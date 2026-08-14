import type { AgentRuntimeRun } from "./agent-runtimes";

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
  triggeredAt: number;
  conversationId?: string;
}

/** A desktop schedule that launches ordinary local Runtime conversations. */
export interface TaskSchedule {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  runtimeId: string;
  /** Auto grants write access only when this schedule explicitly selects a workspace. */
  mode: "auto" | "analysis" | "full_access";
  workspace?: string;
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
