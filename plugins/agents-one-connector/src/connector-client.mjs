import { generateKeyPairSync } from "node:crypto";
import WebSocket from "ws";
import { createCredentialStore } from "./credential-store.mjs";

const CONNECT_PROTOCOL_VERSION = "1.1";
const CONNECTOR_VERSION = "0.1.0";
const RUNTIME_ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function normalizeRuntimeDescriptors({ runtimes, runtimeId, displayName }) {
  const candidates = Array.isArray(runtimes)
    ? runtimes
    : runtimeId
      ? [{ runtimeId, displayName }]
      : [];
  const seen = new Set();
  const result = [];
  for (const item of candidates) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.runtimeId !== "string" ||
      !RUNTIME_ID_PATTERN.test(item.runtimeId) ||
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
  if (!result.length) throw new Error("At least one Runtime is required.");
  return result;
}

function runtimesFromResponse(body, fallback) {
  try {
    return normalizeRuntimeDescriptors({
      runtimes: body.runtimes,
      runtimeId: body.runtimeId || fallback?.runtimeId,
      displayName: body.displayName || fallback?.displayName,
    });
  } catch {
    return fallback ? normalizeRuntimeDescriptors(fallback) : [];
  }
}

function endpointUrl(endpoint, path) {
  const base = new URL(endpoint);
  if (
    base.protocol !== "https:" &&
    !(
      base.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)
    )
  ) {
    throw new Error(
      "Connect endpoint must use HTTPS (HTTP is allowed only for local development).",
    );
  }
  return new URL(
    path.replace(/^\/+/, ""),
    `${base.toString().replace(/\/+$/, "")}/`,
  ).toString();
}

function tunnelUrl(endpoint, configuredEndpoint) {
  if (
    typeof configuredEndpoint === "string" &&
    configuredEndpoint.startsWith("ws")
  ) {
    return configuredEndpoint;
  }
  const base = new URL(endpoint);
  base.protocol = base.protocol === "http:" ? "ws:" : "wss:";
  base.pathname = "/connect/v1/tunnel";
  base.search = "";
  base.hash = "";
  return base.toString();
}

function publicKeyBase64(publicKey) {
  return publicKey.export({ type: "spki", format: "der" }).toString("base64");
}

export async function pairConnector({
  connectEndpoint,
  pairingCode,
  runtimeId,
  displayName,
  runtimes,
  store = createCredentialStore(),
  fetchImpl = globalThis.fetch,
}) {
  if (!fetchImpl) throw new Error("A global fetch implementation is required.");
  const normalizedCode = pairingCode.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-9]{10}$/.test(normalizedCode)) {
    throw new Error("Pairing code must contain 10 letters or digits.");
  }
  const runtimeList = normalizeRuntimeDescriptors({
    runtimes,
    runtimeId,
    displayName,
  });
  const primary = runtimeList[0];
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const response = await fetchImpl(
    endpointUrl(connectEndpoint, "/connect/v1/pair/exchange"),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: CONNECT_PROTOCOL_VERSION,
        pairingCode: normalizedCode,
        runtimeId: primary.runtimeId,
        displayName: primary.displayName,
        ...(runtimes ? { runtimes: runtimeList } : {}),
        publicKey: publicKeyBase64(publicKey),
        connector: { id: "agents-one-connector", version: CONNECTOR_VERSION },
      }),
    },
  );
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body || typeof body !== "object") {
    throw new Error(`Pairing failed (HTTP ${response.status}).`);
  }
  if (
    typeof body.deviceId !== "string" ||
    typeof body.deviceToken !== "string"
  ) {
    throw new Error("Connect returned an invalid device registration.");
  }
  const registeredRuntimes = runtimesFromResponse(body, {
    runtimes: runtimeList,
  });
  store.save({
    connectEndpoint: new URL(connectEndpoint).toString().replace(/\/$/, ""),
    deviceId: body.deviceId,
    runtimeId: body.runtimeId || registeredRuntimes[0].runtimeId,
    displayName: body.displayName || registeredRuntimes[0].displayName,
    runtimes: registeredRuntimes,
    publicKey: publicKeyBase64(publicKey),
    deviceToken: body.deviceToken,
    tunnelEndpoint:
      typeof body.tunnelEndpoint === "string" ? body.tunnelEndpoint : undefined,
    status: "paired",
    pairedAt: Date.now(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
  });
  return {
    deviceId: body.deviceId,
    runtimeId: body.runtimeId || registeredRuntimes[0].runtimeId,
    ...(body.runtimes ? { runtimes: registeredRuntimes } : {}),
  };
}

