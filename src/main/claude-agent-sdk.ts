import {
  query,
  type ModelInfo,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import {
  prepareClaudeSdkPolicy,
  type PreparedClaudeSdkPolicy,
  type ClaudeSdkStartupConfig,
} from "./claude-sdk-policy";
import type { AgentRuntimeTaskInput } from "../shared/agent-runtimes";

export interface ClaudeAgentSdkConfig extends ClaudeSdkStartupConfig {
  executablePath?: string;
  workspace?: string;
  timeoutMs?: number;
}

export interface ClaudeAgentSdkCompaction {
  trigger: "manual" | "auto";
  tokensBefore: number;
  tokensAfter?: number;
}

export interface StartedClaudeAgentSdkProcess {
  /** The provider session id is assigned as soon as the SDK emits it. */
  sessionId?: string;
  cancel: () => Promise<void>;
  completion: Promise<{
    output: string;
    sessionId?: string;
    error?: string;
  }>;
}

const DEFAULT_CONTROL_TIMEOUT_MS = 120_000;

function controlTimeout(config: ClaudeAgentSdkConfig): number {
  const configured = config.timeoutMs;
  if (!configured || !Number.isFinite(configured))
    return DEFAULT_CONTROL_TIMEOUT_MS;
  return Math.min(Math.max(configured, 5_000), 10 * 60_000);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

class ClaudeInputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly items: SDKUserMessage[] = [];
  private waiter:
    | ((result: IteratorResult<SDKUserMessage>) => void)
    | undefined;
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) throw new Error("Claude Agent SDK session is closed.");
    const waiter = this.waiter;
    this.waiter = undefined;
    if (waiter) waiter({ value: message, done: false });
    else this.items.push(message);
  }

  close(): void {
    this.closed = true;
    this.items.length = 0;
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.({ value: undefined, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      const next = await this.next();
      if (next.done) return;
      yield next.value;
    }
  }

  private next(): Promise<IteratorResult<SDKUserMessage>> {
    const item = this.items.shift();
    if (item) return Promise.resolve({ value: item, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

function sdkUserText(text: string): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
  };
}

interface ClaudeAgentSdkSession {
  query: Query;
  policy?: PreparedClaudeSdkPolicy;
  send: (text: string) => void;
  waitForCompaction: () => Promise<ClaudeAgentSdkCompaction>;
  waitForTurn: () => Promise<void>;
}

interface PersistentClaudeAgentSdkSession extends ClaudeAgentSdkSession {
  sessionId?: string;
  running: boolean;
  closed: boolean;
  close: () => Promise<void>;
  runTurn: (
    text: string,
    onMessage: (message: SDKMessage) => void,
  ) => Promise<{
    output: string;
    sessionId?: string;
  }>;
}

const persistentSessions = new Map<string, PersistentClaudeAgentSdkSession>();

/** Closes streaming SDK processes during desktop shutdown. */
export async function closeClaudeAgentSdkSessions(): Promise<void> {
  const sessions = [...new Set(persistentSessions.values())];
  persistentSessions.clear();
  await Promise.all(sessions.map((session) => session.close()));
}

function sdkMessageText(message: SDKMessage): string {
  if (message.type !== "assistant") return "";
  const content = message.message.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const value = item as unknown as { type?: unknown; text?: unknown };
      return value.type === "text" && typeof value.text === "string"
        ? value.text
        : "";
    })
    .join("");
}

function errorText(message: Extract<SDKMessage, { type: "result" }>): string {
  if (message.subtype === "success") return "";
  return message.errors.join("\n") || "Claude Code command failed.";
}

