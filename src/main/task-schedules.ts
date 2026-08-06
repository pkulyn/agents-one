import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  CreateTaskScheduleInput,
  TaskSchedule,
  TaskScheduleConcurrencyPolicy,
  TaskScheduleRun,
  TaskScheduleTriggerResult,
} from "../shared/task-schedules";
import type { TaskCenterStatus, TaskCenterTask } from "../shared/task-center";
import { listAgentRuntimes } from "./agent-runtimes";
import {
  cancelTaskCenterTask,
  createTaskCenterTask,
  listTaskCenterTasks,
} from "./task-center";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

const STORE_VERSION = 1;
const MAX_SCHEDULES = 200;
const MAX_SCHEDULE_RUNS = 100;
const MAX_PENDING_RUNS = 20;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const RUNNER_INTERVAL_MS = 30_000;
let runner: NodeJS.Timeout | null = null;
let ticking = false;

interface Store {
  version: number;
  schedules: TaskSchedule[];
}

function storePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "desktop", "task-schedules.json");
}

function cleanText(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
}

function policy(value: unknown): TaskScheduleConcurrencyPolicy {
  return value === "queue" || value === "replace" ? value : "skip";
}

function validSchedule(value: string): boolean {
  return /^\d+[mh]$/i.test(value) || value.trim().split(/\s+/).length === 5;
}

function normalizeSchedule(value: unknown): TaskSchedule | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TaskSchedule>;
  const id = cleanText(item.id, 120);
  const name = cleanText(item.name, 160);
  const schedule = cleanText(item.schedule, 128);
  const prompt = cleanText(item.prompt, 50_000);
  const runtimeId = cleanText(item.runtimeId, 64);
  if (!id || !name || !schedule || !prompt || !runtimeId || !validSchedule(schedule)) return null;
  const mode = item.mode === "implementation" ? "implementation" : "analysis";
  const timeoutMs = typeof item.timeoutMs === "number" && item.timeoutMs >= 1_000
    ? Math.min(item.timeoutMs, 24 * 60 * 60_000)
    : DEFAULT_TIMEOUT_MS;
  const runs = Array.isArray(item.runs)
    ? item.runs.filter((run): run is TaskScheduleRun => Boolean(run && typeof run === "object" && run.id))
      .slice(-MAX_SCHEDULE_RUNS)
    : [];
  const now = Date.now();
  return {
    id,
    name,
    schedule,
    prompt,
    runtimeId,
    mode,
    ...(cleanText(item.workspace, 4096) ? { workspace: cleanText(item.workspace, 4096) } : {}),
    timeoutMs,
    enabled: item.enabled !== false,
    concurrencyPolicy: policy(item.concurrencyPolicy),
    pendingRuns: typeof item.pendingRuns === "number" ? Math.max(0, Math.min(MAX_PENDING_RUNS, Math.floor(item.pendingRuns))) : 0,
    ...(typeof item.lastDueAt === "number" ? { lastDueAt: item.lastDueAt } : {}),
    ...(typeof item.nextRunAt === "number" ? { nextRunAt: item.nextRunAt } : {}),
    ...(cleanText(item.activeTaskCenterTaskId, 120) ? { activeTaskCenterTaskId: cleanText(item.activeTaskCenterTaskId, 120) } : {}),
    runs,
    createdAt: typeof item.createdAt === "number" ? item.createdAt : now,
    updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : now,
  };
}

function readStore(profile?: string): Store {
  try {
    const path = storePath(profile);
    if (!existsSync(path)) return { version: STORE_VERSION, schedules: [] };
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Store>;
    return {
      version: STORE_VERSION,
      schedules: Array.isArray(raw.schedules)
        ? raw.schedules.map(normalizeSchedule).filter((item): item is TaskSchedule => Boolean(item)).slice(0, MAX_SCHEDULES)
        : [],
    };
  } catch {
    return { version: STORE_VERSION, schedules: [] };
  }
}

function writeStore(store: Store, profile?: string): void {
  safeWriteFile(storePath(profile), JSON.stringify({
    version: STORE_VERSION,
    schedules: store.schedules.slice(0, MAX_SCHEDULES),
  }));
}

function taskIsTerminal(status: TaskCenterStatus): boolean {
  return ["succeeded", "failed", "cancelled", "timed_out", "review_required"].includes(status);
}

function scheduleRunStatus(task: TaskCenterTask): TaskScheduleRun["status"] {
  return task.status === "review_required" ? "succeeded" : task.status;
}

