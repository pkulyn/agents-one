import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import { cancelAgentRuntimeTask, getAgentRuntimeRun, startAgentRuntimeTask } from "./agent-runtimes";
import type { AgentRuntimeRun } from "../shared/agent-runtimes";
import type { CreateTaskCenterTaskInput, TaskCenterStatus, TaskCenterTask } from "../shared/task-center";

const MAX_TASKS = 200;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function storePath(): string {
  return join(profileHome(getActiveProfileNameSync()), "desktop", "task-center.json");
}

function readTasks(): TaskCenterTask[] {
  try {
    const file = storePath();
    if (!existsSync(file)) return [];
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is TaskCenterTask => Boolean(item && typeof item === "object" && typeof (item as TaskCenterTask).id === "string")) : [];
  } catch {
    return [];
  }
}

function writeTasks(tasks: TaskCenterTask[]): void {
  safeWriteFile(storePath(), JSON.stringify(tasks.slice(0, MAX_TASKS)));
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  return normalized.length <= 56 ? normalized : `${normalized.slice(0, 53)}...`;
}

function taskStatus(run: AgentRuntimeRun): TaskCenterStatus {
  const hasReviewArtifact = run.artifacts?.some(
    (artifact) => artifact.kind === "final" && artifact.label === "Coordinator plan",
  );
  return run.status === "succeeded" && (run.worktreePath || hasReviewArtifact)
    ? "review_required"
    : run.status;
}

function patchTask(id: string, patch: Partial<TaskCenterTask>): TaskCenterTask | null {
  const tasks = readTasks();
  const index = tasks.findIndex((task) => task.id === id);
  if (index < 0) return null;
  tasks[index] = { ...tasks[index], ...patch };
  writeTasks(tasks);
  return tasks[index];
}

function applyRun(task: TaskCenterTask, run: AgentRuntimeRun): TaskCenterTask {
  const status = taskStatus(run);
  return {
    ...task,
    status,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    ...(run.output !== undefined ? { output: run.output } : {}),
    ...(run.error ? { error: run.error } : {}),
    ...(run.worktreePath ? { worktreePath: run.worktreePath } : {}),
    ...(run.diffSummary ? { diffSummary: run.diffSummary } : {}),
    ...(run.artifacts ? { artifacts: run.artifacts } : {}),
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
      tasks[i] = {
        ...task,
        status: "failed",
        completedAt: Date.now(),
        error:
          "The desktop restarted before this task completed. Inspect the runtime output before retrying.",
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
    timeoutMs,
    status: "queued",
    createdAt: Date.now(),
  };
  const tasks = readTasks();
  writeTasks([task, ...tasks]);
  try {
    const run = await startAgentRuntimeTask(task.runtimeId, {
      prompt: task.prompt,
      mode: task.mode,
      workspace: task.workspace,
      timeoutMs: task.timeoutMs,
      coordinatorPlan: input.coordinatorPlan,
    });
    const started: TaskCenterTask = applyRun(
      { ...task, status: "running", startedAt: Date.now(), runtimeRunId: run.id },
      run,
    );
    return patchTask(task.id, started) || started;
  } catch (error) {
    const failed = patchTask(task.id, {
      status: "failed",
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error),
    });
    return failed || task;
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
