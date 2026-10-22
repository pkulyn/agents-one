import { execFile } from "node:child_process";
import {
  runtimeRemovalBlockedMessage,
  isRuntimeRemovalOperation,
} from "../../../shared/runtime-permissions";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { prepareRuntimeInputs } from "../../runtime-inputs";
import { extname, dirname, join, relative, resolve, win32 } from "node:path";
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeTaskInput,
  AgentRuntimeArtifact,
  RuntimeInputArtifact,
} from "../../../shared/agent-runtimes";
import {
  normalizeAgentEventStreamModel,
  normalizeAgentEventStreamUsage,
  type AgentEventStreamTool,
  type AgentEventStreamModel,
  type AgentEventStreamUsage,
} from "../../../shared/agent-event-stream";
import { NO_AGENT_RUNTIME_CAPABILITIES } from "../../../shared/agent-runtimes";
import { redactSensitiveText } from "../../../shared/redaction";
import {
  normalizeRuntimeEvent,
  type NormalizedRuntimeEvent,
} from "../event-normalizer";
import { startLocalProcess, type LocalProcessHandle } from "../local-process";
import { protectWorkspaceFromRemoval } from "../../workspace-protection";
import { agentsOneProfileHome } from "../../utils";

const MAX_OUTPUT = 512 * 1024;
const MAX_RPC_TIMEOUT_MS = 30_000;
const DEFAULT_PROMPT_TIMEOUT_MS = 300_000;
const CANCEL_COMPLETION_GRACE_MS = 5_000;
const MAX_WORKSPACE_FILES = 2_000;
const MAX_HASHED_FILE_BYTES = 8 * 1024 * 1024;
const IGNORED_WORKSPACE_DIRECTORIES = new Set([
  ".git",
  ".agents-one",
  "node_modules",
  "dist",
  "build",
  ".next",
]);

interface JsonRecord {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = redactSensitiveText(value.trim());
  return result ? result.slice(0, 8_000) : undefined;
}

function configuredExecutable(value?: string): string {
  return value?.trim() || "opencode";
}

interface OpenCodeInvocation {
  command: string;
  prefix: string[];
}

function openCodePackageCandidates(binDir: string): string[] {
  return [
    join(binDir, "node_modules", "opencode-ai", "bin", "opencode.exe"),
    join(binDir, "node_modules", "opencode-ai", "bin", "opencode"),
    join(binDir, "node_modules", "opencode-ai", "bin", "opencode.js"),
    join(binDir, "node_modules", "opencode", "bin", "opencode.exe"),
    join(binDir, "node_modules", "opencode", "bin", "opencode"),
    join(binDir, "node_modules", "opencode", "bin", "opencode.js"),
  ];
}

function invocationFromDirectory(
  binDir: string,
  fileExists: (path: string) => boolean,
): OpenCodeInvocation | undefined {
  const entry = openCodePackageCandidates(binDir).find(fileExists);
  if (!entry) return undefined;
  if (extname(entry).toLowerCase() === ".exe") {
    return { command: entry, prefix: [] };
  }
  // A JavaScript package entry is only a safe fallback when the current
  // process is a Node runtime. Packaged Electron cannot execute arbitrary JS
  // as a Node CLI, so leave that case to the actionable error below.
  if (process.versions?.node && !process.versions.electron) {
    return { command: process.execPath, prefix: [entry] };
  }
  return undefined;
}

/**
 * Resolve npm's Windows shim to node + the package entry point. We never pass
 * a .cmd file to a shell and never fall back to `cmd /c`.
 */
export function opencodeInvocation(
  executablePath: string,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): OpenCodeInvocation {
  const normalized = executablePath.trim();
  if (!normalized) return { command: "opencode", prefix: [] };
  if (platform !== "win32") {
    return { command: normalized, prefix: [] };
  }
  const extension = extname(normalized).toLowerCase();
  if (extension === ".exe") {
    return { command: normalized, prefix: [] };
  }
  if (extension !== ".cmd" && extension !== ".ps1") {
    // Bare `opencode` is common in Runtime settings. Resolve it through PATH
    // when possible so Windows never asks CreateProcess to execute a .cmd or
    // PowerShell shim directly.
    if (!normalized.includes("\\") && !normalized.includes("/")) {
      const pathVar = process.env.PATH || process.env.Path || "";
      for (const directory of pathVar
        .split(";")
        .map((item) => item.trim())
        .filter(Boolean)) {
        const resolved = invocationFromDirectory(directory, fileExists);
        if (resolved) return resolved;
      }
    }
    return { command: executablePath, prefix: [] };
  }
  const resolved = invocationFromDirectory(dirname(normalized), fileExists);
  if (!resolved) {
    throw new Error(
      "The OpenCode Windows wrapper is incomplete. Select opencode.exe or reinstall the user-level OpenCode CLI.",
    );
  }
  return resolved;
}

// @lat: [[runtime-chat#Cross-runtime native permission enforcement]]
export function openCodePermissionEnvironment(
  mode: AgentRuntimeTaskInput["mode"],
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (mode === "full_access" || mode === "implementation") return { ...source };
  const inherited = source.OPENCODE_PERMISSION
    ? JSON.parse(source.OPENCODE_PERMISSION)
    : {};
  if (!isRecord(inherited))
    throw new Error(
      "OpenCode process permission configuration must be an object.",
    );
  // Per-process overrides only. Native reader/query permissions remain available.
  return {
    ...source,
    OPENCODE_PERMISSION: JSON.stringify({
      ...inherited,
      "*": "ask",
      edit: "ask",
      bash: "ask",
      task: "ask",
    }),
  };
}

