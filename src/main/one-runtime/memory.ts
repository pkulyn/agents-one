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
import { assertAgentsOneWritesAllowed } from "../restore-write-lock";

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
export function agentsMdPath(profileRoot: string, runtimeId: string): string {
  return join(runtimeMemoryDirectory(profileRoot, runtimeId), "AGENTS.md");
}

export const DEFAULT_ONE_INSTRUCTIONS = `# Agents One

你是用户的 AI 助手和工作伙伴 One，运行在 Agents One 环境中，通过检索、分析、执行命令、编辑代码和编辑文档等多种方式来帮助用户完成任务。

## 工作方式
- 先理解目标与约束，再动手；不确定时先提问确认。
- 优先复用项目已有组件与数据契约，做最小改动。
- 修改前先读现有配置，保留未知键与用户数据。

## 输出
- 用中文回复，除非用户明确使用其他语言。
- 先给结论，再给必要的细节，不堆砌选项。
- 涉及文件时给出可点击的相对路径。

## 边界
- 不执行破坏性命令，除非用户明确要求。
- 不把私有计划、审计记录与凭据写入公开文档。
`;

/** Only the standard identity line belongs to name synchronization, not custom rules. */
export function oneInstructionsWithName(
  content: string,
  displayName: string,
): string {
  const name =
    displayName
      .replace(/[\r\n\0]/g, " ")
      .trim()
      .slice(0, 128) || "One";
  return content
    .replace(/^# Agents One · [^\r\n]*(?=\r?$)/m, "# Agents One")
    .replace(
      /^(你是用户的 AI 助手和工作伙伴 )[^\r\n]*?(，运行在 Agents One 环境中)/m,
      (_match, prefix: string, suffix: string) => prefix + name + suffix,
    );
}

/** Create only a missing file; an existing empty file is a user's choice. */
export function ensureOneAgentsMdFile(
  profileRoot: string,
  runtimeId: string,
  legacyInstructions?: string,
  displayName = "One",
): string {
  const path = agentsMdPath(profileRoot, runtimeId);
  const existing = readOneAgentsMdFile(profileRoot, runtimeId);
  if (existing !== null) return existing;
  const content =
    legacyInstructions ??
    oneInstructionsWithName(DEFAULT_ONE_INSTRUCTIONS, displayName);
  assertAgentsOneWritesAllowed();
  if (
    Buffer.byteLength(content, "utf8") > maximumBytes ||
    content.includes("\0")
  )
    throw new Error("One instructions are invalid or too large");
  for (const part of [
    join(profileRoot, "desktop"),
    join(profileRoot, "desktop", "one"),
    dirname(path),
    path,
  ])
    assertNotSymlink(part);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path, content, { flag: "wx", mode: 0o600, encoding: "utf8" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readOneAgentsMdFile(profileRoot, runtimeId)!;
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
export function readOneAgentsMdFile(
  profileRoot: string,
  runtimeId: string,
): string | null {
  const path = agentsMdPath(profileRoot, runtimeId);
  if (!existsSync(path)) return null;
  return readMemoryPath(profileRoot, runtimeId, path);
}
export function writeOneAgentsMdFile(
  profileRoot: string,
  runtimeId: string,
  content: string,
): void {
  writeMemoryPath(
    profileRoot,
    runtimeId,
    agentsMdPath(profileRoot, runtimeId),
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
