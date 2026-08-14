import {
  spawn,
  execFile as execFileCallback,
  type ChildProcess,
} from "child_process";
import { existsSync, mkdirSync } from "fs";
import { promisify } from "util";
import { dirname, extname, join, relative, resolve } from "path";
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

export interface CodexRuntimeConfig {
  executablePath?: string;
  model?: string;
  workspace?: string;
  timeoutMs?: number;
}

export interface CodexProbeResult {
  healthy: boolean;
  message?: string;
  workspaceAccess: boolean;
}

export interface CodexProcessResult {
  output: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts: AgentRuntimeArtifact[];
  inputArtifacts: RuntimeInputArtifact[];
}

export interface StartedCodexProcess {
  worktreePath?: string;
  inputArtifacts: RuntimeInputArtifact[];
  cancel: () => void;
  completion: Promise<CodexProcessResult>;
}

function executable(config: CodexRuntimeConfig): string {
  return config.executablePath?.trim() || "codex";
}

interface CodexInvocation {
  command: string;
  prefix: string[];
}

/**
 * npm creates a Windows .cmd shim for global binaries. Node's spawn() cannot
 * launch that batch file with shell:false (it raises EINVAL), so resolve the
 * known Codex shim to node.exe + its JavaScript entry point instead. This keeps
 * command execution argument-based and never enables a shell.
 */
export function codexInvocation(
  executablePath: string,
  platform = process.platform,
  fileExists: (path: string) => boolean = existsSync,
): CodexInvocation {
  if (
    platform !== "win32" ||
    extname(executablePath).toLowerCase() !== ".cmd"
  ) {
    return { command: executablePath, prefix: [] };
  }
  const binDir = dirname(executablePath);
  const node = join(binDir, "node.exe");
  const entry = join(
    binDir,
    "node_modules",
    "@openai",
    "codex",
    "bin",
    "codex.js",
  );
  if (!fileExists(node) || !fileExists(entry)) {
    throw new Error(
      "The Codex .cmd wrapper is incomplete. Select codex.exe or reinstall the user-level Codex CLI.",
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
  invocation: CodexInvocation,
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
  _config: CodexRuntimeConfig,
  input?: AgentRuntimeTaskInput,
): string | undefined {
  const raw = input?.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace))
    throw new Error("The selected workspace does not exist.");
  return workspace;
}

function configuredProbeWorkspace(config: CodexRuntimeConfig): string | undefined {
  const raw = config.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace)) throw new Error("The configured workspace does not exist.");
  return workspace;
}

function conversationCwd(profile?: string): string {
  const root = join(profileHome(profile), "desktop", "runtime-chat", "codex");
  mkdirSync(root, { recursive: true });
  return root;
}

function worktreeRoot(profile?: string): string {
  return join(profileHome(profile), "desktop", "worktrees", "codex");
}

function safeWorktreePath(profile: string | undefined, id: string): string {
  const root = resolve(worktreeRoot(profile));
  const target = resolve(root, id);
  if (relative(root, target).startsWith(".."))
    throw new Error("Invalid worktree path.");
  mkdirSync(root, { recursive: true });
  return target;
}

function childEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env };
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
export function codexExecArgs(
  cwd: string,
  mode: "analysis" | "safe_write" | "implementation" | "full_access",
  prompt: string,
  inputDirectory?: string,
  imagePaths: string[] = [],
  model?: string,
): string[] {
  const args = [
    "exec",
    "--json",
  ];
  if (mode === "full_access") {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push(
      "--sandbox",
      mode === "analysis" ? "read-only" : "workspace-write",
    );
  }
  args.push("--cd", cwd);
  if (inputDirectory) args.push("--add-dir", inputDirectory);
  for (const image of imagePaths) args.push("--image", image);
  if (model?.trim()) args.push("--model", model.trim());
  args.push(prompt);
  return args;
}

export async function probeCodexRuntime(
  config: CodexRuntimeConfig,
): Promise<CodexProbeResult> {
  try {
    const version = await command(codexInvocation(executable(config)), [
      "exec",
      "--version",
    ]);
    const workspace = configuredProbeWorkspace(config);
    if (workspace) await gitRoot(workspace);
    return {
      healthy: true,
      workspaceAccess: Boolean(workspace),
      message: version || "Codex CLI is available.",
    };
  } catch (error) {
    return {
      healthy: false,
      workspaceAccess: false,
      message:
        error instanceof Error
          ? redact(error.message)
          : "Codex CLI is unavailable.",
    };
  }
}

export async function startCodexProcess(
  config: CodexRuntimeConfig,
  input: AgentRuntimeTaskInput,
  onOutput: (chunk: string) => void,
): Promise<StartedCodexProcess> {
  const mode = input.mode || "analysis";
  const invocation = codexInvocation(executable(config));
  const workspace = requestedWorkspace(config, input);
  if ((mode === "implementation" || mode === "full_access") && !workspace) {
    throw new Error("Codex file tasks require a task-specific project folder.");
  }

  let cwd = workspace || conversationCwd(input.profile);
  let worktreePath: string | undefined;
  if (mode === "implementation") {
    const root = await gitRoot(workspace as string);
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
    `codex-${randomUUID()}`,
  );
  const runtimePrompt = `${input.prompt}${preparedInputs.promptContext}`;
  const workspaceProtection =
    mode === "safe_write" && workspace
      ? protectWorkspaceFromRemoval(workspace, input.profile)
      : undefined;

  const args = codexExecArgs(
    cwd,
    mode,
    runtimePrompt,
    preparedInputs.directory,
    preparedInputs.imagePaths,
    config.model,
  );
  const child = spawn(invocation.command, [...invocation.prefix, ...args], {
    cwd,
    env: childEnvironment(),
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (data: Buffer) => {
    const chunk = redact(data.toString());
    output = appendCapped(output, chunk);
    onOutput(chunk);
  });
  child.stderr?.on("data", (data: Buffer) => {
    const chunk = redact(data.toString());
    output = appendCapped(output, chunk);
    onOutput(chunk);
  });

  const completion = new Promise<CodexProcessResult>((resolveResult) => {
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
          // Preserve the Codex output even when the diff inspection fails.
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
      resolveResult({
        output: restoredFiles.length
          ? `${output}\n[Agents One] 已阻止移动或删除 ${restoredFiles.length} 个原有文件。`
          : output,
        ...(code === 0
          ? {}
          : { error: `Codex exited with code ${code ?? "unknown"}.` }),
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
    cancel: () => terminateTree(child),
    completion,
  };
}
