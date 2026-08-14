import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  CreateTaskScheduleInput,
  TaskSchedule,
  TaskScheduleConcurrencyPolicy,
  TaskScheduleRun,
  TaskScheduleRunCompletedEvent,
  TaskScheduleRunStartedEvent,
  TaskScheduleTriggerResult,
  UpdateTaskScheduleInput,
} from "../shared/task-schedules";
import { summarizeTaskOutput } from "../shared/runtime-output";
import type { AgentRuntimeRun } from "../shared/agent-runtimes";
import {
  cancelAgentRuntimeTask,
  getAgentRuntimeRun,
  listAgentRuntimes,
  startAgentRuntimeTask,
} from "./agent-runtimes";
import {
  getRuntimeConversation,
  saveRuntimeConversation,
} from "./runtime-conversation-store";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

const STORE_VERSION = 5;
const MAX_SCHEDULES = 200;
const MAX_SCHEDULE_RUNS = 100;
const MAX_PENDING_RUNS = 20;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const RUNNER_INTERVAL_MS = 5_000;
const LEGACY_TASK_CENTER_RECOVERY_MESSAGE =
  "旧版 Task Center 执行引擎已退役，无法恢复此次运行；请重新触发计划任务。";
let runner: NodeJS.Timeout | null = null;
let ticking = false;
const runCompletedListeners = new Set<
  (event: TaskScheduleRunCompletedEvent) => void
>();
const runStartedListeners = new Set<
  (event: TaskScheduleRunStartedEvent) => void
>();

interface Store {
  version: number;
  schedules: TaskSchedule[];
}

function storePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "desktop",
    "task-schedules.json",
  );
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

function normalizeSchedule(
  value: unknown,
  sourceVersion = STORE_VERSION,
): TaskSchedule | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<TaskSchedule>;
  const storedMode = (value as { mode?: unknown }).mode;
  const id = cleanText(item.id, 120);
  const name = cleanText(item.name, 160);
  const schedule = cleanText(item.schedule, 128);
  const prompt = cleanText(item.prompt, 50_000);
  const runtimeId = cleanText(item.runtimeId, 64);
  if (
    !id ||
    !name ||
    !schedule ||
    !prompt ||
    !runtimeId ||
    !validSchedule(schedule)
  )
    return null;
  const mode =
    sourceVersion < 2 && (storedMode === undefined || storedMode === "analysis")
      ? "auto"
      : sourceVersion < 3 && storedMode === "implementation"
        ? "full_access"
        : storedMode === "analysis" || storedMode === "full_access"
          ? storedMode
          : "auto";
  const timeoutMs =
    typeof item.timeoutMs === "number" && item.timeoutMs >= 1_000
      ? Math.min(item.timeoutMs, 24 * 60 * 60_000)
      : DEFAULT_TIMEOUT_MS;
  const now = Date.now();
  const runs = Array.isArray(item.runs)
    ? item.runs
        .filter((run): run is TaskScheduleRun =>
          Boolean(run && typeof run === "object" && run.id),
        )
        .map((run) => {
          const normalized = { ...run };
          if (
            normalized.taskCenterTaskId &&
            (normalized.status === "queued" || normalized.status === "running")
          ) {
            normalized.status = "failed";
            normalized.completedAt = normalized.completedAt || now;
            normalized.summary = LEGACY_TASK_CENTER_RECOVERY_MESSAGE;
          }
          return normalized;
        })
        .slice(-MAX_SCHEDULE_RUNS)
    : [];
  // `activeTaskCenterTaskId` is intentionally not returned. It belonged to
  // the retired engine and must never block or dispatch a current schedule.
  return {
    id,
    name,
    schedule,
    prompt,
    runtimeId,
    mode,
    ...(cleanText(item.workspace, 4096)
      ? { workspace: cleanText(item.workspace, 4096) }
      : {}),
    timeoutMs,
    enabled: item.enabled !== false,
    concurrencyPolicy: policy(item.concurrencyPolicy),
    pendingRuns:
      typeof item.pendingRuns === "number"
        ? Math.max(0, Math.min(MAX_PENDING_RUNS, Math.floor(item.pendingRuns)))
        : 0,
    ...(typeof item.lastDueAt === "number"
      ? { lastDueAt: item.lastDueAt }
      : {}),
    ...(typeof item.nextRunAt === "number"
      ? { nextRunAt: item.nextRunAt }
      : {}),
    ...(cleanText(item.activeRuntimeRunId, 120)
      ? { activeRuntimeRunId: cleanText(item.activeRuntimeRunId, 120) }
      : {}),
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
    const sourceVersion = typeof raw.version === "number" ? raw.version : 1;
    return {
      version: STORE_VERSION,
      schedules: Array.isArray(raw.schedules)
        ? raw.schedules
            .map((item) => normalizeSchedule(item, sourceVersion))
            .filter((item): item is TaskSchedule => Boolean(item))
            .slice(0, MAX_SCHEDULES)
        : [],
    };
  } catch {
    return { version: STORE_VERSION, schedules: [] };
  }
}

