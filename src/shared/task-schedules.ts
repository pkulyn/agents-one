import {
  deriveAgentTransport,
  type AgentRuntimeDefinition,
  type AgentRuntimeKind,
  type AgentRuntimeRun,
} from "./agent-runtimes";

export type TaskScheduleRuntimeCategory = "local" | "web" | "remote";

// @lat: [[task-schedules#Eligible Runtime boundary]]
/**
 * Runtime classes supported by the desktop-owned scheduler. This is shared by
 * the renderer and main process so a Runtime shown in the form is also
 * accepted by the execution boundary.
 */
export function taskScheduleRuntimeCategory(
  runtime: AgentRuntimeDefinition,
): TaskScheduleRuntimeCategory | null {
  const transport = deriveAgentTransport(runtime);
  if (
    transport === "local-web" &&
    runtime.kind === "web-agent" &&
    runtime.location === "local"
  ) {
    return "web";
  }
  if (transport === "gateway-v1" && runtime.location === "remote") {
    return "remote";
  }
  if (transport === "local-cli" && runtime.location === "local") {
    return "local";
  }
  return null;
}

export function isTaskScheduleRuntimeEligible(
  runtime: AgentRuntimeDefinition,
): boolean {
  const category = taskScheduleRuntimeCategory(runtime);
  return Boolean(
    category &&
    runtime.enabled &&
    !runtime.configurationIssue &&
    !runtime.needsReauthorization &&
    (category !== "web" || runtime.config.webAgent?.enabled) &&
    (category !== "remote" ||
      (runtime.config.remoteGateway?.protocol === "agents-one-v1" &&
        runtime.config.endpoint?.trim())),
  );
}

export type TaskScheduleConcurrencyPolicy = "skip" | "queue" | "replace";
export type TaskScheduleRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "skipped";

export interface TaskScheduleRun {
  id: string;
  triggeredAt: number;
  /** Why this execution record was created. `missed` is a coalesced catch-up. */
  trigger?: "manual" | "scheduled" | "missed";
  /** Original due time for a scheduled or coalesced catch-up execution. */
  dueAt?: number;
  status: TaskScheduleRunStatus;
  /**
   * Historical pointer written by the retired Task Center engine.
   * It is retained only so old schedule records round-trip without data loss.
   */
  taskCenterTaskId?: string;
  /** Direct Runtime execution used by current schedule runs. */
  runtimeRunId?: string;
  /** Visible Runtime conversation created for this individual execution. */
  conversationId?: string;
  completedAt?: number;
  summary?: string;
}

export interface TaskScheduleRunCompletedEvent {
  profile: string;
  scheduleId: string;
  scheduleName: string;
  runId: string;
  status: TaskScheduleRunStatus;
  completedAt: number;
  conversationId?: string;
  summary?: string;
}

export interface TaskScheduleRunStartedEvent {
  profile: string;
  scheduleId: string;
  scheduleName: string;
  runId: string;
  runtimeRunId: string;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeAvatar?: string | null;
  triggeredAt: number;
  conversationId?: string;
}

/** A desktop schedule that launches an eligible Runtime conversation. */
export interface TaskSchedule {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  runtimeId: string;
  /** Auto grants write access only when this schedule explicitly selects a workspace. */
  mode: "auto" | "analysis" | "full_access";
  workspace?: string;
  /** Preferred opaque project capability for scheduled Runtime runs. */
  workspaceId?: string;
  timeoutMs: number;
  enabled: boolean;
  concurrencyPolicy: TaskScheduleConcurrencyPolicy;
  pendingRuns: number;
  lastDueAt?: number;
  nextRunAt?: number;
  /** Current direct Runtime run. */
  activeRuntimeRunId?: string;
  runs: TaskScheduleRun[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskScheduleInput {
  name: string;
  schedule: string;
  prompt: string;
  runtimeId: string;
  mode?: "auto" | "analysis" | "full_access";
  workspace?: string;
  workspaceId?: string;
  timeoutMs?: number;
  concurrencyPolicy?: TaskScheduleConcurrencyPolicy;
}

export interface UpdateTaskScheduleInput extends CreateTaskScheduleInput {
  enabled?: boolean;
}

export interface TaskScheduleTriggerResult {
  schedule: TaskSchedule;
  run?: AgentRuntimeRun;
}
