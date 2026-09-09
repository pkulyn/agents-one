import { existsSync, readFileSync } from "fs";
import { basename, join, normalize } from "path";
import { createHash } from "crypto";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import type {
  ProjectFolderRecord,
  ProjectWorkspaceCapability,
  UpdateProjectFolderInput,
} from "../shared/project-folders";

interface ProjectFolderStore {
  version: number;
  folders: ProjectFolderRecord[];
}

const STORE_VERSION = 2;
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

/** Deterministic so old records gain an id without a risky write-on-read migration. */
export function projectFolderIdForPath(path: string): string {
  return `project-${createHash("sha256")
    .update(process.platform === "win32" ? path.toLowerCase() : path)
    .digest("hex")
    .slice(0, 24)}`;
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
    typeof record.updatedAt === "number" &&
    (record.id === undefined || typeof record.id === "string")
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
    return {
      version: STORE_VERSION,
      folders: folders.map((folder) => ({
        ...folder,
        id: folder.id || projectFolderIdForPath(folder.path),
      })),
    };
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

/** Return project metadata that is safe to expose outside the main process. */
export function listProjectWorkspaceCapabilities(): ProjectWorkspaceCapability[] {
  return listProjectFolders().flatMap((folder) => {
    const id = folder.id || projectFolderIdForPath(folder.path);
    return [{
      id,
      name: folder.name,
      ...(folder.pinned ? { pinned: true } : {}),
      updatedAt: folder.updatedAt,
    }];
  });
}

export function projectWorkspaceCapability(
  folder: ProjectFolderRecord | null,
): ProjectWorkspaceCapability | null {
  if (!folder) return null;
  return {
    id: folder.id || projectFolderIdForPath(folder.path),
    name: folder.name,
    ...(folder.pinned ? { pinned: true } : {}),
    updatedAt: folder.updatedAt,
  };
}

export function registerProjectFolder(path: string): ProjectFolderRecord | null {
  const normalized = cleanPath(path);
  if (!normalized) return null;
  const now = Date.now();
  const store = readStore();
  const existing = store.folders.find((folder) => folder.path === normalized);
  const nextRecord: ProjectFolderRecord = existing
    ? {
        ...existing,
        id: existing.id || projectFolderIdForPath(normalized),
        updatedAt: now,
      }
    : {
        id: projectFolderIdForPath(normalized),
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
  const normalized = cleanPath(
    input.id ? resolveProjectFolderPath(input.id) || input.path : input.path,
  );
  if (!normalized) return null;
  const store = readStore();
  const existing = store.folders.find((folder) => folder.path === normalized);
  const now = Date.now();
  const requestedName =
    typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  const next: ProjectFolderRecord = {
    id: existing?.id || projectFolderIdForPath(normalized),
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

/** Resolve an opaque project id entirely in the main process. */
export function resolveProjectFolderPath(id: string): string | null {
  if (typeof id !== "string" || !id.trim()) return null;
  const folder = readStore().folders.find((item) => item.id === id.trim());
  return folder?.path || null;
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

/** Removes a registered project by opaque id, never exposing its path. */
export function removeProjectWorkspace(id: string): boolean {
  const path = resolveProjectFolderPath(id);
  return path ? removeProjectFolder(path) : false;
}