async function createPersistentSession(
  config: ClaudeAgentSdkConfig,
  resume: string | undefined,
  policy: PreparedClaudeSdkPolicy,
): Promise<PersistentClaudeAgentSdkSession> {
  const input = new ClaudeInputQueue();
  policy.assertCurrent();
  const active = query({
    prompt: input,
    options: {
      ...policy.options,
      ...(resume?.trim() ? { resume: resume.trim() } : {}),
      includePartialMessages: true,
    },
  });
  let sessionId: string | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let stopRequested = false;
  const stop = (): void => {
    closed = true;
    if (stopRequested) return;
    stopRequested = true;
    input.close();
    active.close();
  };
  let currentTurn:
    | {
        resolve: (value: { output: string; sessionId?: string }) => void;
        reject: (error: Error) => void;
        onMessage: (message: SDKMessage) => void;
        output: string;
      }
    | undefined;
  let resolveCompaction:
    | ((value: ClaudeAgentSdkCompaction) => void)
    | undefined;
  let rejectCompaction: ((error: Error) => void) | undefined;
  let compaction = new Promise<ClaudeAgentSdkCompaction>((resolve, reject) => {
    resolveCompaction = resolve;
    rejectCompaction = reject;
  });
  void compaction.catch(() => undefined);
  const consume = (async () => {
    try {
      for await (const message of active) {
        sessionId = message.session_id || sessionId;
        currentTurn?.onMessage(message);
        if (currentTurn) currentTurn.output += sdkMessageText(message);
        if (isCompactBoundary(message)) {
          resolveCompaction?.({
            trigger: message.compact_metadata.trigger,
            tokensBefore: message.compact_metadata.pre_tokens,
            ...(typeof message.compact_metadata.post_tokens === "number"
              ? { tokensAfter: message.compact_metadata.post_tokens }
              : {}),
          });
        }
        if (message.type === "result" && currentTurn) {
          const turn = currentTurn;
          currentTurn = undefined;
          if (message.subtype !== "success") {
            turn.reject(new Error(errorText(message)));
          } else {
            turn.resolve({ output: turn.output || message.result, sessionId });
          }
        }
      }
      const failure = new Error(
        "Claude Agent SDK session closed before a result.",
      );
      currentTurn?.reject(failure);
      currentTurn = undefined;
      rejectCompaction?.(failure);
      stop();
    } catch (error) {
      stop();
      const failure = error instanceof Error ? error : new Error(String(error));
      currentTurn?.reject(failure);
      currentTurn = undefined;
      rejectCompaction?.(failure);
    }
  })();
  try {
    await withTimeout(
      active.initializationResult(),
      controlTimeout(config),
      "Claude Agent SDK 初始化超时。请确认已配置受支持的 API 凭据。",
    );
    policy.assertCurrent();
    if (closed)
      throw Error("Claude Agent SDK session closed during initialization.");
  } catch (error) {
    stop();
    await withTimeout(
      consume,
      5000,
      "Claude Agent SDK shutdown was not confirmed.",
    );
    throw error;
  }
  return {
    query: active,
    policy,
    send: (text) => input.push(sdkUserText(text)),
    get sessionId() {
      return sessionId;
    },
    get closed() {
      return closed;
    },
    get running() {
      return Boolean(currentTurn);
    },
    waitForCompaction: () => compaction,
    waitForTurn: async () => {
      if (!currentTurn) return;
      await new Promise<void>((resolve, reject) => {
        const previous = currentTurn;
        if (!previous) return resolve();
        const originalResolve = previous.resolve;
        const originalReject = previous.reject;
        previous.resolve = (value) => {
          originalResolve(value);
          resolve();
        };
        previous.reject = (error) => {
          originalReject(error);
          reject(error);
        };
      });
    },
    runTurn: (text, onMessage) => {
      if (closed)
        return Promise.reject(new Error("Claude Agent SDK session is closed."));
      if (currentTurn)
        return Promise.reject(
          new Error("Claude Agent SDK session is already running."),
        );
      // A compact boundary belongs to the next explicit /compact request.
      compaction = new Promise<ClaudeAgentSdkCompaction>((resolve, reject) => {
        resolveCompaction = resolve;
        rejectCompaction = reject;
      });
      void compaction.catch(() => undefined);
      return new Promise((resolve, reject) => {
        currentTurn = { resolve, reject, onMessage, output: "" };
        input.push(sdkUserText(text));
      });
    },
    close: () => {
      if (!closing) {
        closed = true;
        currentTurn?.reject(
          new Error("Claude Agent SDK session closed before a result."),
        );
        currentTurn = undefined;
        stop();
        closing = withTimeout(
          consume,
          5000,
          "Claude Agent SDK shutdown was not confirmed.",
        );
      }
      return closing;
    },
  };
}

function sessionKey(
  policy: PreparedClaudeSdkPolicy,
  sessionId: string,
): string {
  return JSON.stringify([policy.key, sessionId.trim()]);
}
function rememberSession(
  policy: PreparedClaudeSdkPolicy,
  sessionId: string,
  session: PersistentClaudeAgentSdkSession,
): void {
  persistentSessions.set(sessionKey(policy, sessionId), session);
}
function forgetSession(session: PersistentClaudeAgentSdkSession): void {
  for (const [key, value] of persistentSessions)
    if (value === session) persistentSessions.delete(key);
}
async function persistentSession(
  policy: PreparedClaudeSdkPolicy,
  sessionId?: string,
): Promise<PersistentClaudeAgentSdkSession | undefined> {
  if (!sessionId?.trim()) return undefined;
  const session = persistentSessions.get(sessionKey(policy, sessionId));
  if (!session) return undefined;
  if (
    session.closed ||
    policy.native ||
    session.policy?.fingerprint !== policy.fingerprint
  ) {
    if (session.running)
      throw Error(
        "Claude Agent SDK session is already running with another startup context.",
      );
    forgetSession(session);
    await session.close();
    return undefined;
  }
  policy.assertCurrent();
  return session;
}

