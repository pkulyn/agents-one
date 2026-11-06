import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type {
  AgentSession,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createOneSession } from "./session";
import type {
  OneWorkerInput,
  OneWorkerOutput,
  OneWorkerTool,
} from "./protocol";

let session: AgentSession | undefined;
let started = false;
let cancelled = false;
let apiKey = "";
const steering: Array<{ requestId: string; text: string }> = [];
let steerChain = Promise.resolve();
let readyAck:
  | { resolve: () => void; reject: (error: Error) => void }
  | undefined;
const pending = new Map<
  string,
  { resolve: (value: string) => void; reject: (error: Error) => void }
>();

function send(message: OneWorkerOutput): void {
  if (!process.connected) return;
  const serialized = JSON.stringify(message, function (key, value) {
    if (key === "data" && this && this.type === "image")
      return "[image omitted]";
    return typeof value === "string" && apiKey
      ? value.replaceAll(apiKey, "[redacted]")
      : value;
  });
  process.send?.(JSON.parse(serialized));
}
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (apiKey ? message.replaceAll(apiKey, "[redacted]") : message).slice(
    0,
    4000,
  );
}
function rejectPending(): void {
  for (const request of pending.values())
    request.reject(new Error("One tool request cancelled"));
  pending.clear();
}
function hostTool(tool: OneWorkerTool): ToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: Type.Unsafe(tool.parameters),
    execute: async (_callId, parameters, signal) => {
      const requestId = randomUUID();
      const content = await new Promise<string>((resolve, reject) => {
        const abort = (): void => {
          pending.delete(requestId);
          reject(new Error("One tool request cancelled"));
        };
        if (signal?.aborted) return abort();
        pending.set(requestId, {
          resolve: (value) => {
            signal?.removeEventListener("abort", abort);
            resolve(value);
          },
          reject: (error) => {
            signal?.removeEventListener("abort", abort);
            reject(error);
          },
        });
        signal?.addEventListener("abort", abort, { once: true });
        send({ type: "tool-call", requestId, toolName: tool.name, parameters });
      });
      return { content: [{ type: "text", text: content }], details: {} };
    },
  };
}
async function start(
  message: Extract<OneWorkerInput, { type: "start" }>,
): Promise<void> {
  if (started) throw new Error("One worker already started");
  started = true;
  apiKey = message.options.apiKey;
  const created = await createOneSession({
    ...message.options,
    onModelCall: (count, limit) =>
      send({ type: "event", event: { type: "one_model_call", count, limit } }),
    tools: message.tools.map(hostTool),
  });
  session = created.session;
  if (cancelled) {
    session.dispose();
    send({ type: "cancelled" });
    return;
  }
  session.subscribe((event) => {
    if (event.type === "message_start" && event.message.role === "user") {
      const content = event.message.content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((item) => item.type === "text")
              .map((item) => item.text)
              .join("");
      const index = steering.findIndex((item) => item.text === text);
      if (index >= 0) {
        const [delivered] = steering.splice(index, 1);
        send({ type: "steer-result", requestId: delivered.requestId });
      }
    }
    send({ type: "event", event });
  });
  await new Promise<void>((resolve, reject) => {
    readyAck = { resolve, reject };
    send({
      type: "ready",
      sessionId: session!.sessionId,
      sessionFile: session!.sessionManager.getSessionFile(),
    });
  });
  if (message.options.revisionBinding) {
    session.sessionManager.appendCustomEntry(
      "agents-one-run-binding-v1",
      message.options.revisionBinding,
    );
  }
  await session.prompt(message.prompt, { images: message.images });
  if (cancelled) {
    send({ type: "cancelled" });
    return;
  }
  const last = session.messages.at(-1);
  if (last?.role === "assistant" && last.stopReason === "error") {
    throw new Error(last.errorMessage || "Model request failed");
  }
  send({
    type: "complete",
    sessionId: session.sessionId,
    output: session.getLastAssistantText() || "",
    sessionFile: session.sessionManager.getSessionFile(),
  });
}
process.on("message", (value: OneWorkerInput) => {
  if (!value || typeof value !== "object") return;
  if (value.type === "start") {
    void start(value).catch((error) =>
      cancelled
        ? send({ type: "cancelled" })
        : send({ type: "error", message: safeError(error) }),
    );
  } else if (value.type === "steer") {
    steerChain = steerChain
      .then(async () => {
        if (cancelled || !session?.isStreaming)
          throw new Error("One task is not accepting input");
        const entry = { requestId: value.requestId, text: value.text };
        steering.push(entry);
        try {
          const disposition = await session.steer(value.text);
          if (disposition !== "queued")
            throw new Error("One input was not queued");
        } catch (error) {
          const index = steering.indexOf(entry);
          if (index >= 0) steering.splice(index, 1);
          throw error;
        }
      })
      .catch((error) =>
        send({
          type: "steer-result",
          requestId: value.requestId,
          error: safeError(error),
        }),
      );
  } else if (value.type === "ready-ack") {
    readyAck?.resolve();
    readyAck = undefined;
  } else if (value.type === "cancel") {
    cancelled = true;
    readyAck?.reject(new Error("One task cancelled"));
    readyAck = undefined;
    rejectPending();
    void session?.abort();
  } else if (value.type === "tool-result") {
    const request = pending.get(value.requestId);
    if (!request) return;
    pending.delete(value.requestId);
    if (value.error) request.reject(new Error(value.error));
    else request.resolve(value.content ?? "");
  }
});
process.on("disconnect", () => {
  readyAck?.reject(new Error("One host disconnected"));
  readyAck = undefined;
  rejectPending();
  session?.dispose();
  process.exit(0);
});
