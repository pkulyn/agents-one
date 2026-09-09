import { spawn } from "child_process";
import { codexInvocation, type CodexRuntimeConfig } from "./codex-runtime";
import { terminateProcessTree } from "./process-control";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function withCodexAppServer<T>(
  config: CodexRuntimeConfig,
  operation: (
    request: (method: string, params?: JsonRecord) => Promise<unknown>,
    waitForNotification: (
      predicate: (method: string, params: JsonRecord | undefined) => boolean,
      timeoutMs?: number,
    ) => Promise<void>,
    onNotification: (
      listener: (method: string, params: JsonRecord | undefined) => void,
    ) => void,
  ) => Promise<T>,
  operationTimeoutMs = 30_000,
): Promise<T> {
  const invocation = codexInvocation(config.executablePath?.trim() || "codex");
  const child = spawn(
    invocation.command,
    [...invocation.prefix, "app-server"],
    {
      env: { ...process.env },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  const notificationWaiters = new Set<{
    predicate: (method: string, params: JsonRecord | undefined) => boolean;
    resolve: () => void;
    reject: (error: Error) => void;
    timeout: NodeJS.Timeout;
  }>();
  const notificationListeners = new Set<
    (method: string, params: JsonRecord | undefined) => void
  >();
  const failAll = (error: Error): void => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    for (const waiter of notificationWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    notificationWaiters.clear();
  };
  const request = (method: string, params?: JsonRecord): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin?.write(
        `${JSON.stringify({ method, id, ...(params ? { params } : {}) })}\n`,
      );
    });
  };
  const waitForNotification = (
    predicate: (method: string, params: JsonRecord | undefined) => boolean,
    timeoutMs = 120_000,
  ): Promise<void> =>
    new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve: () => {
          clearTimeout(waiter.timeout);
          notificationWaiters.delete(waiter);
          resolve();
        },
        reject: (error: Error) => {
          clearTimeout(waiter.timeout);
          notificationWaiters.delete(waiter);
          reject(error);
        },
        timeout: undefined as unknown as NodeJS.Timeout,
      };
      waiter.timeout = setTimeout(
        () => waiter.reject(new Error("Codex 上下文压缩等待超时。")),
        timeoutMs,
      );
      notificationWaiters.add(waiter);
    });
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      try {
        const frame: unknown = JSON.parse(line);
        if (
          isRecord(frame) &&
          typeof frame.id === "number" &&
          pending.has(frame.id)
        ) {
          const handler = pending.get(frame.id)!;
          pending.delete(frame.id);
          if (isRecord(frame.error)) {
            handler.reject(
              new Error(
                typeof frame.error.message === "string"
                  ? frame.error.message
                  : "Codex App Server request failed.",
              ),
            );
          } else handler.resolve(frame.result);
        } else if (isRecord(frame) && typeof frame.method === "string") {
          const params = isRecord(frame.params) ? frame.params : undefined;
          for (const listener of notificationListeners) {
            listener(frame.method, params);
          }
          for (const waiter of [...notificationWaiters]) {
            if (waiter.predicate(frame.method, params)) waiter.resolve();
          }
        }
      } catch {
        // App Server is JSONL; an invalid diagnostic must not corrupt another response.
      }
      newline = buffer.indexOf("\n");
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = `${stderr}${chunk}`.slice(-2_000);
  });
  child.once("error", (error) => failAll(error));
  child.once("close", () =>
    failAll(new Error(stderr || "Codex App Server closed.")),
  );
  const timeout = setTimeout(
    () => failAll(new Error("Codex App Server request timed out.")),
    operationTimeoutMs,
  );
  try {
    await request("initialize", {
      clientInfo: { name: "agents_one", title: "Agents One", version: "0.1.0" },
    });
    child.stdin?.write(
      `${JSON.stringify({ method: "initialized", params: {} })}\n`,
    );
    return await operation(request, waitForNotification, (listener) => {
      notificationListeners.add(listener);
    });
  } finally {
    clearTimeout(timeout);
    child.stdin?.end();
    await terminateProcessTree(child).catch(() => undefined);
  }
}

function isContextCompactionItem(
  method: string,
  params: JsonRecord | undefined,
  threadId: string,
): boolean {
  if (
    (method !== "item/started" && method !== "item/completed") ||
    params?.threadId !== threadId
  ) {
    return false;
  }
  return isRecord(params.item) && params.item.type === "contextCompaction";
}

export interface CodexAppServerModel {
  id: string;
  displayName?: string;
  reasoningEfforts?: string[];
  isDefault?: boolean;
}

export async function listCodexAppServerModels(
  config: CodexRuntimeConfig,
): Promise<CodexAppServerModel[]> {
  return withCodexAppServer(config, async (request) => {
    const result = await request("model/list", {});
    const models =
      isRecord(result) && Array.isArray(result.models) ? result.models : [];
    return models.flatMap((item) => {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim())
        return [];
      const efforts = Array.isArray(item.supportedReasoningEfforts)
        ? item.supportedReasoningEfforts.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      return [
        {
          id: item.id,
          ...(typeof item.displayName === "string"
            ? { displayName: item.displayName }
            : {}),
          ...(efforts.length ? { reasoningEfforts: efforts } : {}),
          ...(item.isDefault === true ? { isDefault: true } : {}),
        },
      ];
    });
  });
}

/** Start native Codex compaction for an already persisted thread. */
export async function compactCodexAppServerThread(
  config: CodexRuntimeConfig,
  threadId: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) throw new Error("Codex thread id is required.");
  await withCodexAppServer(
    config,
    async (request, waitForNotification, onNotification) => {
      await request("thread/resume", { threadId: normalizedThreadId });
      onNotification((method, params) => {
        if (
          method === "item/started" &&
          isContextCompactionItem(method, params, normalizedThreadId)
        ) {
          onProgress?.("Codex 正在压缩当前会话上下文…");
        }
        if (
          method === "item/completed" &&
          isContextCompactionItem(method, params, normalizedThreadId)
        ) {
          onProgress?.("Codex 已完成上下文压缩，正在同步结果…");
        }
      });
      const completed = waitForNotification(
        (method, params) =>
          method === "item/completed" &&
          isContextCompactionItem(method, params, normalizedThreadId),
      );
      onProgress?.("已请求 Codex 压缩当前会话上下文…");
      await request("thread/compact/start", {
        threadId: normalizedThreadId,
      });
      await completed;
    },
    120_000,
  );
}