/** Connector-first pairing: the remote agent creates the short code, then
 * the user enters it in Agents One. The private key remains local while the
 * request waits for desktop approval. */
export async function requestConnectorPairing({
  connectEndpoint,
  runtimeId,
  displayName,
  runtimes,
  store = createCredentialStore(),
  fetchImpl = globalThis.fetch,
}) {
  if (!fetchImpl) throw new Error("A global fetch implementation is required.");
  const runtimeList = normalizeRuntimeDescriptors({
    runtimes,
    runtimeId,
    displayName,
  });
  const primary = runtimeList[0];
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyValue = publicKeyBase64(publicKey);
  const response = await fetchImpl(
    endpointUrl(connectEndpoint, "/connect/v1/pair/request"),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        protocolVersion: CONNECT_PROTOCOL_VERSION,
        runtimeId: primary.runtimeId,
        displayName: primary.displayName,
        ...(runtimes ? { runtimes: runtimeList } : {}),
        publicKey: publicKeyValue,
        connector: { id: "agents-one-connector", version: CONNECTOR_VERSION },
      }),
    },
  );
  const body = await response.json().catch(() => undefined);
  if (
    !response.ok ||
    !body ||
    typeof body !== "object" ||
    typeof body.sessionId !== "string" ||
    typeof body.requestToken !== "string" ||
    typeof body.pairingCode !== "string"
  ) {
    throw new Error(`Pairing request failed (HTTP ${response.status}).`);
  }
  store.savePending({
    connectEndpoint: new URL(connectEndpoint).toString().replace(/\/$/, ""),
    sessionId: body.sessionId,
    requestToken: body.requestToken,
    runtimeId: primary.runtimeId,
    displayName: primary.displayName,
    runtimes: runtimeList,
    publicKey: publicKeyValue,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    expiresAt: body.expiresAt,
  });
  return {
    sessionId: body.sessionId,
    pairingCode: body.pairingCode,
    runtimeId: primary.runtimeId,
    displayName: primary.displayName,
    ...(runtimes ? { runtimes: runtimeList } : {}),
    expiresAt: body.expiresAt,
  };
}

export async function completeConnectorPairing({
  store = createCredentialStore(),
  fetchImpl = globalThis.fetch,
}) {
  if (!fetchImpl) throw new Error("A global fetch implementation is required.");
  const pending = store.loadPending();
  if (!pending) throw new Error("No pending Connector pairing was found.");
  const response = await fetchImpl(
    endpointUrl(
      pending.connectEndpoint,
      `/connect/v1/pair/request/${encodeURIComponent(pending.sessionId)}`,
    ),
    {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${pending.requestToken}`,
      },
    },
  );
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body || typeof body !== "object")
    throw new Error(`Pairing status failed (HTTP ${response.status}).`);
  if (body.state !== "paired")
    return { state: body.state || "pending", sessionId: pending.sessionId };
  if (typeof body.deviceId !== "string" || typeof body.deviceToken !== "string")
    throw new Error("Connect returned an invalid device registration.");
  store.save({
    connectEndpoint: pending.connectEndpoint,
    deviceId: body.deviceId,
    runtimeId: body.runtimeId || pending.runtimeId,
    displayName: body.displayName || pending.displayName,
    runtimes: runtimesFromResponse(body, pending),
    publicKey: pending.publicKey,
    deviceToken: body.deviceToken,
    tunnelEndpoint: body.tunnelEndpoint,
    status: "paired",
    pairedAt: Date.now(),
    privateKeyPem: pending.privateKeyPem,
  });
  store.clearPending();
  return {
    state: "paired",
    deviceId: body.deviceId,
    runtimeId: body.runtimeId || pending.runtimeId,
    ...(body.runtimes ? { runtimes: runtimesFromResponse(body, pending) } : {}),
  };
}

export async function revokeConnector({
  store = createCredentialStore(),
  fetchImpl = globalThis.fetch,
}) {
  const credentials = store.load();
  if (!credentials) throw new Error("No paired Connector was found.");
  const response = await fetchImpl(
    endpointUrl(
      credentials.connectEndpoint,
      `/connect/v1/devices/${encodeURIComponent(credentials.deviceId)}/revoke`,
    ),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${credentials.deviceToken}`,
      },
      body: "{}",
    },
  );
  if (!response.ok) throw new Error(`Revoke failed (HTTP ${response.status}).`);
  store.markRevoked();
  return { deviceId: credentials.deviceId, revoked: true };
}