export function openCodePermissionDenial(
  mode: AgentRuntimeTaskInput["mode"],
  toolCall: JsonRecord,
): string | undefined {
  const kind = (text(toolCall.kind) || "").toLowerCase();
  const title = text(toolCall.title) || "";
  const rawInput = isRecord(toolCall.rawInput) ? toolCall.rawInput : {};
  const destructive =
    ["delete", "move"].includes(kind) ||
    isRuntimeRemovalOperation(title, rawInput);
  if (mode === "safe_write" && destructive)
    return "[Agents One 权限不足] 当前为自动权限，移动或删除原有文件未执行；请切换为完全访问后重新发送任务。";
  if (
    mode === "analysis" &&
    !["read", "search", "fetch", "think"].includes(kind)
  )
    return (
      "[Agents One 权限不足] 当前为只读权限，已阻止 " +
      (title || kind || "未声明为只读的工具") +
      "。读取和查询仍可执行；创建或编辑请切换为自动，移动或删除请切换为完全访问。"
    );
  return undefined;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface OpenCodeAcpClientOptions {
  mode: AgentRuntimeTaskInput["mode"];
  onUpdate: (params: JsonRecord) => void;
  onPermissionDenied?: (reason: string) => void;
}

interface OpenCodeSessionInfo {
  sessionId: string;
  model?: AgentEventStreamModel;
}

class OpenCodeAcpClient {
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private sessionId: string | undefined;
  private replayingHistory = false;
  private closed = false;

  constructor(
    private readonly process: LocalProcessHandle,
    private readonly options: OpenCodeAcpClientOptions,
  ) {
    process.completion.then((result) => {
      if (this.closed) return;
      this.closed = true;
      const detail = result.stderr.trim() || "OpenCode ACP 进程已退出。";
      this.failPending(new Error(detail));
    });
  }

  handleLine(json: unknown): void {
    if (!isRecord(json)) return;
    const id = json.id;
    if (
      (typeof id === "number" || typeof id === "string") &&
      (json.result !== undefined || json.error !== undefined)
    ) {
      const key = String(id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (isRecord(json.error)) {
        pending.reject(
          new Error(text(json.error.message) || "OpenCode ACP 请求失败。"),
        );
      } else {
        pending.resolve(json.result);
      }
      return;
    }
    const method = typeof json.method === "string" ? json.method : "";
    const params = isRecord(json.params) ? json.params : {};
    if (method === "session/update") {
      if (!this.replayingHistory) this.options.onUpdate(params);
      return;
    }
    if ((typeof id === "number" || typeof id === "string") && method) {
      this.handleAgentRequest(id, method, params);
    }
  }

  private handleAgentRequest(
    id: string | number,
    method: string,
    params: JsonRecord,
  ): void {
    if (method === "session/request_permission") {
      const rawOptions = Array.isArray(params.options) ? params.options : [];
      const options = rawOptions.filter(isRecord);
      const toolCall = isRecord(params.toolCall) ? params.toolCall : {};
      const denial = openCodePermissionDenial(this.options.mode, toolCall);
      if (denial) {
        this.options.onPermissionDenied?.(denial);
        this.respond(id, { outcome: { outcome: "cancelled" } });
        return;
      }
      const preferred =
        options.find((option) =>
          /allow.?once|^once$/i.test(String(option.kind || option.optionId)),
        ) ||
        options.find((option) =>
          /allow/i.test(String(option.kind || option.optionId)),
        );
      this.respond(id, {
        outcome: preferred
          ? { outcome: "selected", optionId: String(preferred.optionId) }
          : { outcome: "cancelled" },
      });
      return;
    }
    // Agents One does not advertise client-side filesystem or terminal
    // capabilities yet. Reply explicitly so the ACP request cannot hang and
    // so OpenCode can surface a controlled unsupported-tool error.
    this.respondError(id, -32601, `${method} 未被 Agents One ACP 客户端启用。`);
  }

  private respond(id: string | number, result: unknown): void {
    if (this.closed) return;
    this.process.sendLine(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private respondError(
    id: string | number,
    code: number,
    message: string,
  ): void {
    if (this.closed) return;
    this.process.sendLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code, message: redactSensitiveText(message) },
      }),
    );
  }

  notify(method: string, params: JsonRecord): void {
    if (this.closed) return;
    this.process.sendLine(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }

  request(
    method: string,
    params: JsonRecord,
    timeoutMs = MAX_RPC_TIMEOUT_MS,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error("OpenCode ACP 已关闭。"));
    const id = String(this.nextId++);
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OpenCode ACP 请求超时：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      try {
        this.process.sendLine(
          JSON.stringify({ jsonrpc: "2.0", id: Number(id), method, params }),
        );
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async initialize(): Promise<JsonRecord> {
    const result = await this.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "Agents One", version: "0.1.0" },
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
    });
    return isRecord(result) ? result : {};
  }

  async createOrResumeSession(
    cwd: string,
    requestedSessionId?: string,
  ): Promise<OpenCodeSessionInfo> {
    const initialize = await this.initialize();
    const capabilities = isRecord(initialize.agentCapabilities)
      ? initialize.agentCapabilities
      : {};
    const sessionCapabilities = isRecord(capabilities.sessionCapabilities)
      ? capabilities.sessionCapabilities
      : {};
    let result: unknown;
    const canResume =
      sessionCapabilities.resume === true ||
      isRecord(sessionCapabilities.resume);
    if (requestedSessionId && canResume) {
      result = await this.request("session/resume", {
        sessionId: requestedSessionId,
        cwd,
        mcpServers: [],
      });
    } else if (requestedSessionId && capabilities.loadSession === true) {
      this.replayingHistory = true;
      try {
        result = await this.request("session/load", {
          sessionId: requestedSessionId,
          cwd,
          mcpServers: [],
        });
      } finally {
        this.replayingHistory = false;
      }
    } else if (requestedSessionId) {
      throw new Error(
        "OpenCode ACP 当前版本不支持恢复已有 session，未创建新会话。",
      );
    } else {
      result = await this.request("session/new", { cwd, mcpServers: [] });
    }
    // ACP load/resume replies may contain only configuration, or be empty.
    // The requested provider identity remains authoritative for continuation.
    const sessionId =
      requestedSessionId || (isRecord(result) ? result.sessionId : undefined);
    if (
      !isRecord(result) ||
      typeof sessionId !== "string" ||
      !sessionId.trim()
    ) {
      throw new Error("OpenCode ACP 未返回有效 sessionId。");
    }
    this.sessionId = sessionId;
    const model = modelFromConfigOptions(result.configOptions);
    return {
      sessionId,
      ...(model ? { model } : {}),
    };
  }

  async prompt(
    prompt: JsonRecord[],
    timeoutMs = DEFAULT_PROMPT_TIMEOUT_MS,
  ): Promise<JsonRecord> {
    if (!this.sessionId) throw new Error("OpenCode ACP session 尚未创建。");
    const result = await this.request(
      "session/prompt",
      {
        sessionId: this.sessionId,
        prompt,
      },
      timeoutMs,
    );
    return isRecord(result) ? result : {};
  }

  cancelSession(): void {
    if (this.sessionId) {
      this.notify("session/cancel", { sessionId: this.sessionId });
    }
  }
}

