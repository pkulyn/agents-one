import { assertPiNonExecutingConfig } from "./pi-config-policy";
import { verifyPiStrictCapabilities } from "./pi-capabilities";
import { createPiWriteBoundary } from "./pi-write-boundary";
import { runtimeRemovalBlockedMessage } from "../shared/runtime-permissions";
import { spawn, execFile as execFileCallback } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { promisify } from "util";
import { StringDecoder } from "node:string_decoder";
import { homedir } from "os";
import { delimiter, dirname, extname, join, relative, resolve } from "path";
import { createHash, randomUUID } from "crypto";
import { agentsOneProfileHome, profileHome } from "./utils";
import { agentsOneDataRoot } from "./agents-one-data-root";
import { fileURLToPath } from "node:url";
import { prepareRuntimeInputs } from "./runtime-inputs";
import { protectWorkspaceFromRemoval } from "./workspace-protection";
import { terminateProcessTree } from "./process-control";
import type {
  AgentRuntimeArtifact,
  AgentRuntimeTaskInput,
  RuntimeInputArtifact,
} from "../shared/agent-runtimes";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 512 * 1024;
const SECRET_VALUE =
  /((?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi;

export interface PiRuntimeConfig {
  executablePath?: string;
  model?: string;
  workspace?: string;
  timeoutMs?: number;
}

export interface PiRuntimeProbeResult {
  healthy: boolean;
  message?: string;
  workspaceAccess: boolean;
}

export interface PiProcessResult {
  output: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts: AgentRuntimeArtifact[];
  inputArtifacts: RuntimeInputArtifact[];
  sessionId: string;
}

export interface StartedPiProcess {
  worktreePath?: string;
  inputArtifacts: RuntimeInputArtifact[];
  sessionId: string;
  /** Resolves only after the child has closed and its cleanup has completed. */
  cancel: () => Promise<void>;
  completion: Promise<PiProcessResult>;
}

export type PiRpcCommand =
  | "get_available_models"
  | "set_model"
  | "get_available_thinking_levels"
  | "set_thinking_level"
  | "compact"
  | "get_commands"
  | "get_state";

export interface PiRpcCommandRequest {
  type: PiRpcCommand;
  /** A provider session is required for stateful commands such as compact. */
  sessionId?: string;
  profile?: string;
  params?: Record<string, unknown>;
  timeoutMs?: number;
  /** Observes non-response RPC frames without making them model-visible text. */
  onEvent?: (event: PiRpcEvent) => void;
}

export interface PiRpcCommandResponse {
  command: PiRpcCommand;
  data: unknown;
}

export interface PiRpcEvent {
  type: string;
  data?: unknown;
}

export interface PiRpcPromptResult {
  /** Text from the last completed assistant message, if the command invoked one. */
  output?: string;
}

interface PiInvocation {
  command: string;
  prefix: string[];
}

function configuredExecutable(config: PiRuntimeConfig): string {
  const configured = config.executablePath?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") return "pi";
  const path = process.env.PATH || process.env.Path || "";
  for (const directory of path.split(delimiter)) {
    const candidate = join(directory, "pi.cmd");
    if (existsSync(candidate)) return candidate;
  }
  return "pi";
}

/** Keep npm's Windows wrapper out of spawn() while still using shell:false. */
export function piInvocation(
  executablePath: string,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): PiInvocation {
  if (
    platform !== "win32" ||
    extname(executablePath).toLowerCase() !== ".cmd"
  ) {
    return { command: executablePath, prefix: [] };
  }
  const binDir = dirname(executablePath);
  const node = join(binDir, "node.exe");
  const entries = [
    join(
      binDir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
      "dist",
      "cli.js",
    ),
    join(
      binDir,
      "node_modules",
      "@mariozechner",
      "pi-coding-agent",
      "dist",
      "cli.js",
    ),
  ];
  const entry = entries.find(fileExists);
  if (!fileExists(node) || !entry) {
    throw new Error(
      "The Pi Agent CLI script wrapper is incomplete. Select pi.exe or reinstall the user-level Pi Agent CLI.",
    );
  }
  return { command: node, prefix: [entry] };
}

function redact(value: string): string {
  return value.replace(SECRET_VALUE, "$1[redacted]");
}

/** Binary input echoes are not output and must not evict the final JSON frame. */
// @lat: [[runtime-chat#Pi attachment output retention]]
export function piOutputFrame(line: string): string {
  try {
    const frame = JSON.parse(line);
    if (frame.type === "agent_end" && Array.isArray(frame.messages)) {
      frame.messages = frame.messages.filter(
        (message: unknown) => record(message) && message.role === "assistant",
      );
    }
    return JSON.stringify(frame, (_key, value) => {
      if (record(value) && value.type === "image") {
        return {
          type: "image",
          mimeType: value.mimeType,
          data: "[input omitted]",
        };
      }
      return value;
    });
  } catch {
    return line;
  }
}

function appendCapped(current: string, next: string): string {
  const merged = `${current}${redact(next)}`;
  return merged.length <= MAX_OUTPUT ? merged : merged.slice(-MAX_OUTPUT);
}

async function command(
  invocation: PiInvocation,
  args: string[],
  cwd?: string,
): Promise<string> {
  const result = await execFile(
    invocation.command,
    [...invocation.prefix, ...args],
    {
      cwd,
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: MAX_OUTPUT,
      shell: false,
    },
  );
  return String(result.stdout || "").trim();
}

async function gitRoot(workspace: string): Promise<string> {
  const root = await command({ command: "git", prefix: [] }, [
    "-C",
    workspace,
    "rev-parse",
    "--show-toplevel",
  ]);
  if (!root) throw new Error("The selected workspace is not a Git repository.");
  return resolve(root);
}

function requestedWorkspace(
  _config: PiRuntimeConfig,
  input?: AgentRuntimeTaskInput,
): string | undefined {
  const raw = input?.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace))
    throw new Error("The selected workspace does not exist.");
  return workspace;
}

