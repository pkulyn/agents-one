import { randomUUID } from "node:crypto";
import { basename, relative } from "node:path";
import {
  readWorkspaceArtifact,
  resolveHostWorkspace,
  resolveWorkspaceToolPath,
} from "./remote-workspace.mjs";
import { sanitizeEventText } from "../event-stream.mjs";
import { openJsonlRpc } from "./jsonl-rpc.mjs";

const BASE_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "LANG",
  "LC_ALL",
];
const MANIFEST = {
  adapterId: "codex-app-server",
  vendorId: "openai",
  version: "0.1.0",
  displayName: "Codex App Server",
  protocol: "codex-app-server",
};
const CAPABILITIES = {
  eventStream: { toolEvents: true, modelMetadata: true },
  tasks: { start: true, get: true, cancel: true },
  permissions: { interactive: false, modes: ["analysis"] },
  sessions: { create: true, resume: true },
  artifacts: { download: false },
};
const CLIENT = {
  name: "agents_one_host",
  title: "Agents One Remote CLI Host",
  version: "0.1.0",
};
const MAX_OUTPUT_CHARS = 512 * 1024;

function openCodex(options, cwd, onMessage) {
  const command = options.executablePath || "codex";
  if (/\.(cmd|bat|ps1)$/i.test(command))
    throw new Error(
      "Codex Host requires a native executable or a directly executable command.",
    );
  const env = {};
  for (const key of [...BASE_ENV_KEYS, ...(options.allowedEnv || [])]) {
    if (typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      continue;
    const value = options.env?.[key] ?? process.env[key];
    if (typeof value === "string") env[key] = value;
  }
  return openJsonlRpc({
    command,
    args: options.appServerArgs || ["app-server", "--listen", "stdio://"],
    cwd,
    env,
    onMessage,
  });
}

async function initialize(client) {
  const info = await client.request("initialize", {
    clientInfo: CLIENT,
    capabilities: { experimentalApi: true },
  });
  client.send({ method: "initialized", params: {} });
  return info;
}

// T3 Code maps its runtime modes onto Codex's native sandbox modes and
// approval policies; OS-enforced read scopes are deliberately not requested
// because the unelevated Windows sandbox cannot enforce them and fails closed
// (codex-rs/sandboxing/src/windows.rs). Writes stay confined by Codex's own
// workspace-write sandbox and anything it denies escalates to native
// approvals, which the Host still gates per tool call.
function sandboxFor(writing) {
  return writing ? "workspace-write" : "read-only";
}

function approvalPolicyFor(writing) {
  return writing ? "on-request" : "never";
}

function requestedMode(input) {
  return (
    input.execution?.permissionMode ||
    input.input?.permissionMode ||
    (input.execution?.permission === "write" ? "safe_write" : "analysis")
  );
}

function validatedPatch(cwd, changes) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 64)
    return undefined;
  const paths = [];
  const outputs = [];
  let deletion = false;
  for (const change of changes) {
    const kind =
      typeof change?.kind === "string" ? change.kind : change?.kind?.type;
    if (!["add", "update", "delete"].includes(kind) || change?.kind?.movePath)
      return undefined;
    const path = resolveWorkspaceToolPath(cwd, change?.path, kind === "add");
    if (!path || path === cwd) return undefined;
    paths.push(relative(cwd, path).replaceAll("\\", "/"));
    if (kind === "delete") deletion = true;
    else outputs.push(path);
  }
  return { deletion, paths, outputs };
}

function emit(run, context, type, data) {
  context.emit({ id: `${run.id}:${++run.sequence}`, type, data });
}

function toolEvent(frame, run, context) {
  const tool = frame.params?.item;
  const kind = {
    commandExecution: "terminal",
    fileChange: "workspace",
    mcpToolCall: "mcp",
    webSearch: "tool",
  }[tool?.type];
  if (typeof kind !== "string" || typeof tool.id !== "string") return;
  const name = {
    terminal: "Codex command",
    workspace: "Codex file change",
    mcp: "Codex MCP tool",
    tool: "Codex web search",
  }[kind];
  const type =
    frame.method === "item/started"
      ? "tool.started"
      : tool.status === "failed" || tool.status === "declined"
        ? "tool.failed"
        : "tool.completed";
  emit(run, context, type, { tool: { callId: tool.id, name, kind } });
}

