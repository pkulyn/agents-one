import { runtimeRemovalBlockedMessage } from "../shared/runtime-permissions";
import { spawn, execFile as execFileCallback } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { promisify } from "util";
import { StringDecoder } from "node:string_decoder";
import { dirname, extname, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { agentsOneProfileHome } from "./utils";
import { prepareRuntimeInputs } from "./runtime-inputs";
import { protectWorkspaceFromRemoval } from "./workspace-protection";
import { terminateProcessTree } from "./process-control";
import {
  prepareCodexMobileContext,
  type CodexMobileContext,
} from "./mobile-control/codex-mobile-context";
import { createCodexProjectWriteRunner } from "./mobile-control/codex-project-write-context";
import { readCodexMobileConfiguration } from "./mobile-control/codex-effective-config";
import {
  captureCodexInspectionIdentity,
  assertReviewedCodexInspectionNative,
  assertCodexInspectionIdentity,
} from "./mobile-control/codex-invocation-identity";
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
  /** Persisted Codex thread id reported by `exec --json`, when available. */
  sessionId?: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts: AgentRuntimeArtifact[];
  inputArtifacts: RuntimeInputArtifact[];
}

export interface StartedCodexProcess {
  worktreePath?: string;
  inputArtifacts: RuntimeInputArtifact[];
  /** Resolves only after the child has closed and its cleanup has completed. */
  cancel: () => Promise<void>;
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

/** Tolerate both current and older JSONL event spellings without parsing prose. */
export function codexThreadIdFromOutput(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    try {
      const event: unknown = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event)) continue;
      const record = event as Record<string, unknown>;
      const direct = record.thread_id ?? record.threadId;
      if (typeof direct === "string" && direct.trim()) return direct.trim();
      const thread = record.thread;
      if (thread && typeof thread === "object" && !Array.isArray(thread)) {
        const id = (thread as Record<string, unknown>).id;
        if (typeof id === "string" && id.trim()) return id.trim();
      }
    } catch {
      // stderr and partial JSON are deliberately ignored.
    }
  }
  return undefined;
}

