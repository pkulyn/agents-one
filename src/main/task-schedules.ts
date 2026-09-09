import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  isTaskScheduleRuntimeEligible,
  taskScheduleRuntimeCategory,
  type CreateTaskScheduleInput,
  type TaskSchedule,
  type TaskScheduleConcurrencyPolicy,
  type TaskScheduleRun,
  type TaskScheduleRunCompletedEvent,
  type TaskScheduleRunStartedEvent,
  type TaskScheduleTriggerResult,
  type UpdateTaskScheduleInput,
} from "../shared/task-schedules";
import { summarizeTaskOutput } from "../shared/runtime-output";
import { redactSensitiveText } from "../shared/redaction";
import {
  runtimeIsolationInfo,
  unattendedRuntimePreflight,
  type AgentRuntimeDefinition,
  type AgentRuntimeRun,
} from "../shared/agent-runtimes";
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
import { resolveAuthorizedWorkspaceId } from "./workspace-authority";

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
const scheduleMutationChains = new Map<string, Promise<void>>();

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
  if (/^\d+[mh]$/i.test(value)) return true;
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    validCronPart(parts[0], 0, 59) &&
    validCronPart(parts[1], 0, 23) &&
    validCronPart(parts[2], 1, 31) &&
    validCronPart(parts[3], 1, 12) &&
    validCronPart(parts[4], 0, 7)
  );
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
    ...(cleanText(item.workspaceId, 128)
      ? { workspaceId: cleanText(item.workspaceId, 128) }
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

/** Serialize async schedule mutations for one Profile to prevent stale writes. */
async function withScheduleMutation<T>(
  profile: string | undefined,
  mutation: () => Promise<T>,
): Promise<T> {
  const key = resolvedProfile(profile);
  const previous = scheduleMutationChains.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => undefined).then(() => current);
  scheduleMutationChains.set(key, chain);
  await previous.catch(() => undefined);
  try {
    return await mutation();
  } finally {
    release();
    if (scheduleMutationChains.get(key) === chain) {
      scheduleMutationChains.delete(key);
    }
  }
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
    workspaceId: schedule.workspaceId,
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
    workspaceId: conversation.workspaceId,
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

function cronNumber(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max
    ? number
    : null;
}

function validCronPart(part: string, min: number, max: number): boolean {
  return part.split(",").every((item) => {
    const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(item);
    const base = stepMatch ? stepMatch[1] : item;
    if (stepMatch && Number(stepMatch[2]) < 1) return false;
    if (base === "*") return true;
    const range = /^(\d+)-(\d+)$/.exec(base);
    if (range) {
      const start = cronNumber(range[1], min, max);
      const end = cronNumber(range[2], min, max);
      return start !== null && end !== null && start <= end;
    }
    return cronNumber(base, min, max) !== null;
  });
}

function cronPartMatches(
  part: string,
  value: number,
  min: number,
  max: number,
): boolean {
  const candidates = max === 7 && value === 0 ? [0, 7] : [value];
  return candidates.some((candidate) =>
    part.split(",").some((item) => {
      const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(item);
      const base = stepMatch ? stepMatch[1] : item;
      const step = stepMatch ? Number(stepMatch[2]) : 1;
      if (base === "*") return (candidate - min) % step === 0;
      const range = /^(\d+)-(\d+)$/.exec(base);
      const start = range ? Number(range[1]) : Number(base);
      const end = range ? Number(range[2]) : start;
      return (
        candidate >= start &&
        candidate <= end &&
        (candidate - start) % step === 0
      );
    }),
  );
}

function cronMatches(schedule: string, now: Date): boolean {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  return (
    cronPartMatches(parts[0], now.getMinutes(), 0, 59) &&
    cronPartMatches(parts[1], now.getHours(), 0, 23) &&
    cronPartMatches(parts[2], now.getDate(), 1, 31) &&
    cronPartMatches(parts[3], now.getMonth() + 1, 1, 12) &&
    cronPartMatches(parts[4], now.getDay(), 0, 7)
  );
}

/**
 * Cron expressions follow the desktop's local civil time. During a fall-back
 * DST transition the same wall-clock minute occurs twice; it is one intended
 * cron slot, not two opportunities to dispatch the same schedule.
 */
function cronLocalMinuteKey(timestamp: number): string {
  const local = new Date(timestamp);
  return [
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
  ].join(":");
}

function nextRunAt(schedule: TaskSchedule, now: number): number | undefined {
  const interval = intervalMs(schedule.schedule);
  if (interval) return (schedule.lastDueAt || now) + interval;
  for (let offset = 1; offset <= 10 * 525_600; offset += 1) {
    const candidate = Math.floor(now / 60_000) * 60_000 + offset * 60_000;
    if (cronMatches(schedule.schedule, new Date(candidate))) return candidate;
  }
  return undefined;
}

function enabledScheduledRuntimeIds(): Set<string> {
  return new Set(
    listAgentRuntimes()
      .filter(isTaskScheduleRuntimeEligible)
      .map((runtime) => runtime.id),
  );
}

function scheduledRuntime(
  runtimeId: string,
): AgentRuntimeDefinition | undefined {
  return listAgentRuntimes().find(
    (runtime) =>
      runtime.id === runtimeId && isTaskScheduleRuntimeEligible(runtime),
  );
}

function requireScheduledRuntime(runtimeId: string): AgentRuntimeDefinition {
  const runtime = scheduledRuntime(runtimeId);
  if (!runtime) {
    throw new Error(
      "Scheduled tasks require an enabled local CLI, Web Agent, or remote Gateway v1 Runtime.",
    );
  }
  return runtime;
}

// @lat: [[task-schedules#Execution semantics]]
async function startRun(
  schedule: TaskSchedule,
  trigger: "manual" | "scheduled" | "missed",
  profile?: string,
  dueAt?: number,
): Promise<AgentRuntimeRun> {
  const triggeredAt = Date.now();
  const scheduleRunId = `schedule-run-${randomUUID()}`;
  const runtime = requireScheduledRuntime(schedule.runtimeId);
  const webRuntime = taskScheduleRuntimeCategory(runtime) === "web";
  const taskMode = webRuntime
    ? "analysis"
    : schedule.mode === "auto"
      ? "safe_write"
      : schedule.mode;
  if (trigger !== "manual") {
    const preflight = unattendedRuntimePreflight(
      runtimeIsolationInfo(runtime, { mode: taskMode }),
      { mode: taskMode, fullAccessConfirmed: false },
    );
    if (!preflight.allowed) throw new Error(preflight.warnings.join(" "));
  }
  const runtimeRun = await startAgentRuntimeTask(schedule.runtimeId, {
    prompt: schedule.prompt,
    mode: taskMode,
    fullAccessConfirmed: taskMode === "full_access",
    conversation: true,
    ...(webRuntime
      ? {}
      : schedule.workspaceId
        ? { workspaceId: schedule.workspaceId }
        : { workspace: schedule.workspace }),
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
    trigger,
    ...(dueAt === undefined ? {} : { dueAt }),
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
    runtimeId: runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeAvatar: runtime.avatar,
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
  reason: "manual" | "scheduled" | "missed",
  profile?: string,
  dueAt?: number,
): Promise<AgentRuntimeRun | undefined> {
  const activeRunId = schedule.activeRuntimeRunId;
  if (activeRunId) {
    if (schedule.concurrencyPolicy === "skip") {
      appendRun(schedule, {
        id: `schedule-run-${randomUUID()}`,
        triggeredAt: Date.now(),
        trigger: reason,
        ...(dueAt === undefined ? {} : { dueAt }),
        status: "skipped",
        summary: `${reason === "manual" ? "Manual" : reason === "missed" ? "Coalesced catch-up" : "Scheduled"} trigger skipped because a prior run is active.`,
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
  return startRun(schedule, reason, profile, dueAt);
}

export function listTaskSchedules(profile?: string): TaskSchedule[] {
  return readStore(profile).schedules.sort((a, b) => b.updatedAt - a.updatedAt);
}

function createTaskScheduleUnlocked(
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
  const runtime = requireScheduledRuntime(input.runtimeId);
  const workspaceId = cleanText(input.workspaceId, 128);
  const workspace = cleanText(input.workspace, 4096);
  const webRuntime = taskScheduleRuntimeCategory(runtime) === "web";
  if (webRuntime && (workspace || workspaceId)) {
    throw new Error("Web Agent schedules do not accept a project workspace.");
  }
  if (webRuntime && input.mode === "full_access") {
    throw new Error("Web Agent schedules support analysis mode only.");
  }
  if (workspaceId && !resolveAuthorizedWorkspaceId(workspaceId)) {
    throw new Error(
      "Scheduled workspace capability is unavailable or no longer authorized.",
    );
  }
  if (input.mode === "full_access" && !workspace && !workspaceId) {
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
    mode: webRuntime
      ? "analysis"
      : input.mode === "analysis" || input.mode === "full_access"
        ? input.mode
        : "auto",
    ...(workspace ? { workspace } : {}),
    ...(workspaceId ? { workspaceId } : {}),
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

export async function createTaskSchedule(
  input: CreateTaskScheduleInput,
  profile?: string,
): Promise<TaskSchedule> {
  return withScheduleMutation(profile, async () =>
    createTaskScheduleUnlocked(input, profile),
  );
}

function updateTaskScheduleUnlocked(
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
  const runtime = requireScheduledRuntime(input.runtimeId);
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  if (schedule.activeRuntimeRunId) {
    throw new Error(
      "Wait for the active run to finish before editing this schedule.",
    );
  }
  const workspaceId = cleanText(input.workspaceId, 128);
  const workspace = cleanText(input.workspace, 4096);
  const webRuntime = taskScheduleRuntimeCategory(runtime) === "web";
  if (webRuntime && (workspace || workspaceId)) {
    throw new Error("Web Agent schedules do not accept a project workspace.");
  }
  if (webRuntime && input.mode === "full_access") {
    throw new Error("Web Agent schedules support analysis mode only.");
  }
  const mode = webRuntime
    ? "analysis"
    : input.mode === "analysis" || input.mode === "full_access"
      ? input.mode
      : "auto";
  if (workspaceId && !resolveAuthorizedWorkspaceId(workspaceId)) {
    throw new Error(
      "Scheduled workspace capability is unavailable or no longer authorized.",
    );
  }
  if (mode === "full_access" && !workspace && !workspaceId) {
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
  if (workspaceId) schedule.workspaceId = workspaceId;
  else delete schedule.workspaceId;
  writeStore(store, profile);
  return schedule;
}

export async function updateTaskSchedule(
  id: string,
  input: UpdateTaskScheduleInput,
  profile?: string,
): Promise<TaskSchedule> {
  return withScheduleMutation(profile, async () =>
    updateTaskScheduleUnlocked(id, input, profile),
  );
}

function setTaskScheduleEnabledUnlocked(
  id: string,
  enabled: boolean,
  profile?: string,
): TaskSchedule {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  if (enabled) requireScheduledRuntime(schedule.runtimeId);
  schedule.enabled = enabled;
  schedule.updatedAt = Date.now();
  writeStore(store, profile);
  return schedule;
}

export async function setTaskScheduleEnabled(
  id: string,
  enabled: boolean,
  profile?: string,
): Promise<TaskSchedule> {
  return withScheduleMutation(profile, async () =>
    setTaskScheduleEnabledUnlocked(id, enabled, profile),
  );
}

function deleteTaskScheduleUnlocked(id: string, profile?: string): boolean {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) return false;
  if (schedule.activeRuntimeRunId)
    throw new Error("Pause the active schedule before deleting it.");
  store.schedules = store.schedules.filter((item) => item.id !== id);
  writeStore(store, profile);
  return true;
}

export async function deleteTaskSchedule(
  id: string,
  profile?: string,
): Promise<boolean> {
  return withScheduleMutation(profile, async () =>
    deleteTaskScheduleUnlocked(id, profile),
  );
}

async function triggerTaskScheduleUnlocked(
  id: string,
  profile?: string,
): Promise<TaskScheduleTriggerResult> {
  const store = readStore(profile);
  const schedule = store.schedules.find((item) => item.id === id);
  if (!schedule) throw new Error("Task schedule was not found.");
  requireScheduledRuntime(schedule.runtimeId);
  const run = await requestRun(schedule, "manual", profile);
  writeStore(store, profile);
  return { schedule, ...(run ? { run } : {}) };
}

export async function triggerTaskSchedule(
  id: string,
  profile?: string,
): Promise<TaskScheduleTriggerResult> {
  return withScheduleMutation(profile, () =>
    triggerTaskScheduleUnlocked(id, profile),
  );
}

/** Reconciles direct Runtime runs and starts due schedules. Exposed for tests. */
async function tickTaskSchedulesUnlocked(
  profile?: string,
  now = Date.now(),
): Promise<void> {
  const store = readStore(profile);
  const eligibleRuntimeIds = enabledScheduledRuntimeIds();
  const completedEvents: TaskScheduleRunCompletedEvent[] = [];
  let changed = false;
  for (const schedule of store.schedules) {
    try {
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
          error:
            "桌面应用重启后无法恢复本机进程内运行；请从本对话重新执行任务。",
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
      // Keep records for disabled, removed, or temporarily unavailable
      // Runtimes intact without dispatching them.
      if (!eligibleRuntimeIds.has(schedule.runtimeId)) continue;
      if (
        schedule.enabled &&
        !schedule.activeRuntimeRunId &&
        schedule.pendingRuns > 0
      ) {
        schedule.pendingRuns -= 1;
        await startRun(schedule, "scheduled", profile);
        changed = true;
      }
      if (!schedule.enabled) continue;
      // `nextRunAt` is the durable schedule cursor. If the desktop was asleep
      // or restarted, an overdue cursor coalesces all missed periods into one
      // explicit catch-up instead of replaying every missed minute.
      const dueAt =
        schedule.nextRunAt ||
        nextRunAt(
          schedule,
          schedule.lastDueAt || schedule.createdAt || schedule.updatedAt,
        );
      if (dueAt === undefined || dueAt > now) continue;
      const trigger =
        dueAt < Math.floor(now / 60_000) * 60_000 ? "missed" : "scheduled";
      if (
        !intervalMs(schedule.schedule) &&
        typeof schedule.lastDueAt === "number" &&
        cronLocalMinuteKey(schedule.lastDueAt) === cronLocalMinuteKey(dueAt)
      ) {
        // The preceding local minute was already dispatched. This is normally
        // reachable only during a DST fall-back hour, but is intentionally
        // based on civil fields so it also survives a manual clock rollback.
        schedule.lastDueAt = dueAt;
        schedule.nextRunAt = nextRunAt(schedule, dueAt);
        changed = true;
        continue;
      }
      schedule.lastDueAt = intervalMs(schedule.schedule)
        ? now
        : Math.floor(now / 60_000) * 60_000;
      schedule.nextRunAt = nextRunAt(schedule, now);
      await requestRun(schedule, trigger, profile, dueAt);
      changed = true;
    } catch (error) {
      console.error(
        `[TASK SCHEDULE] Tick failed for ${schedule.id}: ${redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }
  if (changed) writeStore(store, profile);
  for (const event of completedEvents) {
    for (const listener of runCompletedListeners) listener(event);
  }
}

export async function tickTaskSchedules(
  profile?: string,
  now = Date.now(),
): Promise<void> {
  return withScheduleMutation(profile, () =>
    tickTaskSchedulesUnlocked(profile, now),
  );
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
      .catch((error) => {
        console.error(
          `[TASK SCHEDULE] Runner tick failed: ${redactSensitiveText(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      })
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
