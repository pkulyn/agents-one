import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

const skillName = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const maximumFiles = 500;
const maximumBytes = 4 * 1024 * 1024;
const maximumFileBytes = 2 * 1024 * 1024;

/**
 * Copy a user skill into One's private skill directory so One can own/remove
 * its copy without touching a skill shared with other agents. Symlinked
 * entries are rejected, and only regular files/directories are copied.
 */
export function copyOneSkillDirectory(
  sourceDir: string,
  targetDir: string,
): void {
  if (!skillName.test(targetDir.split(/[\\/]/).pop() || ""))
    throw new Error("One skill name is invalid");
  // Enabling an already installed skill must never overwrite user edits.
  const existing = lstatSync(targetDir, { throwIfNoEntry: false });
  if (existing) {
    const file = lstatSync(join(targetDir, "SKILL.md"), {
      throwIfNoEntry: false,
    });
    if (
      !existing.isDirectory() ||
      existing.isSymbolicLink() ||
      !file?.isFile() ||
      file.isSymbolicLink()
    )
      throw new Error("One skill target is unsafe");
    return;
  }
  const sourceStat = lstatSync(sourceDir);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink())
    throw new Error("One skill source is unavailable or unsafe");
  const tempDir = `${targetDir}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(tempDir, { recursive: true });
  let files = 0;
  let bytes = 0;
  const walk = (directory: string, relativePath: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const relative = relativePath
        ? join(relativePath, entry.name)
        : entry.name;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink())
        throw new Error("One skill copy contains a symbolic link");
      if (stat.isDirectory()) {
        mkdirSync(join(tempDir, relative), { recursive: true });
        walk(absolute, relative);
        continue;
      }
      if (!stat.isFile())
        throw new Error("One skill copy contains an unsupported entry");
      files += 1;
      bytes += stat.size;
      if (
        files > maximumFiles ||
        bytes > maximumBytes ||
        stat.size > maximumFileBytes
      )
        throw new Error("One skill copy exceeds the size limit");
      copyFileSync(absolute, join(tempDir, relative));
    }
  };
  try {
    walk(sourceDir, "");
    const skillFile = join(tempDir, "SKILL.md");
    const skillStat = lstatSync(skillFile);
    if (!skillStat.isFile() || skillStat.isSymbolicLink())
      throw new Error("One skill copy has no regular SKILL.md");
    renameSync(tempDir, targetDir);
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/** Remove only the One-owned copy; the shared source skill is untouched. */
export function removeOneSkillDirectory(
  targetRoot: string,
  name: string,
): void {
  if (!skillName.test(name)) throw new Error("One skill name is invalid");
  const target = join(targetRoot, name);
  if (!existsSync(target)) return;
  const stat = lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw new Error("One skill target is unsafe");
  rmSync(target, { recursive: true, force: true });
}
