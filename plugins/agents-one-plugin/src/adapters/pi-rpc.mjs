import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeEventText } from "../event-stream.mjs";
import { openJsonlRpc } from "./jsonl-rpc.mjs";
import {
  PI_READ_TOOLS,
  PI_WORKSPACE_PROBE,
  PI_WRITE_TOOLS,
  resolvePiToolPath,
} from "./pi-workspace-policy.mjs";
import {
  readWorkspaceArtifact,
  resolveHostWorkspace,
  resolveWorkspaceToolPath,
} from "./remote-workspace.mjs";

const manifest = {
  adapterId: "pi-rpc",
  vendorId: "badlogic",
  version: "0.1.0",
  displayName: "Pi Agent",
  protocol: "pi-jsonl-rpc",
};
const modes = ["analysis", "safe_write"];
const capabilities = {
  eventStream: {
    toolEvents: true,
    modelMetadata: true,
    reasoningSummaries: true,
    usageMetadata: true,
  },
  tasks: { start: true, get: true, cancel: true },
  permissions: { interactive: false, modes },
  sessions: { create: true, resume: true },
  artifacts: { publish: true, download: true },
};
const extension = fileURLToPath(
  new URL("./pi-workspace-policy.mjs", import.meta.url),
);
const MAX_OUTPUT = 512 * 1024;

function summarize(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return sanitizeEventText(value, 4_000);
  try {
    return sanitizeEventText(JSON.stringify(value), 4_000);
  } catch {
    return undefined;
  }
}

function sessionOptions(options, cwd, sessionId) {
  if (!options.sessionDirectory || !isAbsolute(options.sessionDirectory))
    throw new Error("Pi requires an absolute Host-owned session directory.");
  const bucket = createHash("sha256").update(cwd).digest("hex");
  mkdirSync(options.sessionDirectory, { recursive: true, mode: 0o700 });
  const root = realpathSync(options.sessionDirectory);
  const configured = join(root, bucket);
  mkdirSync(configured, { recursive: true, mode: 0o700 });
  const dir = resolveHostWorkspace(root, bucket);
  if (dir !== configured)
    throw new Error("Pi session directory must not be redirected.");
  if (!sessionId) return ["--session-dir", dir];
  if (typeof sessionId !== "string" || !/^[A-Za-z0-9-]{8,80}$/.test(sessionId))
    throw new Error("Pi native session ID is invalid.");
  const matches = readdirSync(dir, { withFileTypes: true }).filter(
    (entry) =>
      entry.isFile() &&
      (entry.name === sessionId + ".jsonl" ||
        entry.name.endsWith("_" + sessionId + ".jsonl")),
  );
  const path =
    matches.length === 1 &&
    resolveWorkspaceToolPath(dir, matches[0].name, false);
  if (!path)
    throw new Error("Pi native session is unavailable for this workspace.");
  return ["--session-dir", dir, "--session", path];
}

