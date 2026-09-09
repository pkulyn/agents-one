import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
  readdirSync,
  lstatSync,
} from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { HERMES_HOME } from "./installer";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";

/**
 * Main-process-owned staging area for every binary/document attachment.
 * The Renderer never passes an original local path to a Runtime; it first
 * sends attachment bytes here, then passes only this controlled path.
 *
 * Layout:
 *   %LOCALAPPDATA%/hermes/desktop-staging/<sessionId>/<filename>
 *
 * Files persist across desktop restarts so the agent can re-read them
 * on session resume.  Per-session subdirs are cleaned up when the
 * session is deleted.
 */
const STAGING_ROOT = join(HERMES_HOME, "desktop-staging");
const MAX_STAGED_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_STAGED_SESSION_BYTES = 100 * 1024 * 1024;
const MAX_STAGED_TOTAL_BYTES = 1024 * 1024 * 1024;

function containedBy(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return !(
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  );
}

function sanitizeSegment(value: string, fallback: string): string {
  // Strip path separators, null bytes, and any other dodgy chars; collapse
  // whitespace to underscores.  Keeps the original name human-readable but
  // refuses anything that could escape the staging dir.
  const cleaned = value
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, "") // eslint-disable-line no-control-regex
    .replace(/\s+/g, "_")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  return cleaned.slice(0, 200);
}

function uniquePath(dir: string, filename: string): string {
  const base = sanitizeSegment(filename, "file");
  let candidate = join(dir, base);
  if (!existsSync(candidate)) return candidate;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    candidate = join(dir, `${stem}_${i}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  // Astronomically unlikely fallback — append a timestamp.
  return join(dir, `${stem}_${Date.now()}${ext}`);
}

/** Count regular files only; a staging symlink never contributes authority. */
function regularFileBytes(path: string): number {
  if (!existsSync(path)) return 0;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) {
      total += regularFileBytes(candidate);
      continue;
    }
    if (entry.isFile()) total += lstatSync(candidate).size;
  }
  return total;
}

/**
 * Write a base64-encoded attachment to the staging area and return the
 * absolute path.  Caller is the renderer (via IPC); we don't trust the
 * filename and re-sanitize the session id segment too.
 */
export function stageAttachment(
  sessionId: string,
  filename: string,
  base64Bytes: string,
): string {
  assertAgentsOneWritesAllowed();
  if (
    typeof base64Bytes !== "string" ||
    !/^[A-Za-z0-9+/=\s]+$/.test(base64Bytes)
  ) {
    throw new Error("Attachment bytes are invalid.");
  }
  const bytes = Buffer.from(base64Bytes.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_STAGED_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the staging size limit.");
  }
  const sessionSegment = sanitizeSegment(sessionId || "default", "default");
  const dir = join(STAGING_ROOT, sessionSegment);
  const sessionBytes = regularFileBytes(dir);
  const totalBytes = regularFileBytes(STAGING_ROOT);
  if (sessionBytes + bytes.length > MAX_STAGED_SESSION_BYTES) {
    throw new Error("Attachment exceeds the per-session staging quota.");
  }
  if (totalBytes + bytes.length > MAX_STAGED_TOTAL_BYTES) {
    throw new Error(
      "Attachment exceeds the total staging quota. Delete old sessions before adding more files.",
    );
  }
  mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, filename);
  writeFileSync(target, bytes);
  return target;
}

/** True only for a real file below the main-process owned staging root. */
export function isStagedAttachmentPath(value: string): boolean {
  try {
    const root = realpathSync(resolve(STAGING_ROOT));
    const candidate = realpathSync(resolve(value));
    return containedBy(root, candidate);
  } catch {
    return false;
  }
}

/**
 * Remove an entire session's staging directory.  Called when a chat
 * session is deleted from the UI.
 */
export function clearStagedAttachments(sessionId: string): void {
  if (!sessionId) return;
  const sessionSegment = sanitizeSegment(sessionId, "");
  if (!sessionSegment) return;
  const dir = join(STAGING_ROOT, sessionSegment);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Files may be locked (open in another app); best-effort cleanup.
    }
  }
}