function writeStore(store: Store, profile?: string): void {
  safeWriteFile(
    storePath(profile),
    JSON.stringify({
      version: STORE_VERSION,
      schedules: store.schedules.slice(0, MAX_SCHEDULES),
    }),
  );
}

function resolvedProfile(profile?: string): string {
  return profile || getActiveProfileNameSync();
}

function createRunConversation(
  schedule: TaskSchedule,
  runId: string,
  triggeredAt: number,
  profile?: string,
  activeRuntimeRunId?: string,
): string | undefined {
  const runtime = listAgentRuntimes().find(
    (item) => item.id === schedule.runtimeId,
  );
  if (!runtime) return undefined;
  const conversationId = `runtime-conv-schedule-${randomUUID()}`;
  saveRuntimeConversation({
    profile: resolvedProfile(profile),
    id: conversationId,
    title: `定时任务：${schedule.name}`,
    runtimeId: runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeLocation: runtime.location,
    runtimeColor: runtime.color,
    runtimeAvatar: runtime.avatar,
    activeRuntimeRunId,
    workspace: schedule.workspace,
    accessMode: schedule.mode,
    messages: [
      {
        id: `${runId}-user`,
        role: "user",
        content: schedule.prompt,
        createdAt: triggeredAt,
      },
    ],
  });
  return conversationId;
}

function runtimeRunStatus(run: AgentRuntimeRun): TaskScheduleRun["status"] {
  return run.status;
}

function runtimeRunMessage(run: AgentRuntimeRun): string {
  if (run.error) return run.error;
  const output = run.output?.trim() || "";
  const summary = summarizeTaskOutput(output);
  if (summary.finalText) return summary.finalText;
  if (output && !summary.hasStructuredEvents) return output.slice(-200_000);
  if (run.status === "succeeded") return "定时任务执行完成。";
  return `定时任务未成功完成（${run.status}）。`;
}

function finishRuntimeConversation(
  schedule: TaskSchedule,
  run: TaskScheduleRun,
  runtimeRun: AgentRuntimeRun,
  completedAt: number,
  profile?: string,
): string {
  const conversationId =
    run.conversationId ||
    createRunConversation(
      schedule,
      run.id,
      run.triggeredAt,
      profile,
      runtimeRun.id,
    );
  if (!conversationId) return runtimeRunMessage(runtimeRun);
  run.conversationId = conversationId;
  const conversation = getRuntimeConversation(
    conversationId,
    resolvedProfile(profile),
  );
  if (!conversation) return runtimeRunMessage(runtimeRun);

  const existingResult = conversation.messages.find(
    (message) => message.execution?.runId === runtimeRun.id,
  );
  const content = existingResult?.content || runtimeRunMessage(runtimeRun);
  saveRuntimeConversation({
    profile: resolvedProfile(profile),
    id: conversation.id,
    title: conversation.title,
    runtimeId: conversation.runtimeId,
    runtimeName: conversation.runtimeName,
    runtimeKind: conversation.runtimeKind,
    runtimeLocation: conversation.runtimeLocation,
    runtimeColor: conversation.runtimeColor,
    runtimeAvatar: conversation.runtimeAvatar,
    runtimeSessionId: runtimeRun.sessionId || conversation.runtimeSessionId,
    activeRuntimeRunId: null,
    workspace: conversation.workspace,
    accessMode: conversation.accessMode,
    messages: existingResult
      ? conversation.messages
      : [
          ...conversation.messages,
          {
            id: `${run.id}-result`,
            role: runtimeRun.status === "succeeded" ? "agent" : "system",
            content,
            createdAt: completedAt,
            execution: {
              runId: runtimeRun.id,
              events: runtimeRun.events || [],
              ...(runtimeRun.artifacts?.length
                ? { artifacts: runtimeRun.artifacts }
                : {}),
              ...(runtimeRun.model ? { model: runtimeRun.model } : {}),
              ...(runtimeRun.usage ? { usage: runtimeRun.usage } : {}),
            },
          },
        ],
  });
  return content;
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
  return (
    cronPartMatches(parts[0], now.getMinutes()) &&
    cronPartMatches(parts[1], now.getHours()) &&
    cronPartMatches(parts[2], now.getDate()) &&
    cronPartMatches(parts[3], now.getMonth() + 1) &&
    cronPartMatches(parts[4], now.getDay())
  );
}

