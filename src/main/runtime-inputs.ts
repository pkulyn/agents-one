import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { basename, join, relative, resolve } from "path";
import type { Attachment } from "../shared/attachments";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_IMAGE_TARGET_BYTES,
  MAX_TEXT_BYTES,
} from "../shared/attachments";
import type { RuntimeInputArtifact } from "../shared/agent-runtimes";
import { profileHome } from "./utils";

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_INPUT_BYTES = 30 * 1024 * 1024;
const SENSITIVE_FILE_NAME = /^(?:\.env(?:\..*)?|.*\.(?:pem|key|p12|pfx)|.*(?:credential|secret|token|password).*)$/i;

export interface PreparedRuntimeInputs {
  directory?: string;
  imagePaths: string[];
  files: Array<{ artifact: RuntimeInputArtifact; path: string }>;
  promptContext: string;
  artifacts: RuntimeInputArtifact[];
}

function safeName(value: unknown, fallback: string): string {
  const name = typeof value === "string" ? basename(value).trim() : "";
  const cleaned = name
    .replace(/[\x00-\x1F<>:"/\\|?*]/g, "")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 160);
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned : fallback;
}

function uniquePath(directory: string, fileName: string, index: number): string {
  const candidate = join(directory, fileName);
  if (!existsSync(candidate)) return candidate;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  return join(directory, `${stem}-${index}${ext}`);
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function bytesFromDataUrl(value: string): Buffer {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(value);
  if (!match) throw new Error("Image attachment data is invalid.");
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

function inputDirectory(
  profile: string | undefined,
  token: string,
  rootOverride?: string,
): string {
  const root = rootOverride
    ? resolve(rootOverride)
    : resolve(profileHome(profile), "desktop", "runtime-inputs");
  const directory = resolve(root, token);
  if (relative(root, directory).startsWith("..")) {
    throw new Error("Invalid runtime input directory.");
  }
  mkdirSync(directory, { recursive: true });
  return directory;
}

function artifactKind(attachment: Attachment): RuntimeInputArtifact["kind"] {
  if (attachment.kind === "text-file") return "text";
  if (attachment.kind === "image") return "image";
  return "document";
}

/**
 * Copy explicit user inputs into a per-task desktop directory. Runtime CLIs
 * receive this directory as an additional allowed directory, never a source
 * path from the user filesystem. Input copies are retained as task evidence.
 */
export function prepareRuntimeInputs(
  profile: string | undefined,
  attachments: Attachment[] | undefined,
  token = `input-${randomUUID()}`,
  rootOverride?: string,
): PreparedRuntimeInputs {
  if (!attachments?.length) {
    return { promptContext: "", artifacts: [], imagePaths: [], files: [] };
  }
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error(`A task may include at most ${MAX_ATTACHMENTS_PER_MESSAGE} input files.`);
  }

  const directory = inputDirectory(profile, token, rootOverride);
  const artifacts: RuntimeInputArtifact[] = [];
  const imagePaths: string[] = [];
  const files: Array<{ artifact: RuntimeInputArtifact; path: string }> = [];
  let totalBytes = 0;

  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index];
    if (!attachment || typeof attachment !== "object") {
      throw new Error("Task input attachment is invalid.");
    }
    const name = safeName(attachment.name, `input-${index + 1}`);
    if (SENSITIVE_FILE_NAME.test(name)) {
      throw new Error(`${name} is excluded from Runtime input for safety.`);
    }
    const target = uniquePath(directory, name, index + 1);
    let bytes: Buffer;

    if (attachment.kind === "text-file") {
      if (typeof attachment.text !== "string") {
        throw new Error(`${name} has no readable text content.`);
      }
      bytes = Buffer.from(attachment.text, "utf8");
      if (bytes.length > MAX_TEXT_BYTES) {
        throw new Error(`${name} exceeds the text input limit.`);
      }
      writeFileSync(target, bytes);
    } else if (attachment.kind === "image") {
      if (typeof attachment.dataUrl !== "string") {
        throw new Error(`${name} has no readable image content.`);
      }
      bytes = bytesFromDataUrl(attachment.dataUrl);
      if (bytes.length > MAX_IMAGE_TARGET_BYTES) {
        throw new Error(`${name} exceeds the image input limit.`);
      }
      writeFileSync(target, bytes);
    } else if (attachment.kind === "path-ref") {
      if (typeof attachment.path !== "string" || !attachment.path.trim()) {
        throw new Error(`${name} has no source path.`);
      }
      const source = realpathSync(resolve(attachment.path));
      const info = statSync(source);
      if (!info.isFile()) throw new Error(`${name} is not a file.`);
      if (info.size > MAX_DOCUMENT_BYTES) {
        throw new Error(`${name} exceeds the document input limit.`);
      }
      copyFileSync(source, target);
      bytes = Buffer.from(readFileSync(target));
    } else {
      throw new Error(`${name} has an unsupported input type.`);
    }

    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_INPUT_BYTES) {
      throw new Error("Task input files exceed the combined size limit.");
    }
    const artifact: RuntimeInputArtifact = {
      id: attachment.id || `input-${index + 1}`,
      name,
      mime: typeof attachment.mime === "string" ? attachment.mime : "application/octet-stream",
      size: bytes.length,
      kind: artifactKind(attachment),
      sha256: sha256(bytes),
    };
    artifacts.push(artifact);
    files.push({ artifact, path: target });
    if (attachment.kind === "image") imagePaths.push(target);
  }

  const summary = artifacts
    .map((artifact) => `- ${artifact.name} (${artifact.kind}, ${artifact.size} bytes)`)
    .join("\n");
  return {
    directory,
    imagePaths,
    files,
    artifacts,
    promptContext:
      `\n\nThe user supplied these task inputs. Read only the copies in ${directory}; ` +
      "do not look for similarly named files elsewhere on the machine.\n" +
      `${summary}`,
  };
}