function openPi(
  options,
  cwd,
  mode,
  sessionId,
  tools,
  onMessage,
  probe = false,
) {
  const command = options.executablePath || "pi";
  if (/\.(cmd|bat|ps1)$/i.test(command))
    throw new Error("Pi Host needs a directly executable command.");
  const env = {};
  const keys = [
    "PATH",
    "Path",
    "SystemRoot",
    "WINDIR",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "XDG_CONFIG_HOME",
    "LANG",
    "PI_CODING_AGENT_DIR",
  ];
  for (const key of [...keys, ...(options.allowedEnv || [])]) {
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      continue;
    const value = options.env?.[key] ?? process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  env.AGENTS_ONE_PI_WORKSPACE = cwd;
  env.AGENTS_ONE_PI_MODE = mode;
  return openJsonlRpc({
    command,
    cwd,
    env,
    onMessage,
    pi: true,
    args: [
      ...(options.executableArgs || []),
      "--mode",
      "rpc",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--extension",
      extension,
      "--tools",
      tools.join(","),
      ...(probe ? ["--no-session"] : sessionOptions(options, cwd, sessionId)),
    ],
  });
}

async function inspectPi(client) {
  const catalog = await client.request("get_commands", {});
  if (
    !Array.isArray(catalog?.commands) ||
    !catalog.commands.some(
      (command) =>
        command.name === PI_WORKSPACE_PROBE && command.source === "extension",
    )
  )
    throw new Error("Pi did not load the Host workspace policy.");
  return client.request("get_state", {});
}

function emit(run, context, type, data) {
  context.emit({ id: `${run.id}:${++run.sequence}`, type, data });
}

async function executePi(run, input, context, options) {
  let status = "failed";
  let timer;
  try {
    const text = input.input?.text || "";
    if (/^\s*\/[A-Za-z0-9_-]+(?:\s|$)/.test(text))
      throw new Error(
        "Native slash commands are not enabled for this Host Runtime.",
      );
    const mode =
      input.execution?.permissionMode ||
      input.input?.permissionMode ||
      (input.execution?.permission === "write" ? undefined : "analysis");
    if (!modes.includes(mode))
      throw new Error("Pi Host supports only analysis and safe_write.");
    const cwd = resolveHostWorkspace(
      options.workspaceRoot,
      input.workspace || input.input?.workspace,
    );
    const tools =
      mode === "analysis"
        ? PI_READ_TOOLS
        : [...PI_READ_TOOLS, ...PI_WRITE_TOOLS];
    const requested = input.sessionId || input.input?.sessionId;
    const writes = new Map();
    const results = new Set();
    let complete;
    const completed = new Promise((resolve) => {
      complete = resolve;
    });
    const handle = (frame) => {
      if (!run.prompted) return;
      // A native abort still reports settlement; dropping it while cancelled
      // would stall the executor until the prompt timeout instead of letting
      // cancellation converge with the Runtime slot freed promptly.
      const settlement =
        frame.type === "agent_end" || frame.type === "agent_settled";
      if (run.cancelled && !settlement) return;
      if (
        frame.type === "message_update" &&
        frame.assistantMessageEvent?.type === "text_delta"
      ) {
        const delta = frame.assistantMessageEvent.delta;
        if (typeof delta === "string") {
          run.output = (run.output + delta).slice(-MAX_OUTPUT);
          emit(run, context, "assistant.delta", { text: delta });
        }
      }
      if (
        frame.type === "message_update" &&
        frame.assistantMessageEvent?.type === "thinking_delta" &&
        typeof frame.assistantMessageEvent.delta === "string"
      ) {
        // Pi streams reasoning the same way OpenCode does; presenting it
        // keeps the desktop trace consistent across remote runtimes.
        emit(run, context, "reasoning.summary", {
          reasoningSummary: frame.assistantMessageEvent.delta,
        });
      }
      const callId = frame.toolCallId;
      if (
        frame.type === "tool_execution_start" &&
        typeof callId === "string" &&
        tools.includes(frame.toolName)
      ) {
        const path = resolvePiToolPath(cwd, tools, frame.toolName, frame.args);
        if (
          path &&
          PI_WRITE_TOOLS.includes(frame.toolName) &&
          writes.size < 128
        )
          writes.set(callId, path);
        emit(run, context, "tool.started", {
          tool: {
            callId,
            name: frame.toolName,
            kind: "workspace",
            ...(summarize(frame.args)
              ? { inputSummary: summarize(frame.args) }
              : {}),
          },
        });
      }
      if (
        frame.type === "tool_execution_end" &&
        typeof callId === "string" &&
        tools.includes(frame.toolName)
      ) {
        const path = writes.get(callId);
        if (path && frame.isError === false && results.size < 128)
          results.add(path);
        writes.delete(callId);
        emit(run, context, frame.isError ? "tool.failed" : "tool.completed", {
          tool: { callId, name: frame.toolName, kind: "workspace" },
        });
      }
      if (frame.type === "agent_end" || frame.type === "agent_settled") {
        const lastAssistant = Array.isArray(frame.messages)
          ? frame.messages.findLast((item) => item.role === "assistant")
          : undefined;
        const usageSource = lastAssistant?.usage ?? frame.usage;
        if (
          usageSource &&
          Number.isFinite(usageSource.input) &&
          Number.isFinite(usageSource.output)
        ) {
          run.usage = {
            inputTokens: Math.floor(usageSource.input),
            outputTokens: Math.floor(usageSource.output),
            ...(Number.isFinite(usageSource.totalTokens)
              ? { totalTokens: Math.floor(usageSource.totalTokens) }
              : {}),
          };
        }
        const reason = frame.stopReason || lastAssistant?.stopReason;
        complete(
          reason === "error" || reason === "aborted" ? "failed" : "succeeded",
        );
      }
    };
    const client = openPi(options, cwd, mode, requested, tools, handle);
    run.client = client;
    const state = await inspectPi(client);
    if (
      typeof state?.sessionId !== "string" ||
      !state.sessionId ||
      (requested && state.sessionId !== requested)
    )
      throw new Error("Pi did not return the expected native session.");
    run.sessionId = state.sessionId;
    if (typeof state.model?.id === "string")
      run.model = {
        id: state.model.id,
        ...(typeof state.model.provider === "string"
          ? { provider: state.model.provider }
          : {}),
      };
    if (run.cancelled) return;
    run.prompted = true;
    const acknowledgement = await client.request("prompt", {
      message: text,
    });
    if (acknowledgement?.disposition === "handled")
      throw new Error(
        "Pi handled this input as a CLI command instead of starting an agent turn.",
      );
    const max = Number(options.promptTimeoutMs);
    const outcome = await Promise.race([
      completed,
      client.failed.then((error) => {
        throw error;
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Pi turn timed out.")),
          Number.isFinite(max) && max > 0 ? Math.min(max, 3_600_000) : 300_000,
        );
      }),
    ]);
    if (outcome !== "succeeded") throw new Error("Pi native turn failed.");
    if (run.cancelled) return;
    if (run.output)
      emit(run, context, "assistant.completed", {
        text: run.output,
        model: run.model,
        ...(run.usage ? { usage: run.usage } : {}),
      });
    for (const path of results) {
      const bytes = readWorkspaceArtifact(cwd, path);
      if (bytes && !run.cancelled)
        await context.publishArtifact?.({
          name: basename(path),
          mime: "text/plain",
          bytes,
        });
    }
    status = "succeeded";
  } catch (cause) {
    if (!run.cancelled)
      run.error = sanitizeEventText(
        cause instanceof Error ? cause.message : String(cause),
      );
  } finally {
    clearTimeout(timer);
    try {
      await run.client?.close();
    } catch {
      run.error = "Pi RPC shutdown could not be confirmed.";
      status = "failed";
    }
    run.status = run.cancelled && !run.error ? "cancelled" : status;
  }
}

