import {
  spawn,
  execFile as execFileCallback,
  type ChildProcess,
} from "child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync } from "fs";
import { promisify } from "util";
import { delimiter, dirname, extname, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { profileHome } from "./utils";
import { prepareRuntimeInputs } from "./runtime-inputs";
import type {
  AgentRuntimeArtifact,
  AgentRuntimeTaskInput,
  RuntimeInputArtifact,
} from "../shared/agent-runtimes";

const execFile = promisify(execFileCallback);
const MAX_OUTPUT = 512 * 1024;
const SECRET_VALUE =
  /((?:authorization|api[_-]?key|token|secret|password)\s*[:=]\s*)([^\s,;]+)/gi;

export interface ClaudeCodeRuntimeConfig {
  executablePath?: string;
  model?: string;
  workspace?: string;
  timeoutMs?: number;
}

export interface ClaudeCodeProbeResult {
  healthy: boolean;
  message?: string;
  workspaceAccess: boolean;
}

export interface ClaudeCodeProcessResult {
  output: string;
  error?: string;
  sessionId: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts: AgentRuntimeArtifact[];
  inputArtifacts: RuntimeInputArtifact[];
}

export interface StartedClaudeCodeProcess {
  worktreePath?: string;
  inputArtifacts: RuntimeInputArtifact[];
  sessionId: string;
  cancel: () => void;
  completion: Promise<ClaudeCodeProcessResult>;
}

interface ClaudeInvocation {
  command: string;
  prefix: string[];
}

interface WorkspaceSnapshot {
  entries: Map<string, string>;
  truncated: boolean;
}

const WORKSPACE_SNAPSHOT_LIMIT = 2_000;
const WORKSPACE_SNAPSHOT_IGNORED = new Set([
  ".git",
  ".agents-one",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
]);

/**
 * Full-access tasks edit the selected workspace directly, so there is no
 * worktree diff to inspect. Keep a bounded manifest to publish only actual
 * filesystem changes, never a model's textual claim of having changed files.
 */
function workspaceSnapshot(root: string): WorkspaceSnapshot {
  const entries = new Map<string, string>();
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
      if (WORKSPACE_SNAPSHOT_IGNORED.has(child)) continue;
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
      entries.set(relative(root, fullPath), `${stat.size}:${Math.floor(stat.mtimeMs)}`);
      if (entries.size >= WORKSPACE_SNAPSHOT_LIMIT) {
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
  const changed: string[] = [];
  for (const [path, signature] of after.entries) {
    if (before.entries.get(path) !== signature) changed.push(path);
  }
  return changed.sort().slice(0, 200);
}

function configuredExecutable(config: ClaudeCodeRuntimeConfig): string {
  const configured = config.executablePath?.trim();
  if (configured) return configured;
  if (process.platform !== "win32") return "claude";

  const path = process.env.PATH || process.env.Path || "";
  for (const directory of path.split(delimiter)) {
    const candidate = join(directory, "claude.cmd");
    if (existsSync(candidate)) return candidate;
  }
  return "claude";
}

/**
 * The user-level Claude installer exposes claude.cmd/claude.ps1 shims. Main
 * process child_process APIs cannot safely launch those scripts with shell:false,
 * so Windows uses the installed native executable directly.
 */
export function claudeCodeInvocation(
  executablePath: string,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): ClaudeInvocation {
  if (platform !== "win32") return { command: executablePath, prefix: [] };
  const extension = extname(executablePath).toLowerCase();
  if (extension !== ".cmd" && extension !== ".ps1") {
    return { command: executablePath, prefix: [] };
  }
  const entry = join(
    dirname(executablePath),
    "node_modules",
    "@anthropic-ai",
    "claude-code",
    "bin",
    "claude.exe",
  );
  if (!fileExists(entry)) {
    throw new Error(
      "The Claude Code script wrapper is incomplete. Select claude.exe or reinstall the user-level Claude Code CLI.",
    );
  }
  return { command: entry, prefix: [] };
}

function redact(value: string): string {
  return value.replace(SECRET_VALUE, "$1[redacted]");
}

function appendCapped(current: string, next: string): string {
  const merged = `${current}${redact(next)}`;
  return merged.length <= MAX_OUTPUT ? merged : merged.slice(-MAX_OUTPUT);
}

/** Drop Claude session bootstrap metadata before it reaches persisted task logs. */
export function filterClaudeCodeStreamLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return line;
  try {
    const event = JSON.parse(trimmed) as {
      type?: unknown;
      message?: { content?: Array<{ type?: unknown }> };
    };
    if (
      event.type === "assistant" ||
      event.type === "result" ||
      event.type === "tool" ||
      event.type === "error"
    ) {
      return line;
    }
    if (
      event.type === "user" &&
      event.message?.content?.some((item) => item?.type === "tool_result")
    ) {
      return line;
    }
    return "";
  } catch {
    return line;
  }
}

function createClaudeOutputFilter(): (
  chunk: string,
  flush?: boolean,
) => string {
  let pending = "";
  return (chunk: string, flush = false): string => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = flush ? "" : lines.pop() || "";
    const visible = lines.map(filterClaudeCodeStreamLine).filter(Boolean);
    return visible.length ? `${visible.join("\n")}\n` : "";
  };
}

