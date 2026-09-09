import type Database from "better-sqlite3";
import { getDbConnection } from "./db";

/**
 * Desktop-owned, per-session store for the working folder the user links to a
 * conversation (issue #27). The folder is a desktop-only UI binding — the agent
 * receives it per message as a context-folder system message — so it isn't part
 * of hermes-agent's session schema. Persisting it here lets a re-opened session
 * restore its linked folder instead of losing it when the app restarts.
 *
 * Mirrors the [[src/main/session-continuation-store.ts]] pattern: a desktop
 * table in the active profile's state.db, keyed by `session_id`.
 */
const TABLE = "desktop_session_context_folders";

export interface SessionContextWorkspace {
  /** Opaque id for new records; legacy records have only legacyPath. */
  workspaceId?: string;
  /** Safe renderer-facing label. */
  name: string;
  /** Present only for a pre-capability record that has not been edited. */
  legacyPath?: string;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      session_id TEXT PRIMARY KEY,
      folder_path TEXT NOT NULL,
      updated_at REAL NOT NULL DEFAULT (strftime('%s', 'now'))
    );
  `);
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${TABLE})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("workspace_id")) {
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN workspace_id TEXT`);
  }
  if (!columns.has("folder_name")) {
    db.exec(`ALTER TABLE ${TABLE} ADD COLUMN folder_name TEXT`);
  }
}

function tableExists(db: Database.Database): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(TABLE) as { name: string } | undefined;
  return !!row;
}

/**
 * Persist (or clear) the folder linked to a session. A null/empty folder
 * removes the row so an unlinked session doesn't restore a stale path.
 */
export function setSessionContextFolder(
  sessionId: string,
  folder: string | null,
): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);

  if (!folder) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
    return;
  }

  db.prepare(
    `INSERT INTO ${TABLE} (session_id, folder_path, workspace_id, folder_name, updated_at)
     VALUES (?, ?, NULL, NULL, strftime('%s', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET
       folder_path = excluded.folder_path,
       workspace_id = NULL,
       folder_name = NULL,
       updated_at = excluded.updated_at`,
  ).run(sessionId, folder);
}

/** Store an opaque project reference without persisting its local path. */
export function setSessionContextWorkspace(
  sessionId: string,
  workspace: Pick<SessionContextWorkspace, "workspaceId" | "name"> | null,
): void {
  if (!sessionId) return;
  const db = getDbConnection(false);
  if (!db) return;
  ensureTable(db);
  if (!workspace?.workspaceId || !workspace.name.trim()) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
    return;
  }
  db.prepare(
    `INSERT INTO ${TABLE} (session_id, folder_path, workspace_id, folder_name, updated_at)
     VALUES (?, '', ?, ?, strftime('%s', 'now'))
     ON CONFLICT(session_id) DO UPDATE SET
       folder_path = '',
       workspace_id = excluded.workspace_id,
       folder_name = excluded.folder_name,
       updated_at = excluded.updated_at`,
  ).run(sessionId, workspace.workspaceId, workspace.name.trim().slice(0, 160));
}

/** Unlinks every native session from a removed project without deleting chats. */
export function clearSessionContextFolderPath(folder: string): number {
  if (!folder) return 0;
  const db = getDbConnection(false);
  if (!db) return 0;
  ensureTable(db);
  return db
    .prepare(`DELETE FROM ${TABLE} WHERE folder_path = ?`)
    .run(folder).changes;
}

/** Unlinks every native session from a removed opaque project capability. */
export function clearSessionContextWorkspaceId(workspaceId: string): number {
  if (!workspaceId) return 0;
  const db = getDbConnection(false);
  if (!db) return 0;
  ensureTable(db);
  return db
    .prepare(`DELETE FROM ${TABLE} WHERE workspace_id = ?`)
    .run(workspaceId).changes;
}

/** Read the folder linked to a session, or null when none is stored. */
export function getSessionContextFolder(sessionId: string): string | null {
  if (!sessionId) return null;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return null;
  const row = db
    .prepare(`SELECT folder_path FROM ${TABLE} WHERE session_id = ?`)
    .get(sessionId) as { folder_path: string } | undefined;
  return row?.folder_path || null;
}

/** Read either a new opaque reference or an untouched legacy path binding. */
export function getSessionContextWorkspace(
  sessionId: string,
): SessionContextWorkspace | null {
  if (!sessionId) return null;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return null;
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${TABLE})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("workspace_id") || !columns.has("folder_name")) {
    const legacyPath = getSessionContextFolder(sessionId);
    return legacyPath ? { name: legacyPath, legacyPath } : null;
  }
  const row = db
    .prepare(
      `SELECT folder_path, workspace_id, folder_name FROM ${TABLE} WHERE session_id = ?`,
    )
    .get(sessionId) as
    | { folder_path?: string; workspace_id?: string; folder_name?: string }
    | undefined;
  if (!row) return null;
  if (row.workspace_id && row.folder_name) {
    return { workspaceId: row.workspace_id, name: row.folder_name };
  }
  return row.folder_path ? { name: row.folder_path, legacyPath: row.folder_path } : null;
}

