import {
  spawn,
  execFile as execFileCallback,
  type ChildProcess,
} from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { promisify } from "util";
import { homedir } from "os";
import { delimiter, dirname, extname, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { profileHome } from "./utils";
import { prepareRuntimeInputs } from "./runtime-inputs";
import { protectWorkspaceFromRemoval } from "./workspace-protection";
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
  cancel: () => void;
  completion: Promise<PiProcessResult>;
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
  if (!existsSync(workspace)) throw new Error("The configured workspace does not exist.");
  return workspace;
}

function safeWorktreePath(profile: string | undefined, id: string): string {
  const root = resolve(profileHome(profile), "desktop", "worktrees", "pi");
  const target = resolve(root, id);
  if (relative(root, target).startsWith(".."))
    throw new Error("Invalid worktree path.");
  mkdirSync(root, { recursive: true });
  return target;
}

function sessionsRoot(profile?: string): string {
  const root = resolve(profileHome(profile), "desktop", "pi-sessions");
  mkdirSync(root, { recursive: true });
  return root;
}

function conversationCwd(profile?: string): string {
  const root = resolve(profileHome(profile), "desktop", "runtime-chat", "pi");
  mkdirSync(root, { recursive: true });
  return root;
}

export function piChildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return { ...source };
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
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith("{")) continue;
    try {
      const frame = JSON.parse(line) as Record<string, unknown>;
      if (frame.type === "message_end" || frame.type === "turn_end") {
        outcome = assistantOutcome(frame.message) || outcome;
      } else if (frame.type === "agent_end" && Array.isArray(frame.messages)) {
        for (const message of frame.messages) {
          outcome = assistantOutcome(message) || outcome;
        }
      }
    } catch {
      // Partial or non-JSON stderr lines remain available in the raw output.
    }
  }
  if (!outcome?.error) return undefined;
  return /fetch failed/i.test(outcome.error)
    ? "Pi Agent 无法连接模型服务（fetch failed）。请检查网络或代理设置后重试。"
    : `Pi Agent 请求失败：${redact(outcome.error)}`;
}

function terminateTree(child: ChildProcess): void {
  if (child.pid && process.platform === "win32") {
    void execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
    }).catch(() => child.kill());
    return;
  }
  child.kill("SIGTERM");
}

/**
 * Pure, regression-tested Pi invocation. Analysis can use a small read-only
 * tool allowlist inside an explicitly selected workspace. It never receives
 * write, edit, or shell access outside an isolated implementation worktree.
 */
export function piExecArgs(
  mode: "analysis" | "safe_write" | "implementation" | "full_access",
  prompt: string,
  sessionId: string,
  sessionDirectory: string,
  inputPaths: string[] = [],
  allowReadTools = false,
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
  // Writable modes keep Pi's native terminal capabilities: built-in/custom
  // tools, skills, extensions, MCP adapters, packages and project context.
  // Only a user-selected read-only run narrows the available tools.
  if (mode === "analysis") {
    if (allowReadTools) {
      args.push("--tools", "read,grep,find,ls");
    } else {
      args.push("--no-tools");
    }
  }
  if (model?.trim()) args.push("--model", model.trim());
  // Pi expands only these staged copies before the run. It never receives the
  // user's original source path or broad filesystem access for attachments.
  for (const path of inputPaths) args.push(`@${path}`);
  args.push(prompt);
  return args;
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

export async function startPiProcess(
  config: PiRuntimeConfig,
  input: AgentRuntimeTaskInput,
  onOutput: (chunk: string) => void,
): Promise<StartedPiProcess> {
  const mode = input.mode || "analysis";
  const invocation = piInvocation(configuredExecutable(config));
  const workspace = requestedWorkspace(config, input);
  if (
    (mode === "implementation" || mode === "full_access") &&
    !workspace
  ) {
    throw new Error(
      "Pi full-access tasks require a task-specific project folder.",
    );
  }

  let cwd = workspace || conversationCwd(input.profile);
  let worktreePath: string | undefined;
  if (mode === "implementation" && workspace) {
    const root = await gitRoot(workspace);
    worktreePath = safeWorktreePath(input.profile, `task-${randomUUID()}`);
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
  const child = spawn(
    invocation.command,
    [
      ...invocation.prefix,
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
      env: piChildEnvironment(),
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
  child.stdout?.on("data", (data: Buffer) => recordOutput(data.toString()));
  child.stderr?.on("data", (data: Buffer) => recordOutput(data.toString()));

  const completion = new Promise<PiProcessResult>((resolveResult) => {
    child.once("error", (error) => {
      workspaceProtection?.restoreAndDispose();
      resolveResult({
        output,
        error: redact(error.message),
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
        inputArtifacts: preparedInputs.artifacts,
        sessionId,
      });
    });
  });

  return {
    worktreePath,
    inputArtifacts: preparedInputs.artifacts,
    sessionId,
    cancel: () => terminateTree(child),
    completion,
  };
}
