import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import { cancelAgentRuntimeTask, getAgentRuntimeRun, startAgentRuntimeTask } from "./agent-runtimes";
import type { AgentRuntimeRun } from "../shared/agent-runtimes";
import type {
  CreateTaskCenterTaskInput,
  TaskCenterRun,
  TaskCenterStatus,
  TaskCenterTask,
  TaskCenterWorktree,
} from "../shared/task-center";
import { redactSensitiveText } from "../shared/redaction";

const MAX_TASKS = 200;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TASK_CENTER_STORE_VERSION = 2;
const MAX_RUNS_PER_TASK = 20;

interface TaskCenterStore {
  version: number;
  tasks: TaskCenterTask[];
}

function storePath(): string {
  return join(profileHome(getActiveProfileNameSync()), "desktop", "task-center.json");
}

function worktreesRoot(): string {
  return resolve(profileHome(getActiveProfileNameSync()), "desktop", "worktrees");
}

function runSnapshotFromLegacy(task: TaskCenterTask): TaskCenterRun[] {
  if (Array.isArray(task.runs)) return task.runs.slice(-MAX_RUNS_PER_TASK);
  if (!task.runtimeRunId && task.status === "queued") return [];
  return [{
    id: `legacy-run-${task.runtimeRunId || task.id}`,
    ...(task.runtimeRunId ? { runtimeRunId: task.runtimeRunId } : {}),
    status: task.status,
    startedAt: task.startedAt || task.createdAt,
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.output !== undefined ? { output: task.output } : {}),
    ...(task.error ? { error: task.error } : {}),
    ...(task.worktreePath ? { worktreePath: task.worktreePath } : {}),
    ...(task.diffSummary ? { diffSummary: task.diffSummary } : {}),
    ...(task.inputArtifacts ? { inputArtifacts: task.inputArtifacts } : {}),
    ...(task.artifacts ? { artifacts: task.artifacts } : {}),
  }];
}

function normalizeTask(task: TaskCenterTask): TaskCenterTask {
  return {
    ...task,
    runs: runSnapshotFromLegacy(task),
  };
}

function readStore(): TaskCenterStore {
  try {
    const file = storePath();
    if (!existsSync(file)) return { version: TASK_CENTER_STORE_VERSION, tasks: [] };
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    const tasks = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as TaskCenterStore).tasks)
        ? (parsed as TaskCenterStore).tasks
        : [];
    return {
      version:
        parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
        typeof (parsed as TaskCenterStore).version === "number"
          ? (parsed as TaskCenterStore).version
          : 1,
      tasks: tasks
        .filter((item): item is TaskCenterTask =>
          Boolean(item && typeof item === "object" && typeof (item as TaskCenterTask).id === "string"),
        )
        .map(normalizeTask),
    };
  } catch {
    return { version: TASK_CENTER_STORE_VERSION, tasks: [] };
  }
}

function readTasks(): TaskCenterTask[] {
  return readStore().tasks;
}

function writeTasks(tasks: TaskCenterTask[]): void {
  safeWriteFile(
    storePath(),
    JSON.stringify({
      version: TASK_CENTER_STORE_VERSION,
      tasks: tasks.slice(0, MAX_TASKS).map(normalizeTask),
    } satisfies TaskCenterStore),
  );
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 56 ? normalized : `${normalized.slice(0, 53)}...`;
}

function taskStatus(
  run: AgentRuntimeRun,
  requireReview = false,
): TaskCenterStatus {
  const hasReviewArtifact = run.artifacts?.some(
    (artifact) => artifact.kind === "final" && artifact.label === "Coordinator plan",
  );
  return run.status === "succeeded" && (requireReview || run.worktreePath || hasReviewArtifact)
    ? "review_required"
    : run.status;
}

function sanitizeRun(run: AgentRuntimeRun): AgentRuntimeRun {
  return {
    ...run,
    ...(run.output !== undefined ? { output: redactSensitiveText(run.output) } : {}),
    ...(run.error ? { error: redactSensitiveText(run.error) } : {}),
    ...(run.diffSummary ? { diffSummary: redactSensitiveText(run.diffSummary) } : {}),
    ...(run.artifacts ? {
      artifacts: run.artifacts.map((artifact) => ({
        ...artifact,
        ...(artifact.content ? { content: redactSensitiveText(artifact.content) } : {}),
      })),
    } : {}),
    ...(run.events
      ? {
          events: run.events.map((event) => ({
            ...event,
            summary: redactSensitiveText(event.summary),
          })),
        }
      : {}),
  };
}