function appendRun(schedule: TaskSchedule, run: TaskScheduleRun): void {
  schedule.runs = [...schedule.runs, run].slice(-MAX_SCHEDULE_RUNS);
}

function intervalMs(schedule: string): number | null {
  const match = /^(\d+)([mh])$/i.exec(schedule.trim());
  if (!match) return null;
  const multiplier = match[2].toLowerCase() === "h" ? 60 * 60_000 : 60_000;
  return Math.max(1, Number(match[1])) * multiplier;
}

function cronPartMatches(part: string, value: number): boolean {
  if (part === "*") return true;
  const step = /^\*\/(\d+)$/.exec(part);
  if (step) return value % Number(step[1]) === 0;
  return part.split(",").some((candidate) => Number(candidate) === value);
}

function cronMatches(schedule: string, now: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return cronPartMatches(parts[0], now.getMinutes()) &&
    cronPartMatches(parts[1], now.getHours()) &&
    cronPartMatches(parts[2], now.getDate()) &&
    cronPartMatches(parts[3], now.getMonth() + 1) &&
    cronPartMatches(parts[4], now.getDay());
}

function isDue(schedule: TaskSchedule, now: number): boolean {
  const interval = intervalMs(schedule.schedule);
  if (interval) return !schedule.lastDueAt || now - schedule.lastDueAt >= interval;
  const minute = Math.floor(now / 60_000) * 60_000;
  return schedule.lastDueAt !== minute && cronMatches(schedule.schedule, new Date(now));
}

function nextRunAt(schedule: TaskSchedule, now: number): number | undefined {
  const interval = intervalMs(schedule.schedule);
  if (interval) return (schedule.lastDueAt || now) + interval;
  for (let offset = 1; offset <= 525_600; offset += 1) {
    const candidate = Math.floor(now / 60_000) * 60_000 + offset * 60_000;
    if (cronMatches(schedule.schedule, new Date(candidate))) return candidate;
  }
  return undefined;
}

function requireRuntime(input: CreateTaskScheduleInput): void {
  const runtime = listAgentRuntimes().find((item) => item.id === input.runtimeId && item.enabled);
  if (!runtime) throw new Error("Selected Runtime is unavailable.");
  if (input.mode === "implementation" && runtime.kind !== "codex" && runtime.kind !== "claude-code" && runtime.kind !== "pi") {
    throw new Error("Implementation schedules require Codex, Claude Code, or Pi Agent CLI.");
  }
}

function finishActiveRun(schedule: TaskSchedule, task: TaskCenterTask): boolean {
  if (schedule.activeTaskCenterTaskId !== task.id || !taskIsTerminal(task.status)) return false;
  const run = schedule.runs.find((item) => item.taskCenterTaskId === task.id);
  if (run && !run.completedAt) {
    run.status = scheduleRunStatus(task);
    run.completedAt = Date.now();
    run.summary = task.error || task.output?.slice(0, 500) || task.status;
  }
  schedule.activeTaskCenterTaskId = undefined;
  schedule.updatedAt = Date.now();
  return true;
}

async function startRun(schedule: TaskSchedule): Promise<TaskCenterTask> {
  const task = await createTaskCenterTask({
    title: `[计划] ${schedule.name}`,
    prompt: schedule.prompt,
    runtimeId: schedule.runtimeId,
    mode: schedule.mode,
    workspace: schedule.workspace,
    timeoutMs: schedule.timeoutMs,
  });
  schedule.activeTaskCenterTaskId = task.id;
  appendRun(schedule, {
    id: `schedule-run-${randomUUID()}`,
    triggeredAt: Date.now(),
    status: task.status === "running" ? "running" : "queued",
    taskCenterTaskId: task.id,
  });
  schedule.updatedAt = Date.now();
  return task;
}

async function requestRun(schedule: TaskSchedule, reason: "manual" | "scheduled"): Promise<TaskCenterTask | undefined> {
  if (schedule.activeTaskCenterTaskId) {
    if (schedule.concurrencyPolicy === "skip") {
      appendRun(schedule, {
        id: `schedule-run-${randomUUID()}`,
        triggeredAt: Date.now(),
        status: "skipped",
        summary: `${reason === "manual" ? "Manual" : "Scheduled"} trigger skipped because a prior run is active.`,
      });
    } else if (schedule.concurrencyPolicy === "queue") {
      schedule.pendingRuns = Math.min(MAX_PENDING_RUNS, schedule.pendingRuns + 1);
    } else {
      await cancelTaskCenterTask(schedule.activeTaskCenterTaskId);
      schedule.pendingRuns = Math.min(MAX_PENDING_RUNS, schedule.pendingRuns + 1);
    }
    schedule.updatedAt = Date.now();
    return undefined;
  }
  return startRun(schedule);
}