async function liveControl<T>(
  session: PersistentClaudeAgentSdkSession,
  config: ClaudeAgentSdkConfig,
  policy: PreparedClaudeSdkPolicy,
  operation: () => Promise<T>,
): Promise<T> {
  policy.assertCurrent();
  try {
    const result = await withTimeout(
      operation(),
      controlTimeout(config),
      "Claude Agent SDK control operation timed out.",
    );
    policy.assertCurrent();
    return result;
  } catch (error) {
    forgetSession(session);
    await session.close();
    throw error;
  }
}

/**
 * Starts a streaming-input SDK turn. The live Query remains attached to the
 * provider session after the turn, so /model, /compact and follow-up prompts
 * operate on exactly the same agent runtime instead of a fresh CLI process.
 */
export async function startClaudeAgentSdkProcess(
  config: ClaudeAgentSdkConfig,
  input: Pick<AgentRuntimeTaskInput, "prompt" | "sessionId" | "model">,
  onMessage: (message: SDKMessage) => void,
  canStart: () => boolean = () => true,
): Promise<StartedClaudeAgentSdkProcess> {
  const policy = await prepareClaudeSdkPolicy(
    { ...config, model: input.model?.trim() || config.model },
    canStart,
  );
  const requested = input.sessionId?.trim();
  let session = await persistentSession(policy, requested);
  if (!session) {
    session = await createPersistentSession(config, requested, policy);
    if (requested) rememberSession(policy, requested, session);
  }
  const activeSession = session;
  if (
    policy.options.model &&
    activeSession.policy?.options.model !== policy.options.model
  ) {
    await liveControl(activeSession, config, policy, () =>
      activeSession.query.setModel(policy.options.model),
    );
    if (activeSession.policy)
      activeSession.policy.options.model = policy.options.model;
  }
  policy.assertCurrent();
  const completion = activeSession
    .runTurn(input.prompt, (message) => {
      const discovered = activeSession.sessionId;
      if (discovered) rememberSession(policy, discovered, activeSession);
      onMessage(message);
    })
    .then(
      (result) => {
        if (result.sessionId)
          rememberSession(policy, result.sessionId, activeSession);
        return result;
      },
      (error) => ({
        output: "",
        ...(activeSession.sessionId
          ? { sessionId: activeSession.sessionId }
          : {}),
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  return {
    ...(activeSession.sessionId ? { sessionId: activeSession.sessionId } : {}),
    cancel: async () => {
      forgetSession(activeSession);
      try {
        await withTimeout(
          activeSession.query.interrupt(),
          5000,
          "Claude Agent SDK interrupt was not confirmed.",
        );
      } finally {
        await activeSession.close();
      }
    },
    completion,
  };
}

async function withClaudeAgentSdkSession<T>(
  config: ClaudeAgentSdkConfig,
  sessionId: string | undefined,
  operation: (session: ClaudeAgentSdkSession) => Promise<T>,
  policy: PreparedClaudeSdkPolicy,
): Promise<T> {
  const input = new ClaudeInputQueue();
  const active = query({
    prompt: input,
    options: {
      ...policy.options,
      ...(sessionId?.trim() ? { resume: sessionId.trim() } : {}),
    },
  });
  let resolveCompaction:
    | ((value: ClaudeAgentSdkCompaction) => void)
    | undefined;
  let rejectCompaction: ((error: Error) => void) | undefined;
  const compaction = new Promise<ClaudeAgentSdkCompaction>(
    (resolve, reject) => {
      resolveCompaction = resolve;
      rejectCompaction = reject;
    },
  );
  // Controls that do not compact never await this promise. Attach a sink so
  // closing their stream cannot turn a normal control operation into an
  // unhandled rejection.
  void compaction.catch(() => undefined);
  let resolveTurn: (() => void) | undefined;
  let rejectTurn: ((error: Error) => void) | undefined;
  const turn = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });
  void turn.catch(() => undefined);
  let streamClosed = false;
  const consume = (async () => {
    try {
      for await (const message of active) {
        if (isCompactBoundary(message)) {
          resolveCompaction?.({
            trigger: message.compact_metadata.trigger,
            tokensBefore: message.compact_metadata.pre_tokens,
            ...(typeof message.compact_metadata.post_tokens === "number"
              ? { tokensAfter: message.compact_metadata.post_tokens }
              : {}),
          });
        }
        if (message.type === "result") {
          if (message.is_error) {
            rejectTurn?.(
              new Error(
                message.subtype === "success"
                  ? message.result
                  : message.errors.join("\n") || "Claude Code command failed.",
              ),
            );
          } else resolveTurn?.();
        }
      }
      streamClosed = true;
      const failure = new Error(
        "Claude Agent SDK session closed before a result.",
      );
      rejectCompaction?.(failure);
      rejectTurn?.(failure);
    } catch (error) {
      streamClosed = true;
      const failure = error instanceof Error ? error : new Error(String(error));
      rejectCompaction?.(failure);
      rejectTurn?.(failure);
    }
  })();
  try {
    await withTimeout(
      active.initializationResult(),
      controlTimeout(config),
      "Claude Agent SDK 初始化超时。请确认已配置受支持的 API 凭据。",
    );
    policy.assertCurrent();
    if (streamClosed)
      throw Error("Claude Agent SDK session closed during initialization.");
    return await withTimeout(
      operation({
        query: active,
        send: (text) => {
          policy.assertCurrent();
          input.push(sdkUserText(text));
        },
        waitForCompaction: () => compaction,
        waitForTurn: () => turn,
      }),
      controlTimeout(config),
      "Claude Agent SDK control operation timed out.",
    );
  } finally {
    input.close();
    active.close();
    await withTimeout(
      consume,
      5000,
      "Claude Agent SDK shutdown was not confirmed.",
    );
  }
}

function isCompactBoundary(
  message: SDKMessage,
): message is Extract<
  SDKMessage,
  { type: "system"; subtype: "compact_boundary" }
> {
  return message.type === "system" && message.subtype === "compact_boundary";
}

export async function listClaudeAgentSdkModels(
  config: ClaudeAgentSdkConfig,
  sessionId?: string,
): Promise<ModelInfo[]> {
  const policy = await prepareClaudeSdkPolicy(config);
  const live = await persistentSession(policy, sessionId);
  if (live)
    return liveControl(live, config, policy, () =>
      live.query.supportedModels(),
    );
  return withClaudeAgentSdkSession(
    config,
    sessionId,
    (session) => session.query.supportedModels(),
    policy,
  );
}

export async function listClaudeAgentSdkCommands(
  config: ClaudeAgentSdkConfig,
  sessionId?: string,
): Promise<SlashCommand[]> {
  const policy = await prepareClaudeSdkPolicy(
    config,
    undefined,
    Boolean(config.nativeContext),
  );
  const live = await persistentSession(policy, sessionId);
  if (live)
    return liveControl(live, config, policy, () =>
      live.query.supportedCommands(),
    );
  return withClaudeAgentSdkSession(
    config,
    sessionId,
    (session) => session.query.supportedCommands(),
    policy,
  );
}

export async function setClaudeAgentSdkModel(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  model: string,
): Promise<void> {
  const policy = await prepareClaudeSdkPolicy(config);
  const live = await persistentSession(policy, sessionId);
  if (live) {
    await liveControl(live, config, policy, () => live.query.setModel(model));
    if (live.policy) live.policy.options.model = model;
    return;
  }
  await withClaudeAgentSdkSession(
    config,
    sessionId,
    (session) => session.query.setModel(model),
    policy,
  );
}

export async function compactClaudeAgentSdkSession(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  customInstructions?: string,
): Promise<ClaudeAgentSdkCompaction> {
  const policy = await prepareClaudeSdkPolicy(config);
  const live = await persistentSession(policy, sessionId);
  if (live) {
    if (live.running) {
      throw new Error("Claude Code 正在执行当前轮次，不能同时压缩上下文。");
    }
    const turn = live.runTurn(
      `/compact${customInstructions?.trim() ? ` ${customInstructions.trim()}` : ""}`,
      () => undefined,
    );
    const result = await liveControl(live, config, policy, () =>
      Promise.all([live.waitForCompaction(), turn]).then(
        ([compact]) => compact,
      ),
    );
    return result;
  }
  return withClaudeAgentSdkSession(
    config,
    sessionId,
    async (session) => {
      session.send(
        `/compact${customInstructions?.trim() ? ` ${customInstructions.trim()}` : ""}`,
      );
      return withTimeout(
        Promise.all([session.waitForCompaction(), session.waitForTurn()]).then(
          ([compact]) => compact,
        ),
        controlTimeout(config),
        "Claude Code 上下文压缩等待超时。",
      );
    },
    policy,
  );
}

export async function executeClaudeAgentSdkCommand(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  name: string,
  args?: string,
): Promise<void> {
  const policy = await prepareClaudeSdkPolicy(config, undefined, true);
  await persistentSession(policy, sessionId);
  await withClaudeAgentSdkSession(
    config,
    sessionId,
    async (session) => {
      session.send(`/${name}${args?.trim() ? ` ${args.trim()}` : ""}`);
      await withTimeout(
        session.waitForTurn(),
        controlTimeout(config),
        `Claude Code /${name} 命令等待超时。`,
      );
    },
    policy,
  );
}