function configuredWorkspace(value?: string): string | undefined {
  const workspace = value?.trim();
  if (!workspace) return undefined;
  const resolved = resolve(workspace);
  if (!existsSync(resolved) || !lstatSync(resolved).isDirectory()) {
    throw new Error("OpenCode 工作目录不存在或不是目录。");
  }
  return resolved;
}

export function openCodeConversationWorkspace(profile?: string): string {
  const root = resolve(
    agentsOneProfileHome(profile),
    "desktop",
    "runtime-chat",
    "opencode",
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function appendOutput(current: string, value: string): string {
  const next = `${current}${redactSensitiveText(value)}`;
  return next.length <= MAX_OUTPUT ? next : next.slice(-MAX_OUTPUT);
}

/** ACP text deltas must keep whitespace, including whitespace-only chunks. */
function agentTextDelta(value: unknown): string | undefined {
  if (typeof value === "string") return redactSensitiveText(value);
  if (!isRecord(value) || value.type !== "text") return undefined;
  return agentTextDelta(value.text);
}

function contentText(value: unknown, depth = 0): string | undefined {
  if (depth > 8) return undefined;
  if (typeof value === "string") return text(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => contentText(item, depth + 1))
      .filter((item): item is string => Boolean(item));
    return parts.length ? parts.join("\n").slice(0, 8_000) : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (value.type === "text") return contentText(value.text, depth + 1);
  if (value.type === "content") {
    return contentText(value.content, depth + 1);
  }
  for (const key of [
    "text",
    "content",
    "output",
    "preview",
    "message",
    "detail",
    "error",
  ]) {
    const result = contentText(value[key], depth + 1);
    if (result) return result;
  }
  return undefined;
}

function looksLikeAbsolutePath(value: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith("\\\\") ||
    value.startsWith("/")
  );
}

function relativeOpenCodePath(value: string, cwd: string): string | undefined {
  if (!looksLikeAbsolutePath(value)) return undefined;
  const root = resolve(cwd);
  const candidate = resolve(value);
  if (candidate === root) return ".";
  const relativePath = relative(root, candidate).replace(/\\/g, "/");
  if (
    !relativePath ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    /^[a-z]:\//i.test(relativePath)
  ) {
    return undefined;
  }
  return relativePath;
}

function sanitizeOpenCodeDisplayText(value: string, cwd: string): string {
  const redacted = redactSensitiveText(value.trim());
  const root = resolve(cwd);
  return redacted
    .replaceAll(root, ".")
    .replaceAll(root.replace(/\\/g, "/"), ".")
    .slice(0, 8_000);
}

function sanitizeOpenCodeValue(
  value: unknown,
  cwd: string,
  key = "",
  depth = 0,
): unknown {
  if (depth > 8) return "…";
  if (typeof value === "string") {
    if (
      /(?:path|file|directory|dir|cwd|working.?directory)/i.test(key) &&
      looksLikeAbsolutePath(value)
    ) {
      return relativeOpenCodePath(value, cwd) || "[工作区外路径]";
    }
    return sanitizeOpenCodeDisplayText(value, cwd);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 32)
      .map((item) => sanitizeOpenCodeValue(item, cwd, key, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeOpenCodeValue(childValue, cwd, childKey, depth + 1),
      ]),
    );
  }
  return value;
}

function openCodeValueSummary(value: unknown, cwd: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const sanitized = sanitizeOpenCodeValue(value, cwd);
  if (isRecord(sanitized) && !Object.keys(sanitized).length) return undefined;
  const serialized = JSON.stringify(sanitized);
  return serialized && serialized !== "{}"
    ? serialized.slice(0, 4_000)
    : undefined;
}

