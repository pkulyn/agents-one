import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { AgentRuntimeDefinition } from "../shared/agent-runtimes";
import { agentsOneProfileHome } from "./agents-one-data-root";

interface GatewayRunReceipt {
  id: string;
  runtimeId: string;
  remoteRunId: string;
  route: string;
  startedAt: number;
}

const MAX_RECEIPTS = 100;
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function gatewayRunRoute(runtime: AgentRuntimeDefinition): string {
  const { endpoint, connect } = runtime.config;
  return createHash("sha256")
    .update(
      JSON.stringify([
        endpoint,
        connect?.endpoint,
        connect?.runtimeId,
        connect?.deviceId,
        runtime.kind,
        runtime.adapterId,
      ]),
    )
    .digest("hex");
}

function indexPath(profile: string): string {
  return join(agentsOneProfileHome(profile), "remote-gateway-runs.json");
}

function isReceipt(value: unknown): value is GatewayRunReceipt {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<GatewayRunReceipt>;
  return (
    typeof entry.id === "string" &&
    /^run-[0-9a-f-]{36}$/.test(entry.id) &&
    typeof entry.runtimeId === "string" &&
    entry.runtimeId.length > 0 &&
    typeof entry.remoteRunId === "string" &&
    entry.remoteRunId.length > 0 &&
    entry.remoteRunId.length <= 256 &&
    typeof entry.route === "string" &&
    /^[0-9a-f]{64}$/.test(entry.route) &&
    typeof entry.startedAt === "number" &&
    Number.isSafeInteger(entry.startedAt) &&
    entry.startedAt >= Date.now() - RETENTION_MS
  );
}

function readReceipts(profile: string): GatewayRunReceipt[] {
  try {
    const value: unknown = JSON.parse(readFileSync(indexPath(profile), "utf8"));
    return Array.isArray(value) ? value.filter(isReceipt) : [];
  } catch {
    return [];
  }
}

export function readGatewayRunReceipt(
  profile: string,
  id: string,
): GatewayRunReceipt | undefined {
  return readReceipts(profile).find((entry) => entry.id === id);
}

// @lat: [[main-process#Remote Gateway run recovery]]
export function writeGatewayRunReceipt(
  profile: string,
  receipt: GatewayRunReceipt,
): boolean {
  if (!isReceipt(receipt)) return false;
  const path = indexPath(profile);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const entries = readReceipts(profile).filter(({ id }) => id !== receipt.id);
  mkdirSync(agentsOneProfileHome(profile), { recursive: true });
  try {
    writeFileSync(
      temporary,
      JSON.stringify([receipt, ...entries].slice(0, MAX_RECEIPTS)),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    renameSync(temporary, path);
    return true;
  } finally {
    rmSync(temporary, { force: true });
  }
}