export function createPiRpcAdapter(options = {}) {
  const runs = new Map();
  return {
    manifest,
    capabilities,
    async probe() {
      let client;
      try {
        const cwd = resolveHostWorkspace(options.workspaceRoot);
        client = openPi(
          options,
          cwd,
          "analysis",
          undefined,
          PI_READ_TOOLS,
          undefined,
          true,
        );
        await inspectPi(client);
        await client.close();
        return { healthy: true, capabilities, manifest };
      } catch (cause) {
        return {
          healthy: false,
          capabilities: {},
          message: sanitizeEventText(
            cause instanceof Error ? cause.message : String(cause),
          ),
        };
      } finally {
        await client?.close().catch(() => undefined);
      }
    },
    async startRun(input, context) {
      const id = `pi_${randomUUID()}`;
      const run = { id, status: "running", output: "", sequence: 0 };
      runs.set(id, run);
      run.completion = executePi(run, input, context, options);
      return { vendorRunId: id, status: "running" };
    },
    async getRun(id) {
      const run = runs.get(id);
      if (!run) return { status: "failed", error: "Pi run is unavailable." };
      const { status, output, sessionId, model, error } = run;
      return { status, output, sessionId, model, error };
    },
    async cancelRun(id) {
      const run = runs.get(id);
      if (!run || run.status !== "running") return false;
      run.cancelled = true;
      if (run.prompted)
        await run.client.request("abort", {}, 2_000).catch(() => undefined);
      await run.client?.close().catch(() => undefined);
      await Promise.race([
        run.completion,
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
      // close() already tore down the native process. A stalled executor
      // must not hold the Runtime's concurrency slot open past the teardown
      // window; the late executor settle lands on the same terminal status.
      if (run.status === "running" && run.cancelled) run.status = "cancelled";
      return run.status === "cancelled";
    },
  };
}
