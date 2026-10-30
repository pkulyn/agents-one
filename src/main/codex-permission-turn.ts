import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { terminateProcessTree } from "./process-control";
import { redactSensitiveText } from "../shared/redaction";
import type { RuntimePermissionBridge } from "./runtime-tool-permissions";
import type { CodexProcessResult, StartedCodexProcess } from "./codex-runtime";
import type { RuntimeInputArtifact } from "../shared/agent-runtimes";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

/** Automatic Codex turns need bidirectional tool approval, unavailable in exec JSONL. */
export async function startCodexPermissionTurn(options: {
  invocation: { command: string; prefix: string[] };
  cwd: string;
  prompt: string;
  model?: string;
  sessionId?: string;
  imagePaths: string[];
  inputArtifacts: RuntimeInputArtifact[];
  environment: NodeJS.ProcessEnv;
  bridge: RuntimePermissionBridge;
  onOutput(chunk: string): void;
}): Promise<StartedCodexProcess> {
  const child = spawn(
    options.invocation.command,
    [...options.invocation.prefix, "app-server"],
    {
      cwd: options.cwd,
      env: options.environment,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  const decoder = new StringDecoder("utf8");
  let buffer = "",
    output = "",
    stderr = "",
    nextId = 1,
    sessionId = options.sessionId,
    cancelled = false,
    done = false;
  const items = new Map<string, RecordValue>();
  let latestUsage: RecordValue | undefined;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }
  >();
  let resolveCompletion!: (result: CodexProcessResult) => void;
  const completion = new Promise<CodexProcessResult>((resolve) => {
    resolveCompletion = resolve;
  });
  const send = (frame: unknown): void => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify(frame) + "\n");
  };
  const emit = (frame: unknown): void => {
    const line = redactSensitiveText(JSON.stringify(frame)) + "\n";
    output = (output + line).slice(-512 * 1024);
    options.onOutput(line);
  };
  const request = (method: string, params: RecordValue): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Codex control request timed out: " + method));
      }, 30000);
      pending.set(id, { resolve, reject, timer });
      send({ id, method, params });
    });
  const finish = async (error?: string): Promise<void> => {
    if (done) return;
    done = true;
    for (const value of pending.values()) {
      clearTimeout(value.timer);
      value.reject(Error(error || "Codex turn ended"));
    }
    pending.clear();
    await terminateProcessTree(child).catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(Error("Codex process closure was not confirmed")),
            5000,
          );
        }),
      ]);
    } catch (closeError) {
      error = String(closeError);
    } finally {
      if (timer) clearTimeout(timer);
    }
    resolveCompletion({
      output,
      ...(sessionId ? { sessionId } : {}),
      ...(error ? { error } : {}),
      artifacts: [],
      inputArtifacts: options.inputArtifacts,
    });
  };
  const handle = async (frame: RecordValue): Promise<void> => {
    const params = record(frame.params);
    if (frame.method && frame.id !== undefined) {
      let allowed = false;
      const method = String(frame.method);
      if (!cancelled && (!params.threadId || params.threadId === sessionId)) {
        if (
          /commandExecution\/requestApproval|execCommandApproval/.test(method)
        ) {
          allowed = await options.bridge.authorize("command", {
            command: params.command || [],
            cwd: params.cwd,
          });
        } else if (
          /fileChange\/requestApproval|applyPatchApproval/.test(method)
        ) {
          const item = items.get(String(params.itemId)) || {};
          const changes = params.fileChanges || params.changes || item.changes;
          // Missing patch intent must not silently authorize an unknown deletion.
          allowed =
            Boolean(changes) &&
            (await options.bridge.authorize("file_change", { changes }));
        } else {
          send({
            id: frame.id,
            error: { code: -32601, message: "Unsupported approval request" },
          });
          return;
        }
      }
      const legacy = /execCommandApproval|applyPatchApproval/.test(method);
      send({
        id: frame.id,
        result: {
          decision:
            allowed && !cancelled && !done
              ? legacy
                ? "approved"
                : "accept"
              : legacy
                ? "denied"
                : "decline",
        },
      });
      return;
    }
    if (typeof frame.id === "number" && pending.has(frame.id)) {
      const value = pending.get(frame.id)!;
      pending.delete(frame.id);
      clearTimeout(value.timer);
      if (frame.error)
        value.reject(
          Error(String(record(frame.error).message || "Codex control error")),
        );
      else value.resolve(frame.result);
      return;
    }
    const method = String(frame.method || "");
    if (method === "thread/started") {
      const id = record(params.thread).id;
      if (typeof id === "string") sessionId = id;
    }
    if (params.threadId && sessionId && params.threadId !== sessionId) return;
    if (method === "item/started" || method === "item/completed") {
      const item = record(params.item);
      items.set(String(item.id), item);
      const types: Record<string, string> = {
        agentMessage: "agent_message",
        reasoning: "reasoning",
        commandExecution: "command_execution",
        fileChange: "file_change",
        mcpToolCall: "mcp_tool_call",
        webSearch: "web_search",
      };
      if (types[String(item.type)])
        emit({
          type: method === "item/started" ? "item.started" : "item.completed",
          item: {
            ...item,
            type: types[String(item.type)],
            text:
              item.text ||
              (Array.isArray(item.summary)
                ? item.summary.join("\n")
                : undefined),
            aggregated_output: item.aggregatedOutput,
            exit_code: item.exitCode,
          },
        });
    }
    if (/reasoning.*Delta|reasoning\/.*Delta|reasoning\/.*delta/.test(method))
      emit({
        type: "item.updated",
        item: { id: params.itemId, type: "reasoning", text: params.delta },
      });
    if (method === "thread/tokenUsage/updated") {
      const usage = record(record(params.tokenUsage).last);
      latestUsage = {
        input_tokens: usage.inputTokens,
        cached_input_tokens: usage.cachedInputTokens,
        output_tokens: usage.outputTokens,
      };
    }
    if (method === "turn/completed") {
      const turn = record(params.turn);
      const error = record(turn.error).message;
      emit({
        type: "turn.completed",
        ...(params.usage || latestUsage
          ? { usage: params.usage || latestUsage }
          : {}),
      });
      void finish(
        turn.status === "failed"
          ? String(error || "Codex turn failed")
          : cancelled
            ? "Codex turn was cancelled."
            : undefined,
      );
    }
    if (method === "error" && !params.willRetry)
      void finish(String(record(params.error).message || "Codex error"));
  };
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        void handle(record(JSON.parse(line))).catch(
          (error) => void finish(String(error)),
        );
      } catch {
        /* Ignore non-protocol diagnostics. */
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr = redactSensitiveText((stderr + chunk).slice(-4000));
  });
  child.once("error", (error) => void finish(error.message));
  child.once("close", () => {
    if (!done)
      void finish(
        stderr || "Codex App Server closed before the turn completed.",
      );
  });
  try {
    await request("initialize", {
      clientInfo: { name: "agents_one", title: "Agents One", version: "0.1.0" },
    });
    send({ method: "initialized", params: {} });
    const config = {
      cwd: options.cwd,
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      ...(options.model ? { model: options.model } : {}),
    };
    const response = record(
      await request(sessionId ? "thread/resume" : "thread/start", {
        ...config,
        ...(sessionId ? { threadId: sessionId } : {}),
      }),
    );
    const id = record(response.thread).id;
    if (typeof id !== "string" || (sessionId && sessionId !== id))
      throw Error("Codex returned a mismatched thread");
    sessionId = id;
    emit({ type: "thread.started", thread_id: id });
    if (cancelled || options.bridge.isActive?.() === false)
      throw Error("Codex task was cancelled before dispatch");
    await request("turn/start", {
      threadId: id,
      cwd: options.cwd,
      approvalPolicy: "untrusted",
      approvalsReviewer: "user",
      input: [
        { type: "text", text: options.prompt },
        ...options.imagePaths.map((path) => ({ type: "localImage", path })),
      ],
    });
  } catch (error) {
    void finish(error instanceof Error ? error.message : String(error));
  }
  return {
    inputArtifacts: options.inputArtifacts,
    completion,
    cancel: async () => {
      cancelled = true;
      await finish("Codex task was cancelled.");
    },
  };
}
