import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ArchivedItem, ArchiveItemInput } from "../shared/archives";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

interface ArchiveStore { version: 1; items: ArchivedItem[] }

function storePath(profile?: string): string {
  return join(profileHome(profile || getActiveProfileNameSync()), "desktop", "archives.json");
}

function clean(value: unknown, max = 1024): string | undefined {
  if (typeof value !== "string") return undefined;
  const result = value.trim().slice(0, max);
  return result || undefined;
}

function readStore(profile?: string): ArchiveStore {
  try {
    if (!existsSync(storePath(profile))) return { version: 1, items: [] };
    const parsed = JSON.parse(readFileSync(storePath(profile), "utf8")) as { items?: unknown };
    if (!Array.isArray(parsed.items)) return { version: 1, items: [] };
    const items = parsed.items.flatMap((raw): ArchivedItem[] => {
      if (!raw || typeof raw !== "object") return [];
      const item = raw as Partial<ArchivedItem>;
      const id = clean(item.id, 120);
      const targetId = clean(item.targetId, 512);
      const title = clean(item.title, 240);
      if (!id || !targetId || !title || (item.kind !== "task" && item.kind !== "project")) return [];
      return [{
        id, kind: item.kind, targetId, title,
        ...(clean(item.projectPath) ? { projectPath: clean(item.projectPath) } : {}),
        ...(clean(item.runtimeId, 160) ? { runtimeId: clean(item.runtimeId, 160) } : {}),
        archivedAt: typeof item.archivedAt === "number" ? item.archivedAt : Date.now(),
      }];
    });
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeStore(items: ArchivedItem[], profile?: string): void {
  safeWriteFile(storePath(profile), JSON.stringify({ version: 1, items } satisfies ArchiveStore));
}

export function listArchivedItems(profile?: string): ArchivedItem[] {
  return readStore(profile).items.sort((a, b) => b.archivedAt - a.archivedAt);
}

export function archiveItem(input: ArchiveItemInput, profile?: string): ArchivedItem {
  const targetId = clean(input.targetId, 512);
  const title = clean(input.title, 240);
  if (!targetId || !title) throw new Error("归档目标无效");
  const id = `${input.kind}:${targetId}`;
  const item: ArchivedItem = {
    id, kind: input.kind, targetId, title,
    ...(clean(input.projectPath) ? { projectPath: clean(input.projectPath) } : {}),
    ...(clean(input.runtimeId, 160) ? { runtimeId: clean(input.runtimeId, 160) } : {}),
    archivedAt: Date.now(),
  };
  const current = readStore(profile).items;
  writeStore([item, ...current.filter((entry) => entry.id !== id)], profile);
  return item;
}

export function restoreArchivedItem(id: string, profile?: string): boolean {
  const current = readStore(profile).items;
  const next = current.filter((item) => item.id !== id);
  if (next.length === current.length) return false;
  writeStore(next, profile);
  return true;
}

export function getArchivedItem(id: string, profile?: string): ArchivedItem | undefined {
  return readStore(profile).items.find((item) => item.id === id);
}
