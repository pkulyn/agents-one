import type {
  AgentRuntimeArtifact,
  AgentRuntimeEvent,
  AgentRuntimeKind,
  RuntimeIsolationInfo,
} from "./agent-runtimes";
import type {
  AgentEventStreamModel,
  AgentEventStreamUsage,
} from "./agent-event-stream";
import type {
  RuntimeCommandTarget,
  RuntimeCompactionMetadata,
} from "./runtime-commands";

export interface RuntimeConversationExecution {
  runId: string;
  events: AgentRuntimeEvent[];
  /** Wall-clock bounds reported by the Runtime for this completed turn. */
  startedAt?: number;
  completedAt?: number;
  artifacts?: AgentRuntimeArtifact[];
  /** Provider-reported model actually used for this execution. */
  actualModel?: AgentEventStreamModel;
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
  isolation?: RuntimeIsolationInfo;
}

/** Separates model context from user-visible and audit-only timeline entries. */
export interface ConversationEntryMeta {
  audience: Array<"model" | "user" | "audit">;
  origin: "user" | "runtime" | "platform";
  persistence: "transient" | "durable";
}

/** A conversation tree is distinct from a task DAG and from a Git worktree. */
export interface ConversationBranchRef {
  parentConversationId?: string;
  forkedFromMessageId?: string;
  activeLeafId?: string;
  branchLabel?: string;
  /** User-visible handoff facts only; never private model reasoning. */
  branchSummary?: string;
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
  /** Control-plane record: retained for audit/UI, never treated as chat input. */
  controlAudit?: {
    requestId: string;
    command: string;
    runtimeId: string;
    target?: RuntimeCommandTarget;
    outcome: "handled" | "needs-input" | "unsupported" | "error";
    startedAt: number;
    completedAt: number;
    /** True only when an adapter states that native control fell back. */
    degraded?: boolean;
    /** Opaque compaction metadata; no generated summary text is persisted here. */
    compaction?: RuntimeCompactionMetadata;
    createdAt: number;
  };
  /** Optional on purpose: old stored messages infer this at read time. */
  meta?: ConversationEntryMeta;
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
  /** Preferred opaque project capability for new Runtime dispatches. */
  workspaceId?: string;
  /** Permission selected for this conversation or scheduled execution. */
  accessMode?: "auto" | "analysis" | "full_access";
  branch?: ConversationBranchRef;
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
  workspaceId?: string;
  accessMode?: "auto" | "analysis" | "full_access";
  branch?: ConversationBranchRef;
  messages: RuntimeConversationMessage[];
}

/**
 * Backward-compatible audience inference. Platform/control and tool progress
 * stay visible and auditable but are deliberately excluded from next prompts.
 */
export function conversationEntryMeta(
  message: Pick<
    RuntimeConversationMessage,
    "role" | "controlAudit" | "execution" | "meta"
  >,
): ConversationEntryMeta {
  if (message.meta) return message.meta;
  if (message.controlAudit) {
    return {
      audience: ["user", "audit"],
      origin: "platform",
      persistence: "durable",
    };
  }
  if (message.role === "user") {
    return {
      audience: ["model", "user"],
      origin: "user",
      persistence: "durable",
    };
  }
  if (message.role === "agent") {
    return {
      audience: ["model", "user", "audit"],
      origin: "runtime",
      persistence: "durable",
    };
  }
  return {
    audience: ["user", "audit"],
    origin: "platform",
    persistence: "durable",
  };
}

export function isModelContextEntry(
  message: RuntimeConversationMessage,
): boolean {
  return conversationEntryMeta(message).audience.includes("model");
}