function openCodeToolKind(value: unknown): AgentEventStreamTool["kind"] {
  const kind = typeof value === "string" ? value.toLowerCase() : "";
  if (kind.includes("mcp")) return "mcp";
  if (kind.includes("skill")) return "skill";
  if (/(?:execute|terminal|shell|command|bash)/.test(kind)) return "terminal";
  if (
    /(?:read|write|edit|delete|file|directory|search|glob|patch)/.test(kind)
  ) {
    return "workspace";
  }
  return "tool";
}

interface OpenCodeToolState {
  name: string;
  kind: AgentEventStreamTool["kind"];
  started: boolean;
  inputSummary?: string;
}

function openCodeToolEvents(
  update: JsonRecord,
  cwd: string,
  states: Map<string, OpenCodeToolState>,
): NormalizedRuntimeEvent[] | null {
  const sessionUpdate = text(update.sessionUpdate)?.toLowerCase();
  if (sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") {
    return null;
  }
  const callId = text(update.toolCallId || update.callId || update.call_id);
  const previous = callId ? states.get(callId) : undefined;
  const title = text(update.title);
  // OpenCode sometimes replaces `title: "read"` with a path-like title on the
  // completed frame. Prefer the first stable title retained for this call.
  const name =
    previous?.name ||
    title ||
    text(update.name) ||
    text(update.toolName) ||
    text(update.kind) ||
    "工具";
  const kind = previous?.kind || openCodeToolKind(update.kind);
  const inputSummary = openCodeValueSummary(update.rawInput, cwd);
  const rawOutput = isRecord(update.rawOutput) ? update.rawOutput : undefined;
  const outputSummary = sanitizeOpenCodeDisplayText(
    contentText(update.content) ||
      contentText(rawOutput?.output) ||
      contentText(update.output) ||
      contentText(update.result) ||
      "",
    cwd,
  );
  const hasOutput = Boolean(outputSummary);
  const state: OpenCodeToolState = {
    name,
    kind,
    started: previous?.started || false,
    ...(inputSummary || previous?.inputSummary
      ? { inputSummary: inputSummary || previous?.inputSummary }
      : {}),
  };
  if (callId) states.set(callId, state);
  const tool: AgentEventStreamTool = {
    name: name.slice(0, 256),
    ...(callId ? { callId: callId.slice(0, 256) } : {}),
    kind,
    ...(state.inputSummary ? { inputSummary: state.inputSummary } : {}),
    ...(hasOutput ? { outputSummary } : {}),
  };
  const events: NormalizedRuntimeEvent[] = [];
  const emitCall =
    sessionUpdate === "tool_call" ||
    !state.started ||
    Boolean(inputSummary && inputSummary !== previous?.inputSummary);
  if (emitCall) {
    state.started = true;
    events.push({
      type: "tool_call",
      summary: `正在调用工具：${name}`,
      detail: state.inputSummary || "已提交工具调用，等待执行。",
      tool,
    });
  }
  if (sessionUpdate === "tool_call") return events;

  const status = text(update.status)?.toLowerCase() || "";
  if (["failed", "error", "cancelled", "canceled"].includes(status)) {
    events.push({
      type: "error",
      summary: `工具执行失败：${name}`,
      detail:
        outputSummary ||
        contentText(update.error) ||
        "OpenCode 未返回工具失败详情。",
      tool,
    });
  } else if (
    ["completed", "complete", "success", "succeeded", "done"].includes(status)
  ) {
    events.push({
      type: "tool_result",
      summary: `工具已完成：${name}`,
      detail: outputSummary || "工具已完成，但 OpenCode 未返回输出详情。",
      tool,
    });
  }
  return events;
}

function modelFromOpenCodeValue(
  value: unknown,
): AgentEventStreamModel | undefined {
  const normalized = normalizeAgentEventStreamModel(value);
  if (!normalized) return undefined;
  const rawId = normalized.id?.trim();
  const rawProvider = normalized.provider?.trim();
  if (rawId && !rawProvider) {
    const separator = rawId.indexOf("/");
    if (separator > 0 && separator < rawId.length - 1) {
      return {
        ...normalized,
        provider: rawId.slice(0, separator),
        id: rawId.slice(separator + 1),
      };
    }
  }
  return normalized;
}

function modelFromConfigOptions(
  value: unknown,
): AgentEventStreamModel | undefined {
  if (!Array.isArray(value)) return undefined;
  const option = value.find((item) => {
    if (!isRecord(item)) return false;
    const id = text(item.id) || "";
    const category = text(item.category) || "";
    return id === "model" || category === "model";
  });
  if (!isRecord(option)) return undefined;
  return modelFromOpenCodeValue(option.currentValue ?? option.value);
}

function usageFromOpenCodeValue(
  value: unknown,
): AgentEventStreamUsage | undefined {
  const source = isRecord(value) && isRecord(value.usage) ? value.usage : value;
  const normalized = normalizeAgentEventStreamUsage(source);
  if (!isRecord(source)) return normalized;
  const used =
    typeof source.used === "number" &&
    Number.isFinite(source.used) &&
    source.used >= 0
      ? source.used
      : undefined;
  const size =
    typeof source.size === "number" &&
    Number.isFinite(source.size) &&
    source.size > 0
      ? source.size
      : undefined;
  if (!normalized && used === undefined && size === undefined) return undefined;
  return {
    ...(normalized || {}),
    ...(used !== undefined ? { contextUsedTokens: used } : {}),
    ...(size !== undefined ? { contextWindowTokens: size } : {}),
  };
}

