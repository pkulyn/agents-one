import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { WebSocketServer } from "ws";

const PROTOCOL_VERSION = "1.1";
const LEGACY_PROTOCOL_VERSION = "1.0";
const PAIRING_TTL_MS = 5 * 60 * 1000;
const PAIRING_ATTEMPT_WINDOW_MS = 60 * 1000;
const PAIRING_MAX_ATTEMPTS = 8;
const MAX_BODY_BYTES = 256 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_PENDING_REQUESTS_PER_DEVICE = 128;
const MAX_PENDING_REQUESTS_PER_RUNTIME = 32;
const REQUEST_RATE_WINDOW_MS = 1_000;
const MAX_REQUESTS_PER_DEVICE_WINDOW = 120;
const MAX_REQUESTS_PER_RUNTIME_WINDOW = 40;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function error(res, status, message, code = "invalid_request") {
  json(res, status, {
    error: { code, message, retryable: status >= 500 },
  });
}

function bodyOf(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.once("error", reject);
    req.once("end", () => {
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
            : {},
        );
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
  });
}

function token(prefix) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function runtimeTokensFor(runtimes) {
  return Object.fromEntries(
    runtimes.map((runtime) => [runtime.runtimeId, token("gw")]),
  );
}

function pairingCode() {
  const bytes = randomBytes(10);
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join("");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeCode(value) {
  return typeof value === "string"
    ? value.replace(/[\s-]/g, "").toUpperCase()
    : "";
}

function validRuntimeId(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,63}$/.test(value);
}

function normalizeRuntimes(input) {
  const candidates = Array.isArray(input?.runtimes)
    ? input.runtimes
    : input?.runtimeId
      ? [{ runtimeId: input.runtimeId, displayName: input.displayName }]
      : [];
  const seen = new Set();
  const result = [];
  for (const item of candidates.slice(0, 64)) {
    if (
      !item ||
      typeof item !== "object" ||
      !validRuntimeId(item.runtimeId) ||
      typeof item.displayName !== "string" ||
      !item.displayName.trim() ||
      seen.has(item.runtimeId)
    )
      continue;
    seen.add(item.runtimeId);
    result.push({
      runtimeId: item.runtimeId,
      displayName: item.displayName.trim().slice(0, 80),
      ...(typeof item.kind === "string" && item.kind.trim()
        ? { kind: item.kind.trim().slice(0, 128) }
        : {}),
      ...(typeof item.adapterId === "string" && item.adapterId.trim()
        ? { adapterId: item.adapterId.trim().slice(0, 128) }
        : {}),
      ...(typeof item.adapterVersion === "string" && item.adapterVersion.trim()
        ? { adapterVersion: item.adapterVersion.trim().slice(0, 64) }
        : {}),
      ...(typeof item.capabilityDigest === "string" &&
      /^sha256:[a-f0-9]{64}$/i.test(item.capabilityDigest)
        ? { capabilityDigest: item.capabilityDigest.toLowerCase() }
        : {}),
      ...(item.enabled === false ? { enabled: false } : {}),
    });
  }
  return result;
}

function normalizeConnectorMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const version =
    typeof value.version === "string" ? value.version.trim().slice(0, 64) : "";
  return version ? { version } : undefined;
}

function runtimeKey(deviceId, runtimeId) {
  return `${deviceId}:${runtimeId}`;
}

function protocolSupported(value) {
  return value === PROTOCOL_VERSION || value === LEGACY_PROTOCOL_VERSION;
}

function validPublicKey(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512)
    return false;
  try {
    return Buffer.from(value, "base64").length > 16;
  } catch {
    return false;
  }
}

function authToken(req) {
  const header = req.headers.authorization;
  return typeof header === "string" && header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : "";
}

function sendSocket(socket, value) {
  if (socket.readyState === 1) socket.send(JSON.stringify(value));
}

function closeSocket(socket, code, reason) {
  if (socket && socket.readyState === 1) socket.close(code, reason);
}

function sendSocketError(socket, requestId, status, code, message) {
  sendSocket(socket, {
    type: "response",
    requestId,
    status,
    body: { error: { code, message } },
  });
}

function allowTunnelRequest(device, runtimeId, nowValue) {
  device.requestRates ||= new Map();
  const runtimeRate = device.requestRates.get(runtimeId);
  device.deviceRequestRate ||= { startedAt: nowValue, count: 0 };
  const deviceRate = device.deviceRequestRate;
  const runtimeWindowOpen =
    runtimeRate && nowValue - runtimeRate.startedAt < REQUEST_RATE_WINDOW_MS;
  const deviceWindowOpen =
    nowValue - deviceRate.startedAt < REQUEST_RATE_WINDOW_MS;
  if (
    (runtimeWindowOpen &&
      runtimeRate.count >= MAX_REQUESTS_PER_RUNTIME_WINDOW) ||
    (deviceWindowOpen && deviceRate.count >= MAX_REQUESTS_PER_DEVICE_WINDOW)
  )
    return false;
  device.requestRates.set(
    runtimeId,
    runtimeWindowOpen
      ? { ...runtimeRate, count: runtimeRate.count + 1 }
      : { startedAt: nowValue, count: 1 },
  );
  device.deviceRequestRate = deviceWindowOpen
    ? { ...deviceRate, count: deviceRate.count + 1 }
    : { startedAt: nowValue, count: 1 };
  return true;
}

