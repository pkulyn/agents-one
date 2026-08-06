import type {
  AgentRuntimeArtifact,
  AgentRuntimeEvent,
  AgentRuntimeKind,
} from "./agent-runtimes";
import type {
  AgentEventStreamModel,
  AgentEventStreamUsage,
} from "./agent-event-stream";

export interface RuntimeConversationExecution {
  runId: string;
  events: AgentRuntimeEvent[];
  artifacts?: AgentRuntimeArtifact[];
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
}

export interface RuntimeConversationMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: number;
  /** Attribution for replies dispatched by a collaboration task. */
  agentRuntimeId?: string;
  agentName?: string;
  agentAvatar?: string | null;
  agentColor?: string;
  collaborationRole?: string;
  /** Stable role-run linkage used by the collaboration timeline. */
  collaborationAssignmentId?: string;
  /** Redacted runtime progress retained with the final answer for later review. */
  execution?: RuntimeConversationExecution;
}

export interface RuntimeConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeLocation: "local" | "remote";
  /** Desktop display metadata captured when the conversation was updated. */
  runtimeColor?: string;
  runtimeAvatar?: string | null;
  runtimeSessionId?: string;
  /** Last local project explicitly selected for this conversation. */
  workspace?: string;
  messageCount: number;
}

export interface RuntimeConversation extends RuntimeConversationSummary {
  messages: RuntimeConversationMessage[];
}

export interface SaveRuntimeConversationInput {
  profile?: string;
  id: string;
  title: string;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  runtimeLocation: "local" | "remote";
  runtimeColor?: string;
  runtimeAvatar?: string | null;
  runtimeSessionId?: string;
  workspace?: string;
  messages: RuntimeConversationMessage[];
}
