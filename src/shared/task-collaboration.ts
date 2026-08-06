/**
 * Explicit, opt-in collaboration metadata for a conversation task.
 * It deliberately lives alongside, rather than inside, the conversation
 * transcript so enabling collaboration never rewrites message history.
 */
/**
 * A role belongs to a specific collaboration task, not to a global fixed
 * catalogue.  Teams can therefore use domain names such as "UI 设计" or
 * "数据迁移" without changing the application.
 */
export type TaskCollaborationRole = string;

export type TaskCollaborationStatus = "configured" | "active";

export type TaskCollaborationRoleRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "blocked"
  | "waiting_for_user"
  | "paused"
  | "retrying"
  | "needs_review"
  | "cancelled";

export type TaskCollaborationExecutionStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "waiting_for_user"
  | "paused"
  | "needs_review"
  | "cancelled";

/**
 * A user instruction is scoped to one role unless the user explicitly shares
 * it with the team. It is platform data, never inferred from an agent reply.
 */
export interface TaskCollaborationIntervention {
  id: string;
  assignmentId: string;
  content: string;
  visibility: "role" | "shared";
  /**
   * An explicit, role-scoped override chosen by the user while recovering a
   * blocked role. It is never inferred from an agent response.
   */
  accessMode?: "analysis" | "full_access";
  createdAt: number;
}

export interface TaskCollaborationAssignment {
  /** Stable row identity. Legacy records may not have one. */
  id?: string;
  role: TaskCollaborationRole;
  runtimeId?: string;
  /** User-facing scope, kept with the role rather than inferred by a runtime. */
  responsibility?: string;
  /** A short declaration of which task context this role receives. */
  context?: string;
  /**
   * Declares how this role can reach the project workspace.  It is explicit
   * platform data rather than an assumption inferred from a path in a prompt.
   */
  workspaceAccess?: "local_direct" | "remote_mapping" | "evidence_bundle";
  /** A remote path, Git ref, mounted share or Bridge workspace reference. */
  workspaceRef?: string;
}

/**
 * Runtime facts for one configured role. These are platform-owned records:
 * an agent response must never be treated as evidence another role finished.
 */
export interface TaskCollaborationRoleRun {
  assignmentId: string;
  role: string;
  runtimeId?: string;
  status: TaskCollaborationRoleRunStatus;
  runtimeRunId?: string;
  startedAt?: number;
  completedAt?: number;
  /** Bounded handoff text, not an unbounded copy of the conversation. */
  handoff?: string;
  error?: string;
  /** The coordinator's terminal review is a separate platform-owned phase. */
  phase?: "work" | "final_review";
}

/**
 * Evidence emitted by a Runtime, never inferred from an agent's prose reply.
 * `runtime_artifact` is a concrete worktree/diff/file reference; `runtime_event`
 * is a bounded test command/result observed by the Runtime event stream.
 */
export interface TaskCollaborationArtifact {
  id: string;
  assignmentId: string;
  role: string;
  runtimeId?: string;
  kind: "file" | "code_diff" | "test_result";
  label: string;
  path?: string;
  summary?: string;
  /** Delivery-contract facts.  They are supplied by the Runtime adapter. */
  sourceMachine?: string;
  sha256?: string;
  changeSummary?: string;
  source: "runtime_artifact" | "runtime_event";
  sourceRunId?: string;
  createdAt: number;
}

export interface TaskCollaborationTimelineEvent {
  id: string;
  type: "preflight" | "started" | "handoff" | "artifact" | "acceptance" | "blocked" | "recovery";
  label: string;
  detail?: string;
  assignmentId?: string;
  artifactId?: string;
  messageId?: string;
  createdAt: number;
}

export interface TaskCollaborationAcceptance {
  assignmentId?: string;
  status: "passed" | "failed" | "needs_review";
  conclusion: string;
  reviewedArtifactIds: string[];
  createdAt: number;
}

export interface TaskCollaborationExecution {
  status: TaskCollaborationExecutionStatus;
  roleRuns: TaskCollaborationRoleRun[];
  /** Original task brief, required to safely resume one blocked role. */
  brief?: string;
  /** Human guidance kept private to a role unless explicitly shared. */
  interventions?: TaskCollaborationIntervention[];
  /** Concrete evidence published by Runtime adapters for this collaboration. */
  artifacts?: TaskCollaborationArtifact[];
  /** A review role's conclusion, backed by the concrete artifacts above. */
  acceptance?: TaskCollaborationAcceptance;
  /** Compact audit trail, linked to role messages and Runtime evidence. */
  timeline?: TaskCollaborationTimelineEvent[];
  activeAssignmentId?: string;
  updatedAt: number;
  completedAt?: number;
}

export interface TaskCollaborationRecord {
  taskId: string;
  title: string;
  projectFolder?: string;
  sourceRuntimeId?: string;
  assignments: TaskCollaborationAssignment[];
  /** Explicitly started by the user; never inferred from an agent response. */
  status: TaskCollaborationStatus;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  /** Stable parent task links; neither one creates a second collaboration record. */
  conversationId?: string;
  sourceSessionId?: string;
  execution?: TaskCollaborationExecution;
}

export interface SaveTaskCollaborationInput {
  taskId: string;
  title: string;
  projectFolder?: string;
  sourceRuntimeId?: string;
  assignments: TaskCollaborationAssignment[];
  status?: TaskCollaborationStatus;
}

export interface LinkTaskCollaborationInput {
  taskId: string;
  conversationId?: string;
  sourceSessionId?: string;
}

export interface UpdateTaskCollaborationExecutionInput {
  taskId: string;
  execution: TaskCollaborationExecution;
}
