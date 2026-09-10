import Database from "./sqlite";
import type BetterDatabase from "better-sqlite3";
import { dirname } from "path";
import { existsSync, mkdirSync } from "fs";
import { activeStateDbPath } from "./utils";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";

let cachedDb: BetterDatabase.Database | null = null;
let cachedDbPath: string | null = null;
let cachedDbReadonly: boolean | null = null;

/**
 * Return a cached database connection for the active profile state DB.
 * If the active profile database path or readonly status changes,
 * the old database connection is cleanly closed and a new one is established.
 */
export function getDbConnection(
  readonly = true,
): BetterDatabase.Database | null {
  if (!readonly) assertAgentsOneWritesAllowed();
  const dbPath = activeStateDbPath();
  if (!existsSync(dbPath)) {
    if (readonly) {
      closeDbConnection();
      return null;
    }
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch (err) {
      console.error(
        `[db] Failed to create database directory for ${dbPath}:`,
        err,
      );
      closeDbConnection();
      return null;
    }
  }

  // Reuse the existing cached connection if the path and mode match
  if (cachedDb && cachedDbPath === dbPath && cachedDbReadonly === readonly) {
    return cachedDb;
  }

  closeDbConnection();

  try {
    cachedDb = new Database(dbPath, readonly ? { readonly: true } : {});
    cachedDbPath = dbPath;
    cachedDbReadonly = readonly;
    return cachedDb;
  } catch (err) {
    console.error(`[db] Failed to open database at ${dbPath}:`, err);
    return null;
  }
}

/**
 * Close the cached database connection if open.
 */
export function closeDbConnection(): void {
  if (cachedDb) {
    try {
      cachedDb.close();
    } catch (err) {
      console.error("[db] Error closing database connection:", err);
    }
    cachedDb = null;
    cachedDbPath = null;
    cachedDbReadonly = null;
  }
}