export function listTaskSchedules(profile?: string): TaskSchedule[] {
  return readStore(profile).schedules.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createTaskSchedule(input: CreateTaskScheduleInput, profile?: string): TaskSchedule {
  const name = cleanText(input?.name, 160);
  const schedule = cleanText(input?.schedule, 128);
  const prompt = cleanText(input?.prompt, 50_000);
  if (!name || !schedule || !prompt || !validSchedule(schedule)) {
    throw new Error("Schedule name, task prompt, and a 5-field Cron or interval schedule are required.");
  }
  requireRuntime(input);
  const now = Date.now();
  const store = readStore(profile);
  const value: TaskSchedule = {
    id: `schedule-${randomUUID()}`,
    name,
    schedule,
    prompt,
    runtimeId: input.runtimeId,
    mode: input.mode === "implementation" ? "implementation" : "analysis",
    ...(cleanText(input.workspace, 4096) ? { workspace: cleanText(input.workspace, 4096) } : {}),
    timeoutMs: typeof input.timeoutMs === "number" ? Math.max(1_000, Math.min(input.timeoutMs, 24 * 60 * 60_000)) : DEFAULT_TIMEOUT_MS,
    enabled: true,
    concurrencyPolicy: policy(input.concurrencyPolicy),
    pendingRuns: 0,
    lastDueAt: now,
    nextRunAt: nextRunAt({ schedule, lastDueAt: now } as TaskSchedule, now),
    runs: [],
    createdAt: now,
    updatedAt: now,
  };
  store.schedules.unshift(value);
  writeStore(store, profile);
  return value;
}

export function setTaskScheduleEnabled(id: string, enabled: boolean, profile?: string): TaskSchedule {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  schedule.enabled = enabled;
  schedule.updatedAt = Date.now();
  writeStore(store, profile);
  return schedule;
}

export function deleteTaskSchedule(id: string, profile?: string): boolean {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) return false;
  if (schedule.activeTaskCenterTaskId) throw new Error("Pause the active schedule before deleting it.");
  store.schedules = store.schedules.filter((item) => item.id !== id);
  writeStore(store, profile);
  return true;
}

export async function triggerTaskSchedule(id: string, profile?: string): Promise<TaskScheduleTriggerResult> {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  const task = await requestRun(schedule, "manual");
  writeStore(store, profile);
  return { schedule, ...(task ? { task } : {}) };
}

/** Reconciles Task Center status and starts due local schedules. Exposed for tests. */
export async function tickTaskSchedules(profile?: string, now = Date.now()): Promise<void> {
  const store = readStore(profile);
  const taskById = new Map((await listTaskCenterTasks()).map((task) => [task.id, task]));
  let changed = false;
  for (const schedule of store.schedules) {
    if (schedule.activeTaskCenterTaskId) {
      const task = taskById.get(schedule.activeTaskCenterTaskId);
      if (task) changed = finishActiveRun(schedule, task) || changed;
    }
    if (schedule.enabled && !schedule.activeTaskCenterTaskId && schedule.pendingRuns > 0) {
      schedule.pendingRuns -= 1;
      await startRun(schedule);
      changed = true;
    }
    if (!schedule.enabled || !isDue(schedule, now)) continue;
    schedule.lastDueAt = intervalMs(schedule.schedule) ? now : Math.floor(now / 60_000) * 60_000;
    schedule.nextRunAt = nextRunAt(schedule, now);
    await requestRun(schedule, "scheduled");
    changed = true;
  }
  if (changed) writeStore(store, profile);
}

export function startTaskScheduleRunner(): void {
  if (runner) return;
  const run = (): void => {
    if (ticking) return;
    ticking = true;
    void tickTaskSchedules().catch(() => undefined).finally(() => { ticking = false; });
  };
  runner = setInterval(run, RUNNER_INTERVAL_MS);
  run();
}

export function stopTaskScheduleRunner(): void {
  if (!runner) return;
  clearInterval(runner);
  runner = null;
}