function snapshotRun(
  run: AgentRuntimeRun,
  requireReview = false,
): TaskCenterRun {
  const cleanRun = sanitizeRun(run);
  const status = taskStatus(cleanRun, requireReview);
  return {
    id: `task-run-${cleanRun.id}`,
    runtimeRunId: cleanRun.id,
    status,
    startedAt: cleanRun.startedAt,
    ...(cleanRun.completedAt ? { completedAt: cleanRun.completedAt } : {}),
    ...(cleanRun.output !== undefined ? { output: cleanRun.output } : {}),
    ...(cleanRun.error ? { error: cleanRun.error } : {}),
    ...(cleanRun.worktreePath ? { worktreePath: cleanRun.worktreePath } : {}),
    ...(cleanRun.diffSummary ? { diffSummary: cleanRun.diffSummary } : {}),
    ...(cleanRun.inputArtifacts ? { inputArtifacts: cleanRun.inputArtifacts } : {}),
    ...(cleanRun.artifacts ? { artifacts: cleanRun.artifacts } : {}),
    ...(cleanRun.events ? { events: cleanRun.events } : {}),
  };
}

function patchTask(id: string, patch: Partial<TaskCenterTask>): TaskCenterTask | null {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  tasks[index] = { ...tasks[index], ...patch };
  writeTasks(tasks);
  return tasks[index];
}

function recoveryRun(task: TaskCenterTask, message: string, completedAt: number): TaskCenterRun {
  const id = task.runtimeRunId
    ? `task-run-${task.runtimeRunId}`
    : `task-run-recovery-${task.id}`;
  return {
    id,
    ...(task.runtimeRunId ? { runtimeRunId: task.runtimeRunId } : {}),
    status: "failed",
    startedAt: task.startedAt || task.createdAt,
    completedAt,
    ...(task.output !== undefined ? { output: task.output } : {}),
    error: message,
    events: [
      ...(runSnapshotFromLegacy(task)
        .find((run) => run.id === id)?.events || []),
      {
        id: `task-event-recovery-${task.id}-${completedAt}`,
        type: "error",
        summary: message,
        createdAt: completedAt,
      },
    ],
  };
}

function applyRun(task: TaskCenterTask, run: AgentRuntimeRun): TaskCenterTask {
  const cleanRun = sanitizeRun(run);
  const status = taskStatus(cleanRun, task.requireReview);
  const snapshot = snapshotRun(cleanRun, task.requireReview);
  const priorRuns = runSnapshotFromLegacy(task);
  const index = priorRuns.findIndex(
    (item) => item.runtimeRunId === cleanRun.id || item.id === snapshot.id,
  );
  const runs = [...priorRuns];
  if (index >= 0) runs[index] = snapshot;
  else runs.push(snapshot);
  return {
    ...task,
    status,
    ...(cleanRun.completedAt ? { completedAt: cleanRun.completedAt } : {}),
    ...(cleanRun.output !== undefined ? { output: cleanRun.output } : {}),
    ...(cleanRun.error ? { error: cleanRun.error } : {}),
    ...(cleanRun.worktreePath ? { worktreePath: cleanRun.worktreePath } : {}),
    ...(cleanRun.diffSummary ? { diffSummary: cleanRun.diffSummary } : {}),
    ...(cleanRun.inputArtifacts
      ? { inputArtifacts: cleanRun.inputArtifacts }
      : {}),
    ...(cleanRun.artifacts ? { artifacts: cleanRun.artifacts } : {}),
    runs: runs.slice(-MAX_RUNS_PER_TASK),
    ...(status === "review_required" ? { acceptance: "pending" as const } : {}),
  };
}