function configuredProbeWorkspace(config: PiRuntimeConfig): string | undefined {
  const raw = config.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace))
    throw new Error("The configured workspace does not exist.");
  return workspace;
}

function safeWorktreePath(profile: string | undefined, id: string): string {
  const root = resolve(
    agentsOneProfileHome(profile),
    "desktop",
    "worktrees",
    "pi",
  );
  const target = resolve(root, id);
  if (relative(root, target).startsWith(".."))
    throw new Error("Invalid worktree path.");
  mkdirSync(root, { recursive: true });
  return target;
}

function sessionsRoot(profile?: string): string {
  const root = resolve(agentsOneProfileHome(profile), "desktop", "pi-sessions");
  mkdirSync(root, { recursive: true });
  return root;
}

function conversationDirectory(profile?: string): string {
  return resolve(
    agentsOneProfileHome(profile),
    "desktop",
    "runtime-chat",
    "pi",
  );
}

function conversationCwd(profile?: string): string {
  const root = conversationDirectory(profile);
  mkdirSync(root, { recursive: true });
  return root;
}

const PI_EXECUTION_ENVIRONMENT_KEYS = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_EXTERNAL_MODULE",
  "NODE_ICU_DATA",
  "NODE_V8_COVERAGE",
  "NODE_COMPILE_CACHE",
  "NODE_COMPILE_CACHE_PORTABLE",
  "NODE_REDIRECT_WARNINGS",
  "OPENSSL_CONF",
  "OPENSSL_CONF_INCLUDE",
  "OPENSSL_ENGINES",
  "OPENSSL_MODULES",
  "ELECTRON_RUN_AS_NODE",
  "PI_PACKAGE_DIR",
  "RIPGREP_CONFIG_PATH",
  "BASH_ENV",
  "ENV",
  "SHELLOPTS",
  "BASHOPTS",
  "PROMPT_COMMAND",
  "ZDOTDIR",
  "ZSH_ENV",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONINSPECT",
  "RUBYOPT",
  "RUBYLIB",
  "PERL5OPT",
  "PERL5LIB",
  "PERLLIB",
]);

// @lat: [[runtime-chat#Pi restricted task environment]]
export function piChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  mode: AgentRuntimeTaskInput["mode"] = "full_access",
): NodeJS.ProcessEnv {
  if (mode !== "analysis" && mode !== "safe_write") return { ...source };
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => {
      const name = key.toUpperCase();
      return (
        !PI_EXECUTION_ENVIRONMENT_KEYS.has(name) &&
        !name.startsWith("LD_") &&
        !name.startsWith("DYLD_") &&
        !name.startsWith("BUN_")
      );
    }),
  );
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

