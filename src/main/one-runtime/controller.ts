import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { OneToolCleanupError } from "./cleanup-error";
import type { OneModelApiType } from "../../shared/one-model-api";
import type {
  OneWorkerInput,
  OneWorkerOutput,
  OneWorkerTool,
} from "./protocol";

export interface OneWorkerOptions {
  workerPath: string;
  workspace: string;
  stateDir: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  apiType?: OneModelApiType;
  contextWindow?: number;
  maxOutputTokens?: number;
  maxModelCalls?: number;
  imageInput?: boolean;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high";
  operation?: "compact";
  customInstructions?: string;
  images?: Array<{ type: "image"; data: string; mimeType: string }>;
  prompt: string;
  systemPrompt?: string;
  sessionId?: string;
  revisionBinding?: {
    runId: string;
    definitionRevision: string;
    snapshotHash: string;
  };
  tools: OneWorkerTool[];
  /** Main must authorize and execute every tool request; no worker grant is implicit. */
  executeTool: (
    name: string,
    parameters: unknown,
    signal: AbortSignal,
  ) => Promise<string>;
  onEvent?: (event: unknown) => void;
  onReady?: (sessionId: string, sessionFile?: string) => void | Promise<void>;
}
export interface OneWorkerResult {
  sessionId: string;
  output: string;
  sessionFile?: string;
}
export interface OneWorkerHandle {
  completion: Promise<OneWorkerResult>;
  cancel(): void;
  steer(text: string): Promise<void>;
}

