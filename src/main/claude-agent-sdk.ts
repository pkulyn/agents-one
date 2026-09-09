import {
  query,
  type ModelInfo,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import { claudeCodeInvocation } from "./claude-code-runtime";
import type { AgentRuntimeTaskInput } from "../shared/agent-runtimes";

export interface ClaudeAgentSdkConfig {
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

function controlExecutablePath(
  config: ClaudeAgentSdkConfig,
): string | undefined {
  const configured = config.executablePath?.trim();
  if (!configured) return undefined;
  return claudeCodeInvocation(configured).command;
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
  send: (text: string) => void;
  waitForCompaction: () => Promise<ClaudeAgentSdkCompaction>;
  waitForTurn: () => Promise<void>;
}

interface PersistentClaudeAgentSdkSession extends ClaudeAgentSdkSession {
  sessionId?: string;
  running: boolean;
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
  await Promise.all(
    sessions.map((session) => session.close().catch(() => undefined)),
  );
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
): Promise<PersistentClaudeAgentSdkSession> {
  const input = new ClaudeInputQueue();
  const active = query({
    prompt: input,
    options: {
      ...(config.workspace?.trim() ? { cwd: config.workspace.trim() } : {}),
      ...(resume?.trim() ? { resume: resume.trim() } : {}),
      ...(controlExecutablePath(config)
        ? { pathToClaudeCodeExecutable: controlExecutablePath(config) }
        : {}),
      includePartialMessages: true,
    },
  });
  let sessionId: string | undefined;
  let closed = false;
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
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      currentTurn?.reject(failure);
      currentTurn = undefined;
      rejectCompaction?.(failure);
    }
  })();
  await withTimeout(
    active.initializationResult(),
    controlTimeout(config),
    "Claude Agent SDK 初始化超时。请确认已配置受支持的 API 凭据。",
  );
  return {
    query: active,
    send: (text) => input.push(sdkUserText(text)),
    get sessionId() {
      return sessionId;
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
    close: async () => {
      if (closed) return;
      closed = true;
      input.close();
      active.close();
      await consume.catch(() => undefined);
    },
  };
}

function persistentSession(
  sessionId: string | undefined,
): PersistentClaudeAgentSdkSession | undefined {
  return sessionId?.trim()
    ? persistentSessions.get(sessionId.trim())
    : undefined;
}

/**
 * Starts a streaming-input SDK turn. The live Query remains attached to the
 * provider session after the turn, so /model, /compact and follow-up prompts
 * operate on exactly the same agent runtime instead of a fresh CLI process.
 */
export async function startClaudeAgentSdkProcess(
  config: ClaudeAgentSdkConfig,
  input: Pick<AgentRuntimeTaskInput, "prompt" | "sessionId">,
  onMessage: (message: SDKMessage) => void,
): Promise<StartedClaudeAgentSdkProcess> {
  const requested = input.sessionId?.trim();
  let session = persistentSession(requested);
  if (!session) {
    session = await createPersistentSession(config, requested);
    if (requested) persistentSessions.set(requested, session);
  }
  const activeSession = session;
  const completion = activeSession
    .runTurn(input.prompt, (message) => {
      const discovered = activeSession.sessionId;
      if (discovered) persistentSessions.set(discovered, activeSession);
      onMessage(message);
    })
    .then(
      (result) => {
        if (result.sessionId)
          persistentSessions.set(result.sessionId, activeSession);
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
      await activeSession.query.interrupt();
    },
    completion,
  };
}

async function withClaudeAgentSdkSession<T>(
  config: ClaudeAgentSdkConfig,
  sessionId: string | undefined,
  operation: (session: ClaudeAgentSdkSession) => Promise<T>,
): Promise<T> {
  const input = new ClaudeInputQueue();
  const active = query({
    prompt: input,
    options: {
      ...(config.workspace?.trim() ? { cwd: config.workspace.trim() } : {}),
      ...(sessionId?.trim() ? { resume: sessionId.trim() } : {}),
      ...(controlExecutablePath(config)
        ? { pathToClaudeCodeExecutable: controlExecutablePath(config) }
        : {}),
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
    } catch (error) {
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
    return await operation({
      query: active,
      send: (text) => input.push(sdkUserText(text)),
      waitForCompaction: () => compaction,
      waitForTurn: () => turn,
    });
  } finally {
    input.close();
    active.close();
    await consume.catch(() => undefined);
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
  const live = persistentSession(sessionId);
  if (live) return live.query.supportedModels();
  return withClaudeAgentSdkSession(config, sessionId, (session) =>
    session.query.supportedModels(),
  );
}

export async function listClaudeAgentSdkCommands(
  config: ClaudeAgentSdkConfig,
  sessionId?: string,
): Promise<SlashCommand[]> {
  const live = persistentSession(sessionId);
  if (live) return live.query.supportedCommands();
  return withClaudeAgentSdkSession(config, sessionId, (session) =>
    session.query.supportedCommands(),
  );
}

export async function setClaudeAgentSdkModel(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  model: string,
): Promise<void> {
  const live = persistentSession(sessionId);
  if (live) {
    await live.query.setModel(model);
    return;
  }
  await withClaudeAgentSdkSession(config, sessionId, (session) =>
    session.query.setModel(model),
  );
}

export async function compactClaudeAgentSdkSession(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  customInstructions?: string,
): Promise<ClaudeAgentSdkCompaction> {
  const live = persistentSession(sessionId);
  if (live) {
    if (live.running) {
      throw new Error("Claude Code 正在执行当前轮次，不能同时压缩上下文。");
    }
    const turn = live.runTurn(
      `/compact${customInstructions?.trim() ? ` ${customInstructions.trim()}` : ""}`,
      () => undefined,
    );
    const result = await withTimeout(
      Promise.all([live.waitForCompaction(), turn]).then(
        ([compact]) => compact,
      ),
      controlTimeout(config),
      "Claude Code 上下文压缩等待超时。",
    );
    return result;
  }
  return withClaudeAgentSdkSession(config, sessionId, async (session) => {
    session.send(
      `/compact${customInstructions?.trim() ? ` ${customInstructions.trim()}` : ""}`,
    );
    return withTimeout(
      session.waitForCompaction(),
      controlTimeout(config),
      "Claude Code 上下文压缩等待超时。",
    );
  });
}

export async function executeClaudeAgentSdkCommand(
  config: ClaudeAgentSdkConfig,
  sessionId: string,
  name: string,
  args?: string,
): Promise<void> {
  const live = persistentSession(sessionId);
  if (live) {
    if (live.running) {
      throw new Error(`Claude Code 正在执行当前轮次，不能同时运行 /${name}。`);
    }
    await withTimeout(
      live.runTurn(
        `/${name}${args?.trim() ? ` ${args.trim()}` : ""}`,
        () => undefined,
      ),
      controlTimeout(config),
      `Claude Code /${name} 命令等待超时。`,
    );
    return;
  }
  await withClaudeAgentSdkSession(config, sessionId, async (session) => {
    session.send(`/${name}${args?.trim() ? ` ${args.trim()}` : ""}`);
    await withTimeout(
      session.waitForTurn(),
      controlTimeout(config),
      `Claude Code /${name} 命令等待超时。`,
    );
  });
}