export async function listTaskCenterTasks(): Promise<TaskCenterTask[]> {
  const tasks = readTasks();
  let changed = false;
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    if (!task.runtimeRunId || task.status !== "running") continue;
    const run = await getAgentRuntimeRun(task.runtimeRunId);
    if (!run) {
      const now = Date.now();
      const message = "The desktop restarted before this task completed. Inspect the runtime output before retrying.";
      tasks[i] = {
        ...task,
        status: "failed",
        completedAt: now,
        error: message,
        recovery: { reason: "desktop_restarted", message, at: now },
        runs: [
          ...runSnapshotFromLegacy(task).filter(
            (run) => run.id !== `task-run-${task.runtimeRunId}`,
          ),
          recoveryRun(task, message, now),
        ].slice(-MAX_RUNS_PER_TASK),
      };
      changed = true;
      continue;
    }
    const next = applyRun(task, run);
    if (JSON.stringify(next) !== JSON.stringify(task)) {
      tasks[i] = next;
      changed = true;
    }
  }
  if (changed) writeTasks(tasks);
  return tasks.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createTaskCenterTask(input: CreateTaskCenterTaskInput): Promise<TaskCenterTask> {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > 100_000) throw new Error("Task prompt must be between 1 and 100000 characters.");
  if (!input.runtimeId?.trim()) throw new Error("A runtime must be selected.");
  if (input.mode !== "analysis" && input.mode !== "implementation") throw new Error("Task mode is invalid.");
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const task: TaskCenterTask = {
    id: `task-${randomUUID()}`,
    title: input.title?.trim() || titleFromPrompt(prompt),
    prompt,
    runtimeId: input.runtimeId.trim(),
    mode: input.mode,
    ...(input.workspace?.trim() ? { workspace: input.workspace.trim() } : {}),
    ...(input.workspaceRef?.trim()
      ? { workspaceRef: input.workspaceRef.trim() }
      : {}),
    ...(input.coordinatorPlan ? { coordinatorPlan: input.coordinatorPlan } : {}),
    ...(input.requireReview ? { requireReview: true } : {}),
    timeoutMs,
    status: "queued",
    createdAt: Date.now(),
    runs: [],
  };
  const tasks = readTasks();
  writeTasks([task, ...tasks]);
  try {
    const run = await startAgentRuntimeTask(task.runtimeId, {
      prompt: task.prompt,
      mode: task.mode,
      workspace: task.workspace,
      workspaceRef: task.workspaceRef,
      attachments: input.attachments,
      timeoutMs: task.timeoutMs,
      coordinatorPlan: input.coordinatorPlan,
    });
    const started: TaskCenterTask = applyRun(
      { ...task, status: "running", startedAt: Date.now(), runtimeRunId: run.id },
      run,
    );
    return patchTask(task.id, started) || started;
  } catch (error) {
    const completedAt = Date.now();
    const message = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    const failed = patchTask(task.id, {
      status: "failed",
      completedAt,
      error: message,
      runs: [{
        id: `task-run-dispatch-${task.id}`,
        status: "failed",
        startedAt: task.createdAt,
        completedAt,
        error: message,
        events: [{
          id: `task-event-dispatch-${task.id}`,
          type: "error",
          summary: message,
          createdAt: completedAt,
        }],
      }],
    });
    return failed || task;
  }
}

/**
 * Start another execution under the same business task. The prior TaskRun is
 * preserved for audit and comparison; staged file inputs must be selected
 * again so a retry never grants stale filesystem access implicitly.
 */
export async function retryTaskCenterTask(id: string): Promise<TaskCenterTask | null> {
  const task = readTasks().find((item) => item.id === id);
  if (!task) return null;
  if (task.status === "running" || task.status === "queued") {
    throw new Error("A running task cannot be retried.");
  }
  if (task.status === "review_required" && task.acceptance !== "rejected") {
    throw new Error("Accept or reject the review before retrying this task.");
  }
  if (task.inputArtifacts?.length) {
    throw new Error("Re-add file inputs before retrying this task.");
  }

  const startedAt = Date.now();
  try {
    const run = await startAgentRuntimeTask(task.runtimeId, {
      prompt: task.prompt,
      mode: task.mode,
      workspace: task.workspace,
      workspaceRef: task.workspaceRef,
      timeoutMs: task.timeoutMs,
      coordinatorPlan: task.coordinatorPlan,
    });
    const restarted = applyRun(
      {
        ...task,
        status: "running",
        startedAt,
        completedAt: undefined,
        runtimeRunId: run.id,
        output: undefined,
        error: undefined,
        diffSummary: undefined,
        artifacts: undefined,
        acceptance: undefined,
        recovery: undefined,
      },
      run,
    );
    return patchTask(task.id, restarted) || restarted;
  } catch (error) {
    const completedAt = Date.now();
    const message = redactSensitiveText(
      error instanceof Error ? error.message : String(error),
    );
    const failure: TaskCenterRun = {
      id: `task-run-retry-${task.id}-${completedAt}`,
      status: "failed",
      startedAt,
      completedAt,
      error: message,
      events: [{
        id: `task-event-retry-${task.id}-${completedAt}`,
        type: "error",
        summary: message,
        createdAt: completedAt,
      }],
    };
    return patchTask(task.id, {
      status: "failed",
      startedAt,
      completedAt,
      error: message,
      runs: [...runSnapshotFromLegacy(task), failure].slice(-MAX_RUNS_PER_TASK),
      recovery: undefined,
    });
  }
}

