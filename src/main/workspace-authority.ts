import { realpathSync, statSync } from "fs";
import { isAbsolute, relative, resolve, sep } from "path";
import {
  listProjectFolders,
  resolveProjectFolderPath,
} from "./project-folders";

/**
 * User-selected folders are short-lived desktop capabilities. Renderer code
 * cannot mint one by passing an arbitrary absolute path: only the native file
 * chooser (or an already registered project) may add a root here.
 */
const selectedWorkspaceRoots = new Set<string>();

function canonicalDirectory(value: string): string | null {
  try {
    const path = realpathSync(resolve(value.trim()));
    return statSync(path).isDirectory()
      ? process.platform === "win32"
        ? path.toLowerCase()
        : path
      : null;
  } catch {
    return null;
  }
}

function canonicalExistingPath(value: string): string | null {
  try {
    const path = realpathSync(resolve(value.trim()));
    return process.platform === "win32" ? path.toLowerCase() : path;
  } catch {
    return null;
  }
}

function containedBy(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return !(
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  );
}

function authorizedRoots(): string[] {
  return [
    ...selectedWorkspaceRoots,
    ...listProjectFolders()
      .map((folder) => canonicalDirectory(folder.path))
      .filter((root): root is string => Boolean(root)),
  ];
}

export function authorizeUserSelectedWorkspace(value: string): boolean {
  if (typeof value !== "string") return false;
  const root = canonicalDirectory(value);
  if (!root) return false;
  selectedWorkspaceRoots.add(root);
  return true;
}

/**
 * Checks an exact directory root, not an arbitrary descendant. Descendants
 * are authorized by the per-operation resolver after the root is known.
 */
export function isAuthorizedWorkspaceRoot(value: string): boolean {
  const root = typeof value === "string" ? canonicalDirectory(value) : null;
  if (!root) return false;
  if (selectedWorkspaceRoots.has(root)) return true;
  return authorizedRoots().includes(root);
}

/**
 * Resolve a persisted project capability without accepting a Renderer path.
 * The resolved root still passes the same realpath authorization check used
 * by legacy callers, so a stale registry entry cannot bypass a moved/junction
 * target.
 */
export function resolveAuthorizedWorkspaceId(id: string): string | null {
  const storedPath = resolveProjectFolderPath(id);
  if (!storedPath || !isAuthorizedWorkspaceRoot(storedPath)) return null;
  return canonicalDirectory(storedPath);
}

/**
 * Resolve a workspace-relative path. Relative input is deliberately strict:
 * no absolute/UNC path, traversal, ADS/device colon, or unresolved symlink
 * can escape the registered root.
 */
export function resolveAuthorizedWorkspaceRelativePath(
  workspaceId: string,
  relativePath = "",
): string | null {
  const root = resolveAuthorizedWorkspaceId(workspaceId);
  if (!root || typeof relativePath !== "string") return null;
  const relativePathNormalized = relativePath.replace(/\\/g, "/").trim();
  if (
    relativePathNormalized.includes("\0") ||
    relativePathNormalized.includes(":") ||
    relativePathNormalized.startsWith("/") ||
    relativePathNormalized.split("/").some((part) => part === "..")
  ) {
    return null;
  }
  const candidate = canonicalExistingPath(
    relativePathNormalized ? resolve(root, relativePathNormalized) : root,
  );
  return candidate && containedBy(root, candidate) ? candidate : null;
}

/** Resolves a Renderer-supplied existing file or descendant against a root. */
export function isAuthorizedWorkspacePath(value: string): boolean {
  const candidate =
    typeof value === "string" ? canonicalExistingPath(value) : null;
  return Boolean(
    candidate && authorizedRoots().some((root) => containedBy(root, candidate)),
  );
}