/** Start a single task in an app-owned process. It cannot authorize its own tools. */
export function startOneWorker(options: OneWorkerOptions): OneWorkerHandle {
  const toolNames = new Set(options.tools.map((tool) => tool.name));
  const abort = new AbortController();
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  const child: ChildProcess = fork(options.workerPath, [], {
    execPath: process.execPath,
    execArgv: [],
    env,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let settled = false;
  let cancelled = false;
  let cancelTimer: ReturnType<typeof setTimeout> | undefined;
  const sentRequests = new Set<string>();
  const pendingSteers = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  const activeTools = new Set<Promise<void>>();
  let cleanupFailed = false;
  let resolveCompletion!: (result: OneWorkerResult) => void;
  let rejectCompletion!: (error: Error) => void;
  const completion = new Promise<OneWorkerResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  const redact = (message: string): string =>
    options.apiKey ? message.replaceAll(options.apiKey, "[redacted]") : message;
  const stop = (): void => {
    if (cancelTimer) clearTimeout(cancelTimer);
    abort.abort();
    for (const request of pendingSteers.values())
      request.reject(new Error("One task ended before input was delivered"));
    pendingSteers.clear();
    if (child.connected) child.disconnect();
  };
  const fail = (message: string): void => {
    if (settled) return;
    settled = true;
    stop();
    const pending = [...activeTools];
    if (!pending.length) {
      rejectCompletion(
        new Error(
          cleanupFailed
            ? "One tool cleanup could not be confirmed"
            : redact(message),
        ),
      );
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), 8000);
    });
    void Promise.race([
      Promise.allSettled(pending).then(() => true as const),
      deadline,
    ]).then((cleaned) => {
      if (timer) clearTimeout(timer);
      rejectCompletion(
        new Error(
          cleaned && !cleanupFailed
            ? redact(message)
            : "One tool cleanup could not be confirmed",
        ),
      );
    });
  };
  const send = (message: OneWorkerInput): void => {
    if (child.connected && !settled)
      child.send(message, (error) => {
        if (error) fail(error.message);
      });
  };
  child.on("error", (error) => fail(error.message));
  child.on("exit", (code, signal) =>
    fail(
      cancelled
        ? "One task cancelled"
        : "One worker exited unexpectedly (" + (signal || code) + ").",
    ),
  );
  child.on("message", (message: OneWorkerOutput) => {
    if (settled || !message || typeof message !== "object") return;
    if (message.type === "ready") {
      void (async () => {
        try {
          await options.onReady?.(message.sessionId, message.sessionFile);
          if (!cancelled) send({ type: "ready-ack" });
        } catch {
          fail(
            cancelled
              ? "One task cancelled"
              : "Could not save the One session binding",
          );
        }
      })();
    } else if (message.type === "event") {
      try {
        options.onEvent?.(message.event);
      } catch {
        /* Consumer failures must not crash the runtime. */
      }
    } else if (message.type === "steer-result") {
      const request = pendingSteers.get(message.requestId);
      if (!request) return;
      pendingSteers.delete(message.requestId);
      if (message.error) request.reject(new Error(redact(message.error)));
      else request.resolve();
    } else if (message.type === "tool-call") {
      if (
        cancelled ||
        typeof message.requestId !== "string" ||
        sentRequests.has(message.requestId) ||
        !toolNames.has(message.toolName)
      ) {
        fail("One worker sent an invalid tool request.");
        return;
      }
      if (sentRequests.size >= 64) {
        fail("One reached the per-run tool call limit");
        return;
      }
      sentRequests.add(message.requestId);
      const pendingTool = Promise.resolve()
        .then(() =>
          options.executeTool(
            message.toolName,
            message.parameters,
            abort.signal,
          ),
        )
        .then(
          (content) =>
            send({
              type: "tool-result",
              requestId: message.requestId,
              content,
            }),
          (error: unknown) => {
            if (error instanceof OneToolCleanupError) cleanupFailed = true;
            send({
              type: "tool-result",
              requestId: message.requestId,
              error: redact(
                error instanceof Error ? error.message : String(error),
              ),
            });
          },
        );
      activeTools.add(pendingTool);
      void pendingTool.finally(() => activeTools.delete(pendingTool));
    } else if (message.type === "complete") {
      if (activeTools.size) {
        fail("One worker completed while a tool was still running");
        return;
      }
      if (cancelled) {
        fail("One task cancelled");
        return;
      }
      settled = true;
      stop();
      resolveCompletion({
        sessionId: message.sessionId,
        output: message.output,
        sessionFile: message.sessionFile,
      });
    } else if (message.type === "cancelled") {
      fail("One task cancelled");
    } else if (message.type === "error") {
      fail(message.message);
    }
  });
  const {
    workspace,
    stateDir,
    baseUrl,
    modelId,
    apiKey,
    apiType,
    contextWindow,
    maxOutputTokens,
    maxModelCalls,
    imageInput,
    thinkingLevel,
    operation,
    customInstructions,
    images,
    systemPrompt,
    sessionId,
    revisionBinding,
    prompt,
    tools,
  } = options;
  send({
    type: "start",
    options: {
      workspace,
      stateDir,
      baseUrl,
      modelId,
      apiKey,
      apiType,
      contextWindow,
      maxOutputTokens,
      maxModelCalls,
      imageInput,
      thinkingLevel,
      operation,
      customInstructions,
      systemPrompt,
      sessionId,
      revisionBinding,
    },
    prompt,
    images,
    tools,
  });
  return {
    completion,
    steer(text) {
      if (settled || cancelled || !child.connected)
        return Promise.reject(new Error("One task is not running"));
      const requestId = randomUUID();
      return new Promise<void>((resolve, reject) => {
        pendingSteers.set(requestId, { resolve, reject });
        send({ type: "steer", requestId, text });
      });
    },
    cancel() {
      if (settled || cancelled) return;
      cancelled = true;
      for (const request of pendingSteers.values())
        request.reject(
          new Error("One task cancelled before input was delivered"),
        );
      pendingSteers.clear();
      abort.abort();
      send({ type: "cancel" });
      cancelTimer = setTimeout(() => {
        child.kill();
        fail("One task cancelled");
      }, 3000);
      cancelTimer.unref();
    },
  };
}
