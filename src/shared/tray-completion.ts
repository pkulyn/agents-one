import type { AgentRuntimeKind } from "./agent-runtimes";

export type TrayCompletionStatus =
  | "scheduled_started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

/** In-memory presentation data for the tray-anchored task completion surface. */
export interface TrayCompletionData {
  id: string;
  title: string;
  status: TrayCompletionStatus;
  detail?: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeAvatar?: string | null;
  taskId?: string;
  completedAt: number;
}
