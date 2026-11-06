import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const idPattern = /^[a-z][a-z0-9-]{1,63}$/;
const maximumBytes = 100 * 1024;
function runtimeMemoryDirectory(
  profileRoot: string,
  runtimeId: string,
): string {
  if (!idPattern.test(runtimeId)) throw new Error("One runtime ID is invalid");
  return join(profileRoot, "desktop", "one", runtimeId);
}
function memoryPath(profileRoot: string, runtimeId: string): string {
  return join(runtimeMemoryDirectory(profileRoot, runtimeId), "memory.md");
}
function projectMemoryPath(
  profileRoot: string,
  runtimeId: string,
  workspaceId: string,
): string {
  if (
    typeof workspaceId !== "string" ||
    !workspaceId.trim() ||
    workspaceId.trim() !== workspaceId ||
    Buffer.byteLength(workspaceId, "utf8") > 512 ||
    /[\0\r\n]/.test(workspaceId)
  )
    throw new Error("One project memory workspace ID is invalid");
  const directory = join(
    runtimeMemoryDirectory(profileRoot, runtimeId),
    "project-memory",
  );
  const key = createHash("sha256").update(workspaceId).digest("hex");
  return join(directory, key + ".md");
}
function assertNotSymlink(path: string): void {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error("One memory path cannot be a symbolic link");
}
function readMemoryPath(
  profileRoot: string,
  runtimeId: string,
  path: string,
): string {
  const runtimeDirectory = runtimeMemoryDirectory(profileRoot, runtimeId);
  for (const part of [
    join(profileRoot, "desktop"),
    join(profileRoot, "desktop", "one"),
    runtimeDirectory,
    dirname(path),
    path,
  ])
    assertNotSymlink(part);
  if (!existsSync(path)) return "";
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximumBytes)
    throw new Error("One memory is invalid or too large");
  return readFileSync(path, "utf8");
}
function writeMemoryPath(
  profileRoot: string,
  runtimeId: string,
  path: string,
  content: string,
): void {
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > maximumBytes ||
    content.includes("\0")
  )
    throw new Error("One memory is invalid or too large");
  const directory = dirname(path);
  for (const part of [
    join(profileRoot, "desktop"),
    join(profileRoot, "desktop", "one"),
    runtimeMemoryDirectory(profileRoot, runtimeId),
    directory,
    path,
  ])
    assertNotSymlink(part);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, ".memory-" + randomUUID() + ".tmp");
  try {
    writeFileSync(temporary, content, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, path);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      /* Preserve the original error. */
    }
    throw error;
  }
}
export function readOneMemoryFile(
  profileRoot: string,
  runtimeId: string,
): string {
  return readMemoryPath(
    profileRoot,
    runtimeId,
    memoryPath(profileRoot, runtimeId),
  );
}
export function writeOneMemoryFile(
  profileRoot: string,
  runtimeId: string,
  content: string,
): void {
  writeMemoryPath(
    profileRoot,
    runtimeId,
    memoryPath(profileRoot, runtimeId),
    content,
  );
}
export function readOneProjectMemoryFile(
  profileRoot: string,
  runtimeId: string,
  workspaceId: string,
): string {
  return readMemoryPath(
    profileRoot,
    runtimeId,
    projectMemoryPath(profileRoot, runtimeId, workspaceId),
  );
}
export function writeOneProjectMemoryFile(
  profileRoot: string,
  runtimeId: string,
  workspaceId: string,
  content: string,
): void {
  writeMemoryPath(
    profileRoot,
    runtimeId,
    projectMemoryPath(profileRoot, runtimeId, workspaceId),
    content,
  );
}