const OPEN_CODE_IDENTITY_INSTRUCTION = [
  "[Agents One runtime identity]",
  "当前会话由 Agents One 通过 OpenCode ACP 接入。介绍自身身份时，请将当前客户端/智能体称为 OpenCode，不要把自己称为 Claude Code、Codex、Pi Agent 或其他客户端产品；用户要求比较或解释这些产品时，可以正常提及其名称。若用户询问模型，请单独使用运行时提供的实际模型标识。",
].join("\n");

function openCodePrompt(prompt: string): string {
  return `${OPEN_CODE_IDENTITY_INSTRUCTION}\n\n[用户请求]\n${prompt}`;
}

function capabilitiesFromInitialize(
  initialize: JsonRecord,
  workspaceAccess: boolean,
): AgentRuntimeCapabilities {
  const agentInfo = isRecord(initialize.agentInfo) ? initialize.agentInfo : {};
  return {
    chat: true,
    taskDispatch: true,
    streaming: true,
    cancellation: true,
    tools: true,
    memory: true,
    orchestration: false,
    readOnlyPlanning: false,
    mailbox: false,
    securityEvents: false,
    artifacts: workspaceAccess,
    artifactUpload: false,
    workspaceAccess,
    modelSelection: false,
    compaction: "none",
    steering: "cancel_resume",
    branching: "none",
    ...(text(agentInfo.version)
      ? {
          plugin: {
            id: "opencode",
            version: text(agentInfo.version),
            kind: "cli-adapter" as const,
          },
        }
      : { plugin: { id: "opencode", kind: "cli-adapter" as const } }),
  };
}

export interface OpenCodeProbeResult {
  healthy: boolean;
  message?: string;
  workspaceAccess: boolean;
  capabilities: AgentRuntimeCapabilities;
}

export interface OpenCodeRuntimeConfig {
  executablePath?: string;
  acpArgs?: string[];
  model?: string;
  agent?: string;
  workspace?: string;
  timeoutMs?: number;
}

function openCodeArgs(config: OpenCodeRuntimeConfig): string[] {
  const args = config.acpArgs?.length ? [...config.acpArgs] : ["acp"];
  const hasOption = (name: string): boolean =>
    args.includes(name) || args.some((arg) => arg.startsWith(`${name}=`));
  if (config.model && !hasOption("--model")) {
    args.push("--model", config.model);
  }
  if (config.agent && !hasOption("--agent")) {
    args.push("--agent", config.agent);
  }
  return args;
}