export function localConnectorStatus(store = createCredentialStore()) {
  const credentials = store.load();
  if (!credentials) return { paired: false, directory: store.directory };
  return {
    paired: true,
    directory: store.directory,
    deviceId: credentials.deviceId,
    runtimeId: credentials.runtimeId,
    runtimes: credentials.runtimes,
    displayName: credentials.displayName,
    connectEndpoint: credentials.connectEndpoint,
    status: credentials.status || "paired",
    pairedAt: credentials.pairedAt,
  };
}

export function listConnectorRuntimes(store = createCredentialStore()) {
  return store.listRuntimes();
}

export function registerConnectorRuntime({
  runtime,
  store = createCredentialStore(),
}) {
  return store.registerRuntime(runtime);
}

export function updateConnectorRuntime({
  runtimeId,
  patch,
  store = createCredentialStore(),
}) {
  return store.updateRuntime(runtimeId, patch);
}

export function removeConnectorRuntime({
  runtimeId,
  store = createCredentialStore(),
}) {
  return store.removeRuntime(runtimeId);
}

export async function probeConnectorRuntime({
  runtimeId,
  runtimeAdapters,
  store = createCredentialStore(),
}) {
  const runtime = store
    .listRuntimes()
    .find((item) => item.runtimeId === runtimeId);
  if (!runtime) throw new Error(`Runtime is not registered: ${runtimeId}`);
  const adapter = runtimeAdapters?.[runtimeId];
  if (!adapter || typeof adapter.probe !== "function") {
    return {
      runtimeId,
      state: "unsupported",
      message: "Runtime adapter does not expose probe().",
    };
  }
  return { runtimeId, ...(await adapter.probe({ runtime })) };
}

