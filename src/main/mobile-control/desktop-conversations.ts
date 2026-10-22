import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import Database from "../sqlite";
import type BetterDatabase from "better-sqlite3";
import { agentsOneProfileHome, profileHome as hermesProfileHome } from "../utils";
import {
  listFullRuntimeConversations,
  listQuickChats,
  patchQuickChat,
  patchRuntimeConversation,
} from "../runtime-conversation-store";
import { listTaskCollaborations } from "../task-collaboration-store";
import { projectFolderIdForPath } from "../project-folders";
import {
  expandRowsToHistory,
  type RawMessageRow,
  type HistoryItem,
} from "../sessions";
import {
  continuationItemsToHistory,
  loadSessionContinuationItems,
  loadSessionLocalErrors,
  mergeSessionContinuationWithCanonical,
  mergeSessionLocalErrors,
  normalizeContinuationItems,
} from "../session-continuation-store";
import { isAutomationSessionSource } from "../../shared/session-list";
import {
  projectCollaboration,
  projectQuickChat,
  projectRuntimeConversation,
  publicPlatformText,
  type ConversationRepository,
  type Json,
  type SourceConversation,
  type SourceMessage,
} from "./conversation-projection";

function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : {};
}
function readCollection(file: string, key: string): unknown[] {
  if (!existsSync(file)) return [];
  try {
    const value = record(JSON.parse(readFileSync(file, "utf8")));
    if (!Array.isArray(value[key])) throw Error();
    return value[key] as unknown[];
  } catch {
    return fail("requires_owner_action");
  }
}
interface Project {
  id: string;
  name: string;
  path: string;
}
function projectPathKey(value: string): string {
  const path = normalize(value);
  return process.platform === "win32" ? path.toLowerCase() : path;
}
function projectMessages(
  items: HistoryItem[],
  fallbackTimestamp: number,
): SourceMessage[] {
  // tool_call uses its assistant's ID; exporting it would duplicate the original ID and expose arguments.
  return items
    .filter((item) => ["user", "assistant", "tool_result"].includes(item.kind))
    .map((item) => {
      if (
        item.kind !== "user" &&
        item.kind !== "assistant" &&
        item.kind !== "tool_result"
      )
        throw Error("unexpected_message");
      return {
        id: String(item.id),
        kind:
          item.kind === "tool_result"
            ? "tool_summary"
            : item.kind === "assistant" && item.error
              ? "error"
              : item.kind,
        content:
          item.kind === "tool_result"
            ? publicPlatformText(`Tool result: ${item.name}`)
            : item.kind === "assistant" && item.error
              ? publicPlatformText(item.error)
              : item.content,
        createdAt: Number.isFinite(new Date(item.timestamp * 1000).getTime())
          ? item.timestamp * 1000
          : fallbackTimestamp,
        runtimeId: "hermes-local",
      };
    });
}
/** Profile-bound reads never borrow the active-profile connection or caches. */
export class DesktopConversationRepository implements ConversationRepository {
  readonly home: string;
  constructor(readonly profile: string) {
    this.home = agentsOneProfileHome(profile);
  }
  projects(): Project[] {
    return readCollection(
      join(this.home, "desktop", "project-folders.json"),
      "folders",
    ).flatMap((raw) => {
      const value = record(raw);
      if (typeof value.path !== "string" || typeof value.name !== "string")
        return [];
      return [
        {
          id:
            typeof value.id === "string"
              ? value.id
              : projectFolderIdForPath(value.path),
          name: value.name,
          path: value.path,
        },
      ];
    });
  }
  private native(projects: Project[]): SourceConversation[] {
    const file = join(hermesProfileHome(this.profile), "state.db");
    const desktopFile = join(this.home, "desktop.db");
    const cache = new Map(
      readCollection(
        join(this.home, "desktop", "sessions.json"),
        "sessions",
      ).map((raw) => {
        const value = record(raw);
        return [String(value.id), value] as const;
      }),
    );
    const overlayFile = join(this.home, "desktop", "session-overlays.json");
    let overlays: Json = {};
    if (existsSync(overlayFile)) {
      try {
        overlays = record(
          record(JSON.parse(readFileSync(overlayFile, "utf8"))).sessions,
        );
      } catch {
        return fail("requires_owner_action");
      }
    }
    let db: BetterDatabase.Database | undefined = existsSync(file)
      ? new Database(file, { readonly: true })
      : undefined;
    const desktopDb = existsSync(desktopFile)
      ? new Database(desktopFile, { readonly: true })
      : undefined;
    try {
      // Native Hermes history is optional; app-owned overlays have a separate DB.
      if (
        db &&
        !db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get()
      ) {
        db.close();
        db = undefined;
      }
      const read = (): SourceConversation[] => {
        const rows = db
          ? (db
              .prepare(
                "SELECT id, source, started_at, ended_at, title FROM sessions ORDER BY started_at, id",
              )
              .all() as Array<{
              id: string;
              source: string;
              started_at: number;
              ended_at: number | null;
              title: string | null;
            }>)
          : [];
        const contexts = new Map<string, Json>();
        if (
          desktopDb
            ?.prepare(
              "SELECT name FROM sqlite_master WHERE name = 'desktop_session_context_folders'",
            )
            .get()
        ) {
          for (const raw of desktopDb
            .prepare("SELECT * FROM desktop_session_context_folders")
            .all()) {
            const row = record(raw);
            contexts.set(String(row.session_id), row);
          }
        }
        const byId = new Map(
          rows
            .filter((row) => !isAutomationSessionSource(row.source))
            .map((row) => [row.id, row]),
        );
        for (const [id, value] of cache)
          if (
            !byId.has(id) &&
            !isAutomationSessionSource(String(value.source)) &&
            Object.hasOwn(overlays, id)
          )
            byId.set(id, {
              id,
              source: String(value.source),
              started_at: Number(value.startedAt) || 0,
              ended_at: null,
              title: typeof value.title === "string" ? value.title : null,
            });
        return [...byId.values()].map((row) => {
          const raw = db
            ? (db
                .prepare(
                  "SELECT id, role, content, timestamp, tool_name FROM messages WHERE session_id = ? AND role IN ('user', 'assistant', 'tool') ORDER BY timestamp, id",
                )
                .all(row.id) as Array<
                Pick<
                  RawMessageRow,
                  "id" | "role" | "content" | "timestamp" | "tool_name"
                >
              >)
            : [];
          const canonical = expandRowsToHistory(
            raw.map((message) => ({
              ...message,
              tool_call_id: null,
              tool_calls: null,
              reasoning: null,
              reasoning_content: null,
              reasoning_details: null,
            })),
          );
          const prefix = desktopDb ? loadSessionContinuationItems(desktopDb, row.id) : [];
          const continuation = prefix.length
            ? prefix
            : continuationItemsToHistory(
                normalizeContinuationItems(overlays[row.id]),
              );
          const timeline = mergeSessionContinuationWithCanonical(
            continuation,
            canonical,
          );
          const messages = projectMessages(
            desktopDb
              ? mergeSessionLocalErrors(
                  timeline,
                  loadSessionLocalErrors(desktopDb, row.id),
                )
              : timeline,
            Math.max(
              row.started_at * 1000,
              ...canonical.map((item) => item.timestamp * 1000),
            ),
          );
          const context = contexts.get(row.id),
            cached = cache.get(row.id);
          const legacyPath =
            typeof context?.folder_path === "string" && context.folder_path
              ? context.folder_path
              : typeof cached?.contextFolder === "string"
                ? cached.contextFolder
                : undefined;
          const projectId =
            typeof context?.workspace_id === "string"
              ? context.workspace_id
              : typeof cached?.contextWorkspaceId === "string"
                ? cached.contextWorkspaceId
                : projects.find(
                    (project) =>
                      legacyPath &&
                      projectPathKey(project.path) ===
                        projectPathKey(legacyPath),
                  )?.id;
          return {
            id: row.id,
            sourceKind: "native_session",
            runtimeId: "hermes-local",
            runtimeName: "Hermes Agent",
            title: row.title?.trim() || String(cached?.title || "Conversation"),
            projectId,
            pinned: false,
            archived: false,
            createdAt: row.started_at * 1000,
            updatedAt: Math.max(
              row.started_at * 1000,
              row.ended_at ? row.ended_at * 1000 : 0,
              ...messages.map((message) => message.createdAt),
            ),
            activeRunIds: [],
            messages,
            manageable: false,
            restrictionReason: "requires_owner_action",
          };
        });
      };
      return db ? db.transaction(read)() : read();
    } finally {
      db?.close();
      desktopDb?.close();
    }
  }
  list(): SourceConversation[] {
    // Validate the original shape before using legacy readers that deliberately tolerate corruption in the desktop UI.
    readCollection(
      join(this.home, "desktop", "runtime-conversations.json"),
      "conversations",
    );
    readCollection(join(this.home, "desktop", "quick-chats.json"), "chats");
    readCollection(
      join(this.home, "desktop", "task-collaborations.json"),
      "records",
    );
    const projects = this.projects();
    const runtime = listFullRuntimeConversations(this.profile);
    const all = runtime.map((value) =>
      projectRuntimeConversation(
        value,
        value.workspaceId ??
          projects.find(
            (project) =>
              value.workspace &&
              projectPathKey(value.workspace) === projectPathKey(project.path),
          )?.id,
      ),
    );
    all.push(
      ...listQuickChats(this.profile, { fullHistory: true }).map(
        projectQuickChat,
      ),
    );
    const linkedNative = new Set(
      runtime
        .filter(
          (value) =>
            value.runtimeId === "hermes-local" ||
            value.runtimeKind === "hermes",
        )
        .map((value) => value.runtimeSessionId)
        .filter(Boolean),
    );
    all.push(
      ...this.native(projects).filter((value) => !linkedNative.has(value.id)),
    );
    const byId = new Map<string, SourceConversation>();
    for (const value of all) {
      if (byId.has(value.id)) fail("requires_owner_action");
      byId.set(value.id, value);
    }
    for (const collaboration of listTaskCollaborations(this.profile)) {
      const explicitId = collaboration.conversationId ?? collaboration.sourceSessionId;
      const legacy = !collaboration.conversationId ? byId.get(collaboration.taskId) : undefined;
      const legacySessionMatches = !collaboration.sourceSessionId || runtime.some(
        (row) => row.id === collaboration.taskId && row.runtimeSessionId === collaboration.sourceSessionId,
      );
      const linked = byId.get(
        explicitId ?? "",
      ) ?? (
        legacy?.sourceKind === "runtime_conversation" &&
        legacy.runtimeId === collaboration.sourceRuntimeId &&
        legacySessionMatches
          ? legacy
          : undefined
      );
      const value = projectCollaboration(collaboration, linked);
      if (!linked && byId.has(value.id)) fail("requires_owner_action");
      byId.set(value.id, value);
    }
    return [...byId.values()];
  }
  patch(
    id: string,
    patch: Parameters<ConversationRepository["patch"]>[1],
    revision: string,
  ): SourceConversation {
    const value = this.list().find((item) => item.id === id);
    if (!value) fail("resource_not_found", 404);
    if (!value.manageable) fail("requires_owner_action", 403);
    if (
      patch.projectId &&
      !this.projects().some((project) => project.id === patch.projectId)
    )
      fail("resource_not_found", 404);
    const { projectId, ...fields } = patch;
    const update = {
      ...fields,
      ...(Object.hasOwn(patch, "projectId") ? { workspaceId: projectId } : {}),
    };
    if (value.sourceKind === "quick_chat")
      return projectQuickChat(
        patchQuickChat(id, update, revision, this.profile),
      );
    return projectRuntimeConversation(
      patchRuntimeConversation(id, update, revision, this.profile),
    );
  }
}