/**
 * Resolve Pi's own model metadata without invoking the CLI. Custom providers
 * live in models.json and refreshed provider catalogues live in
 * models-store.json; both use the same model shape. Reading these files keeps
 * the context gauge aligned with the model Pi actually selected (and avoids a
 * slow `pi --list-models` subprocess on every chat open).
 */
// @lat: [[runtime-chat#Runtime model context window]]
export function getPiModelContextWindow(
  provider: string,
  model: string,
  configDir = process.env.PI_CODING_AGENT_DIR?.trim() ||
    join(homedir(), ".pi", "agent"),
): number | null {
  const providerId = provider.trim().toLowerCase();
  const modelId = model.trim().toLowerCase();
  if (!providerId || !modelId) return null;

  const findInModels = (models: unknown): number | null => {
    if (!Array.isArray(models)) return null;
    const match = models.find((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      const id = (candidate as Record<string, unknown>).id;
      return typeof id === "string" && id.trim().toLowerCase() === modelId;
    }) as Record<string, unknown> | undefined;
    return match ? positiveInteger(match.contextWindow) : null;
  };

  try {
    const customFile = join(configDir, "models.json");
    if (existsSync(customFile)) {
      const parsed = JSON.parse(readFileSync(customFile, "utf-8")) as {
        providers?: Record<string, { models?: unknown }>;
      };
      const entry = Object.entries(parsed.providers || {}).find(
        ([id]) => id.trim().toLowerCase() === providerId,
      );
      const contextWindow = findInModels(entry?.[1]?.models);
      if (contextWindow) return contextWindow;
    }
  } catch {
    // A malformed optional catalogue must not prevent the runtime from loading.
  }

  try {
    const storeFile = join(configDir, "models-store.json");
    if (existsSync(storeFile)) {
      const parsed = JSON.parse(readFileSync(storeFile, "utf-8")) as Record<
        string,
        { models?: unknown }
      >;
      const entry = Object.entries(parsed).find(
        ([id]) => id.trim().toLowerCase() === providerId,
      );
      return findInModels(entry?.[1]?.models);
    }
  } catch {
    // Fall through to provider discovery / renderer heuristics.
  }

  return null;
}

export interface PiConfiguredModel {
  provider: string;
  id: string;
  displayName?: string;
  reasoningEfforts?: string[];
}

/**
 * Read Pi's locally registered model catalog without starting a new CLI/RPC
 * process. This is intentionally metadata-only: provider credentials and all
 * other provider fields remain in Pi's private config and are never exposed.
 */