export async function publishConnectorRuntimes({
  store = createCredentialStore(),
  fetchImpl = globalThis.fetch,
}) {
  if (!fetchImpl) throw new Error("A global fetch implementation is required.");
  const credentials = store.load();
  if (!credentials) throw new Error("No paired Connector was found.");
  const response = await fetchImpl(
    endpointUrl(
      credentials.connectEndpoint,
      `/connect/v1/devices/${encodeURIComponent(credentials.deviceId)}/runtimes/publish`,
    ),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${credentials.deviceToken}`,
      },
      body: JSON.stringify({ runtimes: credentials.runtimes, approved: true }),
    },
  );
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = body?.error?.code ? ` (${body.error.code})` : "";
    throw new Error(
      `Runtime list publish failed (HTTP ${response.status})${code}.`,
    );
  }
  return body;
}

/**
 * Open the Connector side of the managed Gateway v1 tunnel. The caller still
 * supplies the native agent adapter through onRequest; the Connector never
 * invents a final answer when that adapter is missing.
 */
export function openConnectorTunnel({
  store = createCredentialStore(),
  WebSocketImpl = WebSocket,
  onRequest,
  runtimeAdapters,
  onEvent,
  heartbeatMs = 20_000,
}) {
  const credentials = store.load();
  if (!credentials) throw new Error("No paired Connector was found.");
  const socket = new WebSocketImpl(
    tunnelUrl(credentials.connectEndpoint, credentials.tunnelEndpoint),
  );
  let heartbeat;
  let settled = false;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const send = (frame) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(frame));
  };
  socket.on("open", () => {
    send({
      type: "hello",
      role: "connector",
      protocolVersion: CONNECT_PROTOCOL_VERSION,
      deviceId: credentials.deviceId,
      deviceToken: credentials.deviceToken,
      runtimes: credentials.runtimes,
      connector: { id: "agents-one-connector", version: CONNECTOR_VERSION },
    });
    heartbeat = setInterval(() => send({ type: "heartbeat" }), heartbeatMs);
  });
  socket.on("message", async (raw) => {
    let frame;
    try {
      frame = JSON.parse(raw.toString("utf8"));
    } catch {
      socket.close(4000, "invalid JSON");
      return;
    }
    if (frame.type === "hello_ack") {
      if (
        frame.state === "incompatible" ||
        frame.error?.code === "incompatible_version"
      ) {
        const error = new Error(
          frame.error?.message ||
            "Connect protocol version is incompatible; upgrade Connector and Connect.",
        );
        error.code = "incompatible_version";
        error.retryable = false;
        failBeforeReady(error);
        return;
      }
      settled = true;
      resolveReady(frame);
      return;
    }
    if (frame.type === "heartbeat_ack") return;
    if (frame.type === "event") {
      await onEvent?.(frame);
      return;
    }
    if (frame.type !== "request") return;
    try {
      const runtimeId = frame.runtimeId || credentials.runtimeId;
      const runtime = credentials.runtimes.find(
        (item) => item.runtimeId === runtimeId,
      );
      if (!runtime) {
        send({
          type: "response",
          requestId: frame.requestId,
          status: 404,
          body: { error: { code: "runtime_not_registered" } },
        });
        return;
      }
      if (runtime.enabled === false) {
        send({
          type: "response",
          requestId: frame.requestId,
          status: 409,
          body: { error: { code: "runtime_disabled" } },
        });
        return;
      }
      const handler =
        runtimeAdapters?.[runtimeId] ||
        (credentials.runtimes.length === 1 && typeof onRequest === "function"
          ? onRequest
          : undefined);
      const result = handler
        ? await handler(frame)
        : {
            status: 503,
            body: { error: "Connector agent adapter is not configured." },
          };
      send({
        type: "response",
        requestId: frame.requestId,
        status: Number.isInteger(result?.status) ? result.status : 500,
        body: result?.body,
      });
    } catch {
      send({
        type: "response",
        requestId: frame.requestId,
        status: 500,
        body: { error: "Connector agent adapter failed." },
      });
    }
  });
  const failBeforeReady = (cause) => {
    if (settled) return;
    settled = true;
    rejectReady(
      cause instanceof Error ? cause : new Error("Connector tunnel failed."),
    );
  };
  socket.on("error", failBeforeReady);
  socket.on("close", (code, reason) => {
    if (heartbeat) clearInterval(heartbeat);
    failBeforeReady(
      new Error(`Connector tunnel closed (${code}): ${reason.toString()}`),
    );
  });
  return {
    socket,
    ready,
    closed: new Promise((resolve) =>
      socket.once("close", (code, reason) =>
        resolve({ code, reason: reason.toString() }),
      ),
    ),
    close: () => {
      if (heartbeat) clearInterval(heartbeat);
      socket.close();
    },
  };
}

/** Keep a Connector online with bounded exponential backoff. The native
 * adapter is reused for every socket; no private credential leaves the local
 * user profile. AbortSignal is optional and makes service shutdown graceful. */
export async function runConnectorTunnel({
  store = createCredentialStore(),
  onRequest,
  runtimeAdapters,
  onEvent,
  onState,
  signal,
  heartbeatMs = 20_000,
  reconnectMinMs = 1_000,
  reconnectMaxMs = 30_000,
  WebSocketImpl = WebSocket,
}) {
  let delay = reconnectMinMs;
  while (!signal?.aborted) {
    let tunnel;
    try {
      onState?.({ state: "connecting" });
      tunnel = openConnectorTunnel({
        store,
        WebSocketImpl,
        onRequest,
        runtimeAdapters,
        onEvent,
        heartbeatMs,
      });
      await tunnel.ready;
      onState?.({ state: "online" });
      delay = reconnectMinMs;
      await tunnel.closed;
      if (signal?.aborted) break;
      onState?.({ state: "reconnecting" });
    } catch (error) {
      onState?.({ state: "offline", error });
      if (
        error?.retryable === false ||
        error?.code === "incompatible_version"
      ) {
        break;
      }
    } finally {
      tunnel?.close();
    }
    if (signal?.aborted) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(reconnectMaxMs, Math.max(reconnectMinMs, delay * 2));
  }
  onState?.({ state: "stopped" });
}
