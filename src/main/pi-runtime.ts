import {
  spawn,
  execFile as execFileCallback,
  type ChildProcess,
} from "child_process";
import { existsSync, mkdirSync } from "fs";
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
  config: PiRuntimeConfig,
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

function childEnvironment(): NodeJS.ProcessEnv {
  const keys = [
    "APPDATA",
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
  // Pi is intentionally provider-agnostic. Carry common user-level provider
  // variables that a terminal Pi invocation can use, but do not pass the full
  // Electron process environment into a model subprocess.
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value &&
      /^(PI_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|GOOGLE_|GEMINI_|DEEPSEEK_|DASHSCOPE_|ARK_|VOLCENGINE_|NVIDIA_)/.test(
        key,
      )
    ) {
      env[key] = value;
    }
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

/**
 * Pure, regression-tested Pi invocation. Analysis can use a small read-only
 * tool allowlist inside an explicitly selected workspace. It never receives
 * write, edit, or shell access outside an isolated implementation worktree.
 */
export function piExecArgs(
  mode: "analysis" | "implementation" | "full_access",
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
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-context-files",
  ];
  // Analysis may inspect only the selected workspace. Keeping this allowlist
  // explicit avoids the common failure mode where a model emits raw tool-call
  // markup because it was asked to inspect files while all tools were hidden.
  // Historical implementation tasks run in an isolated Git worktree below.
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
    const workspace = requestedWorkspace(config);
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
  if ((mode === "implementation" || mode === "full_access") && !workspace) {
    throw new Error(
      "Pi full-access tasks require a configured project workspace.",
    );
  }

  let cwd = workspace;
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
      ...(cwd ? { cwd } : {}),
      env: childEnvironment(),
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
    child.once("error", (error) =>
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
      }),
    );
    child.once("close", async (code) => {
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
      resolveResult({
        output,
        ...(code === 0
          ? {}
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
