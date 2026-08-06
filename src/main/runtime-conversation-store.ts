import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import type {
  AgentRuntimeEvent,
  AgentRuntimeEventType,
} from "../shared/agent-runtimes";
import type {
  RuntimeConversation,
  RuntimeConversationMessage,
  RuntimeConversationSummary,
  SaveRuntimeConversationInput,
} from "../shared/runtime-conversations";

interface RuntimeConversationData {
  conversations: RuntimeConversation[];
}

const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 200_000;
const MAX_MESSAGES = 500;
const MAX_EXECUTION_EVENTS = 80;
const MAX_EVENT_SUMMARY_LENGTH = 800;
const MAX_AVATAR_DATA_URL_LENGTH = 700_000;
const MAX_WORKSPACE_LENGTH = 4096;
const RUNTIME_EVENT_TYPES = new Set<AgentRuntimeEventType>([
  "queued",
  "started",
  "progress",
  "tool_call",
  "tool_result",
  "message",
  "artifact_published",
  "error",
  "completed",
  "cancelled",
  "timed_out",
]);

function storeFilePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "desktop",
    "runtime-conversations.json",
  );
}

function readStore(profile?: string): RuntimeConversationData {
  const file = storeFilePath(profile);
  try {
    if (!existsSync(file)) return { conversations: [] };
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as {
      conversations?: unknown;
    };
    return {
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations
            .map(normalizeConversation)
            .filter((item): item is RuntimeConversation => Boolean(item))
        : [],
    };
  } catch {
    return { conversations: [] };
  }
}

function writeStore(
  profile: string | undefined,
  data: RuntimeConversationData,
): void {
  safeWriteFile(storeFilePath(profile), JSON.stringify(data));
}

function cleanText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function cleanRuntimeColor(value: unknown): string | undefined {
  const color = cleanText(value);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
}

function cleanRuntimeAvatar(value: unknown): string | null | undefined {
  if (value === null) return null;
  const avatar = cleanText(value);
  if (!avatar) return undefined;
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(avatar) &&
    avatar.length <= MAX_AVATAR_DATA_URL_LENGTH
    ? avatar
    : undefined;
}

function cleanRuntimeEvent(value: unknown): AgentRuntimeEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AgentRuntimeEvent>;
  if (!record.type || !RUNTIME_EVENT_TYPES.has(record.type)) return null;
  const summary = cleanText(record.summary).slice(0, MAX_EVENT_SUMMARY_LENGTH);
  if (!summary) return null;
  const tool =
    record.tool && typeof record.tool === "object"
      ? record.tool
      : undefined;
  return {
    id: cleanText(record.id, `event-${Date.now()}`),
    type: record.type,
    summary,
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
    ...(cleanText(record.detail) ? { detail: cleanText(record.detail) } : {}),
    ...(cleanText(record.code) ? { code: cleanText(record.code) } : {}),
    ...(tool ? { tool } : {}),
  };
}

function cleanExecution(
  value: unknown,
): RuntimeConversationMessage["execution"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as NonNullable<RuntimeConversationMessage["execution"]>;
  const runId = cleanText(record?.runId);
  const events = Array.isArray(record?.events)
    ? record.events
        .map(cleanRuntimeEvent)
        .filter((item): item is AgentRuntimeEvent => Boolean(item))
        .slice(-MAX_EXECUTION_EVENTS)
    : [];
  if (!runId) return undefined;
  const artifacts = Array.isArray(record?.artifacts)
    ? record.artifacts.filter(
        (artifact) => Boolean(artifact && artifact.label.trim()),
      )
    : [];
  if (
    events.length === 0 &&
    artifacts.length === 0 &&
    !record.model &&
    !record.usage
  ) {
    return undefined;
  }
  return {
    runId,
    events,
    ...(artifacts.length ? { artifacts } : {}),
    ...(record.model ? { model: record.model } : {}),
    ...(record.usage ? { usage: record.usage } : {}),
  };
}

function cleanMessage(value: unknown): RuntimeConversationMessage | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RuntimeConversationMessage>;
  const role =
    record.role === "user" ||
    record.role === "agent" ||
    record.role === "system"
      ? record.role
      : null;
  const content = typeof record.content === "string" ? record.content : "";
  if (!role || !content) return null;
  const message: RuntimeConversationMessage = {
    id: cleanText(record.id, `msg-${Date.now()}`),
    role,
    content: content.slice(0, MAX_MESSAGE_LENGTH),
    createdAt:
      typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
        ? record.createdAt
        : Date.now(),
  };
  // Collaboration replies need their original runtime identity after a restart.
  // Do not reconstruct this from the parent conversation's runtime: one task
  // can contain turns from several independently configured agents.
  const agentRuntimeId = cleanText(record.agentRuntimeId);
  const agentName = cleanText(record.agentName);
  const agentAvatar = cleanText(record.agentAvatar, "");
  const agentColor = cleanText(record.agentColor);
  const collaborationRole = cleanText(record.collaborationRole);
  const collaborationAssignmentId = cleanText(record.collaborationAssignmentId);
  if (agentRuntimeId) message.agentRuntimeId = agentRuntimeId;
  if (agentName) message.agentName = agentName;
  if (agentAvatar) message.agentAvatar = agentAvatar;
  if (agentColor) message.agentColor = agentColor;
  if (collaborationRole) message.collaborationRole = collaborationRole;
  if (collaborationAssignmentId) message.collaborationAssignmentId = collaborationAssignmentId;
  const execution = cleanExecution(record.execution);
  if (execution) message.execution = execution;
  return message;
}