function tunnelFrame(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tunnel frame must be an object.");
  }
  if (value.type === "heartbeat") return value;
  if (value.type === "hello") {
    if (
      !protocolSupported(value.protocolVersion) ||
      (value.role !== "connector" && value.role !== "desktop") ||
      (typeof value.deviceId !== "string" &&
        typeof value.runtimeId !== "string")
    ) {
      throw new Error("Invalid tunnel hello.");
    }
    return value;
  }
  if (value.type === "request") {
    if (
      typeof value.requestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.requestId) ||
      (value.method !== "GET" && value.method !== "POST") ||
      typeof value.path !== "string" ||
      !gatewayPath(value.path)
    )
      throw new Error("Invalid Gateway v1 request.");
    if (value.runtimeId !== undefined && !validRuntimeId(value.runtimeId)) {
      throw new Error("Invalid Runtime route.");
    }
    return value;
  }
  if (value.type === "response") {
    if (
      typeof value.requestId !== "string" ||
      typeof value.status !== "number" ||
      !Number.isInteger(value.status) ||
      value.status < 100 ||
      value.status > 599
    )
      throw new Error("Invalid Gateway v1 response.");
    return value;
  }
  if (value.type === "event") {
    if (
      typeof value.runId !== "string" ||
      !Number.isSafeInteger(value.sequence) ||
      value.sequence < 0
    )
      throw new Error("Invalid Gateway v1 event.");
    return value;
  }
  throw new Error("Unknown tunnel frame.");
}

function gatewayPath(path) {
  if (
    typeof path !== "string" ||
    path.length > 2048 ||
    !path.startsWith("/") ||
    path.includes("..")
  ) {
    return false;
  }
  return /^\/(capabilities|commands\/(?:catalog|execute)|runs(?:\/[A-Za-z0-9._:-]+(?:\/events|\/cancel)?)?|artifacts(?:\/[A-Za-z0-9._:-]+)?|workspace-grants(?:\/[A-Za-z0-9._:-]+(?:\/requests|\/results|\/revoke)?)?)$/.test(
    path,
  );
}