function isDue(schedule: TaskSchedule, now: number): boolean {
  const interval = intervalMs(schedule.schedule);
  if (interval)
    return !schedule.lastDueAt || now - schedule.lastDueAt >= interval;
  const minute = Math.floor(now / 60_000) * 60_000;
  return (
    schedule.lastDueAt !== minute &&
    cronMatches(schedule.schedule, new Date(now))
  );
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

function enabledLocalCliRuntimeIds(): Set<string> {
  return new Set(
    listAgentRuntimes()
      .filter(
        (runtime) =>
          runtime.enabled &&
          runtime.location === "local" &&
          runtime.config.transport === "cli",
      )
      .map((runtime) => runtime.id),
  );
}

function isEnabledLocalCliRuntime(runtimeId: string): boolean {
  return enabledLocalCliRuntimeIds().has(runtimeId);
}

function requireLocalCliRuntime(runtimeId: string): void {
  if (!isEnabledLocalCliRuntime(runtimeId)) {
    throw new Error("Scheduled tasks require an enabled local CLI Runtime.");
  }
}

async function startRun(
  schedule: TaskSchedule,
  profile?: string,
): Promise<AgentRuntimeRun> {
  const triggeredAt = Date.now();
  const scheduleRunId = `schedule-run-${randomUUID()}`;
  const taskMode = schedule.mode === "auto" ? "safe_write" : schedule.mode;
  const runtimeRun = await startAgentRuntimeTask(schedule.runtimeId, {
    prompt: schedule.prompt,
    mode: taskMode,
    fullAccessConfirmed: taskMode === "full_access",
    conversation: true,
    workspace: schedule.workspace,
    timeoutMs: schedule.timeoutMs,
  });
  let conversationId: string | undefined;
  try {
    conversationId = createRunConversation(
      schedule,
      scheduleRunId,
      triggeredAt,
      profile,
      runtimeRun.id,
    );
  } catch (error) {
    console.error(
      "[TASK SCHEDULE] Failed to create Runtime conversation",
      error,
    );
  }
  schedule.activeRuntimeRunId = runtimeRun.id;
  appendRun(schedule, {
    id: scheduleRunId,
    triggeredAt,
    status: runtimeRunStatus(runtimeRun),
    runtimeRunId: runtimeRun.id,
    ...(conversationId ? { conversationId } : {}),
  });
  schedule.updatedAt = Date.now();
  const event: TaskScheduleRunStartedEvent = {
    profile: resolvedProfile(profile),
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    runId: scheduleRunId,
    runtimeRunId: runtimeRun.id,
    triggeredAt,
    ...(conversationId ? { conversationId } : {}),
  };
  // Persisting is owned by the caller. Emit on the next event-loop turn so
  // renderer refreshes cannot race the schedule-store write.
  setImmediate(() => {
    for (const listener of runStartedListeners) listener(event);
  });
  return runtimeRun;
}

async function requestRun(
  schedule: TaskSchedule,
  reason: "manual" | "scheduled",
  profile?: string,
): Promise<AgentRuntimeRun | undefined> {
  const activeRunId = schedule.activeRuntimeRunId;
  if (activeRunId) {
    if (schedule.concurrencyPolicy === "skip") {
      appendRun(schedule, {
        id: `schedule-run-${randomUUID()}`,
        triggeredAt: Date.now(),
        status: "skipped",
        summary: `${reason === "manual" ? "Manual" : "Scheduled"} trigger skipped because a prior run is active.`,
      });
    } else if (schedule.concurrencyPolicy === "queue") {
      schedule.pendingRuns = Math.min(
        MAX_PENDING_RUNS,
        schedule.pendingRuns + 1,
      );
    } else {
      await cancelAgentRuntimeTask(activeRunId);
      schedule.pendingRuns = Math.min(
        MAX_PENDING_RUNS,
        schedule.pendingRuns + 1,
      );
    }
    schedule.updatedAt = Date.now();
    return undefined;
  }
  return startRun(schedule, profile);
}

export function listTaskSchedules(profile?: string): TaskSchedule[] {
  return readStore(profile).schedules.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function createTaskSchedule(
  input: CreateTaskScheduleInput,
  profile?: string,
): TaskSchedule {
  const name = cleanText(input?.name, 160);
  const schedule = cleanText(input?.schedule, 128);
  const prompt = cleanText(input?.prompt, 50_000);
  if (!name || !schedule || !prompt || !validSchedule(schedule)) {
    throw new Error(
      "Schedule name, task prompt, and a 5-field Cron or interval schedule are required.",
    );
  }
  requireLocalCliRuntime(input.runtimeId);
  const workspace = cleanText(input.workspace, 4096);
  if (input.mode === "full_access" && !workspace) {
    throw new Error(
      "Full access requires an explicitly selected project folder.",
    );
  }
  const now = Date.now();
  const store = readStore(profile);
  const value: TaskSchedule = {
    id: `schedule-${randomUUID()}`,
    name,
    schedule,
    prompt,
    runtimeId: input.runtimeId,
    mode:
      input.mode === "analysis" || input.mode === "full_access"
        ? input.mode
        : "auto",
    ...(workspace ? { workspace } : {}),
    timeoutMs:
      typeof input.timeoutMs === "number"
        ? Math.max(1_000, Math.min(input.timeoutMs, 24 * 60 * 60_000))
        : DEFAULT_TIMEOUT_MS,
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

export function updateTaskSchedule(
  id: string,
  input: UpdateTaskScheduleInput,
  profile?: string,
): TaskSchedule {
  const name = cleanText(input?.name, 160);
  const scheduleValue = cleanText(input?.schedule, 128);
  const prompt = cleanText(input?.prompt, 50_000);
  if (!name || !scheduleValue || !prompt || !validSchedule(scheduleValue)) {
    throw new Error(
      "Schedule name, task prompt, and a 5-field Cron or interval schedule are required.",
    );
  }
  requireLocalCliRuntime(input.runtimeId);
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  if (schedule.activeRuntimeRunId) {
    throw new Error(
      "Wait for the active run to finish before editing this schedule.",
    );
  }
  const workspace = cleanText(input.workspace, 4096);
  const mode =
    input.mode === "analysis" || input.mode === "full_access"
      ? input.mode
      : "auto";
  if (mode === "full_access" && !workspace) {
    throw new Error(
      "Full access requires an explicitly selected project folder.",
    );
  }
  const now = Date.now();
  Object.assign(schedule, {
    name,
    schedule: scheduleValue,
    prompt,
    runtimeId: input.runtimeId,
    mode,
    timeoutMs:
      typeof input.timeoutMs === "number"
        ? Math.max(1_000, Math.min(input.timeoutMs, 24 * 60 * 60_000))
        : schedule.timeoutMs,
    concurrencyPolicy: policy(input.concurrencyPolicy),
    enabled: input.enabled ?? schedule.enabled,
    lastDueAt: now,
    nextRunAt: nextRunAt(
      { ...schedule, schedule: scheduleValue, lastDueAt: now },
      now,
    ),
    updatedAt: now,
  });
  if (workspace) schedule.workspace = workspace;
  else delete schedule.workspace;
  writeStore(store, profile);
  return schedule;
}

export function setTaskScheduleEnabled(
  id: string,
  enabled: boolean,
  profile?: string,
): TaskSchedule {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  if (enabled) requireLocalCliRuntime(schedule.runtimeId);
  schedule.enabled = enabled;
  schedule.updatedAt = Date.now();
  writeStore(store, profile);
  return schedule;
}

export function deleteTaskSchedule(id: string, profile?: string): boolean {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) return false;
  if (schedule.activeRuntimeRunId)
    throw new Error("Pause the active schedule before deleting it.");
  store.schedules = store.schedules.filter((item) => item.id !== id);
  writeStore(store, profile);
  return true;
}

export async function triggerTaskSchedule(
  id: string,
  profile?: string,
): Promise<TaskScheduleTriggerResult> {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  requireLocalCliRuntime(schedule.runtimeId);
  const run = await requestRun(schedule, "manual", profile);
  writeStore(store, profile);
  return { schedule, ...(run ? { run } : {}) };
}

/** Reconciles direct Runtime runs and starts due local schedules. Exposed for tests. */
export async function tickTaskSchedules(
  profile?: string,
  now = Date.now(),
): Promise<void> {
  const store = readStore(profile);
  const eligibleRuntimeIds = enabledLocalCliRuntimeIds();
  const completedEvents: TaskScheduleRunCompletedEvent[] = [];
  let changed = false;
  for (const schedule of store.schedules) {
    if (schedule.activeRuntimeRunId) {
      const runtimeRun = (await getAgentRuntimeRun(
        schedule.activeRuntimeRunId,
      )) || {
        id: schedule.activeRuntimeRunId,
        runtimeId: schedule.runtimeId,
        status: "failed" as const,
        startedAt:
          schedule.runs.find(
            (item) => item.runtimeRunId === schedule.activeRuntimeRunId,
          )?.triggeredAt || schedule.updatedAt,
        completedAt: Date.now(),
        error: "桌面应用重启后无法恢复本机进程内运行；请从本对话重新执行任务。",
        events: [],
      };
      if (runtimeRun.status !== "running") {
        const run = schedule.runs.find(
          (item) => item.runtimeRunId === runtimeRun.id,
        );
        const completedAt = runtimeRun.completedAt || Date.now();
        if (run && !run.completedAt) {
          run.status = runtimeRunStatus(runtimeRun);
          run.completedAt = completedAt;
          try {
            run.summary = finishRuntimeConversation(
              schedule,
              run,
              runtimeRun,
              completedAt,
              profile,
            )
              .replace(/\s+/g, " ")
              .slice(0, 500);
          } catch (error) {
            console.error(
              "[TASK SCHEDULE] Failed to persist Runtime result conversation",
              error,
            );
            run.summary = runtimeRun.error || runtimeRun.status;
          }
          completedEvents.push({
            profile: resolvedProfile(profile),
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            runId: run.id,
            status: run.status,
            completedAt,
            conversationId: run.conversationId,
            summary: run.summary,
          });
        }
        schedule.activeRuntimeRunId = undefined;
        schedule.updatedAt = completedAt;
        changed = true;
      }
    }
    // Keep legacy records intact, but never dispatch a remote or non-CLI
    // Runtime after scheduled tasks have been narrowed to local CLI agents.
    if (!eligibleRuntimeIds.has(schedule.runtimeId)) continue;
    if (
      schedule.enabled &&
      !schedule.activeRuntimeRunId &&
      schedule.pendingRuns > 0
    ) {
      schedule.pendingRuns -= 1;
      await startRun(schedule, profile);
      changed = true;
    }
    if (!schedule.enabled || !isDue(schedule, now)) continue;
    schedule.lastDueAt = intervalMs(schedule.schedule)
      ? now
      : Math.floor(now / 60_000) * 60_000;
    schedule.nextRunAt = nextRunAt(schedule, now);
    await requestRun(schedule, "scheduled", profile);
    changed = true;
  }
  if (changed) writeStore(store, profile);
  for (const event of completedEvents) {
    for (const listener of runCompletedListeners) listener(event);
  }
}

export function onTaskScheduleRunCompleted(
  listener: (event: TaskScheduleRunCompletedEvent) => void,
): () => void {
  runCompletedListeners.add(listener);
  return () => runCompletedListeners.delete(listener);
}

export function onTaskScheduleRunStarted(
  listener: (event: TaskScheduleRunStartedEvent) => void,
): () => void {
  runStartedListeners.add(listener);
  return () => runStartedListeners.delete(listener);
}

export function startTaskScheduleRunner(): void {
  if (runner) return;
  const run = (): void => {
    if (ticking) return;
    ticking = true;
    void tickTaskSchedules()
      .catch(() => undefined)
      .finally(() => {
        ticking = false;
      });
  };
  runner = setInterval(run, RUNNER_INTERVAL_MS);
  run();
}

export function stopTaskScheduleRunner(): void {
  if (!runner) return;
  clearInterval(runner);
  runner = null;
}

/** Stop future ticks and wait for the current persistence pass to finish. */
export async function stopTaskScheduleRunnerAndWait(
  timeoutMs = 10_000,
): Promise<boolean> {
  stopTaskScheduleRunner();
  const deadline = Date.now() + Math.max(0, timeoutMs);
  while (ticking && Date.now() < deadline) {
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 25));
  }
  return !ticking;
}