/** Capture provider identity before the bounded output tail drops its first event. */
class CodexThreadTracker {
  id?: string;
  private pending = "";
  private discardLine = false;
  push(chunk: string): void {
    if (this.id) return;
    const lines = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = lines.pop() || "";
    for (const line of lines) {
      if (this.discardLine) {
        this.discardLine = false;
        continue;
      }
      // A thread identity event is small. Never retain an unbounded tool/body line.
      if (line.length <= 16_384) this.id = codexThreadIdFromOutput(line);
      if (this.id) {
        this.pending = "";
        return;
      }
    }
    if (this.pending.length > 16_384) {
      this.pending = "";
      this.discardLine = true;
    }
  }
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

function configuredProbeWorkspace(
  config: CodexRuntimeConfig,
): string | undefined {
  const raw = config.workspace?.trim();
  if (!raw) return undefined;
  const workspace = resolve(raw);
  if (!existsSync(workspace))
    throw new Error("The configured workspace does not exist.");
  return workspace;
}

function conversationCwd(profile?: string): string {
  const root = join(
    agentsOneProfileHome(profile),
    "desktop",
    "runtime-chat",
    "codex",
  );
  mkdirSync(root, { recursive: true });
  return root;
}

function worktreeRoot(profile?: string): string {
  return join(agentsOneProfileHome(profile), "desktop", "worktrees", "codex");
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

/** This argument contract is intentionally kept pure and regression-tested. */
export function codexExecArgs(
  cwd: string,
  mode: "analysis" | "safe_write" | "implementation" | "full_access",
  prompt: string,
  inputDirectory?: string,
  imagePaths: string[] = [],
  model?: string,
  skipGitRepoCheck = false,
  sessionId?: string,
): string[] {
  const args = ["exec", "--json"];
  if (skipGitRepoCheck) args.push("--skip-git-repo-check");
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
  const continuation = sessionId?.trim();
  if (continuation) {
    if (model?.trim()) args.push("--model", model.trim());
    // --sandbox/--cd/--add-dir belong to exec, while resumed images belong to
    // resume. Never select --last: this turn must advance its original thread.
    args.push("resume", "--json");
    for (const image of imagePaths) args.push("--image", image);
    args.push("--", continuation, prompt);
  } else {
    for (const image of imagePaths) args.push("--image", image);
    if (model?.trim()) args.push("--model", model.trim());
    args.push("--", prompt);
  }
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
  options?: {
    mobileInspection?: true;
    projectInspectionGuard?: () => void;
    configurationGuard?: (configurationHash: string) => void;
    projectWrite?: {
      runId: string;
      workerPath: string;
      workerSha256?: string;
      assertWritesAllowed(): void;
    };
  },
): Promise<StartedCodexProcess> {
  const mode = input.mode || "analysis";
  const mobileWrite = options?.projectWrite;
  const mobileExecution = Boolean(options?.mobileInspection || mobileWrite);
  if (
    mobileWrite &&
    (options?.mobileInspection ||
      mode !== "safe_write" ||
      !options.projectInspectionGuard ||
      !options.configurationGuard)
  )
    throw Error("Mobile project write requires fixed Run and Main authority.");
  if (options?.mobileInspection && mode !== "analysis")
    throw new Error("Mobile inspection requires analysis mode.");
  if (options?.configurationGuard && !mobileExecution)
    throw new Error("Configuration authority requires mobile inspection.");
  const assertConfiguration = (configurationHash: string): void => {
    if (!options?.configurationGuard) return;
    try {
      const result: unknown = options.configurationGuard(configurationHash);
      if (result instanceof Promise) void result.catch(() => undefined);
      if (result !== undefined) throw Error();
    } catch {
      throw new Error(
        "Mobile Codex approved configuration is unavailable or changed.",
      );
    }
  };
  let invocation = codexInvocation(executable(config));
  const workspace = requestedWorkspace(config, input);
  if (mobileWrite && !workspace)
    throw Error("Mobile project write requires a fixed project.");
  if ((mode === "implementation" || mode === "full_access") && !workspace) {
    throw new Error("Codex file tasks require a task-specific project folder.");
  }

  let cwd = workspace || conversationCwd(input.profile);
  const environment = mobileExecution ? childEnvironment() : undefined;
  const identity = mobileExecution
    ? captureCodexInspectionIdentity(executable(config), cwd, environment!)
    : undefined;
  if (identity) {
    assertReviewedCodexInspectionNative(identity);
    invocation = codexInvocation(identity.nativePath);
  }
  const mobileConfiguration = mobileExecution
    ? await readCodexMobileConfiguration(
        { ...config, executablePath: identity!.nativePath },
        cwd,
        environment!,
      )
    : undefined;
  if (mobileConfiguration)
    assertConfiguration(mobileConfiguration.configurationHash);
  if (identity)
    assertCodexInspectionIdentity(
      identity,
      executable(config),
      cwd,
      childEnvironment(),
    );
  const projectWriter = mobileWrite
    ? createCodexProjectWriteRunner({
        profile: input.profile,
        runId: mobileWrite.runId,
        projectId: input.workspaceId,
        workspace: workspace!,
        executablePath: executable(config),
        workerPath: mobileWrite.workerPath,
        workerSha256: mobileWrite.workerSha256,
        assertWritesAllowed: mobileWrite.assertWritesAllowed,
        authorize: () => {
          mobileWrite.assertWritesAllowed();
          if (!mobileContext)
            throw Error("Mobile project write context is unavailable.");
          mobileContext.assertCurrent();
          assertConfiguration(mobileConfiguration!.configurationHash);
          assertCodexInspectionIdentity(
            identity!,
            executable(config),
            cwd,
            childEnvironment(),
          );
        },
      })
    : undefined;
  const mobileContext: CodexMobileContext | undefined = mobileExecution
    ? await prepareCodexMobileContext({
        model: mobileConfiguration!.model,
        profile: input.profile,
        environment: environment!,
        ...(projectWriter ? { projectWriter } : {}),
        ...(workspace ? { workspace } : {}),
        ...(options?.projectInspectionGuard
          ? { projectGuard: options.projectInspectionGuard }
          : {}),
      })
    : undefined;
  let worktreePath: string | undefined;
  if (mode === "implementation") {
    const root = await gitRoot(workspace as string);
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

  try {
    const preparedInputs = prepareRuntimeInputs(
      input.profile,
      input.attachments,
      `codex-${randomUUID()}`,
    );
    const runtimePrompt = `${input.prompt}${preparedInputs.promptContext}`;
    const workspaceProtection =
      mode === "safe_write" && workspace && !mobileWrite
        ? protectWorkspaceFromRemoval(workspace, input.profile)
        : undefined;

    const args = codexExecArgs(
      cwd,
      mobileWrite ? "analysis" : mode,
      runtimePrompt,
      preparedInputs.directory,
      preparedInputs.imagePaths,
      mobileConfiguration?.model ?? config.model,
      !workspace,
      input.sessionId,
    );
    if (mobileExecution)
      args.splice(1, 0, ...mobileContext!.args, ...mobileConfiguration!.args);
    mobileContext?.assertCurrent();
    if (mobileConfiguration)
      assertConfiguration(mobileConfiguration.configurationHash);
    if (identity)
      assertCodexInspectionIdentity(
        identity,
        executable(config),
        cwd,
        childEnvironment(),
      );
    const child = spawn(invocation.command, [...invocation.prefix, ...args], {
      cwd,
      env: mobileContext?.environment ?? environment ?? childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    // @lat: [[mobile-data#Mobile data#Codex long output session identity]]
    const thread = new CodexThreadTracker();
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = redact(stdoutDecoder.write(data));
      thread.push(chunk);
      output = appendCapped(output, chunk);
      onOutput(chunk);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const chunk = redact(stderrDecoder.write(data));
      output = appendCapped(output, chunk);
      onOutput(chunk);
    });

    const completion = new Promise<CodexProcessResult>((resolveResult) => {
      child.once("error", async (error) => {
        await mobileContext?.dispose();
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
            : (projectWriter?.artifacts() ?? []),
          inputArtifacts: preparedInputs.artifacts,
        });
      });
      child.once("close", async (code) => {
        await mobileContext?.dispose();
        const stdoutTail = redact(stdoutDecoder.end());
        const stderrTail = redact(stderrDecoder.end());
        for (const tail of [stdoutTail, stderrTail]) {
          if (!tail) continue;
          output = appendCapped(output, tail);
          onOutput(tail);
        }
        thread.push(stdoutTail + "\n");
        const requestedSessionId = input.sessionId?.trim();
        const mismatchedSession = Boolean(
          requestedSessionId && thread.id && thread.id !== requestedSessionId,
        );
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
        const artifacts: AgentRuntimeArtifact[] =
          projectWriter?.artifacts() ?? [];
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
          ...(!mismatchedSession && (thread.id || requestedSessionId)
            ? { sessionId: thread.id || requestedSessionId }
            : {}),
          ...(mismatchedSession
            ? {
                error:
                  "Codex reported a different resumed session; verify it on the desktop before continuing.",
              }
            : code === 0
              ? {}
              : { error: `Codex exited with code ${code ?? "unknown"}.` }),
          ...(worktreePath ? { worktreePath } : {}),
          ...(diffSummary ? { diffSummary } : {}),
          artifacts,
          ...(restoredFiles.length
            ? { error: runtimeRemovalBlockedMessage(restoredFiles) }
            : {}),
          inputArtifacts: preparedInputs.artifacts,
        });
      });
    });

    return {
      worktreePath,
      inputArtifacts: preparedInputs.artifacts,
      cancel: async () => {
        await terminateProcessTree(child);
        await completion;
      },
      completion,
    };
  } catch (error) {
    await mobileContext?.dispose();
    throw error;
  }
}
