import type {
  AgentRuntimeArtifact,
  AgentRuntimeEvent,
  RuntimeInputArtifact,
} from "./agent-runtimes";
import type { Attachment } from "./attachments";

export type TaskCenterStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "review_required";

/** Immutable snapshot of one actual Runtime execution under a business task. */
export interface TaskCenterRun {
  id: string;
  runtimeRunId?: string;
  status: TaskCenterStatus;
  startedAt: number;
  completedAt?: number;
  output?: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  inputArtifacts?: RuntimeInputArtifact[];
  artifacts?: AgentRuntimeArtifact[];
  events?: AgentRuntimeEvent[];
}

export interface TaskCenterTask {
  id: string;
  title: string;
  prompt: string;
  runtimeId: string;
  mode: "analysis" | "implementation";
  workspace?: string;
  workspaceRef?: string;
  coordinatorPlan?: CreateTaskCenterTaskInput["coordinatorPlan"];
  /** Project-controlled work always requires an explicit human acceptance. */
  requireReview?: boolean;
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
  inputArtifacts?: RuntimeInputArtifact[];
  artifacts?: AgentRuntimeArtifact[];
  /** Historical executions. Legacy task fields mirror the newest entry. */
  runs?: TaskCenterRun[];
  acceptance?: "pending" | "accepted" | "rejected";
  recovery?: {
    reason: "desktop_restarted";
    message: string;
    at: number;
  };
}

export interface TaskCenterWorktree {
  path: string;
  runtimeKind: "codex" | "claude-code" | "pi" | "unknown";
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
  workspaceRef?: string;
  attachments?: Attachment[];
  /** Keep successful work in the review queue instead of auto-completing it. */
  requireReview?: boolean;
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
