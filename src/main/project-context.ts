import { createHash, randomUUID } from "crypto";
import { open, readdir, realpath, stat } from "fs/promises";
import { basename, extname, relative, resolve } from "path";
import type { Attachment } from "../shared/attachments";
import { ALLOWED_TEXT_EXTENSIONS, MAX_TEXT_BYTES } from "../shared/attachments";

const MAX_PROJECT_FILES = 80;
const MAX_SCANNED_ENTRIES = 2_000;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_CONTEXT_BYTES = Math.min(MAX_TEXT_BYTES - 8 * 1024, 220 * 1024);

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".next",
  ".venv",
  ".vscode",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);

const SENSITIVE_NAME =
  /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|.*(?:credential|secret|token|password).*)$/i;

function isSupportedTextFile(name: string): boolean {
  const extension = extname(name).slice(1).toLowerCase();
  const bareName = name.toLowerCase();
  return (
    ALLOWED_TEXT_EXTENSIONS.has(extension) ||
    ALLOWED_TEXT_EXTENSIONS.has(bareName)
  );
}

/**
 * Build a bounded, read-only text snapshot for a remote agent. The snapshot
 * intentionally excludes generated trees, symlinks, and credential-like
 * files. It never exposes the local absolute root path.
 */
export async function prepareProjectContextAttachment(
  folderPath: string,
): Promise<Attachment> {
  const root = await realpath(resolve(folderPath));
  const rootInfo = await stat(root);
  if (!rootInfo.isDirectory()) throw new Error("所选路径不是文件夹。");

  const files: string[] = [];
  let scannedEntries = 0;
  async function walk(directory: string): Promise<void> {
    if (
      files.length >= MAX_PROJECT_FILES ||
      scannedEntries >= MAX_SCANNED_ENTRIES
    )
      return;
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      scannedEntries += 1;
      if (
        files.length >= MAX_PROJECT_FILES ||
        scannedEntries >= MAX_SCANNED_ENTRIES
      )
        break;
      if (entry.isSymbolicLink() || SENSITIVE_NAME.test(entry.name)) continue;
      const fullPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) {
          await walk(fullPath);
        }
        continue;
      }
      if (entry.isFile() && isSupportedTextFile(entry.name))
        files.push(fullPath);
    }
  }
  await walk(root);

  const projectName = basename(root) || "project";
  const sections: string[] = [
    `Project context snapshot: ${projectName}`,
    "This is a read-only snapshot selected by the user. Relative paths are rooted at the project folder.",
    "Generated folders, symlinks, and credential-like files are excluded.",
    "",
  ];
  let usedBytes = Buffer.byteLength(sections.join("\n"), "utf8");
  let included = 0;
  const manifestEntries: string[] = [];

  for (const filePath of files) {
    const relativePath = relative(root, filePath).replace(/\\/g, "/");
    const info = await stat(filePath);
    const bytesToRead = Math.min(info.size, MAX_FILE_BYTES);
    const file = await open(filePath, "r");
    const buffer = Buffer.alloc(bytesToRead);
    let bytesRead = 0;
    try {
      ({ bytesRead } = await file.read(buffer, 0, bytesToRead, 0));
    } finally {
      await file.close();
    }
    const snapshotBytes = buffer.subarray(0, bytesRead);
    const snapshotSha256 = createHash("sha256").update(snapshotBytes).digest("hex");
    let content = buffer.subarray(0, bytesRead).toString("utf8");
    if (info.size > bytesToRead) content += "\n[File truncated by Agents One]";
    // Do not use <file> wrappers here. Hermes' legacy attachment transport
    // already wraps this whole snapshot in <file>...</file>; nesting the same
    // tag makes old non-recursive history parsers stop at the inner close tag.
    const section =
      `--- PROJECT FILE: ${relativePath} ---\n` +
      `${content}\n--- END PROJECT FILE ---\n`;
    const sectionBytes = Buffer.byteLength(section, "utf8");
    if (usedBytes + sectionBytes > MAX_CONTEXT_BYTES) break;
    sections.push(section);
    manifestEntries.push(
      `- ${relativePath} | ${bytesRead}${info.size > bytesToRead ? `/${info.size}（已截断）` : ""} bytes | SHA-256: ${snapshotSha256}`,
    );
    usedBytes += sectionBytes;
    included += 1;
  }

  sections.splice(
    3,
    0,
    `Included text files: ${included} of ${files.length}`,
    "",
  );
  sections.splice(5, 0, "Evidence manifest (content sent in this snapshot):", ...manifestEntries, "");
  const text = sections.join("\n");
  const size = Buffer.byteLength(text, "utf8");
  return {
    id: `project-context-${randomUUID()}`,
    kind: "text-file",
    name: `${projectName}-project-context.txt`,
    mime: "text/plain",
    size,
    text,
  };
}