export async function probeOpenCodeRuntime(
  config: OpenCodeRuntimeConfig,
): Promise<OpenCodeProbeResult> {
  const workspace = configuredWorkspace(config.workspace);
  const fallbackCapabilities = {
    ...NO_AGENT_RUNTIME_CAPABILITIES,
    plugin: { id: "opencode", kind: "cli-adapter" as const },
  };
  let process: LocalProcessHandle | undefined;
  let client: OpenCodeAcpClient | undefined;
  try {
    const invocation = opencodeInvocation(
      configuredExecutable(config.executablePath),
    );
    process = startLocalProcess({
      command: invocation.command,
      args: [...invocation.prefix, ...openCodeArgs(config)],
      cwd: workspace,
      env: await openCodeProcessEnvironment("analysis"),
      onLine: (line) => {
        if (line.json !== undefined) client?.handleLine(line.json);
      },
    });
    client = new OpenCodeAcpClient(process, {
      mode: "analysis",
      onUpdate: () => undefined,
    });
    const initialize = await client!.initialize();
    const agentInfo = isRecord(initialize.agentInfo)
      ? initialize.agentInfo
      : {};
    await process.cancel();
    return {
      healthy: true,
      workspaceAccess: Boolean(workspace),
      capabilities: capabilitiesFromInitialize(initialize, Boolean(workspace)),
      message:
        [text(agentInfo.name), text(agentInfo.version)]
          .filter(Boolean)
          .join(" ") || "OpenCode ACP 已连接。",
    };
  } catch (error) {
    if (process) await process.cancel().catch(() => undefined);
    return {
      healthy: false,
      workspaceAccess: false,
      capabilities: fallbackCapabilities,
      message: redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }
}

interface OpenCodeWindowsProxySettings {
  enabled: boolean;
  server?: string;
  bypass?: string;
}

function hasOpenCodeProxyEnvironment(source: NodeJS.ProcessEnv): boolean {
  return [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ].some((key) => source[key] !== undefined);
}

/** Inherit an enabled Windows manual proxy without overriding explicit CLI settings. */
export function openCodeProxyEnvironment(
  source: NodeJS.ProcessEnv,
  settings?: OpenCodeWindowsProxySettings,
): NodeJS.ProcessEnv {
  if (
    !settings?.enabled ||
    !settings.server ||
    hasOpenCodeProxyEnvironment(source)
  )
    return source;
  const endpoints: Record<string, string> = {};
  for (const item of settings.server.split(";")) {
    const match = item.trim().match(/^(http|https|socks)=(.*)$/i);
    if (match) endpoints[match[1].toLowerCase()] = match[2].trim();
    else if (item.trim()) endpoints.http = endpoints.https = item.trim();
  }
  const result = { ...source };
  for (const protocol of ["http", "https"] as const) {
    const address = endpoints[protocol];
    if (!address) continue;
    try {
      const url = new URL(
        address.includes("://") ? address : "http://" + address,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        continue;
      result[protocol === "http" ? "HTTP_PROXY" : "HTTPS_PROXY"] =
        url.href.replace(/\/$/, "");
    } catch {
      /* Invalid system proxy settings must not break task startup. */
    }
  }
  if (result.HTTP_PROXY || result.HTTPS_PROXY) {
    if (source.NO_PROXY === undefined && source.no_proxy === undefined) {
      result.NO_PROXY = [
        ...new Set([
          "localhost",
          "127.0.0.1",
          "::1",
          ...(settings.bypass || "")
            .split(";")
            .map((value) => value.trim())
            .filter((value) => value && value !== "<local>"),
        ]),
      ].join(",");
    }
  }
  return result;
}

/** Repair launcher-escaped paths only in the OpenCode child environment. */
export function openCodeWindowsEnvironment(
  source: NodeJS.ProcessEnv,
  platform = process.platform,
): NodeJS.ProcessEnv {
  const result = { ...source };
  if (platform !== "win32") return result;
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (!value) continue;
    if (key.toLowerCase() === "path") {
      result[key] = value
        .split(";")
        .map((part) => (part ? win32.normalize(part) : part))
        .join(";");
    } else if (/^(systemroot|windir|comspec|temp|tmp)$/i.test(key)) {
      result[key] = win32.normalize(value);
    }
  }
  if (
    !Object.keys(result).some(
      (key) => key.toLowerCase() === "pathext" && result[key],
    )
  ) {
    result.PATHEXT = ".COM;.EXE;.BAT;.CMD";
  }
  return result;
}

/** Validate the native Windows shell before model tools start using it. */
export async function openCodeShellEnvironment(
  source: NodeJS.ProcessEnv,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
  probe: (
    path: string,
    args: string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<boolean> = (path, args, env) =>
    new Promise((resolveProbe) => {
      execFile(
        path,
        args,
        {
          env,
          windowsHide: true,
          shell: false,
          timeout: 3000,
          maxBuffer: 4096,
        },
        (error, stdout) =>
          resolveProbe(!error && stdout.trim() === "agents-one-shell-ok"),
      );
    }),
): Promise<NodeJS.ProcessEnv> {
  if (platform !== "win32" || source.SHELL?.trim()) return source;
  const directories = (source.PATH || source.Path || "")
    .split(";")
    .filter(Boolean);
  const find = (name: string): string | undefined =>
    directories.map((directory) => join(directory, name)).find(fileExists);
  const root = source.SystemRoot || source.SYSTEMROOT || source.WINDIR;
  const candidates = [
    find("pwsh.exe"),
    find("powershell.exe"),
    root
      ? join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      : undefined,
    source.OPENCODE_GIT_BASH_PATH,
    ...directories.map((directory) => join(directory, "..", "bin", "bash.exe")),
  ];
  for (const candidate of new Set(
    candidates.filter((path): path is string =>
      Boolean(path && fileExists(path)),
    ),
  )) {
    const args = /bash\.exe$/i.test(candidate)
      ? ["--noprofile", "--norc", "-c", "printf agents-one-shell-ok"]
      : [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Write-Output 'agents-one-shell-ok'",
        ];
    if (await probe(candidate, args, source))
      return { ...source, SHELL: candidate };
  }
  return source;
}

async function openCodeProcessEnvironment(
  mode: AgentRuntimeTaskInput["mode"],
): Promise<NodeJS.ProcessEnv> {
  const source = await openCodeShellEnvironment(
    openCodeWindowsEnvironment(openCodePermissionEnvironment(mode)),
  );
  if (process.platform !== "win32" || hasOpenCodeProxyEnvironment(source))
    return source;
  const settings = await new Promise<OpenCodeWindowsProxySettings | undefined>(
    (resolve) => {
      execFile(
        "reg.exe",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        ],
        { windowsHide: true, timeout: 2000, maxBuffer: 32 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve(undefined);
            return;
          }
          const values: Record<string, string> = {};
          for (const line of stdout.split(/\r?\n/)) {
            const match = line.match(
              /^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*?)\s*$/,
            );
            if (match) values[match[1]] = match[2];
          }
          resolve({
            enabled: Number(values.ProxyEnable) === 1,
            server: values.ProxyServer,
            bypass: values.ProxyOverride,
          });
        },
      );
    },
  );
  return openCodeProxyEnvironment(source, settings);
}

export interface OpenCodeProcessResult {
  inputArtifacts: RuntimeInputArtifact[];
  output: string;
  error?: string;
  sessionId?: string;
  artifacts: AgentRuntimeArtifact[];
  diffSummary?: string;
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
}

export interface StartedOpenCodeProcess {
  inputArtifacts: RuntimeInputArtifact[];
  sessionId?: string;
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
  cancel: () => Promise<void>;
  completion: Promise<OpenCodeProcessResult>;
}

export interface OpenCodeProcessMetadata {
  sessionId?: string;
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
}

