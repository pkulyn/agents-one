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
  /** Background Runtime run currently advancing this persisted conversation. */
  activeRuntimeRunId?: string;
  /** Last local project explicitly selected for this conversation. */
  workspace?: string;
  /** Permission selected for this conversation or scheduled execution. */
  accessMode?: "auto" | "analysis" | "full_access";
  messageCount: number;
}

export interface RuntimeConversation extends RuntimeConversationSummary {
  messages: RuntimeConversationMessage[];
}

export interface QuickChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  createdAt: number;
}

export interface QuickChatConversation {
  id: string;
  title: string;
  runtimeId: string;
  runtimeName: string;
  runtimeSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: QuickChatMessage[];
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
  /** Set by background task creation and cleared after terminal delivery. */
  activeRuntimeRunId?: string | null;
  workspace?: string;
  accessMode?: "auto" | "analysis" | "full_access";
  messages: RuntimeConversationMessage[];
}
