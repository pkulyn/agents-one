import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "fs";
import { dirname, join, relative, resolve } from "path";
import { randomUUID } from "crypto";
import { profileHome } from "./utils";

const MAX_PROTECTED_FILES = 20_000;
const MAX_PROTECTED_BYTES = 1024 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".agents-one",
  ".next",
  "build",
  "dist",
  "node_modules",
  "out",
]);

export interface WorkspaceProtection {
  restoreAndDispose: () => string[];
}

function hasSymbolicLinkParent(root: string, target: string): boolean {
  let current = dirname(target);
  while (current !== root) {
    if (relative(root, current).startsWith("..")) return true;
    const info = lstatSync(current, { throwIfNoEntry: false });
    if (info?.isSymbolicLink()) return true;
    current = dirname(current);
  }
  return false;
}

/**
 * Keeps a private copy of every pre-existing regular file for a safe-write run.
 * Missing originals are restored when the Runtime exits, so an attempted
 * delete or move cannot remove files from the selected project.
 */
export function protectWorkspaceFromRemoval(
  workspace: string,
  profile?: string,
  backupBase?: string,
): WorkspaceProtection {
  const root = resolve(workspace);
  const backupRoot = resolve(
    backupBase || profileHome(profile),
    "desktop",
    "safe-write-backups",
    randomUUID(),
  );
  mkdirSync(backupRoot, { recursive: true });
  const files: string[] = [];
  let totalBytes = 0;

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      const rel = relative(root, source);
      if (!rel || rel.startsWith("..")) continue;
      const stat = lstatSync(source);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        visit(source);
        continue;
      }
      if (!stat.isFile()) continue;
      files.push(rel);
      totalBytes += stat.size;
      if (
        files.length > MAX_PROTECTED_FILES ||
        totalBytes > MAX_PROTECTED_BYTES
      ) {
        throw new Error(
          "The selected project is too large for safe-write removal protection. Use read-only or explicitly choose full access.",
        );
      }
      const backup = join(backupRoot, rel);
      mkdirSync(dirname(backup), { recursive: true });
      copyFileSync(source, backup);
    }
  };

  try {
    visit(root);
  } catch (error) {
    rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }

  let disposed = false;
  return {
    restoreAndDispose: (): string[] => {
      if (disposed) return [];
      disposed = true;
      const restored: string[] = [];
      try {
        for (const rel of files) {
          const target = resolve(root, rel);
          if (relative(root, target).startsWith("..")) continue;
          if (hasSymbolicLinkParent(root, target)) continue;
          const targetInfo = lstatSync(target, { throwIfNoEntry: false });
          if (targetInfo?.isSymbolicLink()) {
            unlinkSync(target);
          } else if (existsSync(target)) {
            continue;
          }
          mkdirSync(dirname(target), { recursive: true });
          copyFileSync(join(backupRoot, rel), target);
          restored.push(rel);
        }
        return restored;
      } finally {
        rmSync(backupRoot, { recursive: true, force: true });
      }
    },
  };
}