export function getPiConfiguredModels(
  configDir = process.env.PI_CODING_AGENT_DIR?.trim() ||
    join(homedir(), ".pi", "agent"),
): PiConfiguredModel[] {
  const result: PiConfiguredModel[] = [];
  const seen = new Set<string>();
  const appendModels = (providers: unknown): void => {
    if (
      !providers ||
      typeof providers !== "object" ||
      Array.isArray(providers)
    ) {
      return;
    }
    for (const [providerValue, providerConfig] of Object.entries(providers)) {
      const provider = providerValue.trim();
      if (!provider || !providerConfig || typeof providerConfig !== "object") {
        continue;
      }
      const models = (providerConfig as { models?: unknown }).models;
      if (!Array.isArray(models)) continue;
      for (const candidate of models) {
        if (!candidate || typeof candidate !== "object") continue;
        const item = candidate as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id) continue;
        const key = `${provider.toLowerCase()}/${id.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const displayName =
          typeof item.displayName === "string"
            ? item.displayName.trim()
            : typeof item.name === "string"
              ? item.name.trim()
              : "";
        const thinkingLevelMap = item.thinkingLevelMap;
        const reasoningEfforts =
          thinkingLevelMap &&
          typeof thinkingLevelMap === "object" &&
          !Array.isArray(thinkingLevelMap)
            ? Object.entries(thinkingLevelMap as Record<string, unknown>)
                .filter(
                  ([level, mapped]) =>
                    typeof level === "string" && mapped !== null,
                )
                .map(([level]) => level.trim())
                .filter(Boolean)
            : [];
        result.push({
          provider,
          id,
          ...(displayName ? { displayName } : {}),
          ...(reasoningEfforts.length ? { reasoningEfforts } : {}),
        });
      }
    }
  };

  try {
    const customFile = join(configDir, "models.json");
    if (existsSync(customFile)) {
      const parsed = JSON.parse(readFileSync(customFile, "utf-8")) as {
        providers?: unknown;
      };
      appendModels(parsed.providers);
    }
  } catch {
    // A malformed optional model file must not block Runtime chat.
  }

  try {
    const storeFile = join(configDir, "models-store.json");
    if (existsSync(storeFile)) {
      appendModels(JSON.parse(readFileSync(storeFile, "utf-8")) as unknown);
    }
  } catch {
    // The configured catalog above is still usable when a cache is malformed.
  }

  return result.sort((left, right) => {
    const leftId = `${left.provider}/${left.id}`;
    const rightId = `${right.provider}/${right.id}`;
    return leftId.localeCompare(rightId);
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assistantOutcome(
  value: unknown,
): { error?: string; succeeded?: boolean } | undefined {
  if (!record(value) || value.role !== "assistant") return undefined;
  if (value.stopReason === "error") {
    return {
      error:
        typeof value.errorMessage === "string" && value.errorMessage.trim()
          ? value.errorMessage.trim()
          : "Pi Agent returned an error without details.",
    };
  }
  const hasText =
    Array.isArray(value.content) &&
    value.content.some(
      (item) =>
        record(item) &&
        item.type === "text" &&
        typeof item.text === "string" &&
        item.text.trim(),
    );
  return hasText ? { succeeded: true } : undefined;
}

/** Pi can report a failed model request in JSON while still exiting with code 0. */
export function piOutputError(output: string): string | undefined {
  let outcome: { error?: string; succeeded?: boolean } | undefined;
  let sawTerminalAssistant = false;
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const frame = JSON.parse(line) as Record<string, unknown>;
      // `pi --print --output-format json` emits a completed assistant reply as
      // `type: "message"`; interactive transports may instead use
      // `message_end`/`turn_end`. Treat all three as the same assistant result.
      if (
        frame.type === "message" ||
        frame.type === "message_end" ||
        frame.type === "turn_end"
      ) {
        sawTerminalAssistant =
          sawTerminalAssistant ||
          (record(frame.message) && frame.message.role === "assistant");
        outcome = assistantOutcome(frame.message) || outcome;
      } else if (frame.type === "agent_end" && Array.isArray(frame.messages)) {
        for (const message of frame.messages) {
          sawTerminalAssistant =
            sawTerminalAssistant ||
            (record(message) && message.role === "assistant");
          outcome = assistantOutcome(message) || outcome;
        }
      }
    } catch {
      // Partial or non-JSON stderr lines remain available in the raw output.
    }
  }
  if (!outcome?.error) {
    return sawTerminalAssistant && !outcome?.succeeded
      ? "Pi Agent 本轮在工具或思考阶段结束，未返回最终答复。"
      : undefined;
  }
  return /fetch failed/i.test(outcome.error)
    ? "Pi Agent 无法连接模型服务（fetch failed）。请检查网络或代理设置后重试。"
    : `Pi Agent 请求失败：${redact(outcome.error)}`;
}

/**
 * Read-only runs retain file readers and query orchestration. A native Pi
 * extension guards every actual call, including nested MCP/codemode calls.
 */
export function piExecArgs(
  mode: "analysis" | "safe_write" | "implementation" | "full_access",
  prompt: string,
  sessionId: string,
  sessionDirectory: string,
  inputPaths: string[] = [],
  _allowReadTools = false,
  model?: string,
): string[] {
  const args = [
    "--print",
    "--mode",
    "json",
    "--session-dir",
    sessionDirectory,
    "--session-id",
    sessionId,
  ];
  // Restricted runs use trusted native file tools only. A tools allowlist alone
  // does not disable MCP in Pi; block discovery and indirect execution as well.
  if (mode === "analysis" || mode === "safe_write") {
    args.push(
      "--no-extensions",
      "--no-mcp",
      "--tools",
      mode === "analysis"
        ? "read,grep,find,ls"
        : "read,grep,find,ls,write,edit",
      "--exclude-tools",
      "bash,powershell,tool_search,codemode,mcp__*",
    );
  }
  if (model?.trim()) args.push("--model", model.trim());
  // Pi expands only these staged copies before the run. It never receives the
  // user's original source path or broad filesystem access for attachments.
  for (const path of inputPaths) args.push(`@${path}`);
  args.push(prompt);
  return args;
}

/**
 * Build a strict JSONL RPC invocation. The adapter deliberately uses Pi's RPC
 * mode instead of attempting to feed interactive `/` commands to a terminal.
 */
export function piRpcArgs(
  sessionDirectory: string,
  sessionId?: string,
): string[] {
  const args = ["--mode", "rpc", "--session-dir", sessionDirectory];
  if (sessionId?.trim()) args.push("--session-id", sessionId.trim());
  else args.push("--no-session");
  return args;
}

/**
 * Execute exactly one Pi RPC request over a short-lived JSONL control channel.
 * Prompt execution remains on the existing streaming process path; this helper
 * is only for out-of-band controls and is safe to call from Electron main.
 */
export async function executePiRpcCommand(
  config: PiRuntimeConfig,
  request: PiRpcCommandRequest,
): Promise<PiRpcCommandResponse> {
  const invocation = piInvocation(configuredExecutable(config));
  const sessionDirectory = sessionsRoot(request.profile);
  const requestId = `agents-one-${randomUUID()}`;
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? 20_000, 1_000),
    60_000,
  );

  return new Promise<PiRpcCommandResponse>((resolveResult, rejectResult) => {
    const child = spawn(
      invocation.command,
      [...invocation.prefix, ...piRpcArgs(sessionDirectory, request.sessionId)],
      {
        cwd: conversationCwd(request.profile),
        env: piChildEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    const settle = (
      callback: (value: PiRpcCommandResponse | Error) => void,
      value: PiRpcCommandResponse | Error,
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin?.end();
      void terminateProcessTree(child).catch(() => undefined);
      callback(value);
    };
    const succeed = (response: PiRpcCommandResponse): void =>
      settle((value) => resolveResult(value as PiRpcCommandResponse), response);
    const fail = (error: Error): void =>
      settle((value) => rejectResult(value), error);
    const timeout = setTimeout(() => {
      fail(new Error(`Pi RPC ${request.type} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    const parseFrame = (line: string): void => {
      if (!line.trim()) return;
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!record(parsed)) return;
        frame = parsed;
      } catch {
        return;
      }
      if (frame.type === "event") {
        const event = record(frame.event) ? frame.event : frame;
        const type = typeof event.type === "string" ? event.type : "unknown";
        request.onEvent?.({
          type,
          ...("data" in event ? { data: event.data } : {}),
        });
        return;
      }
      if (frame.type !== "response" || frame.id !== requestId) return;
      if (frame.success !== true) {
        const message =
          typeof frame.error === "string" && frame.error.trim()
            ? redact(frame.error)
            : `Pi RPC ${request.type} failed.`;
        fail(new Error(message));
        return;
      }
      succeed({ command: request.type, data: frame.data });
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        parseFrame(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString());
    });
    child.once("error", (error) => fail(new Error(redact(error.message))));
    child.once("close", (code) => {
      parseFrame(stdoutBuffer.replace(/\r$/, ""));
      if (!settled) {
        fail(
          new Error(
            `Pi RPC ${request.type} exited with code ${code ?? "unknown"}${
              stderr ? `: ${redact(stderr).slice(-500)}` : ""
            }`,
          ),
        );
      }
    });
    child.stdin?.write(
      `${JSON.stringify({ id: requestId, type: request.type, ...(request.params ?? {}) })}\n`,
    );
  });
}