/**
 * Batch-read the folders linked to many sessions in a single pass: one
 * `tableExists` check and one chunked `IN (...)` query instead of two queries
 * per session. Used by the session cache so attaching folders to a full page
 * of rows stays a couple of queries rather than O(N). Sessions with no linked
 * folder are simply absent from the returned map.
 */
export function getSessionContextFolders(
  sessionIds: string[],
): Map<string, string> {
  const contexts = getSessionContextWorkspaces(sessionIds);
  const result = new Map<string, string>();
  for (const [sessionId, context] of contexts) {
    // This legacy helper intentionally omits capability-backed records so a
    // caller cannot accidentally treat their display label as an openable path.
    if (context.legacyPath) result.set(sessionId, context.legacyPath);
  }
  return result;
}

/** Batch-read renderer-safe workspace bindings for session-cache consumers. */
export function getSessionContextWorkspaces(
  sessionIds: string[],
): Map<string, SessionContextWorkspace> {
  const result = new Map<string, SessionContextWorkspace>();
  if (sessionIds.length === 0) return result;
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return result;

  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${TABLE})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  const hasCapabilities =
    columns.has("workspace_id") && columns.has("folder_name");

  // Chunk well under SQLITE_MAX_VARIABLE_NUMBER for portability, matching the
  // batching used elsewhere in the session cache.
  const CHUNK = 500;
  for (let i = 0; i < sessionIds.length; i += CHUNK) {
    const chunk = sessionIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT session_id, folder_path${hasCapabilities ? ", workspace_id, folder_name" : ""}
         FROM ${TABLE} WHERE session_id IN (${placeholders})`,
      )
      .all(...chunk) as Array<{
      session_id: string;
      folder_path: string;
      workspace_id?: string | null;
      folder_name?: string | null;
    }>;
    for (const r of rows) {
      if (r.workspace_id && r.folder_name) {
        result.set(r.session_id, {
          workspaceId: r.workspace_id,
          name: r.folder_name,
        });
      } else if (r.folder_path) {
        result.set(r.session_id, {
          name: r.folder_path,
          legacyPath: r.folder_path,
        });
      }
    }
  }
  return result;
}

/**
 * Drop a session's linked-folder row. Called from `deleteSessionRows` so it
 * runs inside the same delete transaction as the other per-session cleanup.
 */
export function deleteSessionContextFolderForSession(
  db: Database.Database,
  sessionId: string,
): void {
  if (tableExists(db)) {
    db.prepare(`DELETE FROM ${TABLE} WHERE session_id = ?`).run(sessionId);
  }
}

/** Get recent distinct context folder paths ordered by most recently updated. */
export function getRecentSessionContextFolders(limit = 20): string[] {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  // GROUP BY (not DISTINCT) so each folder appears once ordered by its most
  // recent use. A `DISTINCT folder_path ... ORDER BY updated_at` collapses the
  // duplicates but then orders by an arbitrary one of each path's rows, so a
  // folder reused recently could sort as if it were old.
  const rows = db
    .prepare(
      `SELECT folder_path FROM ${TABLE} WHERE folder_path IS NOT NULL AND folder_path != '' GROUP BY folder_path ORDER BY MAX(updated_at) DESC LIMIT ?`,
    )
    .all(limit) as Array<{ folder_path: string }>;
  return rows.map((r) => r.folder_path);
}

/** Recent opaque workspace bindings, ordered by last use, for Renderer menus. */
export function getRecentSessionContextWorkspaces(
  limit = 20,
): Array<Required<Pick<SessionContextWorkspace, "workspaceId" | "name">>> {
  const db = getDbConnection(true);
  if (!db || !tableExists(db)) return [];
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${TABLE})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("workspace_id") || !columns.has("folder_name")) return [];
  const rows = db
    .prepare(
      `SELECT workspace_id, folder_name, MAX(updated_at) AS last_used
       FROM ${TABLE}
       WHERE workspace_id IS NOT NULL AND workspace_id != ''
         AND folder_name IS NOT NULL AND folder_name != ''
       GROUP BY workspace_id, folder_name
       ORDER BY last_used DESC LIMIT ?`,
    )
    .all(limit) as Array<{ workspace_id: string; folder_name: string }>;
  return rows.map((row) => ({
    workspaceId: row.workspace_id,
    name: row.folder_name,
  }));
}