function normalizeConversation(value: unknown): RuntimeConversation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<RuntimeConversation>;
  const id = cleanText(record.id);
  const runtimeId = cleanText(record.runtimeId);
  const runtimeName = cleanText(record.runtimeName, runtimeId);
  const runtimeKind = record.runtimeKind;
  if (
    !id ||
    !runtimeId ||
    !runtimeName ||
    !(
      runtimeKind === "hermes" ||
      runtimeKind === "openclaw" ||
      runtimeKind === "codex" ||
      runtimeKind === "claude-code" ||
      runtimeKind === "pi"
    )
  ) {
    return null;
  }
  const messages = Array.isArray(record.messages)
    ? record.messages
        .map(cleanMessage)
        .filter((item): item is RuntimeConversationMessage => Boolean(item))
        .slice(-MAX_MESSAGES)
    : [];
  const now = Date.now();
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : messages[0]?.createdAt || now;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : messages.at(-1)?.createdAt || createdAt;
  return {
    id,
    title:
      cleanText(record.title, titleFromMessages(messages)).slice(
        0,
        MAX_TITLE_LENGTH,
      ) || runtimeName,
    createdAt,
    updatedAt,
    runtimeId,
    runtimeName,
    runtimeKind,
    runtimeLocation: record.runtimeLocation === "local" ? "local" : "remote",
    runtimeColor: cleanRuntimeColor(record.runtimeColor),
    runtimeAvatar: cleanRuntimeAvatar(record.runtimeAvatar),
    runtimeSessionId: cleanText(record.runtimeSessionId) || undefined,
    workspace: cleanText(record.workspace).slice(0, MAX_WORKSPACE_LENGTH) || undefined,
    messageCount: messages.length,
    messages,
  };
}

function titleFromMessages(messages: RuntimeConversationMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) return "New conversation";
  const text = firstUser.content.replace(/\s+/g, " ").trim();
  return text.length > MAX_TITLE_LENGTH
    ? `${text.slice(0, MAX_TITLE_LENGTH - 3)}...`
    : text;
}

function summaryFromConversation(
  conversation: RuntimeConversation,
): RuntimeConversationSummary {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    runtimeId: conversation.runtimeId,
    runtimeName: conversation.runtimeName,
    runtimeKind: conversation.runtimeKind,
    runtimeLocation: conversation.runtimeLocation,
    runtimeColor: conversation.runtimeColor,
    runtimeAvatar: conversation.runtimeAvatar,
    runtimeSessionId: conversation.runtimeSessionId,
    workspace: conversation.workspace,
    messageCount: conversation.messageCount,
  };
}

export function listRuntimeConversations(
  profile?: string,
  limit = 50,
  offset = 0,
): RuntimeConversationSummary[] {
  return readStore(profile)
    .conversations.sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(offset, offset + limit)
    .map(summaryFromConversation);
}

export function getRuntimeConversation(
  id: string,
  profile?: string,
): RuntimeConversation | null {
  if (!id) return null;
  return (
    readStore(profile).conversations.find((item) => item.id === id) ?? null
  );
}

export function saveRuntimeConversation(
  input: SaveRuntimeConversationInput,
): RuntimeConversation {
  const existing = readStore(input.profile);
  const now = Date.now();
  const messages = input.messages
    .map(cleanMessage)
    .filter((item): item is RuntimeConversationMessage => Boolean(item))
    .slice(-MAX_MESSAGES);
  const previous = existing.conversations.find((item) => item.id === input.id);
  const conversation = normalizeConversation({
    ...previous,
    ...input,
    title: input.title || titleFromMessages(messages),
    createdAt: previous?.createdAt ?? messages[0]?.createdAt ?? now,
    updatedAt: messages.at(-1)?.createdAt ?? now,
    messageCount: messages.length,
    messages,
  });
  if (!conversation) {
    throw new Error("Invalid runtime conversation.");
  }
  const next = [
    conversation,
    ...existing.conversations.filter((item) => item.id !== conversation.id),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  writeStore(input.profile, { conversations: next });
  return conversation;
}

export function updateRuntimeConversationTitle(
  id: string,
  title: string,
  profile?: string,
): void {
  const data = readStore(profile);
  const conversation = data.conversations.find((item) => item.id === id);
  if (!conversation) return;
  conversation.title = cleanText(title, conversation.title).slice(
    0,
    MAX_TITLE_LENGTH,
  );
  conversation.updatedAt = Date.now();
  writeStore(profile, data);
}

export function deleteRuntimeConversation(id: string, profile?: string): void {
  const data = readStore(profile);
  const next = data.conversations.filter((item) => item.id !== id);
  if (next.length !== data.conversations.length) {
    writeStore(profile, { conversations: next });
  }
}