/**
 * Run a Pi extension, prompt-template, or skill command in the persisted
 * session. Pi deliberately expands these only through the `prompt` RPC
 * command; they must not be written to an interactive terminal.
 */
export async function executePiRpcPrompt(
  config: PiRuntimeConfig,
  request: {
    sessionId: string;
    message: string;
    profile?: string;
    timeoutMs?: number;
    /** Extension commands can complete without starting an agent turn. */
    waitForAgentSettled?: boolean;
  },
): Promise<PiRpcPromptResult> {
  const sessionId = request.sessionId.trim();
  const message = request.message.trim();
  if (!sessionId)
    throw new Error("Pi native command requires an active session.");
  if (!message.startsWith("/")) {
    throw new Error("Pi native commands must start with '/'.");
  }
  const invocation = piInvocation(configuredExecutable(config));
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? 60_000, 1_000),
    10 * 60_000,
  );
  const requestId = `agents-one-${randomUUID()}`;

  return new Promise<PiRpcPromptResult>((resolveResult, rejectResult) => {
    const child = spawn(
      invocation.command,
      [
        ...invocation.prefix,
        ...piRpcArgs(sessionsRoot(request.profile), sessionId),
      ],
      {
        cwd: conversationCwd(request.profile),
        env: piChildEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdoutBuffer = "";
    let stderr = "";
    let accepted = false;
    let settled = false;
    let lastAssistantText = "";
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin?.end();
      void terminateProcessTree(child).catch(() => undefined);
      if (error) rejectResult(error);
      else
        resolveResult(lastAssistantText ? { output: lastAssistantText } : {});
    };
    const parseMessageText = (value: unknown): string | undefined => {
      if (!record(value) || !Array.isArray(value.content)) return undefined;
      const text = value.content
        .filter(record)
        .filter((item) => item.type === "text" && typeof item.text === "string")
        .map((item) => String(item.text))
        .join("")
        .trim();
      return text || undefined;
    };
    const parseFrame = (line: string): void => {
      if (!line.trim() || settled) return;
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!record(parsed)) return;
        frame = parsed;
      } catch {
        return;
      }
      if (frame.type === "response" && frame.id === requestId) {
        if (frame.success !== true) {
          const detail =
            typeof frame.error === "string" && frame.error.trim()
              ? redact(frame.error)
              : "Pi native command was rejected.";
          finish(new Error(detail));
        } else {
          accepted = true;
          if (request.waitForAgentSettled === false) finish();
        }
        return;
      }
      if (frame.type === "message_end") {
        const text = parseMessageText(frame.message);
        if (text) lastAssistantText = text;
        return;
      }
      if (frame.type === "agent_settled" && accepted) finish();
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newline = stdoutBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        parseFrame(line);
        newline = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString());
    });
    child.once("error", (error) => finish(new Error(redact(error.message))));
    child.once("close", (code) => {
      parseFrame(stdoutBuffer.replace(/\r$/, ""));
      if (!settled) {
        finish(
          new Error(
            accepted
              ? `Pi native command ended before the session settled (code ${code ?? "unknown"}).`
              : `Pi native command exited with code ${code ?? "unknown"}${
                  stderr ? `: ${redact(stderr).slice(-500)}` : ""
                }`,
          ),
        );
      }
    });
    const timeout = setTimeout(() => {
      finish(new Error(`Pi native command timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdin?.write(
      `${JSON.stringify({ id: requestId, type: "prompt", message })}\n`,
    );
  });
}

export async function probePiRuntime(
  config: PiRuntimeConfig,
): Promise<PiRuntimeProbeResult> {
  try {
    const version = await command(piInvocation(configuredExecutable(config)), [
      "--version",
    ]);
    const workspace = configuredProbeWorkspace(config);
    if (workspace) await gitRoot(workspace);
    return {
      healthy: true,
      workspaceAccess: Boolean(workspace),
      message: version || "Pi Agent CLI is available.",
    };
  } catch (error) {
    return {
      healthy: false,
      workspaceAccess: false,
      message:
        error instanceof Error
          ? redact(error.message)
          : "Pi Agent CLI is unavailable.",
    };
  }
}

/** Match the native Pi 1.4 config path spelling before applying write authority. */
function piPrivateConfigRoot(cwd: string): string {
  let value =
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  if (process.platform === "win32") {
    const drive = value.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
    if (drive && !value.includes("\\"))
      value =
        drive[1].toUpperCase() + ":\\" + (drive[2] || "").replaceAll("/", "\\");
  }
  if (value === "~") value = homedir();
  else if (
    value.startsWith("~/") ||
    (process.platform === "win32" && value.startsWith("~\\"))
  )
    value = join(homedir(), value.slice(2));
  if (value.startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      return cwd;
    } // Invalid native config cannot establish automatic authority.
  }
  return resolve(cwd, value);
}

/** Native Pi hook: every nested tool call receives the same check. */
// @lat: [[runtime-chat#Pi read-only tool boundary]]
export function piReadOnlyExtensionSource(
  mode: "analysis" | "safe_write" = "analysis",
  writableRoot = "",
  protectedPaths: string[] = [],
): string {
  return `import * as fs from "node:fs";
import * as path from "node:path";
const checkWritePath = (${createPiWriteBoundary.toString()})(${JSON.stringify(writableRoot)}, fs, path, ${JSON.stringify(protectedPaths)});
export default function agentsOneReadOnly(pi) {
  const allowed = new Set(${JSON.stringify(mode === "safe_write" ? ["read", "grep", "find", "ls", "write", "edit"] : ["read", "grep", "find", "ls"])});
  pi.on("tool_call", (event, ctx) => {
    const name = event.toolName;
    if (allowed.has(name)) {
      if (name === "write" || name === "edit") {
        const reason = checkWritePath(event.input?.path, ctx?.cwd);
        if (reason) return { block: true, reason };
      }
      return;
    }
    return {
      block: true,
      reason: "[Agents One 权限不足] 当前权限为" + ${JSON.stringify(mode === "safe_write" ? "自动" : "只读")} +
        "，已阻止终端、脚本或未受控工具 " + name +
        "。仅允许本轮受控文件工具；终端、脚本、移动或删除需切换为完全访问。不要声称该操作已完成。",
    };
  });
}
`;
}

function piReadOnlyExtension(
  profile: string | undefined,
  mode: "analysis" | "safe_write",
  writableRoot: string,
  protectedPaths: string[],
): string {
  const source = piReadOnlyExtensionSource(mode, writableRoot, protectedPaths);
  const digest = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const directory = resolve(
    agentsOneProfileHome(profile),
    "desktop",
    "pi-permissions",
  );
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `read-only-${digest}.mjs`);
  // Generated code is Main-owned and contains no provider/user configuration.
  writeFileSync(file, source, "utf-8");
  return file;
}

export async function startPiProcess(
  config: PiRuntimeConfig,
  input: AgentRuntimeTaskInput,
  onOutput: (chunk: string) => void,
  canStart: () => boolean = () => true,
): Promise<StartedPiProcess> {
  const assertCanStart = (): void => {
    if (!canStart()) throw Error("Pi task was cancelled before execution.");
  };
  assertCanStart();
  const mode = input.mode || "analysis";
  let invocation = piInvocation(configuredExecutable(config));
  const workspace = requestedWorkspace(config, input);
  if ((mode === "implementation" || mode === "full_access") && !workspace) {
    throw new Error(
      "Pi full-access tasks require a task-specific project folder.",
    );
  }

  const strict =
    mode === "analysis" || mode === "safe_write"
      ? await verifyPiStrictCapabilities(invocation)
      : undefined;
  assertCanStart();
  if (strict) invocation = strict.invocation;

  let cwd = workspace || conversationDirectory(input.profile);
  const configRoot = strict ? piPrivateConfigRoot(cwd) : undefined;
  if (configRoot) assertPiNonExecutingConfig(configRoot);
  if (!workspace) mkdirSync(cwd, { recursive: true });
  let worktreePath: string | undefined;
  if (mode === "implementation" && workspace) {
    const root = await gitRoot(workspace);
    worktreePath = safeWorktreePath(
      input.profile,
      input.worktreeId || `task-${randomUUID()}`,
    );
    await command({ command: "git", prefix: [] }, [
      "-C",
      root,
      "worktree",
      "add",
      "--detach",
      worktreePath,
      "HEAD",
    ]);
    cwd = worktreePath;
  }

  assertCanStart();
  const preparedInputs = prepareRuntimeInputs(
    input.profile,
    input.attachments,
    `pi-${randomUUID()}`,
  );
  const sessionId = input.sessionId?.trim() || `pi-${randomUUID()}`;
  const runtimePrompt = `${input.prompt}${preparedInputs.promptContext}`;
  const workspaceProtection =
    mode === "safe_write" && workspace
      ? protectWorkspaceFromRemoval(workspace, input.profile)
      : undefined;
  strict?.assertUnchanged();
  if (configRoot) assertPiNonExecutingConfig(configRoot);
  assertCanStart();
  const child = spawn(
    invocation.command,
    [
      ...invocation.prefix,
      ...(mode === "analysis" || mode === "safe_write"
        ? [
            "--extension",
            piReadOnlyExtension(input.profile, mode, cwd, [
              ...[
                invocation.command,
                ...invocation.prefix,
                process.execPath,
              ].flatMap((file) => [file, dirname(file)]),
              // Explicit selection cannot grant authority over private application state.
              // Implicit conversation writes are already confined to their own cwd.
              resolve(profileHome()),
              piPrivateConfigRoot(cwd),
              ...(workspace ? [dirname(agentsOneDataRoot())] : []),
            ]),
          ]
        : []),
      ...piExecArgs(
        mode,
        runtimePrompt,
        sessionId,
        sessionsRoot(input.profile),
        preparedInputs.files.map((file) => file.path),
        Boolean(workspace),
        config.model,
      ),
    ],
    {
      cwd,
      env: piChildEnvironment(process.env, mode),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const recordOutput = (chunk: string): void => {
    if (!chunk) return;
    const safe = redact(chunk);
    output = appendCapped(output, safe);
    onOutput(safe);
  };
  const decoder = new StringDecoder("utf8");
  let pending = "";
  const consume = (value: string): void => {
    pending += value;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      recordOutput(piOutputFrame(pending.slice(0, newline)) + "\n");
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
    }
  };
  child.stdout?.on("data", (data: Buffer) => consume(decoder.write(data)));
  child.stdout?.on("end", () => {
    consume(decoder.end());
    if (pending) recordOutput(piOutputFrame(pending) + "\n");
    pending = "";
  });
  child.stderr?.on("data", (data: Buffer) => recordOutput(data.toString()));

  const completion = new Promise<PiProcessResult>((resolveResult) => {
    child.once("error", (error) => {
      workspaceProtection?.restoreAndDispose();
      resolveResult({
        output,
        error: workspaceProtection?.recoveryError || redact(error.message),
        worktreePath,
        artifacts: worktreePath
          ? [
              {
                kind: "worktree",
                label: "Isolated worktree",
                path: worktreePath,
              },
            ]
          : [],
        inputArtifacts: preparedInputs.artifacts,
        sessionId,
      });
    });
    child.once("close", async (code) => {
      const restoredFiles = workspaceProtection?.restoreAndDispose() || [];
      let diffSummary: string | undefined;
      let diff: string | undefined;
      if (worktreePath) {
        try {
          diffSummary = await command({ command: "git", prefix: [] }, [
            "-C",
            worktreePath,
            "diff",
            "--stat",
          ]);
          diff = await command({ command: "git", prefix: [] }, [
            "-C",
            worktreePath,
            "diff",
            "--no-ext-diff",
          ]);
        } catch {
          // Keep Pi's output even when inspecting the worktree fails.
        }
      }
      const artifacts: AgentRuntimeArtifact[] = [];
      if (worktreePath)
        artifacts.push({
          kind: "worktree",
          label: "Isolated worktree",
          path: worktreePath,
        });
      if (diff)
        artifacts.push({
          kind: "diff",
          label: "Git diff",
          content: diff.slice(0, MAX_OUTPUT),
        });
      const structuredError = code === 0 ? piOutputError(output) : undefined;
      resolveResult({
        output: restoredFiles.length
          ? `${output}\n[Agents One] 已阻止移动或删除 ${restoredFiles.length} 个原有文件。`
          : output,
        ...(code === 0
          ? structuredError
            ? { error: structuredError }
            : {}
          : { error: `Pi Agent CLI exited with code ${code ?? "unknown"}.` }),
        ...(worktreePath ? { worktreePath } : {}),
        ...(diffSummary ? { diffSummary } : {}),
        artifacts,
        ...(restoredFiles.length
          ? { error: runtimeRemovalBlockedMessage(restoredFiles) }
          : {}),
        ...(workspaceProtection?.recoveryError
          ? { error: workspaceProtection.recoveryError }
          : {}),
        inputArtifacts: preparedInputs.artifacts,
        sessionId,
      });
    });
  });

  return {
    worktreePath,
    inputArtifacts: preparedInputs.artifacts,
    sessionId,
    cancel: async () => {
      await terminateProcessTree(child);
      await completion;
    },
    completion,
  };
}