/** Start one OpenCode ACP session and stream normalized updates to the caller. */
export async function startOpenCodeProcess(
  config: OpenCodeRuntimeConfig,
  input: AgentRuntimeTaskInput,
  onOutput: (chunk: string) => void,
  onEvent: (event: NormalizedRuntimeEvent) => void,
  onMetadata?: (metadata: OpenCodeProcessMetadata) => void,
): Promise<StartedOpenCodeProcess> {
  const mode = input.mode || "analysis";
  // A Runtime's configured workspace is probe-only metadata. Task execution
  // must use the workspace explicitly selected for this conversation; falling
  // back to the saved path would bypass the current workspace capability.
  const workspace = configuredWorkspace(input.workspace);
  if ((mode === "full_access" || mode === "implementation") && !workspace) {
    throw new Error("OpenCode 文件任务需要一个已授权的项目工作区。");
  }
  const cwd = workspace || openCodeConversationWorkspace(input.profile);
  const invocation = opencodeInvocation(
    configuredExecutable(config.executablePath),
  );
  const preparedInputs = prepareRuntimeInputs(
    input.profile,
    input.attachments,
    `opencode-${randomUUID()}`,
  );
  const promptBlocks: JsonRecord[] = [
    {
      type: "text",
      text: openCodePrompt(input.prompt + preparedInputs.promptContext),
    },
    ...preparedInputs.files.map(({ artifact, path }): JsonRecord => {
      if (artifact.kind === "image")
        return {
          type: "image",
          mimeType: artifact.mime,
          data: readFileSync(path).toString("base64"),
        };
      if (artifact.kind === "text")
        return {
          type: "resource",
          resource: {
            uri: pathToFileURL(path).href,
            mimeType: artifact.mime,
            text: readFileSync(path, "utf8"),
          },
        };
      return {
        type: "resource_link",
        uri: pathToFileURL(path).href,
        name: artifact.name,
        mimeType: artifact.mime,
      };
    }),
  ];
  const process = startLocalProcess({
    command: invocation.command,
    args: [...invocation.prefix, ...openCodeArgs(config)],
    cwd,
    env: await openCodeProcessEnvironment(mode),
    onLine: (line) => {
      if (line.json !== undefined) client.handleLine(line.json);
    },
  });
  let output = "";
  let sessionId: string | undefined;
  let cancelRequested = false;
  let turnCompleted = false;
  let model: AgentEventStreamModel | undefined;
  let usage: AgentEventStreamUsage | undefined;
  let thought = "";
  let messageStarted = false;
  let permissionDenied: string | undefined;
  const events: NormalizedRuntimeEvent[] = [];
  const toolStates = new Map<string, OpenCodeToolState>();
  const beforeWorkspace = workspace ? workspaceSnapshot(workspace) : undefined;
  const protection =
    mode === "safe_write" && workspace
      ? protectWorkspaceFromRemoval(workspace, input.profile)
      : undefined;
  const client = new OpenCodeAcpClient(process, {
    mode,
    onPermissionDenied: (reason) => {
      permissionDenied = reason;
      const event: NormalizedRuntimeEvent = {
        type: "error",
        summary: reason,
        detail: reason,
        code: "permission_denied",
      };
      events.push(event);
      onEvent(event);
    },
    onUpdate: (params) => {
      if (sessionId && params.sessionId !== sessionId) return;
      const update = isRecord(params.update) ? params.update : params;
      const isAgentText =
        update.sessionUpdate === "agent_message_chunk" ||
        update.sessionUpdate === "agent_thought_chunk";
      const chunk = isAgentText
        ? agentTextDelta(update.content)
        : contentText(update);
      const updateModel = modelFromOpenCodeValue(update.model);
      const updateUsage = usageFromOpenCodeValue(update.usage ?? update);
      if (updateModel || updateUsage) {
        model = updateModel ? { ...(model || {}), ...updateModel } : model;
        usage = updateUsage ? { ...(usage || {}), ...updateUsage } : usage;
        onMetadata?.({
          ...(model ? { model } : {}),
          ...(usage ? { usage } : {}),
        });
      }
      if (update.sessionUpdate === "agent_message_chunk" && chunk) {
        output = appendOutput(output, chunk);
        onOutput(chunk);
      }
      if (update.sessionUpdate === "agent_thought_chunk" && chunk) {
        thought = appendOutput(thought, chunk);
      } else if (update.sessionUpdate !== "agent_thought_chunk") {
        thought = "";
      }
      if (update.sessionUpdate === "agent_message_chunk") {
        // The answer is already streamed through onOutput. A status event per
        // delta would evict earlier thought/tool evidence from bounded history.
        if (chunk && !messageStarted) {
          messageStarted = true;
          const event: NormalizedRuntimeEvent = {
            type: "message",
            summary: "OpenCode 正在生成回复。",
          };
          events.push(event);
          onEvent(event);
        }
        return;
      }
      const eventText =
        update.sessionUpdate === "agent_thought_chunk" ? thought : chunk;
      const toolEvents = openCodeToolEvents(update, cwd, toolStates);
      if (toolEvents) {
        for (const event of toolEvents) {
          events.push(event);
          onEvent(event);
        }
        return;
      }
      const normalized = normalizeRuntimeEvent({
        type: update.sessionUpdate,
        data: update,
        text: eventText,
        detail: eventText,
      });
      if (normalized) {
        events.push(normalized);
        onEvent(normalized);
      }
    },
  });

  const completion = (async (): Promise<OpenCodeProcessResult> => {
    try {
      const session = await client!.createOrResumeSession(cwd, input.sessionId);
      sessionId = session.sessionId;
      if (session.model) {
        model = { ...(model || {}), ...session.model };
      }
      onMetadata?.({ sessionId, ...(model ? { model } : {}) });
      const response = await client!.prompt(
        promptBlocks,
        input.timeoutMs ?? config.timeoutMs,
      );
      const stopReason = text(response.stopReason);
      const responseUsage = usageFromOpenCodeValue(response);
      if (responseUsage) {
        usage = { ...(usage || {}), ...responseUsage };
        onMetadata?.({
          ...(model ? { model } : {}),
          usage,
        });
      }
      turnCompleted = true;
      await process.cancel();
      const processResult = await process.completion;
      const restored = protection?.restoreAndDispose() || [];
      const artifacts = changedArtifacts(workspace, beforeWorkspace, restored);
      return {
        output: restored.length
          ? `${output}\n[Agents One] 已阻止移动或删除 ${restored.length} 个原有文件。`
          : output,
        sessionId,
        artifacts,
        inputArtifacts: preparedInputs.artifacts,
        ...(model ? { model } : {}),
        ...(usage ? { usage } : {}),
        ...(artifacts.length
          ? {
              diffSummary: `OpenCode 已产生 ${artifacts.length} 项工作区变更。`,
            }
          : {}),
        ...(permissionDenied ? { error: permissionDenied } : {}),
        ...(restored.length
          ? { error: runtimeRemovalBlockedMessage(restored) }
          : {}),
        ...(stopReason === "cancelled" || cancelRequested || turnCompleted
          ? {}
          : processResult.exitCode === 0
            ? {}
            : {
                error:
                  processResult.stderr ||
                  `OpenCode exited with code ${processResult.exitCode ?? "unknown"}.`,
              }),
      };
    } catch (error) {
      const restored = protection?.restoreAndDispose() || [];
      const artifacts = changedArtifacts(workspace, beforeWorkspace, restored);
      await process.cancel().catch(() => undefined);
      return {
        output,
        sessionId,
        artifacts,
        inputArtifacts: preparedInputs.artifacts,
        ...(model ? { model } : {}),
        ...(usage ? { usage } : {}),
        ...(artifacts.length
          ? {
              diffSummary: `OpenCode 已产生 ${artifacts.length} 项工作区变更。`,
            }
          : {}),
        error: redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        ),
      };
    }
  })();

  return {
    inputArtifacts: preparedInputs.artifacts,
    get sessionId() {
      return sessionId;
    },
    get model() {
      return model;
    },
    get usage() {
      return usage;
    },
    cancel: async () => {
      cancelRequested = true;
      client!.cancelSession();
      // ACP acknowledges cancellation through the original prompt response.
      // Let native tools settle before terminating their session process.
      if (sessionId && !turnCompleted) {
        let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            completion.then(() => undefined),
            new Promise<void>((resolve) => {
              cancellationTimer = setTimeout(
                resolve,
                CANCEL_COMPLETION_GRACE_MS,
              );
            }),
          ]);
        } finally {
          if (cancellationTimer) clearTimeout(cancellationTimer);
        }
      }
      await process.cancel();
      await completion;
    },
    completion,
  };
}

