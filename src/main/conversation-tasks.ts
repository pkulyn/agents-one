import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import { listTaskCenterTasks } from "./task-center";
import type { ConversationTaskLink } from "../shared/conversation-tasks";
import type { TaskCenterTask } from "../shared/task-center";

const STORE_VERSION = 1;
const MAX_LINKS = 1_000;

interface ConversationTaskStore {
  version: number;
  links: ConversationTaskLink[];
}

function storePath(): string {
  return join(
    profileHome(getActiveProfileNameSync()),
    "desktop",
    "conversation-tasks.json",
  );
}

function isLink(value: unknown): value is ConversationTaskLink {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ConversationTaskLink;
  return (
    typeof candidate.conversationId === "string" &&
    Boolean(candidate.conversationId.trim()) &&
    typeof candidate.taskId === "string" &&
    Boolean(candidate.taskId.trim()) &&
    typeof candidate.createdAt === "number"
  );
}

function readStore(): ConversationTaskStore {
  try {
    if (!existsSync(storePath())) return { version: STORE_VERSION, links: [] };
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    const links =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ConversationTaskStore).links)
        ? (parsed as ConversationTaskStore).links.filter(isLink)
        : [];
    return { version: STORE_VERSION, links };
  } catch {
    return { version: STORE_VERSION, links: [] };
  }
}

function writeStore(links: ConversationTaskLink[]): void {
  safeWriteFile(
    storePath(),
    JSON.stringify({
      version: STORE_VERSION,
      links: links.slice(0, MAX_LINKS),
    } satisfies ConversationTaskStore),
  );
}

function normalizedId(value: string, label: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > 256) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

export function linkConversationTask(
  conversationId: string,
  taskId: string,
): ConversationTaskLink {
  const normalizedConversationId = normalizedId(conversationId, "Conversation id");
  const normalizedTaskId = normalizedId(taskId, "Task id");
  const store = readStore();
  const existing = store.links.find(
    (link) =>
      link.conversationId === normalizedConversationId &&
      link.taskId === normalizedTaskId,
  );
  if (existing) return existing;

  const link: ConversationTaskLink = {
    conversationId: normalizedConversationId,
    taskId: normalizedTaskId,
    createdAt: Date.now(),
  };
  writeStore([link, ...store.links]);
  return link;
}

export function unlinkConversationTask(
  conversationId: string,
  taskId: string,
): boolean {
  const normalizedConversationId = normalizedId(conversationId, "Conversation id");
  const normalizedTaskId = normalizedId(taskId, "Task id");
  const store = readStore();
  const links = store.links.filter(
    (link) =>
      link.conversationId !== normalizedConversationId ||
      link.taskId !== normalizedTaskId,
  );
  if (links.length === store.links.length) return false;
  writeStore(links);
  return true;
}

export function listConversationTaskLinks(
  conversationId: string,
): ConversationTaskLink[] {
  const normalizedConversationId = normalizedId(conversationId, "Conversation id");
  return readStore().links.filter(
    (link) => link.conversationId === normalizedConversationId,
  );
}

export async function listConversationTasks(
  conversationId: string,
): Promise<TaskCenterTask[]> {
  const links = listConversationTaskLinks(conversationId);
  if (!links.length) return [];
  const order = new Map(links.map((link, index) => [link.taskId, index]));
  const tasks = await listTaskCenterTasks();
  return tasks
    .filter((task) => order.has(task.id))
    .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}