export function createConnectService({
  now = () => Date.now(),
  logger = () => {},
  /** Production deployments provide a user/service-owned state file. Tests
   * may omit it to keep their service fully in-memory. */
  storagePath,
  /** Optional node:https server options. `cert` must contain the server leaf
   * certificate followed by intermediate certificates. `ca`, when present,
   * is for client-certificate verification (mTLS), not the server chain. A
   * public deployment should either provide these or terminate TLS in a
   * trusted reverse proxy. */
  tls,
} = {}) {
  const pairings = new Map();
  const devices = new Map();
  const runtimes = new Map();
  const desktopTokens = new Map();
  const pairingAttempts = new Map();

  function allowPairingAttempt(req) {
    const key = req.socket.remoteAddress || "unknown";
    const current = pairingAttempts.get(key);
    const at = now();
    if (!current || at - current.startedAt >= PAIRING_ATTEMPT_WINDOW_MS) {
      pairingAttempts.set(key, { startedAt: at, count: 1 });
      return true;
    }
    if (current.count >= PAIRING_MAX_ATTEMPTS) return false;
    current.count += 1;
    return true;
  }

  function persistState() {
    if (typeof storagePath !== "string" || !storagePath.trim()) return;
    const state = {
      schemaVersion: 1,
      pairings: [...pairings.entries()].map(([codeDigest, value]) => ({
        codeDigest,
        ...value,
      })),
      devices: [...devices.values()].map((device) => ({
        ...device,
        socket: undefined,
        desktopSockets: undefined,
        pendingRequests: undefined,
        onlineRuntimeIds: undefined,
        requestRates: undefined,
        deviceRequestRate: undefined,
      })),
      desktopTokens: [...desktopTokens.entries()].map(([value, record]) => ({
        value,
        ...record,
      })),
    };
    const target = storagePath.trim();
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, target);
    if (process.platform !== "win32") chmodSync(target, 0o600);
  }

  function restoreState() {
    if (typeof storagePath !== "string" || !storagePath.trim()) return;
    const target = storagePath.trim();
    if (!existsSync(target)) return;
    try {
      const state = JSON.parse(readFileSync(target, "utf8"));
      if (!state || state.schemaVersion !== 1)
        throw new Error("unsupported state");
      for (const item of Array.isArray(state.pairings) ? state.pairings : []) {
        if (typeof item.codeDigest !== "string") continue;
        const { codeDigest, ...pairing } = item;
        pairings.set(codeDigest, pairing);
      }
      for (const item of Array.isArray(state.devices) ? state.devices : []) {
        if (!item || typeof item.deviceId !== "string") continue;
        const device = {
          ...item,
          socket: null,
          desktopSockets: new Map(),
          pendingRequests: new Map(),
          onlineRuntimeIds: new Set(),
          requestRates: new Map(),
          deviceRequestRate: undefined,
        };
        devices.set(device.deviceId, device);
        for (const runtime of device.runtimes || []) {
          runtimes.set(
            runtimeKey(device.deviceId, runtime.runtimeId),
            device.deviceId,
          );
        }
      }
      for (const item of Array.isArray(state.desktopTokens)
        ? state.desktopTokens
        : []) {
        if (typeof item.value !== "string") continue;
        const { value, ...record } = item;
        desktopTokens.set(value, record);
      }
      // Migrate Runtime-scoped credentials written before `scope` was
      // persisted. The device's private runtimeTokens map is the only safe
      // source for this inference; aggregate Gateway tokens are not present
      // in that map.
      for (const device of devices.values()) {
        for (const [runtimeId, runtimeToken] of Object.entries(
          device.runtimeTokens || {},
        )) {
          const record = desktopTokens.get(runtimeToken);
          if (record && !record.scope) {
            record.scope = "runtime";
            record.runtimeId = runtimeId;
            record.runtimeIds = [runtimeId];
          }
        }
      }
    } catch (cause) {
      logger(cause);
      // Keep the service available with an empty in-memory state. The corrupt
      // file is never overwritten until a new mutation is made.
    }
  }

  restoreState();
  const requestHandler = async (req, res) => {
    const url = new URL(req.url || "/", "http://connect.local");
    try {
      if (req.method === "GET" && url.pathname === "/connect/v1/health") {
        json(res, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION });
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/connect/v1/pair/request"
      ) {
        const input = await bodyOf(req);
        const runtimeList = normalizeRuntimes(input);
        if (!runtimeList.length || !validPublicKey(input.publicKey)) {
          error(
            res,
            422,
            "runtimes (or runtimeId), displayName and publicKey are required.",
          );
          return;
        }
        const code = pairingCode();
        const sessionId = `pair_${randomUUID()}`;
        const expiresAt = now() + PAIRING_TTL_MS;
        const requestToken = token("pair");
        pairings.set(digest(code), {
          sessionId,
          runtimeId: runtimeList[0].runtimeId,
          displayName: runtimeList[0].displayName,
          runtimes: runtimeList,
          expiresAt,
          requestToken,
          publicKey: input.publicKey,
          ...(normalizeConnectorMetadata(input.connector)
            ? { connector: normalizeConnectorMetadata(input.connector) }
            : {}),
          state: "pending",
          mode: "connector-request",
        });
        persistState();
        json(res, 201, {
          protocolVersion: PROTOCOL_VERSION,
          sessionId,
          pairingCode: code,
          runtimeId: runtimeList[0].runtimeId,
          displayName: runtimeList[0].displayName,
          runtimes: runtimeList,
          requestToken,
          expiresAt,
        });
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/connect/v1/pair/session"
      ) {
        const input = await bodyOf(req);
        const runtimeList = normalizeRuntimes(input);
        if (!runtimeList.length) {
          error(
            res,
            422,
            "runtimes (or runtimeId) and displayName are required.",
          );
          return;
        }
        const code = pairingCode();
        const sessionId = `pair_${randomUUID()}`;
        const expiresAt = now() + PAIRING_TTL_MS;
        const gatewayToken = token("gw");
        const runtimeTokens = runtimeTokensFor(runtimeList);
        pairings.set(digest(code), {
          sessionId,
          runtimeId: runtimeList[0].runtimeId,
          displayName: runtimeList[0].displayName,
          runtimes: runtimeList,
          expiresAt,
          gatewayToken,
          runtimeTokens,
          state: "pending",
        });
        desktopTokens.set(gatewayToken, {
          runtimeIds: runtimeList.map((item) => item.runtimeId),
          sessionId,
          scope: "device",
        });
        for (const [runtimeId, runtimeToken] of Object.entries(runtimeTokens)) {
          desktopTokens.set(runtimeToken, {
            runtimeIds: [runtimeId],
            sessionId,
            runtimeId,
            scope: "runtime",
          });
        }
        persistState();
        json(res, 201, {
          protocolVersion: PROTOCOL_VERSION,
          sessionId,
          pairingCode: code,
          runtimeId: runtimeList[0].runtimeId,
          displayName: runtimeList[0].displayName,
          runtimes: runtimeList,
          gatewayToken,
          runtimeTokens,
          expiresAt,
          tunnelEndpoint: "/connect/v1/tunnel",
        });
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/connect/v1/pair/preview"
      ) {
        const input = await bodyOf(req);
        if (!allowPairingAttempt(req)) {
          error(
            res,
            429,
            "Too many pairing attempts; try again later.",
            "pairing_rate_limited",
          );
          return;
        }
        const normalizedPairingCode = normalizeCode(input.pairingCode);
        if (!/^[A-Z2-9]{10}$/.test(normalizedPairingCode)) {
          error(res, 422, "Pairing code is invalid.", "pairing_invalid");
          return;
        }
        const pairing = pairings.get(digest(normalizedPairingCode));
        if (
          !pairing ||
          pairing.mode !== "connector-request" ||
          pairing.state !== "pending" ||
          pairing.expiresAt <= now()
        ) {
          error(
            res,
            410,
            "Pairing code is expired or invalid.",
            "pairing_expired",
          );
          return;
        }
        if (
          input.runtimeId &&
          !pairing.runtimes.some((item) => item.runtimeId === input.runtimeId)
        ) {
          error(
            res,
            403,
            "Runtime ID does not match the pairing request.",
            "permission_denied",
          );
          return;
        }
        // Preview is intentionally credential-free. The fingerprint is only
        // a short, non-reversible summary of the Connector public key.
        json(res, 200, {
          protocolVersion: PROTOCOL_VERSION,
          sessionId: pairing.sessionId,
          runtimeId: input.runtimeId || pairing.runtimeId,
          displayName: pairing.displayName,
          runtimes: pairing.runtimes,
          expiresAt: pairing.expiresAt,
          deviceFingerprint: `sha256:${digest(pairing.publicKey).slice(0, 16)}`,
          state: "pending",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/connect/v1/pair/claim") {
        const input = await bodyOf(req);
        if (!allowPairingAttempt(req)) {
          error(
            res,
            429,
            "Too many pairing attempts; try again later.",
            "pairing_rate_limited",
          );
          return;
        }
        const normalizedPairingCode = normalizeCode(input.pairingCode);
        if (!/^[A-Z2-9]{10}$/.test(normalizedPairingCode)) {
          error(res, 422, "Pairing code is invalid.", "pairing_invalid");
          return;
        }
        const pairing = pairings.get(digest(normalizedPairingCode));
        if (
          !pairing ||
          pairing.mode !== "connector-request" ||
          pairing.state !== "pending" ||
          pairing.expiresAt <= now()
        ) {
          error(
            res,
            410,
            "Pairing code is expired or invalid.",
            "pairing_expired",
          );
          return;
        }
        if (
          input.runtimeId &&
          !pairing.runtimes.some((item) => item.runtimeId === input.runtimeId)
        ) {
          error(
            res,
            403,
            "Runtime ID does not match the pairing request.",
            "permission_denied",
          );
          return;
        }
        const deviceId = `device_${randomUUID()}`;
        const deviceToken = token("device");
        const runtimeTokens = runtimeTokensFor(pairing.runtimes);
        const device = {
          deviceId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          runtimeTokens,
          sessionId: pairing.sessionId,
          publicKey: pairing.publicKey,
          deviceToken,
          ...(pairing.connector ? { connector: pairing.connector } : {}),
          state: "paired",
          createdAt: now(),
          socket: null,
          desktopSockets: new Map(),
          pendingRequests: new Map(),
          requestRates: new Map(),
          deviceRequestRate: undefined,
        };
        devices.set(deviceId, device);
        for (const runtime of pairing.runtimes) {
          runtimes.set(runtimeKey(deviceId, runtime.runtimeId), deviceId);
        }
        pairing.state = "paired";
        const gatewayToken = token("gw");
        pairing.gatewayToken = gatewayToken;
        pairing.runtimeTokens = runtimeTokens;
        desktopTokens.set(gatewayToken, {
          deviceId,
          runtimeIds: pairing.runtimes.map((item) => item.runtimeId),
          sessionId: pairing.sessionId,
          scope: "device",
        });
        for (const [runtimeId, runtimeToken] of Object.entries(
          pairing.runtimeTokens,
        )) {
          desktopTokens.set(runtimeToken, {
            deviceId,
            runtimeIds: [runtimeId],
            sessionId: pairing.sessionId,
            runtimeId,
            scope: "runtime",
          });
        }
        persistState();
        json(res, 200, {
          protocolVersion: PROTOCOL_VERSION,
          sessionId: pairing.sessionId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          displayName: pairing.displayName,
          deviceId,
          gatewayToken,
          runtimeTokens: pairing.runtimeTokens,
          tunnelEndpoint: "/connect/v1/tunnel",
        });
        return;
      }
      const pairingRequestStatusMatch = url.pathname.match(
        /^\/connect\/v1\/pair\/request\/([^/]+)$/,
      );
      if (req.method === "GET" && pairingRequestStatusMatch) {
        const sessionId = decodeURIComponent(pairingRequestStatusMatch[1]);
        const pairing = [...pairings.values()].find(
          (item) => item.sessionId === sessionId,
        );
        if (
          !pairing ||
          pairing.mode !== "connector-request" ||
          authToken(req) !== pairing.requestToken
        ) {
          error(
            res,
            401,
            "Pairing request authorization failed.",
            "unauthorized",
          );
          return;
        }
        const device = [...devices.values()].find(
          (item) => item.sessionId === sessionId,
        );
        json(res, 200, {
          sessionId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          displayName: pairing.displayName,
          state:
            pairing.expiresAt <= now() && pairing.state === "pending"
              ? "expired"
              : pairing.state,
          expiresAt: pairing.expiresAt,
          ...(device
            ? {
                deviceId: device.deviceId,
                deviceToken: device.deviceToken,
                tunnelEndpoint: "/connect/v1/tunnel",
              }
            : {}),
        });
        return;
      }
      if (
        req.method === "POST" &&
        url.pathname === "/connect/v1/pair/exchange"
      ) {
        const input = await bodyOf(req);
        if (!allowPairingAttempt(req)) {
          error(
            res,
            429,
            "Too many pairing attempts; try again later.",
            "pairing_rate_limited",
          );
          return;
        }
        const code = normalizeCode(input.pairingCode);
        if (!/^[A-Z2-9]{10}$/.test(code)) {
          error(res, 422, "Pairing code is invalid.", "pairing_invalid");
          return;
        }
        const pairing = pairings.get(digest(code));
        if (
          !pairing ||
          pairing.state !== "pending" ||
          pairing.expiresAt <= now()
        ) {
          error(
            res,
            410,
            "Pairing code is expired or invalid.",
            "pairing_expired",
          );
          return;
        }
        const runtimeList = normalizeRuntimes(input);
        if (
          !runtimeList.length ||
          runtimeList[0].runtimeId !== pairing.runtimeId ||
          !validPublicKey(input.publicKey)
        ) {
          error(
            res,
            403,
            "Connector identity does not match the pairing session.",
            "permission_denied",
          );
          return;
        }
        const deviceId = `device_${randomUUID()}`;
        const deviceToken = token("device");
        const runtimeTokens = runtimeTokensFor(pairing.runtimes);
        const device = {
          deviceId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          runtimeTokens,
          sessionId: pairing.sessionId,
          publicKey: input.publicKey,
          deviceToken,
          ...(normalizeConnectorMetadata(input.connector)
            ? { connector: normalizeConnectorMetadata(input.connector) }
            : {}),
          state: "paired",
          createdAt: now(),
          socket: null,
          desktopSockets: new Map(),
          pendingRequests: new Map(),
          requestRates: new Map(),
          deviceRequestRate: undefined,
        };
        devices.set(deviceId, device);
        for (const runtime of pairing.runtimes) {
          runtimes.set(runtimeKey(deviceId, runtime.runtimeId), deviceId);
        }
        pairing.state = "paired";
        pairing.runtimeTokens = runtimeTokens;
        const legacyGatewayToken = pairing.gatewayToken;
        if (legacyGatewayToken) {
          desktopTokens.set(legacyGatewayToken, {
            deviceId,
            runtimeIds: pairing.runtimes.map((item) => item.runtimeId),
            sessionId: pairing.sessionId,
            scope: "device",
          });
        }
        for (const [runtimeId, runtimeToken] of Object.entries(runtimeTokens)) {
          desktopTokens.set(runtimeToken, {
            deviceId,
            runtimeIds: [runtimeId],
            sessionId: pairing.sessionId,
            runtimeId,
            scope: "runtime",
          });
        }
        persistState();
        json(res, 201, {
          protocolVersion: PROTOCOL_VERSION,
          deviceId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          deviceToken,
          runtimeTokens,
          tunnelEndpoint: "/connect/v1/tunnel",
        });
        return;
      }
      const pairingStatusMatch = url.pathname.match(
        /^\/connect\/v1\/pair\/session\/([^/]+)$/,
      );
      if (req.method === "GET" && pairingStatusMatch) {
        const sessionId = decodeURIComponent(pairingStatusMatch[1]);
        const pairing = [...pairings.values()].find(
          (item) => item.sessionId === sessionId,
        );
        if (!pairing || authToken(req) !== pairing.gatewayToken) {
          error(
            res,
            401,
            "Pairing session authorization failed.",
            "unauthorized",
          );
          return;
        }
        const deviceId = [...devices.values()].find(
          (item) => item.sessionId === sessionId,
        )?.deviceId;
        json(res, 200, {
          sessionId,
          runtimeId: pairing.runtimeId,
          runtimes: pairing.runtimes,
          displayName: pairing.displayName,
          state:
            pairing.expiresAt <= now() && pairing.state === "pending"
              ? "expired"
              : pairing.state,
          expiresAt: pairing.expiresAt,
          ...(deviceId ? { deviceId } : {}),
        });
        return;
      }
      const revokeMatch = url.pathname.match(
        /^\/connect\/v1\/devices\/([^/]+)\/revoke$/,
      );
      if (req.method === "POST" && revokeMatch) {
        const device = devices.get(decodeURIComponent(revokeMatch[1]));
        if (!device || authToken(req) !== device.deviceToken) {
          error(res, 401, "Device authorization failed.", "unauthorized");
          return;
        }
        device.state = "revoked";
        for (const runtime of device.runtimes || []) {
          const key = runtimeKey(device.deviceId, runtime.runtimeId);
          if (runtimes.get(key) === device.deviceId) runtimes.delete(key);
        }
        closeSocket(device.socket, 4003, "device revoked");
        device.socket = null;
        for (const socket of device.desktopSockets?.values() || []) {
          closeSocket(socket, 4003, "device revoked");
        }
        device.desktopSockets?.clear();
        persistState();
        json(res, 200, { deviceId: device.deviceId, revoked: true });
        return;
      }
      const statusMatch = url.pathname.match(
        /^\/connect\/v1\/devices\/([^/]+)$/,
      );
      if (req.method === "GET" && statusMatch) {
        const device = devices.get(decodeURIComponent(statusMatch[1]));
        const presented = authToken(req);
        const desktopRecord = desktopTokens.get(presented);
        const authorized =
          device &&
          (presented === device.deviceToken ||
            desktopRecord?.deviceId === device.deviceId ||
            desktopRecord?.sessionId === device.sessionId);
        if (!device || !authorized) {
          error(res, 401, "Device authorization failed.", "unauthorized");
          return;
        }
        const state =
          device.state === "revoked"
            ? "revoked"
            : device.socket &&
                (!desktopRecord?.runtimeId ||
                  !device.onlineRuntimeIds ||
                  device.onlineRuntimeIds.has(desktopRecord.runtimeId))
              ? "online"
              : "offline";
        const scopedRuntime =
          desktopRecord?.scope === "runtime" && desktopRecord.runtimeId
            ? desktopRecord.runtimeId
            : undefined;
        const visibleRuntimes = scopedRuntime
          ? (device.runtimes || []).filter(
              (runtime) => runtime.runtimeId === scopedRuntime,
            )
          : device.runtimes || [];
        json(res, 200, {
          deviceId: device.deviceId,
          runtimeId: scopedRuntime || device.runtimeId,
          runtimes: visibleRuntimes,
          state,
          protocolVersion: PROTOCOL_VERSION,
          ...(typeof device.lastSeenAt === "number"
            ? { lastSeenAt: device.lastSeenAt }
            : {}),
          ...(device.connector?.version
            ? { connectorVersion: device.connector.version }
            : {}),
          ...(state === "revoked" ? { reason: "revoked" } : {}),
          checkedAt: now(),
        });
        return;
      }
      const runtimeListMatch = url.pathname.match(
        /^\/connect\/v1\/devices\/([^/]+)\/runtimes(?:\/(publish))?$/,
      );
      if (runtimeListMatch && (req.method === "GET" || req.method === "POST")) {
        const device = devices.get(decodeURIComponent(runtimeListMatch[1]));
        const presented = authToken(req);
        const desktopRecord = desktopTokens.get(presented);
        const isDevice = device && presented === device.deviceToken;
        const isDesktop =
          device &&
          (desktopRecord?.deviceId === device.deviceId ||
            desktopRecord?.sessionId === device.sessionId);
        if (!device || (!isDevice && !isDesktop)) {
          error(res, 401, "Device authorization failed.", "unauthorized");
          return;
        }
        if (req.method === "GET") {
          const scopedRuntime =
            desktopRecord?.scope === "runtime" && desktopRecord.runtimeId
              ? desktopRecord.runtimeId
              : undefined;
          json(res, 200, {
            deviceId: device.deviceId,
            runtimes: scopedRuntime
              ? (device.runtimes || []).filter(
                  (runtime) => runtime.runtimeId === scopedRuntime,
                )
              : device.runtimes || [],
            checkedAt: now(),
          });
          return;
        }
        const input = await bodyOf(req);
        const next = normalizeRuntimes(input);
        if (!next.length) {
          error(res, 422, "At least one Runtime is required.");
          return;
        }
        if (runtimeListMatch[2] === "publish") {
          const allowed = new Set(
            (device.runtimes || []).map((runtime) => runtime.runtimeId),
          );
          if (
            !isDevice ||
            !next.every((runtime) => allowed.has(runtime.runtimeId))
          ) {
            error(
              res,
              403,
              "Connector may publish only approved Runtime IDs.",
              "runtime_not_registered",
            );
            return;
          }
          const publishedById = new Map(
            next.map((runtime) => [runtime.runtimeId, runtime]),
          );
          device.runtimes = (device.runtimes || []).map(
            (runtime) => publishedById.get(runtime.runtimeId) || runtime,
          );
        } else {
          if (
            !isDesktop ||
            input.approved !== true ||
            desktopRecord?.scope === "runtime"
          ) {
            error(
              res,
              403,
              "A Desktop approval is required to change the Runtime list.",
              "permission_denied",
            );
            return;
          }
          if (!next.some((runtime) => runtime.runtimeId === device.runtimeId)) {
            error(
              res,
              422,
              "The primary Runtime cannot be removed from a device.",
              "runtime_not_registered",
            );
            return;
          }
          const nextRuntimeIds = next.map((runtime) => runtime.runtimeId);
          const nextRuntimeTokens = { ...(device.runtimeTokens || {}) };
          // Remove scoped credentials for Runtime IDs that are no longer
          // approved. The device-scoped aggregate token is retained for
          // backward compatibility but its allow-list is narrowed below.
          for (const [value, tokenRecord] of desktopTokens.entries()) {
            if (
              tokenRecord.deviceId !== device.deviceId &&
              tokenRecord.sessionId !== device.sessionId
            ) {
              continue;
            }
            if (
              tokenRecord.scope === "runtime" ||
              typeof tokenRecord.runtimeId === "string"
            ) {
              if (!nextRuntimeIds.includes(tokenRecord.runtimeId)) {
                desktopTokens.delete(value);
                if (tokenRecord.runtimeId) {
                  delete nextRuntimeTokens[tokenRecord.runtimeId];
                }
              }
              continue;
            }
            tokenRecord.deviceId = device.deviceId;
            tokenRecord.runtimeIds = nextRuntimeIds;
          }
          // Every newly approved Runtime receives a separate credential. The
          // aggregate token remains usable only as a legacy compatibility
          // path; new desktop records must use the scoped value.
          for (const runtime of next) {
            if (!nextRuntimeTokens[runtime.runtimeId]) {
              const runtimeToken = token("gw");
              nextRuntimeTokens[runtime.runtimeId] = runtimeToken;
              desktopTokens.set(runtimeToken, {
                deviceId: device.deviceId,
                runtimeIds: [runtime.runtimeId],
                runtimeId: runtime.runtimeId,
                sessionId: device.sessionId,
                scope: "runtime",
              });
            }
          }
          device.runtimeTokens = nextRuntimeTokens;
          for (const runtime of device.runtimes || []) {
            runtimes.delete(runtimeKey(device.deviceId, runtime.runtimeId));
          }
          device.runtimes = next;
          for (const runtime of next) {
            runtimes.set(
              runtimeKey(device.deviceId, runtime.runtimeId),
              device.deviceId,
            );
          }
          for (const tokenRecord of desktopTokens.values()) {
            if (
              tokenRecord.deviceId === device.deviceId ||
              tokenRecord.sessionId === device.sessionId
            ) {
              if (
                tokenRecord.scope !== "runtime" &&
                typeof tokenRecord.runtimeId !== "string"
              ) {
                tokenRecord.runtimeIds = nextRuntimeIds;
              }
              tokenRecord.deviceId = device.deviceId;
            }
          }
          for (const [runtimeId, socket] of device.desktopSockets || []) {
            if (!nextRuntimeIds.includes(runtimeId)) {
              closeSocket(socket, 4001, "runtime authorization revoked");
              device.desktopSockets.delete(runtimeId);
            }
          }
        }
        persistState();
        json(res, 200, {
          deviceId: device.deviceId,
          runtimes: device.runtimes || [],
          ...(runtimeListMatch[2] !== "publish" && device.runtimeTokens
            ? { runtimeTokens: device.runtimeTokens }
            : {}),
          updatedAt: now(),
        });
        return;
      }
      error(res, 404, "Connect route not found.", "not_found");
    } catch (cause) {
      logger(cause);
      if (!res.headersSent)
        error(
          res,
          400,
          cause instanceof Error ? cause.message : "Invalid request.",
        );
    }
  };

  if (
    tls !== undefined &&
    (!tls || typeof tls !== "object" || !tls.key || !tls.cert)
  ) {
    throw new Error("Connect TLS requires both key and cert.");
  }
  const server = tls
    ? createHttpsServer(tls, requestHandler)
    : createServer(requestHandler);

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 4 * 1024 * 1024,
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://connect.local");
    if (url.pathname !== "/connect/v1/tunnel") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) =>
      wss.emit("connection", client, req),
    );
  });

  wss.on("connection", (socket) => {
    let identity;
    const helloTimeout = setTimeout(
      () => closeSocket(socket, 4000, "hello required"),
      5_000,
    );
    socket.once("message", (raw) => {
      clearTimeout(helloTimeout);
      try {
        const hello = JSON.parse(raw.toString("utf8"));
        if (hello.type !== "hello") throw new Error("Invalid hello.");
        if (!protocolSupported(hello.protocolVersion)) {
          sendSocket(socket, {
            type: "hello_ack",
            protocolVersion: PROTOCOL_VERSION,
            state: "incompatible",
            error: {
              code: "incompatible_version",
              message: `Connect supports protocol ${PROTOCOL_VERSION} and legacy ${LEGACY_PROTOCOL_VERSION}.`,
            },
          });
          setTimeout(
            () => closeSocket(socket, 4006, "incompatible version"),
            10,
          );
          return;
        }
        if (hello.role === "connector") {
          const device = devices.get(hello.deviceId);
          if (
            !device ||
            device.state === "revoked" ||
            hello.deviceToken !== device.deviceToken
          ) {
            closeSocket(socket, 4001, "connector unauthorized");
            return;
          }
          const advertised = normalizeRuntimes({
            runtimes: hello.runtimes,
            runtimeId: hello.runtimeId || device.runtimeId,
            displayName:
              hello.displayName || device.displayName || device.runtimeId,
          });
          const allowed = new Set(
            (device.runtimes || []).map((item) => item.runtimeId),
          );
          device.onlineRuntimeIds = new Set(
            advertised
              .map((item) => item.runtimeId)
              .filter((id) => allowed.has(id)),
          );
          if (device.socket && device.socket !== socket)
            closeSocket(device.socket, 4002, "replaced by new connection");
          device.socket = socket;
          device.lastSeenAt = now();
          const connector = normalizeConnectorMetadata(hello.connector);
          if (connector) device.connector = connector;
          persistState();
          identity = { role: "connector", device };
          sendSocket(socket, {
            type: "hello_ack",
            protocolVersion: PROTOCOL_VERSION,
            deviceId: device.deviceId,
            runtimeId: device.runtimeId,
            runtimes: device.runtimes || [],
          });
        } else if (hello.role === "desktop") {
          const tokenRecord = desktopTokens.get(hello.gatewayToken);
          if (
            !tokenRecord ||
            !validRuntimeId(hello.runtimeId) ||
            !tokenRecord.runtimeIds?.includes(hello.runtimeId)
          ) {
            closeSocket(socket, 4001, "desktop unauthorized");
            return;
          }
          const deviceId =
            tokenRecord.deviceId ||
            [...devices.values()].find(
              (item) => item.sessionId === tokenRecord.sessionId,
            )?.deviceId;
          const device = deviceId ? devices.get(deviceId) : undefined;
          if (!device || device.state === "revoked") {
            closeSocket(socket, 4004, "connector offline");
            return;
          }
          const selectedRuntime = (device.runtimes || []).find(
            (runtime) => runtime.runtimeId === hello.runtimeId,
          );
          if (!selectedRuntime) {
            closeSocket(socket, 4001, "runtime not registered");
            return;
          }
          if (selectedRuntime.enabled === false) {
            sendSocket(socket, {
              type: "hello_ack",
              protocolVersion: PROTOCOL_VERSION,
              runtimeId: hello.runtimeId,
              state: "disabled",
              error: {
                code: "runtime_disabled",
                message: "The requested Runtime is disabled.",
              },
            });
            closeSocket(socket, 4003, "runtime disabled");
            return;
          }
          device.desktopSockets ||= new Map();
          device.desktopSockets.set(hello.runtimeId, socket);
          identity = { role: "desktop", device, runtimeId: hello.runtimeId };
          const online =
            device.socket &&
            (!device.onlineRuntimeIds ||
              device.onlineRuntimeIds.has(hello.runtimeId));
          sendSocket(socket, {
            type: "hello_ack",
            protocolVersion: PROTOCOL_VERSION,
            runtimeId: hello.runtimeId,
            state: online ? "online" : "offline",
            runtimes: device.runtimes || [],
          });
        } else {
          throw new Error("Unknown tunnel role.");
        }
      } catch {
        closeSocket(socket, 4000, "invalid hello");
      }
    });
    socket.on("message", (raw) => {
      if (!identity) return;
      try {
        let frame = tunnelFrame(JSON.parse(raw.toString("utf8")));
        if (frame.type === "heartbeat") {
          identity.device.lastSeenAt = now();
          sendSocket(socket, { type: "heartbeat_ack", at: now() });
          return;
        }
        if (frame.type === "hello") return;
        if (frame.type === "request" && identity.role === "desktop") {
          if (frame.runtimeId && frame.runtimeId !== identity.runtimeId) {
            throw new Error(
              "Runtime route does not match the desktop session.",
            );
          }
          const pending = identity.device.pendingRequests || new Map();
          const pendingForRuntime = [...pending.values()].filter(
            (runtimeId) => runtimeId === identity.runtimeId,
          ).length;
          if (pending.has(frame.requestId)) {
            sendSocketError(
              socket,
              frame.requestId,
              409,
              "request_id_conflict",
              "The requestId is already in flight.",
            );
            return;
          }
          if (
            pending.size >= MAX_PENDING_REQUESTS_PER_DEVICE ||
            pendingForRuntime >= MAX_PENDING_REQUESTS_PER_RUNTIME ||
            !allowTunnelRequest(identity.device, identity.runtimeId, now())
          ) {
            sendSocketError(
              socket,
              frame.requestId,
              429,
              "tunnel_rate_limited",
              "The Runtime tunnel is busy or rate limited.",
            );
            return;
          }
          frame = { ...frame, runtimeId: identity.runtimeId };
        }
        let target;
        if (identity.role === "connector") {
          const runtimeId =
            frame.runtimeId ||
            (frame.type === "response"
              ? identity.device.pendingRequests?.get(frame.requestId)
              : undefined);
          target = runtimeId
            ? identity.device.desktopSockets?.get(runtimeId)
            : undefined;
          if (frame.type === "response" && runtimeId) {
            identity.device.pendingRequests?.delete(frame.requestId);
          }
        } else {
          const runtimeId = identity.runtimeId;
          if (frame.type === "request") {
            identity.device.pendingRequests ||= new Map();
            identity.device.pendingRequests?.set(frame.requestId, runtimeId);
          }
          target = identity.device.socket;
        }
        if (target) {
          sendSocket(target, frame);
        } else if (frame.type === "request" && identity.role === "desktop") {
          const code = identity.device.socket
            ? identity.device.onlineRuntimeIds &&
              !identity.device.onlineRuntimeIds.has(identity.runtimeId)
              ? "runtime_offline"
              : "connector_offline"
            : "connector_offline";
          sendSocket(socket, {
            type: "response",
            requestId: frame.requestId,
            status: code === "runtime_offline" ? 503 : 503,
            body: {
              error: {
                code,
                message:
                  code === "runtime_offline"
                    ? "The requested Runtime is offline."
                    : "The Connector is offline.",
              },
            },
          });
          identity.device.pendingRequests?.delete(frame.requestId);
        }
      } catch {
        closeSocket(socket, 4000, "invalid tunnel frame");
      }
    });
    socket.on("close", () => {
      if (!identity) return;
      if (identity.role === "connector" && identity.device.socket === socket)
        identity.device.socket = null;
      if (identity.role === "desktop") {
        const sockets = identity.device.desktopSockets;
        if (sockets?.get(identity.runtimeId) === socket)
          sockets.delete(identity.runtimeId);
        for (const [requestId, runtimeId] of identity.device.pendingRequests ||
          []) {
          if (runtimeId === identity.runtimeId)
            identity.device.pendingRequests.delete(requestId);
        }
      }
    });
  });

  return {
    server,
    wss,
    pairings,
    devices,
    async listen(port = 0, host = "127.0.0.1") {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      persistState();
      for (const device of devices.values()) {
        closeSocket(device.socket, 1001, "service stopping");
        for (const socket of device.desktopSockets?.values() || []) {
          closeSocket(socket, 1001, "service stopping");
        }
      }
      await new Promise((resolve) => wss.close(resolve));
      await new Promise((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      );
    },
  };
}
