import {
  conversationEntryMeta,
  type RuntimeConversation,
  type QuickChatConversation,
} from "../../shared/runtime-conversations";
import type { TaskCollaborationRecord } from "../../shared/task-collaboration";
import { redactSensitiveText } from "../../shared/redaction";

export type Json = Record<string, unknown>;
export interface SourceMessage {
  id: string;
  kind: "user" | "assistant" | "control" | "tool_summary" | "error";
  content: string;
  createdAt: number;
  runtimeId?: string;
  runId?: string;
}
export interface SourceConversation {
  id: string;
  sourceKind:
    | "runtime_conversation"
    | "quick_chat"
    | "native_session"
    | "collaboration";
  title: string;
  runtimeId: string;
  runtimeName: string;
  runtimeAvatar?: string | null;
  projectId?: string;
  revision?: string;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  activeRunIds: string[];
  messages: SourceMessage[];
  manageable: boolean;
  restrictionReason?: "requires_owner_action" | "unsupported_source";
  /** Internal ancestry evidence; never included in the public Conversation projection. */
  parentConversationId?: string;
}
/** Only platform-generated summaries are redacted; user/assistant body remains original. */
export function publicPlatformText(value: string): string {
  return redactSensitiveText(value)
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"'<>]+/g, "[local path]")
    .replace(
      /\/(?:Users|home|tmp|var|etc|private|mnt|opt|root)\/[^\s"'<>]+/g,
      "[local path]",
    );
}

/** Excerpts only messages already admitted by the original source projection. */
export function publicConversationPreview(
  messages: readonly { content: string }[],
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    let preview = "",
      count = 0,
      whitespace = false;
    for (const character of messages[index].content) {
      if (/\s/u.test(character)) {
        whitespace = true;
        continue;
      }
      if (whitespace && preview) {
        if (count === 120) break;
        preview += " ";
        count++;
      }
      if (count === 120) break;
      preview += character;
      count++;
      whitespace = false;
    }
    if (preview) return preview.trimEnd();
  }
  return null;
}
export function projectRuntimeConversation(
  value: RuntimeConversation,
  projectId = value.workspaceId,
): SourceConversation {
  return {
    id: value.id,
    sourceKind: "runtime_conversation",
    title: value.title,
    runtimeId: value.runtimeId,
    runtimeName: value.runtimeName,
    runtimeAvatar: value.runtimeAvatar,
    projectId,
    revision: value.revision ?? "1",
    pinned: value.pinned === true,
    archived: value.archived === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    activeRunIds: value.activeRuntimeRunId ? [value.activeRuntimeRunId] : [],
    manageable: true,
    ...(value.branch?.parentConversationId
      ? { parentConversationId: value.branch.parentConversationId }
      : {}),
    messages: value.messages
      .filter(
        (message) =>
          conversationEntryMeta(message).audience.includes("user") &&
          conversationEntryMeta(message).persistence === "durable",
      )
      .map((message) => ({
        id: message.id,
        kind:
          message.role === "user"
            ? "user"
            : message.role === "agent"
              ? "assistant"
              : "control",
        content:
          message.role === "system"
            ? publicPlatformText(message.content)
            : message.content,
        createdAt: message.createdAt,
        runtimeId: message.agentRuntimeId ?? value.runtimeId,
        ...(message.execution?.runId ? { runId: message.execution.runId } : {}),
      })),
  };
}
export function projectQuickChat(
  value: QuickChatConversation,
): SourceConversation {
  return {
    id: value.id,
    sourceKind: "quick_chat",
    title: value.title,
    runtimeId: value.runtimeId,
    runtimeName: value.runtimeName,
    revision: value.revision ?? "1",
    pinned: value.pinned === true,
    archived: value.archived === true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    activeRunIds: [],
    manageable: true,
    messages: value.messages.map((message) => ({
      id: message.id,
      kind:
        message.role === "user"
          ? "user"
          : message.role === "agent"
            ? "assistant"
            : "control",
      content:
        message.role === "system"
          ? publicPlatformText(message.content)
          : message.content,
      createdAt: message.createdAt,
      runtimeId: value.runtimeId,
    })),
  };
}
export function projectCollaboration(
  value: TaskCollaborationRecord,
  linked?: SourceConversation,
): SourceConversation {
  if (linked)
    return {
      ...linked,
      revision: undefined,
      updatedAt: Math.max(
        linked.updatedAt,
        value.updatedAt,
        value.execution?.updatedAt ?? 0,
      ),
      activeRunIds: [
        ...new Set([
          ...linked.activeRunIds,
          ...(value.execution?.roleRuns
            .filter((run) => run.status === "running" && run.runtimeRunId)
            .map((run) => run.runtimeRunId!) ?? []),
        ]),
      ],
      sourceKind: "collaboration",
      manageable: false,
      restrictionReason: "requires_owner_action",
    };
  return {
    id: value.taskId,
    sourceKind: "collaboration",
    title: value.title,
    runtimeId:
      value.sourceRuntimeId ??
      value.assignments.find((assignment) => assignment.runtimeId)?.runtimeId ??
      "unavailable-runtime",
    runtimeName: "Collaboration",
    projectId: value.projectWorkspaceId,
    pinned: false,
    archived: false,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    activeRunIds:
      value.execution?.roleRuns
        .filter((run) => run.status === "running" && run.runtimeRunId)
        .map((run) => run.runtimeRunId!) ?? [],
    manageable: false,
    restrictionReason: "requires_owner_action",
    messages: (value.execution?.timeline ?? []).map((event) => ({
      id: event.id,
      kind: "control",
      content: publicPlatformText(
        [event.label, event.detail].filter(Boolean).join("\n"),
      ),
      createdAt: event.createdAt,
    })),
  };
}
export interface ConversationRepository {
  list(): SourceConversation[];
  patch(
    id: string,
    patch: {
      title?: string;
      pinned?: boolean;
      archived?: boolean;
      projectId?: string | null;
    },
    revision: string,
  ): SourceConversation;
}