export function claudeCodeLoggedIn(authStatusOutput: string): boolean {
  try {
    const parsed = JSON.parse(authStatusOutput) as { loggedIn?: unknown };
    return parsed.loggedIn === true;
  } catch {
    return (
      /\blogged\s*in\b/i.test(authStatusOutput) &&
      !/\bnot\s+logged\s*in\b/i.test(authStatusOutput)
    );
  }
}

async function command(
  invocation: ClaudeInvocation,
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
  config: ClaudeCodeRuntimeConfig,
  input?: AgentRuntimeTaskInput,
): string | undefined {
  const raw = input?.workspace?.trim() || config.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace))
    throw new Error("The selected workspace does not exist.");
  return workspace;
}

function safeWorktreePath(profile: string | undefined, id: string): string {
  const root = resolve(
    profileHome(profile),
    "desktop",
    "worktrees",
    "claude-code",
  );
  const target = resolve(root, id);
  if (relative(root, target).startsWith(".."))
    throw new Error("Invalid worktree path.");
  mkdirSync(root, { recursive: true });
  return target;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const keys = [
    "APPDATA",
    "CLAUDE_CONFIG_DIR",
    "COMSPEC",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "WINDIR",
  ];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) if (process.env[key]) env[key] = process.env[key];
  // Claude Code can use either its persisted login or a user-level provider
  // credential. Forward only its own provider variables, never all desktop env.
  for (const [key, value] of Object.entries(process.env)) {
    if (value && /^(ANTHROPIC_|CLAUDE_)/.test(key)) env[key] = value;
  }
  return env;
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

/** This argument contract is intentionally kept pure and regression-tested. */
export function claudeCodeExecArgs(
  mode: "analysis" | "implementation" | "full_access",
  prompt: string,
  inputDirectory?: string,
  options: { sessionId: string; resume?: boolean; model?: string } = {
    sessionId: randomUUID(),
  },
): string[] {
  const args = [
    "--print",
    "--verbose",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--permission-mode",
    mode === "analysis" ? "plan" : "acceptEdits",
  ];
  if (options.model?.trim()) args.push("--model", options.model.trim());
  if (options.resume) args.push("--resume", options.sessionId);
  else args.push("--session-id", options.sessionId);
  // `--add-dir` accepts a variadic list. Without the option terminator Claude
  // treats the prompt as another directory and exits with "Input must be
  // provided". Keep the no-attachment contract unchanged.
  if (inputDirectory) args.push("--add-dir", inputDirectory, "--");
  args.push(prompt);
  return args;
}

function validClaudeSessionId(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    ),
  );
}

