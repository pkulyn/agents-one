export const AGENT_RUNTIME_KINDS = [
  "hermes",
  "openclaw",
  "codex",
  "claude-code",
] as const;

export type AgentRuntimeKind = (typeof AGENT_RUNTIME_KINDS)[number];
export type AgentRuntimeLocation = "local" | "remote";
export type AgentRuntimeHealthState =
  | "healthy"
  | "degraded"
  | "unreachable"
  | "unsupported"
  | "unknown";

export interface AgentRuntimeCapabilities {
  chat: boolean;
  taskDispatch: boolean;
  streaming: boolean;
  cancellation: boolean;
  tools: boolean;
  memory: boolean;
  /** Can propose and manage project/task plans through the controlled API. */
  orchestration: boolean;
  /** Can enforce a server-side no-tools planning policy. */
  readOnlyPlanning: boolean;
  /** Can send and receive structured task handoff events. */
  mailbox: boolean;
  /** Can expose redacted, project-scoped security audit events. */
  securityEvents: boolean;
  artifacts: boolean;
  workspaceAccess: boolean;
}

export interface AgentRuntimeConfig {
  endpoint?: string;
  transport?: "http" | "cli";
  executablePath?: string;
  workspace?: string;
  timeoutMs?: number;
}

export interface AgentRuntimeDefinition {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  location: AgentRuntimeLocation;
  enabled: boolean;
  managed: "builtin" | "user";
  config: AgentRuntimeConfig;
}

export interface AgentRuntimeProbe {
  runtimeId: string;
  state: AgentRuntimeHealthState;
  capabilities: AgentRuntimeCapabilities;
  checkedAt: number;
  message?: string;
}

export interface AgentRuntimeTaskInput {
  prompt: string;
  profile?: string;
  sessionId?: string;
  /** Analysis never mutates a checkout; implementation runs in an isolated worktree. */
  mode?: "analysis" | "implementation";
  /** Optional task-specific workspace. It is validated in the main process. */
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

export interface AgentRuntimeArtifact {
  kind: "worktree" | "diff" | "final";
  label: string;
  path?: string;
  content?: string;
}

export interface AgentRuntimeRun {
  id: string;
  runtimeId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAt: number;
  completedAt?: number;
  output?: string;
  sessionId?: string;
  error?: string;
  worktreePath?: string;
  diffSummary?: string;
  artifacts?: AgentRuntimeArtifact[];
}

export type AgentRuntimeDraft = Omit<
  AgentRuntimeDefinition,
  "managed"
>;

export const NO_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  chat: false,
  taskDispatch: false,
  streaming: false,
  cancellation: false,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
};