function changedArtifacts(
  workspace: string | undefined,
  before: WorkspaceSnapshot | undefined,
  restored: string[],
): AgentRuntimeArtifact[] {
  if (!workspace || !before) return [];
  const after = workspaceSnapshot(workspace);
  const changed = changedWorkspaceFiles(before, after);
  const paths = [...new Set([...changed, ...restored])].sort();
  const content = paths
    .map((path) => {
      const normalizedPath = path.replace(/\\/g, "/");
      const current = after.entries.get(path) || before.entries.get(path);
      if (!current) return `${normalizedPath}\tdeleted`;
      return [
        normalizedPath,
        `${current.size} bytes`,
        current.sha256 ? `sha256=${current.sha256}` : "sha256=not-computed",
      ].join("\t");
    })
    .join("\n");
  const summary = [
    content,
    ...(before.truncated || after.truncated
      ? ["[Agents One] 工作区快照达到文件数上限，摘要可能不完整。"]
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  // Safe-write restoration is itself evidence that the agent attempted a
  // removal; keep only relative paths and never expose the absolute cwd.
  return paths.length
    ? [
        {
          kind: "diff",
          label: "OpenCode 受控写入摘要",
          mime: "text/plain",
          size: Buffer.byteLength(summary, "utf8"),
          sha256: createHash("sha256").update(summary).digest("hex"),
          content: summary,
          changeSummary: `${paths.length} 项相对路径发生变化或被安全策略恢复。`,
        },
      ]
    : [];
}

interface WorkspaceSnapshot {
  entries: Map<string, WorkspaceFileEntry>;
  truncated: boolean;
}

interface WorkspaceFileEntry {
  signature: string;
  size: number;
  sha256?: string;
}

function workspaceFileHash(path: string, size: number): string | undefined {
  if (size > MAX_HASHED_FILE_BYTES) return undefined;
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    return undefined;
  }
}

function workspaceSnapshot(root: string): WorkspaceSnapshot {
  const entries = new Map<string, WorkspaceFileEntry>();
  let truncated = false;
  const visit = (directory: string): void => {
    if (truncated) return;
    let children: string[];
    try {
      children = readdirSync(directory);
    } catch {
      return;
    }
    for (const child of children) {
      if (IGNORED_WORKSPACE_DIRECTORIES.has(child)) continue;
      const fullPath = join(directory, child);
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!stat.isFile()) continue;
      const sha256 = workspaceFileHash(fullPath, stat.size);
      entries.set(relative(root, fullPath), {
        signature: `${stat.size}:${Math.floor(stat.mtimeMs)}:${sha256 || ""}`,
        size: stat.size,
        ...(sha256 ? { sha256 } : {}),
      });
      if (entries.size >= MAX_WORKSPACE_FILES) {
        truncated = true;
        return;
      }
    }
  };
  visit(root);
  return { entries, truncated };
}

function changedWorkspaceFiles(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  const changed = new Set<string>();
  for (const [path, entry] of after.entries) {
    if (before.entries.get(path)?.signature !== entry.signature) {
      changed.add(path);
    }
  }
  for (const path of before.entries.keys()) {
    if (!after.entries.has(path)) changed.add(path);
  }
  return [...changed].sort().slice(0, 200);
}
