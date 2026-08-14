import { existsSync, readFileSync } from "fs";
import { basename, join, normalize } from "path";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import type { ProjectFolderRecord, UpdateProjectFolderInput } from "../shared/project-folders";

interface ProjectFolderStore {
  version: number;
  folders: ProjectFolderRecord[];
}

const STORE_VERSION = 1;
const MAX_FOLDERS = 100;

function storePath(): string {
  return join(
    profileHome(getActiveProfileNameSync()),
    "desktop",
    "project-folders.json",
  );
}

function cleanPath(value: unknown): string {
  return typeof value === "string" ? normalize(value.trim()) : "";
}

function folderName(path: string): string {
  return basename(path) || path;
}

function isRecord(value: unknown): value is ProjectFolderRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as ProjectFolderRecord;
  return (
    typeof record.path === "string" &&
    Boolean(record.path.trim()) &&
    typeof record.name === "string" &&
    (record.pinned === undefined || typeof record.pinned === "boolean") &&
    typeof record.createdAt === "number" &&
    typeof record.updatedAt === "number"
  );
}

function readStore(): ProjectFolderStore {
  try {
    if (!existsSync(storePath())) return { version: STORE_VERSION, folders: [] };
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as unknown;
    const folders =
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ProjectFolderStore).folders)
        ? (parsed as ProjectFolderStore).folders.filter(isRecord)
        : [];
    return { version: STORE_VERSION, folders };
  } catch {
    return { version: STORE_VERSION, folders: [] };
  }
}

function writeStore(folders: ProjectFolderRecord[]): void {
  safeWriteFile(
    storePath(),
    JSON.stringify({
      version: STORE_VERSION,
      folders: folders.slice(0, MAX_FOLDERS),
    } satisfies ProjectFolderStore),
  );
}

export function listProjectFolders(): ProjectFolderRecord[] {
  return readStore().folders.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function registerProjectFolder(path: string): ProjectFolderRecord | null {
  const normalized = cleanPath(path);
  if (!normalized) return null;
  const now = Date.now();
  const store = readStore();
  const existing = store.folders.find((folder) => folder.path === normalized);
  const nextRecord: ProjectFolderRecord = existing
    ? { ...existing, updatedAt: now }
    : {
        path: normalized,
        name: folderName(normalized),
        createdAt: now,
        updatedAt: now,
      };
  writeStore([
    nextRecord,
    ...store.folders.filter((folder) => folder.path !== normalized),
  ]);
  return nextRecord;
}

export function updateProjectFolder(
  input: UpdateProjectFolderInput,
): ProjectFolderRecord | null {
  const normalized = cleanPath(input.path);
  if (!normalized) return null;
  const store = readStore();
  const existing = store.folders.find((folder) => folder.path === normalized);
  const now = Date.now();
  const requestedName =
    typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  const next: ProjectFolderRecord = {
    path: normalized,
    name: requestedName || existing?.name || folderName(normalized),
    ...(typeof input.pinned === "boolean"
      ? { pinned: input.pinned }
      : existing?.pinned !== undefined
        ? { pinned: existing.pinned }
        : {}),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  writeStore([next, ...store.folders.filter((folder) => folder.path !== normalized)]);
  return next;
}

/** Removes only the sidebar registration. Project files are never deleted. */
export function removeProjectFolder(path: string): boolean {
  const normalized = cleanPath(path);
  if (!normalized) return false;
  const current = readStore().folders;
  const next = current.filter((folder) => folder.path !== normalized);
  if (next.length === current.length) return false;
  writeStore(next);
  return true;
}
