import { normalizeConnectEndpoint } from "../shared/agents-one-connect";
import type {
  ConnectDeviceStatus,
  ConnectPairingPreview,
  ConnectRuntimeDescriptor,
} from "../shared/agents-one-connect";

export interface ConnectPairingSessionView {
  sessionId: string;
  pairingCode: string;
  runtimeId: string;
  displayName: string;
  expiresAt: number;
  connectEndpoint: string;
  tunnelEndpoint: string;
  deviceId?: string;
  runtimes?: ConnectRuntimeDescriptor[];
}

export interface ConnectPairingStatus {
  sessionId: string;
  runtimeId: string;
  displayName: string;
  state: "pending" | "paired" | "expired";
  expiresAt: number;
  deviceId?: string;
  runtimes?: ConnectRuntimeDescriptor[];
}

interface PendingConnectorClaim {
  connectEndpoint: string;
  pairingCode: string;
  runtimeId?: string;
}

interface PendingSession extends ConnectPairingSessionView {
  gatewayToken: string;
  runtimeTokens?: Record<string, string>;
}

function runtimeDescriptors(
  body: Record<string, unknown>,
): ConnectRuntimeDescriptor[] {
  if (!Array.isArray(body.runtimes)) return [];
  return body.runtimes.filter((item): item is ConnectRuntimeDescriptor => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.runtimeId === "string" &&
      /^[a-z][a-z0-9-]{1,63}$/.test(value.runtimeId) &&
      typeof value.displayName === "string" &&
      Boolean(value.displayName.trim())
    );
  });
}