async function execute(run, input, context, options) {
  let timer;
  let terminalStatus = "failed";
  let cwd;
  const mode = requestedMode(input);
  const writing =
    mode === "safe_write" && options.allowWorkspaceWrites === true;
  const proposed = new Map();
  const approved = new Map();
  const completedFiles = new Set();
  let completeTurn;
  const completed = new Promise((resolve) => {
    completeTurn = resolve;
  });
  const early = [];
  const decide = async (frame, params) => {
    const request = params && proposed.get(params.itemId);
    const sameTurn =
      params?.threadId === run.sessionId &&
      params?.turnId === run.turnId &&
      Boolean(run.turnId);
    let accept = false;
    if (
      frame.method === "item/fileChange/requestApproval" &&
      writing &&
      sameTurn &&
      request &&
      !params.grantRoot &&
      !run.cancelRequested
    ) {
      proposed.delete(params.itemId);
      try {
        accept =
          (await context.authorizeTool?.(
            request.deletion ? "delete_file" : "file_change",
            { paths: request.paths },
          )) === true && !run.cancelRequested;
      } catch {
        accept = false;
      }
      if (accept) approved.set(params.itemId, request);
    }
    const knownApproval =
      frame.method === "item/fileChange/requestApproval" ||
      frame.method === "item/commandExecution/requestApproval";
    run.client.send(
      knownApproval
        ? { id: frame.id, result: { decision: accept ? "accept" : "decline" } }
        : {
            id: frame.id,
            error: { code: -32601, message: "Native request is unsupported." },
          },
    );
  };
  const handle = (frame) => {
    const params = frame.params;
    const scoped = Boolean(run.sessionId && params?.threadId === run.sessionId);
    if (scoped && !run.turnId) {
      if (early.length >= 256)
        throw new Error(
          "Codex emitted too many events before confirming the turn.",
        );
      early.push(frame);
      return;
    }
    if (frame.id !== undefined) return decide(frame, params);
    if (!scoped) return;
    const eventTurnId =
      frame.method === "turn/completed" ? params.turn?.id : params.turnId;
    if (eventTurnId !== run.turnId || run.cancelRequested) return;
    if (
      frame.method === "item/agentMessage/delta" &&
      typeof params.delta === "string"
    ) {
      run.output = (run.output + params.delta).slice(-MAX_OUTPUT_CHARS);
      emit(run, context, "assistant.delta", { text: params.delta });
    } else if (
      frame.method === "item/completed" &&
      params.item?.type === "agentMessage"
    ) {
      if (typeof params.item.text === "string")
        run.finalOutput = (run.finalOutput + params.item.text).slice(
          -MAX_OUTPUT_CHARS,
        );
    } else if (
      frame.method === "item/started" ||
      frame.method === "item/completed"
    ) {
      const item = params.item;
      if (
        writing &&
        item?.type === "fileChange" &&
        typeof item.id === "string"
      ) {
        if (frame.method === "item/started" && proposed.size < 128) {
          const patch = validatedPatch(cwd, item.changes);
          if (patch) proposed.set(item.id, patch);
        } else if (frame.method === "item/completed") {
          const patch = approved.get(item.id);
          if (patch && item.status === "completed") {
            for (const path of patch.outputs) {
              if (completedFiles.size < 128) completedFiles.add(path);
            }
          }
          approved.delete(item.id);
          proposed.delete(item.id);
        }
      }
      toolEvent(frame, run, context);
    } else if (frame.method === "turn/completed") {
      completeTurn(params.turn.status);
    }
  };

  try {
    if (mode !== "analysis" && !writing)
      throw new Error(
        "This Codex Host adapter currently exposes only read-only execution.",
      );
    cwd = resolveHostWorkspace(
      options.workspaceRoot,
      input.workspace || input.input?.workspace,
    );
    run.client = openCodex(options, cwd, handle);
    await initialize(run.client);
    const sessionId = input.sessionId || input.input?.sessionId;
    const thread = await run.client.request(
      sessionId ? "thread/resume" : "thread/start",
      {
        ...(sessionId ? { threadId: sessionId, excludeTurns: true } : {}),
        cwd,
        sandbox: sandboxFor(writing),
        approvalPolicy: approvalPolicyFor(writing),
        ...(options.model ? { model: options.model } : {}),
      },
    );
    const opened = thread?.thread?.id;
    if (
      typeof opened !== "string" ||
      !opened ||
      (sessionId && sessionId !== opened)
    )
      throw new Error("Codex did not return the expected native session.");
    const reportedWorkspace = thread?.cwd || thread?.thread?.cwd;
    if (
      (sessionId || reportedWorkspace) &&
      (!reportedWorkspace ||
        resolveHostWorkspace(options.workspaceRoot, reportedWorkspace) !== cwd)
    )
      throw new Error("Codex native session belongs to a different workspace.");
    run.sessionId = opened;
    if (typeof thread.model === "string" && thread.model)
      run.model = {
        id: thread.model,
        ...(thread.modelProvider ? { provider: thread.modelProvider } : {}),
      };
    if (run.cancelRequested) return;
    const started = await run.client.request("turn/start", {
      threadId: opened,
      cwd,
      sandbox: sandboxFor(writing),
      approvalPolicy: approvalPolicyFor(writing),
      input: [{ type: "text", text: input.input?.text || "" }],
    });
    run.turnId = started?.turn?.id;
    if (typeof run.turnId !== "string" || !run.turnId)
      throw new Error("Codex did not confirm its native turn.");
    if (run.cancelRequested) return;
    for (const frame of early) void handle(frame);
    const configTimeout = Number(options.promptTimeoutMs);
    const promptTimeout =
      Number.isFinite(configTimeout) && configTimeout > 0
        ? Math.min(configTimeout, 60 * 60_000)
        : 5 * 60_000;
    const status = await Promise.race([
      completed,
      run.client.failed.then((error) => {
        throw error;
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Codex turn timed out.")),
          promptTimeout,
        );
      }),
    ]);
    if (status !== "completed")
      throw new Error(`Codex turn ended with status ${String(status)}.`);
    run.output = run.finalOutput || run.output;
    if (run.output)
      emit(run, context, "assistant.completed", {
        text: run.output,
        model: run.model,
      });
    for (const path of completedFiles) {
      const bytes = readWorkspaceArtifact(cwd, path);
      if (bytes && !run.cancelRequested)
        await context.publishArtifact?.({
          name: basename(path),
          mime: "text/plain",
          bytes,
        });
    }
    terminalStatus = "succeeded";
  } catch (cause) {
    if (!run.cancelRequested) {
      run.error = sanitizeEventText(
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  } finally {
    clearTimeout(timer);
    if (run.cancelRequested) terminalStatus = "cancelled";
    try {
      await run.client?.close();
    } catch {
      terminalStatus = "failed";
      run.error = "Codex App Server shutdown could not be confirmed.";
    }
    run.status = terminalStatus;
  }
}

/** Native Codex adapter. Host-side patch writes require explicit local opt-in. */
export function createCodexAppServerAdapter(options = {}) {
  const runs = new Map();
  const capabilities =
    options.allowWorkspaceWrites === true
      ? {
          ...CAPABILITIES,
          permissions: { interactive: true, modes: ["analysis", "safe_write"] },
          artifacts: { publish: true, download: true },
        }
      : CAPABILITIES;
  return {
    manifest: MANIFEST,
    capabilities,
    async probe() {
      let client;
      try {
        const cwd = resolveHostWorkspace(options.workspaceRoot);
        client = openCodex(options, cwd);
        await initialize(client);
        await client.request("thread/start", {
          cwd,
          ephemeral: true,
          sandbox: sandboxFor(false),
          approvalPolicy: approvalPolicyFor(false),
        });
        await client.close();
        client = undefined;
        return {
          healthy: true,
          capabilities,
          manifest: MANIFEST,
        };
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
      const id = `codex_${randomUUID()}`;
      const run = {
        id,
        status: "running",
        output: "",
        finalOutput: "",
        sequence: 0,
      };
      runs.set(id, run);
      run.completion = execute(run, input, context, options);
      return { vendorRunId: id, status: "running" };
    },
    async getRun(id) {
      const run = runs.get(id);
      if (!run) return { status: "failed", error: "Codex Run is unavailable." };
      const { status, sessionId, output, model, error } = run;
      return { status, sessionId, output, model, error };
    },
    async cancelRun(id) {
      const run = runs.get(id);
      if (!run || run.status !== "running") return false;
      run.cancelRequested = true;
      if (run.turnId) {
        await run.client
          .request(
            "turn/interrupt",
            {
              threadId: run.sessionId,
              turnId: run.turnId,
            },
            2_000,
          )
          .catch(() => undefined);
      }
      await run.client?.close().catch(() => undefined);
      await run.completion;
      return run.status === "cancelled";
    },
  };
}
