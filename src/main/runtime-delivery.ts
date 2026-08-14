import { createHash } from "crypto";
import { createReadStream } from "fs";
import { realpath, stat } from "fs/promises";
import { basename, isAbsolute, relative, resolve } from "path";
import type { AgentRuntimeArtifact } from "../shared/agent-runtimes";

interface DeliveryContract {
  path: string;
  sha256: string;
  changeSummary: string;
}

function collectStrings(value: unknown, output: string[], depth = 0): void {
  if (depth > 8 || output.length > 200) return;
  if (typeof value === "string") {
    if (/\[(?:交付物|交付契约)\]/.test(value)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value as Record<string, unknown>)) {
    collectStrings(item, output, depth + 1);
  }
}

function contractTexts(output: string): string[] {
  const candidates: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      collectStrings(JSON.parse(trimmed), candidates);
    } catch {
      // Non-JSON CLI output remains available as the first candidate.
    }
  }
  return [...candidates, output];
}

function parseDeliveryContract(output: string): DeliveryContract | undefined {
  for (const text of contractTexts(output)) {
    const marker = text.match(/\[(?:交付物|交付契约)\]([\s\S]{0,4000})/i)?.[1];
    if (!marker) continue;
    const value = (label: string): string | undefined =>
      marker
        .match(new RegExp(`${label}\\s*[：:]\\s*([^\\r\\n]+)`, "i"))?.[1]
        ?.trim();
    const path = value("路径");
    const sha256 = value("SHA-?256")?.match(/[a-f0-9]{64}/i)?.[0];
    const changeSummary = value("变更摘要");
    if (path && sha256 && changeSummary) {
      return { path, sha256: sha256.toLowerCase(), changeSummary };
    }
  }
  return undefined;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolvePromise);
  });
  return hash.digest("hex");
}

/**
 * Converts model-declared delivery metadata into platform evidence only
 * after the main process independently verifies workspace containment, file
 * existence and SHA-256. Invalid claims deliberately produce no artifact.
 */
export async function verifyLocalDeliveryArtifacts(
  output: string,
  workspace: string,
): Promise<AgentRuntimeArtifact[]> {
  const contract = parseDeliveryContract(output);
  if (!contract || !workspace.trim()) return [];
  try {
    const workspacePath = await realpath(resolve(workspace));
    const declaredPath = isAbsolute(contract.path)
      ? resolve(contract.path)
      : resolve(workspacePath, contract.path);
    const filePath = await realpath(declaredPath);
    const relation = relative(workspacePath, filePath);
    if (
      relation === ".." ||
      relation.startsWith(`..\\`) ||
      relation.startsWith("../") ||
      isAbsolute(relation)
    ) {
      return [];
    }
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return [];
    const sha256 = await sha256File(filePath);
    if (sha256 !== contract.sha256) return [];
    return [
      {
        kind: "file",
        label: basename(filePath),
        path: filePath,
        size: fileStat.size,
        sha256,
        sourceMachine: "本机工作区",
        changeSummary: contract.changeSummary,
      },
    ];
  } catch {
    return [];
  }
}
