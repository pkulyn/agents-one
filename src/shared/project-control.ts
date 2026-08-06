import type { AgentRuntimeArtifact, AgentRuntimeKind } from "./agent-runtimes";

export type ProjectCoordinatorKind = "runtime" | "human";
export type ProjectRole = "manager" | "implementer" | "tester" | "reviewer" | "acceptor";
export type ProjectStatus = "draft" | "active" | "paused" | "completed" | "cancelled";
export type ProjectTaskStatus =
  | "blocked"
  | "ready"
  | "queued"
  | "running"
  | "review_required"
  | "accepted"
  | "rejected"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface ProjectCoordinatorAssignment {
  kind: ProjectCoordinatorKind;
  runtimeId?: string;
  assignedBy: "user" | "control_plane";
  assignedAt: number;
}

/** A project role is an explicit user choice, never an automatic routing rule. */
export interface ProjectCollaboratorAssignment {
  role: ProjectRole;
  kind: ProjectCoordinatorKind;
  runtimeId?: string;
  assignedAt: number;
}

/** A local summary of a conversation explicitly linked by the user. */
export interface ProjectConversationReference {
  id: string;
  title: string;
  runtimeId: string;
  runtimeName: string;
  linkedAt: number;
}

export interface ProjectControlProject {
  id: string;
  title: string;
  objective: string;
  status: ProjectStatus;
  coordinator: ProjectCoordinatorAssignment;
  /** Project-level defaults for roles; each task still requires explicit assignment. */
  collaborators?: ProjectCollaboratorAssignment[];
  /** User-selected project directory. It is a reference, never an automatic grant. */
  workspace?: string;
  /** Explicit conversation references; messages are not copied into the project. */
  conversations?: ProjectConversationReference[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface ProjectTaskAssignment {
  runtimeId: string;
  role: ProjectRole;
  requestedBy: "user" | "coordinator";
  assignedAt: number;
  workspace?: string;
  mode: "analysis" | "implementation";
}

export interface ProjectControlTask {
  id: string;
  projectId: string;
  parentTaskId?: string;
  title: string;
  requirement: string;
  acceptanceCriteria: string;
  status: ProjectTaskStatus;
  dependencies: string[];
  suggestedRuntimeKind?: AgentRuntimeKind;
  suggestedRole?: ProjectRole;
  suggestedMode?: "analysis" | "implementation";
  assignment?: ProjectTaskAssignment;
  contextPackageId?: string;
  directTaskCenterTaskId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ProjectArtifactReference {
  id: string;
  projectId: string;
  taskId?: string;
  kind: AgentRuntimeArtifact["kind"] | "test_report" | "summary" | "file" | "link";
  label: string;
  sourceRuntimeId?: string;
  path?: string;
  content?: string;
  createdAt: number;
}

export interface ProjectTaskEvent {
  id: string;
  projectId: string;
  taskId?: string;
  type:
    | "project_created"
    | "project_status_changed"
    | "project_scope_changed"
    | "collaborators_changed"
    | "coordinator_changed"
    | "task_created"
    | "task_assigned"
    | "task_status_changed"
    | "progress"
    | "tool_call"
    | "tool_result"
    | "message"
    | "error"
    | "question"
    | "handoff"
    | "review"
    | "acceptance"
    | "artifact_published"
    | "context_requested";
  actor: { kind: "user" | "runtime" | "control_plane"; runtimeId?: string };
  summary: string;
  /** Source Runtime event used to make periodic reconciliation idempotent. */
  sourceEventId?: string;
  createdAt: number;
}

export interface ProjectContextPackage {
  id: string;
  projectId: string;
  taskId: string;
  version: number;
  requirement: string;
  acceptanceCriteria: string;
  projectSummary?: string;
  workspace?: { reference: string; kind: "repository" | "worktree" };
  artifacts: ProjectArtifactReference[];
  upstreamSummaries: Array<{ taskId: string; summary: string }>;
  createdAt: number;
}

export interface CreateProjectInput {
  title: string;
  objective: string;
  coordinator: { kind: ProjectCoordinatorKind; runtimeId?: string };
  workspace?: string;
  conversationIds?: string[];
}

export interface UpdateProjectScopeInput {
  projectId: string;
  workspace?: string;
  conversationIds?: string[];
}

export interface UpdateProjectCollaboratorsInput {
  projectId: string;
  collaborators: Array<{
    role: ProjectRole;
    kind: ProjectCoordinatorKind;
    runtimeId?: string;
  }>;
}

export interface CreateProjectTaskInput {
  projectId: string;
  title: string;
  requirement: string;
  acceptanceCriteria: string;
  parentTaskId?: string;
  dependencies?: string[];
}

export interface AssignProjectTaskInput {
  taskId: string;
  runtimeId: string;
  role: ProjectRole;
  mode: "analysis" | "implementation";
  workspace?: string;
}

export interface ProjectPlanDraftTask {
  title: string;
  requirement: string;
  acceptanceCriteria: string;
  suggestedRuntimeKind?: AgentRuntimeKind;
  role: ProjectRole;
  mode: "analysis" | "implementation";
}

export interface ProjectPlanDraft {
  projectId: string;
  sourceTaskId: string;
  sourceTaskCenterTaskId?: string;
  tasks: ProjectPlanDraftTask[];
  warnings: string[];
}

export interface CreateProjectTasksFromPlanInput {
  projectId: string;
  sourceTaskId: string;
  tasks?: ProjectPlanDraftTask[];
}
