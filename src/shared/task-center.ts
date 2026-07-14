import type { AgentRuntimeArtifact } from "./agent-runtimes";

export type TaskCenterStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "review_required";

export interface TaskCenterTask {
  id: string;
  title: string;
  prompt: string;
  runtimeId: string;
  mode: "analysis" | "implementation";
  workspace?: string;
  timeoutMs: number;
  status: TaskCenterStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  runtimeRunId?: string;
  output?: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts?: AgentRuntimeArtifact[];
  acceptance?: "pending" | "accepted" | "rejected";
  recovery?: {
    reason: "desktop_restarted";
    message: string;
    at: number;
  };
}

export interface TaskCenterWorktree {
  path: string;
  runtimeKind: "codex" | "claude-code" | "unknown";
  exists: boolean;
  updatedAt: number;
  taskId?: string;
  taskTitle?: string;
  taskStatus?: TaskCenterStatus;
  active: boolean;
}

export interface CreateTaskCenterTaskInput {
  title?: string;
  prompt: string;
  runtimeId: string;
  mode: "analysis" | "implementation";
  workspace?: string;
  timeoutMs?: number;
  coordinatorPlan?: {
    projectId: string;
    title: string;
    objective: string;
    existingTasks?: Array<{
      id: string;
      title: string;
      status: string;
      runtimeId?: string;
    }>;
  };
}
