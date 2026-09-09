import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { sanitizeEventText } from "../event-stream.mjs";

const MAX_OUTPUT = 512 * 1024;
const MAX_RPC_TIMEOUT_MS = 30_000;
const MAX_WORKSPACE_FILES = 1_000;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const DEFAULT_ENV_KEYS = [
  "PATH",
  "Path",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "LANG",
  "LC_ALL",
];
const SKIP_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
]);

function record(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function text(value, max = 8_000) {
  return typeof value === "string" && value.trim()
    ? sanitizeEventText(value, max)
    : undefined;
}

function contentText(value, depth = 0) {
  if (depth > 8) return undefined;
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    const values = value
      .map((item) => contentText(item, depth + 1))
      .filter(Boolean);
    return values.length ? values.join("\n").slice(0, 8_000) : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (value.type === "text") return contentText(value.text, depth + 1);
  for (const key of [
    "text",
    "content",
    "output",
    "message",
    "detail",
    "error",
  ]) {
    const result = contentText(value[key], depth + 1);
    if (result) return result;
  }
  return undefined;
}

function model(value) {
  if (typeof value === "string" && value.trim()) {
    const separator = value.indexOf("/");
    return separator > 0
      ? { provider: value.slice(0, separator), id: value.slice(separator + 1) }
      : { id: value.trim() };
  }
  if (!value || typeof value !== "object") return undefined;
  const id = text(value.id || value.model || value.name, 256);
  const provider = text(value.provider || value.vendor, 256);
  return id || provider
    ? { ...(id ? { id } : {}), ...(provider ? { provider } : {}) }
    : undefined;
}

function usage(value) {
  const source = record(value?.usage || value);
  const result = {};
  for (const [key, target] of [
    ["inputTokens", "inputTokens"],
    ["outputTokens", "outputTokens"],
    ["totalTokens", "totalTokens"],
    ["contextUsedTokens", "contextUsedTokens"],
    ["contextWindowTokens", "contextWindowTokens"],
  ]) {
    if (Number.isFinite(source[key]) && source[key] >= 0)
      result[target] = Math.floor(source[key]);
  }
  return Object.keys(result).length ? result : undefined;
}

function summarize(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return text(value, 4_000);
  try {
    return sanitizeEventText(JSON.stringify(value), 4_000);
  } catch {
    return undefined;
  }
}

function toolKind(value) {
  const kind = String(value || "").toLowerCase();
  if (kind.includes("mcp")) return "mcp";
  if (kind.includes("skill")) return "skill";
  if (/(terminal|shell|command|bash|execute)/.test(kind)) return "terminal";
  if (/(read|write|edit|delete|file|directory|search|glob|patch)/.test(kind))
    return "workspace";
  return "tool";
}

function workspacePath(root, requested, mode) {
  const base = root ? resolve(root) : undefined;
  if (!base) {
    if (mode !== "analysis")
      throw new Error("OpenCode 文件任务需要 Host 配置的工作区。 ");
    return undefined;
  }
  if (!existsSync(base)) throw new Error("OpenCode Host 工作区不存在。");
  const candidate = requested
    ? resolve(
        requested.match(/^[A-Za-z]:[\\/]|^\\\\|^\//)
          ? requested
          : base + "/" + requested,
      )
    : base;
  if (!existsSync(candidate) || !lstatSync(candidate).isDirectory())
    throw new Error("OpenCode 工作区不存在或不是目录。");
  const realBase = realpathSync(base);
  const realCandidate = realpathSync(candidate);
  const relativeCandidate = relative(realBase, realCandidate);
  if (
    relativeCandidate &&
    (relativeCandidate === ".." ||
      relativeCandidate.startsWith(
        `..${relativeCandidate.includes("\\") ? "\\" : "/"}`,
      ) ||
      isAbsolute(relativeCandidate))
  ) {
    throw new Error("OpenCode 工作区必须位于 Remote CLI Host 允许的目录内。");
  }
  return realCandidate;
}

function boundedLimit(value, fallback, maximum) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 1
    ? Math.min(Math.floor(candidate), maximum)
    : fallback;
}

function childEnvironment(options) {
  const configured = record(options.env);
  const explicitlyAllowed = Array.isArray(options.allowedEnv)
    ? options.allowedEnv
        .filter(
          (key) =>
            typeof key === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
        )
        .map((key) => key.trim())
    : [];
  const allowed = new Set([...DEFAULT_ENV_KEYS, ...explicitlyAllowed]);
  const result = {};
  for (const key of allowed) {
    const value = Object.prototype.hasOwnProperty.call(configured, key)
      ? configured[key]
      : process.env[key];
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function snapshot(root, maxFiles = MAX_WORKSPACE_FILES) {
  if (!root) return new Map();
  const entries = new Map();
  const visit = (directory) => {
    if (entries.size >= maxFiles) return;
    let children;
    try {
      children = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      if (entries.size >= maxFiles || SKIP_DIRECTORIES.has(child.name))
        continue;
      const full = resolve(directory, child.name);
      if (child.isSymbolicLink()) continue;
      if (child.isDirectory()) {
        visit(full);
        continue;
      }
      if (!child.isFile()) continue;
      try {
        const bytes = readFileSync(full);
        entries.set(relative(root, full).replaceAll("\\", "/"), {
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      } catch {
        // A file may disappear while the CLI is working; it is not an adapter error.
      }
    }
  };
  visit(root);
  return entries;
}

function changedFiles(before, root, maxFiles = MAX_WORKSPACE_FILES) {
  const after = snapshot(root, maxFiles);
  const changed = new Set();
  for (const [path, entry] of after) {
    if (JSON.stringify(before.get(path)) !== JSON.stringify(entry))
      changed.add(path);
  }
  for (const path of before.keys()) if (!after.has(path)) changed.add(path);
  return [...changed].sort().slice(0, 100);
}

class AcpClient {
  constructor(child, { onUpdate, mode }) {
    this.child = child;
    this.onUpdate = onUpdate;
    this.mode = mode;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = undefined;
    this.closed = false;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handle(JSON.parse(line));
      } catch {
        // ACP diagnostics are intentionally not copied into user-visible output.
      }
    });
    child.on("error", (cause) =>
      this.fail(cause instanceof Error ? cause : new Error(String(cause))),
    );
    child.on("close", (code) => {
      if (!this.closed)
        this.fail(
          new Error(`OpenCode ACP 进程已退出（${code ?? "unknown"}）。`),
        );
    });
  }

  handle(value) {
    const message = record(value);
    if (
      message.id !== undefined &&
      (message.result !== undefined || message.error !== undefined)
    ) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(
          new Error(text(message.error.message) || "OpenCode ACP 请求失败。"),
        );
      else pending.resolve(message.result);
      return;
    }
    if (message.method === "session/update") {
      this.onUpdate(record(message.params));
      return;
    }
    if (message.id !== undefined && typeof message.method === "string") {
      this.permission(
        String(message.id),
        message.method,
        record(message.params),
      );
    }
  }

  permission(id, method, params) {
    if (method !== "session/request_permission") {
      this.send({
        jsonrpc: "2.0",
        id: Number(id) || id,
        error: {
          code: -32601,
          message: "Agents One Host 未启用此 ACP 客户端请求。",
        },
      });
      return;
    }
    const options = Array.isArray(params.options)
      ? params.options.filter((item) => item && typeof item === "object")
      : [];
    const denied = options.find((item) =>
      /reject|deny|cancel|read.?only/i.test(
        String(item.kind || item.name || item.optionId),
      ),
    );
    const allowed = options.find((item) =>
      /allow.?once|once|allow/i.test(
        String(item.kind || item.name || item.optionId),
      ),
    );
    const selected = this.mode === "analysis" ? denied : allowed || options[0];
    this.send({
      jsonrpc: "2.0",
      id: Number(id) || id,
      result:
        selected && this.mode !== "analysis"
          ? {
              outcome: {
                outcome: "selected",
                optionId: String(selected.optionId || "allow_once"),
              },
            }
          : { outcome: { outcome: "cancelled" } },
    });
  }

  send(value) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  request(method, params, timeoutMs = MAX_RPC_TIMEOUT_MS) {
    if (this.closed) return Promise.reject(new Error("OpenCode ACP 已关闭。"));
    const id = this.nextId++;
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`OpenCode ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(String(id), { resolve: resolveResult, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  fail(cause) {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(cause);
    }
    this.pending.clear();
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "Agents One Remote CLI Host", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    return record(result);
  }

  async newSession(cwd, requestedSessionId) {
    const init = await this.initialize();
    const caps = record(record(init.agentCapabilities).sessionCapabilities);
    if (requestedSessionId && caps.resume !== true) {
      throw new Error("OpenCode ACP 当前版本不支持恢复已有 session。");
    }
    const method =
      requestedSessionId && caps.resume === true
        ? "session/resume"
        : "session/new";
    const params =
      requestedSessionId && caps.resume === true
        ? { sessionId: requestedSessionId, cwd, mcpServers: [] }
        : { cwd, mcpServers: [] };
    const result = record(await this.request(method, params));
    if (typeof result.sessionId !== "string" || !result.sessionId.trim())
      throw new Error("OpenCode ACP 未返回有效 sessionId。");
    this.sessionId = result.sessionId;
    return { sessionId: result.sessionId, init, result };
  }

  prompt(value) {
    if (!this.sessionId) throw new Error("OpenCode ACP session 尚未创建。");
    return this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text: value }],
    });
  }

  cancel() {
    if (this.sessionId)
      this.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId: this.sessionId },
      });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    for (const pending of this.pending.values()) clearTimeout(pending.timer);
    this.pending.clear();
    this.child.kill();
  }
}

function emit(context, run, type, data) {
  context.emit({ id: `${run.id}:${run.sequence++}`, type, data });
}

function modelFromInit(init) {
  const options = Array.isArray(init.configOptions) ? init.configOptions : [];
  const option = options.find(
    (item) => item && (item.id === "model" || item.category === "model"),
  );
  return model(option?.currentValue ?? option?.value);
}

function toolEvent(update) {
  if (!["tool_call", "tool_call_update"].includes(update.sessionUpdate))
    return undefined;
  const name =
    text(update.title || update.name || update.toolName || update.kind, 256) ||
    "工具";
  const callId = text(
    update.toolCallId || update.callId || update.call_id,
    256,
  );
  const tool = {
    name,
    kind: toolKind(update.kind),
    ...(callId ? { callId } : {}),
    ...(summarize(update.rawInput)
      ? { inputSummary: summarize(update.rawInput) }
      : {}),
    ...(summarize(update.content || update.rawOutput || update.output)
      ? {
          outputSummary: summarize(
            update.content || update.rawOutput || update.output,
          ),
        }
      : {}),
  };
  const status = String(update.status || "").toLowerCase();
  return {
    type: ["failed", "error", "cancelled", "canceled"].includes(status)
      ? "tool.failed"
      : ["completed", "complete", "success", "succeeded", "done"].includes(
            status,
          )
        ? "tool.completed"
        : "tool.started",
    data: { tool },
  };
}

function executableConfig(options) {
  const command =
    typeof options.executablePath === "string" && options.executablePath.trim()
      ? options.executablePath.trim()
      : "opencode";
  if (/\.(cmd|ps1)$/i.test(command))
    throw new Error(
      "Remote OpenCode Host 需要 opencode.exe 或可直接执行的 OpenCode 命令，不使用 shell shim。",
    );
  const args =
    Array.isArray(options.acpArgs) && options.acpArgs.length
      ? [...options.acpArgs]
      : ["acp"];
  const has = (name) =>
    args.includes(name) || args.some((item) => item.startsWith(`${name}=`));
  if (options.model && !has("--model")) args.push("--model", options.model);
  if (options.agent && !has("--agent")) args.push("--agent", options.agent);
  return { command, args };
}

async function publishChangedArtifacts(
  root,
  before,
  context,
  run,
  maxFiles,
  maxArtifactBytes,
) {
  if (!root || typeof context.publishArtifact !== "function") return;
  for (const path of changedFiles(before, root, maxFiles)) {
    const full = resolve(root, path);
    let bytes;
    try {
      bytes = readFileSync(full);
    } catch {
      continue;
    }
    if (!bytes.length || bytes.length > maxArtifactBytes) continue;
    await context.publishArtifact({
      id: `${run.id}:${path}`,
      name: path,
      mime:
        extname(path).toLowerCase() === ".json"
          ? "application/json"
          : "text/plain",
      bytes,
    });
  }
}

async function executeRun(run, input, context, options) {
  const mode = input.mode || input.input?.mode || "analysis";
  const maxOutput = boundedLimit(
    options.maxOutputBytes,
    MAX_OUTPUT,
    8 * 1024 * 1024,
  );
  const maxWorkspaceFiles = boundedLimit(
    options.maxWorkspaceFiles,
    MAX_WORKSPACE_FILES,
    10_000,
  );
  const maxArtifactBytes = boundedLimit(
    options.maxArtifactBytes,
    MAX_ARTIFACT_BYTES,
    16 * 1024 * 1024,
  );
  const requestedWorkspace = input.workspace || input.input?.workspace;
  let cwd;
  try {
    cwd = workspacePath(options.workspaceRoot, requestedWorkspace, mode);
    const invocation = executableConfig({
      ...options,
      model: options.model || input.model || input.input?.model,
    });
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: childEnvironment(options),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    run.client = new AcpClient(child, {
      mode,
      onUpdate: (params) => {
        const update = record(params.update || params);
        const answer =
          update.sessionUpdate === "agent_message_chunk"
            ? contentText(update)
            : undefined;
        if (answer) {
          run.output = `${run.output}${answer}`.slice(-maxOutput);
          emit(context, run, "assistant.delta", {
            text: answer,
            ...(run.model ? { model: run.model } : {}),
          });
        }
        const thought =
          update.sessionUpdate === "agent_thought_chunk"
            ? contentText(update)
            : undefined;
        if (thought)
          emit(context, run, "reasoning.summary", {
            reasoningSummary: thought,
          });
        const tool = toolEvent(update);
        if (tool) {
          const callId = tool.data?.tool?.callId;
          const previous = callId ? run.toolStates.get(callId) : undefined;
          if (!callId || previous !== tool.type) {
            emit(context, run, tool.type, tool.data);
            if (callId) run.toolStates.set(callId, tool.type);
          }
        }
        const updateModel = model(update.model);
        if (updateModel) run.model = { ...(run.model || {}), ...updateModel };
        const updateUsage = usage(update.usage || update);
        if (updateUsage) run.usage = { ...(run.usage || {}), ...updateUsage };
      },
    });
    const before = snapshot(cwd, maxWorkspaceFiles);
    const session = await run.client.newSession(
      cwd,
      input.sessionId || input.input?.sessionId || input.conversationId,
    );
    run.sessionId = session.sessionId;
    run.model =
      run.model || modelFromInit(session.init) || model(session.result.model);
    const result = record(
      await run.client.prompt(input.input?.text || input.text || ""),
    );
    run.model = run.model || model(result.model);
    run.usage = run.usage || usage(result);
    if (run.output)
      emit(context, run, "assistant.completed", {
        text: run.output,
        ...(run.model ? { model: run.model } : {}),
        ...(run.usage ? { usage: run.usage } : {}),
      });
    await publishChangedArtifacts(
      cwd,
      before,
      context,
      run,
      maxWorkspaceFiles,
      maxArtifactBytes,
    );
    run.status = run.cancelRequested ? "cancelled" : "succeeded";
  } catch (cause) {
    run.error =
      text(cause instanceof Error ? cause.message : String(cause)) ||
      "OpenCode ACP 运行失败。";
    run.status = run.cancelRequested ? "cancelled" : "failed";
  } finally {
    run.completedAt = Date.now();
    run.client?.close();
  }
}

export function createOpenCodeAcpAdapter(options = {}) {
  const runs = new Map();
  const capabilities = {
    eventStream: {
      reasoningSummaries: true,
      toolEvents: true,
      modelMetadata: true,
      usageMetadata: true,
    },
    tasks: { start: true, get: true, cancel: true },
    permissions: { interactive: false, policy: "host-managed" },
    sessions: { create: true, resume: true },
    artifacts: { publish: true },
  };
  const manifest = {
    adapterId: "opencode-acp",
    vendorId: "opencode",
    version: "0.1.2",
    displayName: "OpenCode ACP",
    protocol: "acp",
  };
  return {
    manifest,
    capabilities,
    async startRun(input, context) {
      const vendorRunId = `opencode_${randomUUID()}`;
      const run = {
        id: vendorRunId,
        status: "running",
        output: "",
        sequence: 1,
        toolStates: new Map(),
      };
      runs.set(vendorRunId, run);
      void executeRun(run, input, context, options);
      return { vendorRunId, status: "running" };
    },
    async getRun(vendorRunId) {
      const run = runs.get(vendorRunId);
      if (!run) return { status: "failed", error: "OpenCode 运行记录不存在。" };
      return {
        status: run.status,
        ...(run.output ? { output: run.output } : {}),
        ...(run.error ? { error: run.error } : {}),
        ...(run.sessionId ? { sessionId: run.sessionId } : {}),
        ...(run.model ? { model: run.model } : {}),
        ...(run.usage ? { usage: run.usage } : {}),
      };
    },
    async cancelRun(vendorRunId) {
      const run = runs.get(vendorRunId);
      if (!run || ["succeeded", "failed", "cancelled"].includes(run.status))
        return false;
      run.cancelRequested = true;
      run.client?.cancel();
      run.client?.close();
      run.status = "cancelled";
      return true;
    },
    async probe() {
      const invocation = executableConfig(options);
      let client;
      let timer;
      try {
        const cwd = workspacePath(options.workspaceRoot, undefined, "analysis");
        const child = spawn(invocation.command, invocation.args, {
          cwd,
          env: childEnvironment(options),
          shell: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
        client = new AcpClient(child, {
          mode: "analysis",
          onUpdate: () => undefined,
        });
        const initialize = client.initialize();
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("OpenCode ACP probe timed out.")),
            5_000,
          );
        });
        const init = record(await Promise.race([initialize, timeout]));
        const agentInfo = record(init.agentInfo);
        const runtimeVersion = text(agentInfo.version, 128);
        const sessionCapabilities = record(
          record(init.agentCapabilities).sessionCapabilities,
        );
        capabilities.sessions = {
          ...capabilities.sessions,
          resume: sessionCapabilities.resume === true,
        };
        return {
          healthy: true,
          capabilities,
          manifest: {
            ...manifest,
            ...(runtimeVersion ? { runtimeVersion } : {}),
          },
          protocolVersion: init.protocolVersion,
          ...(agentInfo.name
            ? {
                message: `${agentInfo.name}${runtimeVersion ? ` ${runtimeVersion}` : ""} ACP ready.`,
              }
            : {}),
        };
      } catch (cause) {
        return {
          healthy: false,
          capabilities: {},
          message:
            text(cause instanceof Error ? cause.message : String(cause)) ||
            "OpenCode ACP executable is unavailable.",
        };
      } finally {
        if (timer) clearTimeout(timer);
        client?.close();
      }
    },
  };
}

export const createRemoteOpenCodeAdapter = createOpenCodeAcpAdapter;