export async function probeClaudeCodeRuntime(
  config: ClaudeCodeRuntimeConfig,
): Promise<ClaudeCodeProbeResult> {
  try {
    const invocation = claudeCodeInvocation(configuredExecutable(config));
    const version = await command(invocation, ["--version"]);
    const authStatus = await command(invocation, ["auth", "status"]);
    if (!claudeCodeLoggedIn(authStatus)) {
      throw new Error("Claude Code is not logged in. Run `claude auth login`.");
    }
    const workspace = requestedWorkspace(config);
    if (workspace) await gitRoot(workspace);
    return {
      healthy: true,
      workspaceAccess: Boolean(workspace),
      message: version || "Claude Code CLI is available and authenticated.",
    };
  } catch (error) {
    return {
      healthy: false,
      workspaceAccess: false,
      message:
        error instanceof Error
          ? redact(error.message)
          : "Claude Code CLI is unavailable.",
    };
  }
}

export async function startClaudeCodeProcess(
  config: ClaudeCodeRuntimeConfig,
  input: AgentRuntimeTaskInput,
  onOutput: (chunk: string) => void,
): Promise<StartedClaudeCodeProcess> {
  const mode = input.mode || "analysis";
  const invocation = claudeCodeInvocation(configuredExecutable(config));
  const workspace = requestedWorkspace(config, input);
  if (!workspace)
    throw new Error("Claude Code tasks require a configured workspace.");

  let cwd = workspace;
  let worktreePath: string | undefined;
  if (mode === "implementation") {
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
  const fullAccessSnapshot = mode === "full_access" ? workspaceSnapshot(cwd) : undefined;

  const preparedInputs = prepareRuntimeInputs(
    input.profile,
    input.attachments,
    `claude-code-${randomUUID()}`,
  );
  const runtimePrompt = `${input.prompt}${preparedInputs.promptContext}`;
  const requestedSessionId = input.sessionId?.trim();
  const sessionId = validClaudeSessionId(requestedSessionId)
    ? requestedSessionId
    : randomUUID();
  const resume = validClaudeSessionId(requestedSessionId);

  const child = spawn(
    invocation.command,
    [
      ...invocation.prefix,
      ...claudeCodeExecArgs(mode, runtimePrompt, preparedInputs.directory, {
        sessionId,
        resume,
        model: config.model,
      }),
    ],
    {
      cwd,
      env: childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const filterStdout = createClaudeOutputFilter();
  const recordOutput = (chunk: string): void => {
    if (!chunk) return;
    const redacted = redact(chunk);
    output = appendCapped(output, redacted);
    onOutput(redacted);
  };
  child.stdout?.on("data", (data: Buffer) => {
    recordOutput(filterStdout(data.toString()));
  });
  child.stderr?.on("data", (data: Buffer) => {
    recordOutput(data.toString());
  });

  const completion = new Promise<ClaudeCodeProcessResult>((resolveResult) => {
    child.once("error", (error) =>
      resolveResult({
        output,
        error: redact(error.message),
        sessionId,
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
      }),
    );
    child.once("close", async (code) => {
      recordOutput(filterStdout("", true));
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
          // Preserve runtime output even when the diff inspection fails.
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
      if (fullAccessSnapshot) {
        const changedFiles = changedWorkspaceFiles(fullAccessSnapshot, workspaceSnapshot(cwd));
        if (changedFiles.length) {
          artifacts.push({
            kind: "diff",
            label: "Claude Code 已写入文件",
            content: changedFiles.join("\n"),
          });
          diffSummary = [
            diffSummary,
            `Claude Code 直接修改了 ${changedFiles.length} 个文件：${changedFiles.join(", ")}`,
          ].filter(Boolean).join("\n");
        }
      }
      resolveResult({
        output,
        sessionId,
        ...(code === 0
          ? {}
          : { error: `Claude Code exited with code ${code ?? "unknown"}.` }),
        ...(worktreePath ? { worktreePath } : {}),
        ...(diffSummary ? { diffSummary } : {}),
        artifacts,
        inputArtifacts: preparedInputs.artifacts,
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
