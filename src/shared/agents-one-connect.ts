/**
 * Shared contract for the managed Agents One Connect pairing flow.
 *
 * Connect is a transport/control plane. The payloads carried by its tunnel
 * remain Gateway v1 requests, responses and event-stream records.
 */

export const AGENTS_ONE_CONNECT_PROTOCOL_VERSION = "1.1" as const;
export const LEGACY_AGENTS_ONE_CONNECT_PROTOCOL_VERSION = "1.0" as const;
export const SUPPORTED_AGENTS_ONE_CONNECT_PROTOCOL_VERSIONS = [
  AGENTS_ONE_CONNECT_PROTOCOL_VERSION,
  LEGACY_AGENTS_ONE_CONNECT_PROTOCOL_VERSION,
] as const;
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000;
export const MAX_PAIRING_TTL_MS = 15 * 60 * 1000;
export const MAX_TUNNEL_FRAME_BYTES = 4 * 1024 * 1024;

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 10;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export type ConnectPairingState = "pending" | "paired" | "expired" | "revoked";

/** Public, non-secret description of one Runtime published by a Connector. */
export interface ConnectRuntimeDescriptor {
  runtimeId: string;
  displayName: string;
  kind?: string;
  adapterId?: string;
  adapterVersion?: string;
  /** Optional non-secret capability fingerprint published by the Connector. */
  capabilityDigest?: string;
  enabled?: boolean;
}

/** Safe, non-secret preview shown before a Connector-first pairing is consumed. */
export interface ConnectPairingPreview {
  sessionId: string;
  runtimeId: string;
  displayName: string;
  expiresAt: number;
  runtimes?: ConnectRuntimeDescriptor[];
  deviceFingerprint?: string;
}

export interface ConnectPairingSession {
  sessionId: string;
  runtimeId: string;
  displayName: string;
  codeDigest: string;
  createdAt: number;
  expiresAt: number;
  state: ConnectPairingState;
  /** v1.1 multi-Runtime pairing. `runtimeId` remains for v1.0 readers. */
  runtimes?: ConnectRuntimeDescriptor[];
}

export interface ConnectPairingMaterial {
  session: ConnectPairingSession;
  /** Only the caller displays this value; it must not be persisted. */
  code: string;
}

export interface ConnectDeviceRegistration {
  deviceId: string;
  runtimeId: string;
  sessionId: string;
  publicKey: string;
  createdAt: number;
  lastSeenAt?: number;
  revokedAt?: number;
  /** Public Connector package metadata captured during pairing/hello. */
  connectorVersion?: string;
  /** v1.1 multi-Runtime registration; `runtimeId` remains the primary id. */
  runtimes?: ConnectRuntimeDescriptor[];
}

export type ConnectDeviceState = "online" | "offline" | "revoked";

export interface ConnectDeviceStatus {
  deviceId: string;
  runtimeId: string;
  state: ConnectDeviceState;
  checkedAt: number;
  lastSeenAt?: number;
  protocolVersion?: string;
  connectorVersion?: string;
  reason?: "heartbeat_timeout" | "revoked" | "reauthorization_required";
  runtimes?: ConnectRuntimeDescriptor[];
}

export interface ConnectTunnelRequest {
  type: "request";
  requestId: string;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  /** Explicit route metadata for shared Connector devices. */
  runtimeId?: string;
}

export interface ConnectTunnelResponse {
  type: "response";
  requestId: string;
  status: number;
  body?: unknown;
}

export interface ConnectTunnelEvent {
  type: "event";
  runId: string;
  sequence: number;
  event: unknown;
}

export type ConnectTunnelFrame =
  | ConnectTunnelRequest
  | ConnectTunnelResponse
  | ConnectTunnelEvent;

export function isSupportedConnectProtocolVersion(
  value: unknown,
): value is (typeof SUPPORTED_AGENTS_ONE_CONNECT_PROTOCOL_VERSIONS)[number] {
  return (
    typeof value === "string" &&
    (
      SUPPORTED_AGENTS_ONE_CONNECT_PROTOCOL_VERSIONS as readonly string[]
    ).includes(value)
  );
}

function webCrypto(): Crypto {
  if (!globalThis.crypto?.getRandomValues || !globalThis.crypto.subtle) {
    throw new Error("A secure Web Crypto implementation is required.");
  }
  return globalThis.crypto;
}

function randomCode(): string {
  const bytes = new Uint8Array(PAIRING_CODE_LENGTH);
  webCrypto().getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length],
  ).join("");
}

function randomId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!id) throw new Error("A secure UUID implementation is required.");
  return `${prefix}_${id}`;
}

export function normalizePairingCode(value: string): string {
  return value.replace(/[\s-]/g, "").toUpperCase();
}

export function isPairingCodeShapeValid(value: string): boolean {
  const normalized = normalizePairingCode(value);
  return (
    normalized.length === PAIRING_CODE_LENGTH &&
    [...normalized].every((character) => PAIRING_ALPHABET.includes(character))
  );
}

