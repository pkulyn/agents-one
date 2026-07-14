import type { MemoryInfo } from "./memory";
import { remoteRequestJson, type RemoteSessionConfig } from "./remote-sessions";

interface RemoteRecord {
  [key: string]: unknown;
}

const ENTRY_DELIMITER = "\n搂\n";

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseEntries(
  content: string,
): Array<{ index: number; content: string }> {
  if (!content.trim()) return [];
  return content
    .split(ENTRY_DELIMITER)
    .map((entry, index) => ({ index, content: entry.trim() }))
    .filter((entry) => entry.content.length > 0);
}

function normalizeMemoryInfo(response: unknown): MemoryInfo {
  const record = asRecord(response);
  const memory = asRecord(record.memory);
  const user = asRecord(record.user);
  const memoryContent = stringValue(memory.content ?? record.memory_content);
  const userContent = stringValue(user.content ?? record.user_content);
  const stats = asRecord(record.stats);

  return {
    memory: {
      content: memoryContent,
      exists:
        memory.exists !== false && Boolean(memoryContent || memory.exists),
      lastModified: nullableNumber(memory.lastModified ?? memory.last_modified),
      entries: Array.isArray(memory.entries)
        ? memory.entries.map((entry, index) => {
            const item = asRecord(entry);
            return {
              index: numberValue(item.index, index),
              content: stringValue(item.content),
            };
          })
        : parseEntries(memoryContent),
      charCount: numberValue(
        memory.charCount ?? memory.char_count,
        memoryContent.length,
      ),
      charLimit: numberValue(memory.charLimit ?? memory.char_limit, 20000),
    },
    user: {
      content: userContent,
      exists: user.exists !== false && Boolean(userContent || user.exists),
      lastModified: nullableNumber(user.lastModified ?? user.last_modified),
      charCount: numberValue(
        user.charCount ?? user.char_count,
        userContent.length,
      ),
      charLimit: numberValue(user.charLimit ?? user.char_limit, 12000),
    },
    stats: {
      totalSessions: numberValue(stats.totalSessions ?? stats.total_sessions),
      totalMessages: numberValue(stats.totalMessages ?? stats.total_messages),
    },
  };
}

async function tryRemote<T>(
  config: RemoteSessionConfig,
  paths: string[],
  mapper: (value: unknown) => T,
): Promise<T> {
  let lastError: unknown;
  for (const path of paths) {
    try {
      return mapper(await remoteRequestJson(config, path));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function remoteReadMemory(
  config: RemoteSessionConfig,
): Promise<MemoryInfo> {
  return tryRemote(
    config,
    ["/api/memory", "/api/memory/read"],
    normalizeMemoryInfo,
  );
}

export async function remoteAddMemoryEntry(
  config: RemoteSessionConfig,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await remoteRequestJson(config, "/api/memory/entries", {
      method: "POST",
      body: { content },
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function remoteUpdateMemoryEntry(
  config: RemoteSessionConfig,
  index: number,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await remoteRequestJson(config, `/api/memory/entries/${index}`, {
      method: "PUT",
      body: { content },
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function remoteRemoveMemoryEntry(
  config: RemoteSessionConfig,
  index: number,
): Promise<boolean> {
  await remoteRequestJson(config, `/api/memory/entries/${index}`, {
    method: "DELETE",
  });
  return true;
}

export async function remoteWriteUserProfile(
  config: RemoteSessionConfig,
  content: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await remoteRequestJson(config, "/api/memory/user", {
      method: "PUT",
      body: { content },
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function remoteDiscoverMemoryProviders(
  config: RemoteSessionConfig,
): Promise<unknown[]> {
  const response = await remoteRequestJson(config, "/api/memory/providers");
  const record = asRecord(response);
  return Array.isArray(record.providers) ? record.providers : [];
}