function runtimeTokens(
  body: Record<string, unknown>,
): Record<string, string> | undefined {
  if (!body.runtimeTokens || typeof body.runtimeTokens !== "object") {
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [runtimeId, value] of Object.entries(
    body.runtimeTokens as Record<string, unknown>,
  )) {
    if (
      /^[a-z][a-z0-9-]{1,63}$/.test(runtimeId) &&
      typeof value === "string" &&
      value.trim()
    ) {
      result[runtimeId] = value;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

const pendingSessions = new Map<string, PendingSession>();
const pendingConnectorClaims = new Map<string, PendingConnectorClaim>();

export function getAgentsOneConnectEndpoint(): string {
  const configured =
    process.env.AGENTS_ONE_CONNECT_ENDPOINT ||
    process.env.AGENTS_ONE_CONNECT_URL;
  if (!configured) {
    const allowLoopback =
      process.env.NODE_ENV === "test" ||
      process.env.AGENTS_ONE_CONNECT_ALLOW_LOOPBACK === "1";
    if (!allowLoopback) throw new Error("Connect 服务尚未配置。");
    return normalizeConnectEndpoint("http://127.0.0.1:8788");
  }
  return normalizeConnectEndpoint(configured);
}

function route(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

async function requestJson(
  endpoint: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(route(endpoint, path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(10_000),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? String(
            (body as { error?: { message?: string } }).error?.message ||
              "Connect 请求失败",
          )
        : `Connect 请求失败（HTTP ${response.status}）。`;
    throw new Error(message);
  }
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : {};
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Connect 响应缺少 ${key}。`);
  return value;
}

function numberField(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Connect 响应缺少 ${key}。`);
  return value;
}

export async function createAgentsOneConnectPairingSession(
  runtimeId: string,
  displayName: string,
): Promise<ConnectPairingSessionView> {
  const endpoint = getAgentsOneConnectEndpoint();
  const body = await requestJson(endpoint, "/connect/v1/pair/session", {
    method: "POST",
    body: JSON.stringify({ runtimeId, displayName }),
  });
  const parsedRuntimeTokens = runtimeTokens(body);
  const session: PendingSession = {
    sessionId: stringField(body, "sessionId"),
    pairingCode: stringField(body, "pairingCode"),
    runtimeId: stringField(body, "runtimeId"),
    displayName: stringField(body, "displayName"),
    expiresAt: numberField(body, "expiresAt"),
    connectEndpoint: endpoint,
    tunnelEndpoint: stringField(body, "tunnelEndpoint"),
    gatewayToken: stringField(body, "gatewayToken"),
    ...(parsedRuntimeTokens ? { runtimeTokens: parsedRuntimeTokens } : {}),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
  };
  pendingSessions.set(session.sessionId, session);
  const {
    gatewayToken: _gatewaySecret,
    runtimeTokens: _runtimeSecrets,
    ...safe
  } = session;
  return safe;
}

export async function getAgentsOneConnectPairingStatus(
  sessionId: string,
): Promise<ConnectPairingStatus> {
  const session = pendingSessions.get(sessionId);
  if (!session) throw new Error("Connect 配对会话已过期或不属于当前桌面端。");
  const body = await requestJson(
    session.connectEndpoint,
    `/connect/v1/pair/session/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${session.gatewayToken}` } },
  );
  const state = body.state;
  if (state !== "pending" && state !== "paired" && state !== "expired") {
    throw new Error("Connect 返回了未知的配对状态。");
  }
  const deviceId =
    typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : undefined;
  if (deviceId) {
    const current = pendingSessions.get(sessionId);
    if (current) current.deviceId = deviceId;
  }
  return {
    sessionId,
    runtimeId: stringField(body, "runtimeId"),
    displayName: stringField(body, "displayName"),
    state,
    expiresAt: numberField(body, "expiresAt"),
    ...(deviceId ? { deviceId } : {}),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
  };
}

/** Internal main-process handoff used after a paired device is confirmed. */
export function consumeAgentsOneConnectPairingSession(sessionId: string): {
  connectEndpoint: string;
  runtimeId: string;
  gatewayToken: string;
  deviceId?: string;
  runtimes?: ConnectRuntimeDescriptor[];
  runtimeTokens?: Record<string, string>;
} | null {
  const session = pendingSessions.get(sessionId);
  if (!session) return null;
  pendingSessions.delete(sessionId);
  return {
    connectEndpoint: session.connectEndpoint,
    runtimeId: session.runtimeId,
    gatewayToken: session.gatewayToken,
    ...(session.deviceId ? { deviceId: session.deviceId } : {}),
    ...(session.runtimes ? { runtimes: session.runtimes } : {}),
    ...(session.runtimeTokens ? { runtimeTokens: session.runtimeTokens } : {}),
  };
}

export async function claimAgentsOneConnectPairingCode(
  pairingCode: string,
  runtimeId?: string,
): Promise<{
  connectEndpoint: string;
  runtimeId: string;
  displayName: string;
  deviceId: string;
  gatewayToken: string;
  tunnelEndpoint: string;
  runtimes?: ConnectRuntimeDescriptor[];
  runtimeTokens?: Record<string, string>;
}> {
  const endpoint = getAgentsOneConnectEndpoint();
  const body = await requestJson(endpoint, "/connect/v1/pair/claim", {
    method: "POST",
    body: JSON.stringify({ pairingCode, ...(runtimeId ? { runtimeId } : {}) }),
  });
  return {
    connectEndpoint: endpoint,
    runtimeId: stringField(body, "runtimeId"),
    displayName: stringField(body, "displayName"),
    deviceId: stringField(body, "deviceId"),
    gatewayToken: stringField(body, "gatewayToken"),
    tunnelEndpoint: stringField(body, "tunnelEndpoint"),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
    ...(runtimeTokens(body) ? { runtimeTokens: runtimeTokens(body) } : {}),
  };
}

/**
 * Resolve a Connector-first code without consuming it or receiving any
 * credential material. The caller must explicitly complete the preview.
 */
export async function previewAgentsOneConnectPairingCode(
  pairingCode: string,
  runtimeId?: string,
): Promise<ConnectPairingPreview> {
  const endpoint = getAgentsOneConnectEndpoint();
  const body = await requestJson(endpoint, "/connect/v1/pair/preview", {
    method: "POST",
    body: JSON.stringify({ pairingCode, ...(runtimeId ? { runtimeId } : {}) }),
  });
  const preview: ConnectPairingPreview = {
    sessionId: stringField(body, "sessionId"),
    runtimeId: stringField(body, "runtimeId"),
    displayName: stringField(body, "displayName"),
    expiresAt: numberField(body, "expiresAt"),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
    ...(typeof body.deviceFingerprint === "string" && body.deviceFingerprint
      ? { deviceFingerprint: body.deviceFingerprint }
      : {}),
  };
  pendingConnectorClaims.set(preview.sessionId, {
    connectEndpoint: endpoint,
    pairingCode,
    ...(runtimeId ? { runtimeId } : {}),
  });
  return preview;
}

/** Consume a previously displayed preview after the user confirms it. */
export async function completeAgentsOneConnectPairingPreview(
  sessionId: string,
): Promise<Awaited<ReturnType<typeof claimAgentsOneConnectPairingCode>>> {
  const pending = pendingConnectorClaims.get(sessionId);
  if (!pending) throw new Error("Connect 配对预览已失效，请重新输入校验码。");
  pendingConnectorClaims.delete(sessionId);
  const body = await requestJson(
    pending.connectEndpoint,
    "/connect/v1/pair/claim",
    {
      method: "POST",
      body: JSON.stringify({
        pairingCode: pending.pairingCode,
        ...(pending.runtimeId ? { runtimeId: pending.runtimeId } : {}),
      }),
    },
  );
  return {
    connectEndpoint: pending.connectEndpoint,
    runtimeId: stringField(body, "runtimeId"),
    displayName: stringField(body, "displayName"),
    deviceId: stringField(body, "deviceId"),
    gatewayToken: stringField(body, "gatewayToken"),
    tunnelEndpoint: stringField(body, "tunnelEndpoint"),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
    ...(runtimeTokens(body) ? { runtimeTokens: runtimeTokens(body) } : {}),
  };
}

/** Read a redacted device status with a desktop-scoped Runtime token. */
export async function getAgentsOneConnectDeviceStatus(
  endpoint: string,
  deviceId: string,
  bearerToken: string,
): Promise<ConnectDeviceStatus> {
  const normalizedEndpoint = normalizeConnectEndpoint(endpoint);
  if (!deviceId.trim()) throw new Error("Connect deviceId is required.");
  if (!bearerToken.trim()) throw new Error("Connect device token is required.");
  const body = await requestJson(
    normalizedEndpoint,
    `/connect/v1/devices/${encodeURIComponent(deviceId.trim())}`,
    { headers: { Authorization: `Bearer ${bearerToken.trim()}` } },
  );
  const state = body.state;
  if (state !== "online" && state !== "offline" && state !== "revoked") {
    throw new Error("Connect 返回了未知的设备状态。");
  }
  return {
    deviceId: stringField(body, "deviceId"),
    runtimeId: stringField(body, "runtimeId"),
    state,
    checkedAt: numberField(body, "checkedAt"),
    ...(typeof body.lastSeenAt === "number" && Number.isFinite(body.lastSeenAt)
      ? { lastSeenAt: body.lastSeenAt }
      : {}),
    ...(typeof body.protocolVersion === "string" && body.protocolVersion.trim()
      ? { protocolVersion: body.protocolVersion }
      : {}),
    ...(typeof body.connectorVersion === "string" &&
    body.connectorVersion.trim()
      ? { connectorVersion: body.connectorVersion.trim() }
      : {}),
    ...(body.reason === "heartbeat_timeout" ||
    body.reason === "revoked" ||
    body.reason === "reauthorization_required"
      ? { reason: body.reason }
      : {}),
    ...(runtimeDescriptors(body).length
      ? { runtimes: runtimeDescriptors(body) }
      : {}),
  };
}
