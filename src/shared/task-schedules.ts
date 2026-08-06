import type { TaskCenterTask } from "./task-center";

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
  taskCenterTaskId?: string;
  completedAt?: number;
  summary?: string;
}

/** A schedule owned by the desktop Task Center, not a remote Hermes Cron job. */
export interface TaskSchedule {
  id: string;
  name: string;
  schedule: string;
  prompt: string;
  runtimeId: string;
  mode: "analysis" | "implementation";
  workspace?: string;
  timeoutMs: number;
  enabled: boolean;
  concurrencyPolicy: TaskScheduleConcurrencyPolicy;
  pendingRuns: number;
  lastDueAt?: number;
  nextRunAt?: number;
  activeTaskCenterTaskId?: string;
  runs: TaskScheduleRun[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateTaskScheduleInput {
  name: string;
  schedule: string;
  prompt: string;
  runtimeId: string;
  mode?: "analysis" | "implementation";
  workspace?: string;
  timeoutMs?: number;
  concurrencyPolicy?: TaskScheduleConcurrencyPolicy;
}

export interface TaskScheduleTriggerResult {
  schedule: TaskSchedule;
  task?: TaskCenterTask;
}