export async function cancelTaskCenterTask(id: string): Promise<TaskCenterTask | null> {
  const task = readTasks().find((item) => item.id === id);
  if (!task || !task.runtimeRunId || task.status !== "running") return task || null;
  await cancelAgentRuntimeTask(task.runtimeRunId);
  const run = await getAgentRuntimeRun(task.runtimeRunId);
  return run ? patchTask(id, applyRun(task, run)) : patchTask(id, { status: "cancelled", completedAt: Date.now() });
}

export function setTaskCenterAcceptance(id: string, acceptance: "accepted" | "rejected"): TaskCenterTask | null {
  const task = readTasks().find((item) => item.id === id);
  if (!task || task.status !== "review_required") return task || null;
  return patchTask(id, { acceptance });
}

export function resolveManagedWorktreePath(worktree: string): string {
  if (typeof worktree !== "string" || !worktree.trim()) {
    throw new Error("Worktree path is required.");
  }
  const root = worktreesRoot();
  const target = resolve(worktree);
  const outside = relative(root, target);
  if (!outside || outside.startsWith("..") || /^[\\/]/.test(outside)) {
    throw new Error("Task worktree path is outside the managed worktree directory.");
  }
  return target;
}

function worktreeRuntimeKind(path: string): TaskCenterWorktree["runtimeKind"] {
  const relativePath = relative(worktreesRoot(), resolve(path)).replace(/\\/g, "/");
  if (relativePath.startsWith("codex/")) return "codex";
  if (relativePath.startsWith("claude-code/")) return "claude-code";
  if (relativePath.startsWith("pi/")) return "pi";
  return "unknown";
}

export function listTaskCenterWorktrees(): TaskCenterWorktree[] {
  const root = worktreesRoot();
  const tasks = readTasks();
  const refs = new Map<string, TaskCenterTask>();
  for (const task of tasks) {
    if (!task.worktreePath) continue;
    refs.set(resolve(task.worktreePath).toLowerCase(), task);
  }
  if (!existsSync(root)) return [];
  const worktrees: TaskCenterWorktree[] = [];
  for (const runtimeDir of ["codex", "claude-code", "pi"]) {
    const dir = join(root, runtimeDir);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = resolve(dir, entry.name);
      const stats = statSync(path);
      const task = refs.get(path.toLowerCase());
      worktrees.push({
        path,
        runtimeKind: worktreeRuntimeKind(path),
        exists: true,
        updatedAt: stats.mtimeMs,
        ...(task ? {
          taskId: task.id,
          taskTitle: task.title,
          taskStatus: task.status,
        } : {}),
        active: task ? ["queued", "running", "review_required"].includes(task.status) : false,
      });
    }
  }
  return worktrees.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeTaskCenterWorktree(worktree: string): boolean {
  const target = resolveManagedWorktreePath(worktree);
  const tasks = readTasks();
  const activeTask = tasks.find(
    (task) =>
      task.worktreePath &&
      resolve(task.worktreePath).toLowerCase() === target.toLowerCase() &&
      ["queued", "running", "review_required"].includes(task.status),
  );
  if (activeTask) {
    throw new Error("This worktree belongs to an active or review-required task.");
  }
  if (!existsSync(target)) return false;
  rmSync(target, { recursive: true, force: true });
  return true;
}
