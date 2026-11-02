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

function parseDeliveryContracts(output: string): DeliveryContract[] {
  const contracts = new Map<string, DeliveryContract>();
  for (const text of contractTexts(output)) {
    for (const match of text.matchAll(
      /\[(?:交付物|交付契约)\]([\s\S]*?)(?=\[(?:交付物|交付契约)\]|$)/g,
    )) {
      for (const entry of match[1].split(/(?=^[ \t]*路径\s*[：:])/m)) {
        const marker = entry.slice(0, 4000);
        const value = (label: string): string | undefined =>
          marker
            .match(new RegExp(label + "\\s*[：:]\\s*([^\\r\\n]+)", "i"))?.[1]
            ?.trim();
        let path = value("路径");
        if (
          path &&
          [
            String.fromCharCode(96),
            String.fromCharCode(34),
            String.fromCharCode(39),
          ].includes(path[0]) &&
          path.at(-1) === path[0]
        )
          path = path.slice(1, -1);
        const sha256 = value("SHA-?256")
          ?.match(/[a-f0-9]{64}/i)?.[0]
          ?.toLowerCase();
        const changeSummary = value("变更摘要");
        if (path && sha256 && changeSummary)
          contracts.set(path + ":" + sha256, { path, sha256, changeSummary });
      }
    }
  }
  return [...contracts.values()].slice(0, 50);
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
  if (!workspace.trim()) return [];
  const verified: AgentRuntimeArtifact[] = [];
  for (const contract of parseDeliveryContracts(output)) {
    try {
      const workspacePath = await realpath(resolve(workspace));
      const declaredPath = isAbsolute(contract.path)
        ? resolve(contract.path)
        : resolve(workspacePath, contract.path);
      const filePath = await realpath(declaredPath);
      const relation = relative(workspacePath, filePath);
      if (
        relation === ".." ||
        relation.startsWith("..\\") ||
        relation.startsWith("../") ||
        isAbsolute(relation)
      )
        continue;
      const fileStat = await stat(filePath);
      if (!fileStat.isFile()) continue;
      const sha256 = await sha256File(filePath);
      if (sha256 !== contract.sha256) continue;
      verified.push({
        kind: "file",
        label: basename(filePath),
        path: filePath,
        relativePath: relation.replace(/\\/g, "/"),
        size: fileStat.size,
        sha256,
        sourceMachine: "本机工作区",
        changeSummary: contract.changeSummary,
      });
    } catch {
      continue;
    }
  }
  return verified;
}