async function digestPairingCode(code: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizePairingCode(code));
  const digest = await webCrypto().subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createPairingSession(input: {
  runtimeId: string;
  displayName: string;
  now?: number;
  ttlMs?: number;
}): Promise<ConnectPairingMaterial> {
  if (!RUNTIME_ID_PATTERN.test(input.runtimeId)) {
    throw new Error("Runtime ID is invalid.");
  }
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new Error("Display name is invalid.");
  }
  const now = input.now ?? Date.now();
  const ttlMs = Math.min(
    Math.max(30_000, input.ttlMs ?? DEFAULT_PAIRING_TTL_MS),
    MAX_PAIRING_TTL_MS,
  );
  const code = randomCode();
  return {
    code,
    session: {
      sessionId: randomId("pair"),
      runtimeId: input.runtimeId,
      displayName,
      codeDigest: await digestPairingCode(code),
      createdAt: now,
      expiresAt: now + ttlMs,
      state: "pending",
    },
  };
}

export function pairingSessionState(
  session: ConnectPairingSession,
  now = Date.now(),
): ConnectPairingState {
  if (session.state === "pending" && now >= session.expiresAt) return "expired";
  return session.state;
}

export function isPairingSessionUsable(
  session: ConnectPairingSession,
  now = Date.now(),
): boolean {
  return pairingSessionState(session, now) === "pending";
}

export async function verifyPairingCode(
  session: ConnectPairingSession,
  code: string,
  now = Date.now(),
): Promise<boolean> {
  if (!isPairingSessionUsable(session, now) || !isPairingCodeShapeValid(code)) {
    return false;
  }
  return (await digestPairingCode(code)) === session.codeDigest;
}

export function markPairingSessionPaired(
  session: ConnectPairingSession,
  now = Date.now(),
): ConnectPairingSession {
  if (!isPairingSessionUsable(session, now)) {
    throw new Error("Pairing session is no longer usable.");
  }
  return { ...session, state: "paired" };
}

export function revokePairingSession(
  session: ConnectPairingSession,
): ConnectPairingSession {
  return { ...session, state: "revoked" };
}

export function normalizeConnectEndpoint(value: string): string {
  const endpoint = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Connect endpoint is invalid.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Connect endpoint must use HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

export function websocketEndpoint(
  endpoint: string,
  path = "/connect/v1/tunnel",
): string {
  const normalized = normalizeConnectEndpoint(endpoint);
  const url = new URL(normalized);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return url.toString();
}

export function isGatewayV1TunnelPath(path: string): boolean {
  if (!path.startsWith("/") || path.length > 2_048 || path.includes("..")) {
    return false;
  }
  return /^\/(capabilities|commands\/(?:catalog|execute)|runs(?:\/[A-Za-z0-9._:-]+(?:\/events|\/cancel)?)?|artifacts(?:\/[A-Za-z0-9._:-]+)?|workspace-grants(?:\/[A-Za-z0-9._:-]+(?:\/requests|\/results|\/revoke)?)?)$/.test(
    path,
  );
}

export function parseConnectTunnelFrame(value: unknown): ConnectTunnelFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connect tunnel frame must be an object.");
  }
  const frame = value as Record<string, unknown>;
  if (frame.type === "request") {
    if (
      typeof frame.requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(frame.requestId) ||
      (frame.method !== "GET" && frame.method !== "POST") ||
      typeof frame.path !== "string" ||
      !isGatewayV1TunnelPath(frame.path)
    ) {
      throw new Error("Invalid Gateway v1 tunnel request.");
    }
    return {
      type: "request",
      requestId: frame.requestId,
      method: frame.method,
      path: frame.path,
      ...(Object.hasOwn(frame, "body") ? { body: frame.body } : {}),
      ...(typeof frame.runtimeId === "string"
        ? { runtimeId: frame.runtimeId }
        : {}),
    };
  }
  if (frame.type === "response") {
    if (
      typeof frame.requestId !== "string" ||
      !REQUEST_ID_PATTERN.test(frame.requestId) ||
      typeof frame.status !== "number" ||
      !Number.isInteger(frame.status) ||
      frame.status < 100 ||
      frame.status > 599
    ) {
      throw new Error("Invalid Gateway v1 tunnel response.");
    }
    return {
      type: "response",
      requestId: frame.requestId,
      status: frame.status,
      ...(Object.hasOwn(frame, "body") ? { body: frame.body } : {}),
    };
  }
  if (frame.type === "event") {
    if (
      typeof frame.runId !== "string" ||
      !REQUEST_ID_PATTERN.test(frame.runId) ||
      typeof frame.sequence !== "number" ||
      !Number.isSafeInteger(frame.sequence) ||
      frame.sequence < 0 ||
      !Object.hasOwn(frame, "event")
    ) {
      throw new Error("Invalid Gateway v1 tunnel event.");
    }
    return {
      type: "event",
      runId: frame.runId,
      sequence: frame.sequence,
      event: frame.event,
    };
  }
  throw new Error("Unknown Connect tunnel frame type.");
}
