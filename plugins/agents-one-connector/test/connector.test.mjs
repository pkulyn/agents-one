import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCredentialStore } from "../src/credential-store.mjs";
import {
  completeConnectorPairing,
  localConnectorStatus,
  openConnectorTunnel,
  pairConnector,
  requestConnectorPairing,
  revokeConnector,
  listConnectorRuntimes,
  registerConnectorRuntime,
  updateConnectorRuntime,
  removeConnectorRuntime,
  probeConnectorRuntime,
} from "../src/connector-client.mjs";
import { createConnectService } from "../../../services/agents-one-connect/src/server.mjs";
import loopbackGatewayAdapter from "../adapters/gateway-v1-loopback.mjs";
import WebSocket from "ws";

test("pair exchanges a one-time code and stores credentials without exposing the private key in metadata", async () => {
  const store = createCredentialStore(
    mkdtempSync(join(tmpdir(), "agents-one-connector-")),
  );
  let request;
  const result = await pairConnector({
    connectEndpoint: "https://connect.example",
    pairingCode: "ABCDE-FGHIJ",
    runtimeId: "hers-home2",
    displayName: "Hers",
    store,
    fetchImpl: async (_url, init) => {
      request = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          deviceId: "device_1",
          runtimeId: "hers-home2",
          deviceToken: "device-token-secret",
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.deepEqual(result, { deviceId: "device_1", runtimeId: "hers-home2" });
  assert.equal(request.pairingCode, "ABCDEFGHIJ");
  assert.equal(request.publicKey.length > 20, true);
  const metadata = JSON.parse(readFileSync(store.metadataPath, "utf8"));
  assert.equal(metadata.privateKeyPem, undefined);
  const privateKeyFile = readFileSync(store.privateKeyPath, "utf8");
  if (process.platform === "win32") {
    assert.equal(privateKeyFile.includes("PRIVATE KEY"), false);
    assert.equal(metadata.deviceToken, undefined);
    assert.equal(
      metadata.protectedDeviceToken.protection,
      "dpapi-current-user",
    );
  } else {
    assert.match(privateKeyFile, /PRIVATE KEY/);
    assert.equal(statSync(store.metadataPath).mode & 0o777, 0o600);
  }
  assert.equal(localConnectorStatus(store).paired, true);
});

test("Windows protects the device token, private key, and pending pairing state", () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-connector-win-"));
  const protect = (value) =>
    Buffer.from(`bound-user:${value}`, "utf8").toString("base64");
  const unprotect = (value) => {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (!decoded.startsWith("bound-user:")) throw new Error("wrong user");
    return decoded.slice("bound-user:".length);
  };
  const store = createCredentialStore(directory, {
    platform: "win32",
    protect,
    unprotect,
  });
  const credentials = {
    connectEndpoint: "https://connect.example",
    deviceId: "device_windows",
    deviceToken: "fake-device-token",
    publicKey: "fake-public-key",
    runtimeId: "runtime-win",
    displayName: "Runtime Windows",
    runtimes: [{ runtimeId: "runtime-win", displayName: "Runtime Windows" }],
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nfake-private-key\n-----END PRIVATE KEY-----",
  };
  store.save(credentials);
  store.savePending({
    requestToken: "fake-request-token",
    sessionId: "session_windows",
    privateKeyPem: credentials.privateKeyPem,
  });

  const persisted = [
    store.metadataPath,
    store.privateKeyPath,
    store.pendingPath,
  ]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  assert.equal(persisted.includes("fake-device-token"), false);
  assert.equal(persisted.includes("fake-private-key"), false);
  assert.equal(persisted.includes("fake-request-token"), false);
  assert.equal(store.load().deviceToken, "fake-device-token");
  assert.equal(store.loadPending().requestToken, "fake-request-token");
});

test("Windows migrates legacy plaintext credentials idempotently", () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-connector-legacy-"));
  const protect = (value) => Buffer.from(value, "utf8").toString("base64");
  const unprotect = (value) => Buffer.from(value, "base64").toString("utf8");
  const legacy = createCredentialStore(directory, { platform: "linux" });
  legacy.save({
    connectEndpoint: "https://connect.example",
    deviceId: "device_legacy",
    deviceToken: "fake-legacy-token",
    publicKey: "fake-public-key",
    runtimeId: "runtime-legacy",
    displayName: "Legacy Runtime",
    runtimes: [{ runtimeId: "runtime-legacy", displayName: "Legacy Runtime" }],
    privateKeyPem:
      "-----BEGIN PRIVATE KEY-----\nfake-legacy-key\n-----END PRIVATE KEY-----",
  });
  const windowsStore = createCredentialStore(directory, {
    platform: "win32",
    protect,
    unprotect,
  });

  assert.equal(windowsStore.load().deviceToken, "fake-legacy-token");
  assert.equal(windowsStore.load().deviceToken, "fake-legacy-token");
  assert.equal(
    readFileSync(windowsStore.metadataPath, "utf8").includes(
      "fake-legacy-token",
    ),
    false,
  );
  assert.equal(
    readFileSync(windowsStore.privateKeyPath, "utf8").includes(
      "fake-legacy-key",
    ),
    false,
  );
});

test("revoke uses the device credential and marks local state revoked", async () => {
  const store = createCredentialStore(
    mkdtempSync(join(tmpdir(), "agents-one-connector-")),
  );
  await pairConnector({
    connectEndpoint: "https://connect.example",
    pairingCode: "ABCDE-FGHIJ",
    runtimeId: "hers-home2",
    displayName: "Hers",
    store,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          deviceId: "device_1",
          runtimeId: "hers-home2",
          deviceToken: "device-token-secret",
        }),
        { status: 201 },
      ),
  });
  let authorization;
  const result = await revokeConnector({
    store,
    fetchImpl: async (_url, init) => {
      authorization = init.headers.authorization;
      return new Response("{}", { status: 200 });
    },
  });
  assert.deepEqual(result, { deviceId: "device_1", revoked: true });
  assert.equal(authorization, "Bearer device-token-secret");
  assert.equal(localConnectorStatus(store).status, "revoked");
});

test("manages multiple local Runtime registrations atomically and probes one Runtime", async () => {
  const store = createCredentialStore(
    mkdtempSync(join(tmpdir(), "agents-one-connector-")),
  );
  await pairConnector({
    connectEndpoint: "https://connect.example",
    pairingCode: "ABCDE-FGHIJ",
    runtimeId: "opencode-main",
    displayName: "OpenCode",
    store,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          deviceId: "device_1",
          runtimeId: "opencode-main",
          deviceToken: "device-token-secret",
        }),
        { status: 201 },
      ),
  });
  registerConnectorRuntime({
    store,
    runtime: { runtimeId: "pi-main", displayName: "Pi", kind: "pi" },
  });
  updateConnectorRuntime({
    store,
    runtimeId: "pi-main",
    patch: { displayName: "Pi disabled", enabled: false },
  });
  assert.equal(listConnectorRuntimes(store).length, 2);
  assert.equal(listConnectorRuntimes(store)[1].enabled, false);
  const probe = await probeConnectorRuntime({
    store,
    runtimeId: "opencode-main",
    runtimeAdapters: {
      "opencode-main": { probe: async () => ({ state: "healthy" }) },
    },
  });
  assert.deepEqual(probe, { runtimeId: "opencode-main", state: "healthy" });
  removeConnectorRuntime({ store, runtimeId: "pi-main" });
  assert.deepEqual(
    listConnectorRuntimes(store).map((runtime) => runtime.runtimeId),
    ["opencode-main"],
  );
});

test("connector-first pairing stores credentials after Agents One claims the code", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const connectEndpoint = `http://127.0.0.1:${address.port}`;
  const store = createCredentialStore(
    mkdtempSync(join(tmpdir(), "agents-one-connector-")),
  );
  const request = await requestConnectorPairing({
    connectEndpoint,
    runtimeId: "hers-first",
    displayName: "Hers",
    store,
  });
  assert.match(request.pairingCode, /^[A-Z2-9]{10}$/);
  assert.equal(localConnectorStatus(store).paired, false);
  const claimResponse = await fetch(
    `${connectEndpoint}/connect/v1/pair/claim`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingCode: request.pairingCode,
        runtimeId: request.runtimeId,
      }),
    },
  );
  assert.equal(claimResponse.status, 200);
  const completed = await completeConnectorPairing({ store });
  assert.equal(completed.state, "paired");
  assert.equal(localConnectorStatus(store).paired, true);
  await service.close();
});

test("Connector opens the managed WSS tunnel and answers a Gateway v1 request", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const connectEndpoint = `http://127.0.0.1:${address.port}`;
  const store = createCredentialStore(
    mkdtempSync(join(tmpdir(), "agents-one-connector-")),
  );
  const pairingResponse = await fetch(
    `${connectEndpoint}/connect/v1/pair/session`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runtimeId: "hers-home2", displayName: "Hers" }),
    },
  );
  const pairing = await pairingResponse.json();
  await pairConnector({
    connectEndpoint,
    pairingCode: pairing.pairingCode,
    runtimeId: "hers-home2",
    displayName: "Hers",
    store,
    fetchImpl: fetch,
  });

  const tunnel = openConnectorTunnel({
    store,
    WebSocketImpl: WebSocket,
    onRequest: async (request) =>
      request.path === "/capabilities"
        ? { status: 200, body: { protocolVersion: "1.0" } }
        : request.path === "/commands/execute"
          ? { status: 200, body: { type: "handled", message: "ok" } }
          : { status: 404, body: { error: "not found" } },
  });
  await tunnel.ready;
  const desktop = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    desktop.once("open", resolve);
    desktop.once("error", reject);
  });
  desktop.send(
    JSON.stringify({
      type: "hello",
      role: "desktop",
      protocolVersion: "1.0",
      runtimeId: "hers-home2",
      gatewayToken: pairing.gatewayToken,
    }),
  );
  await new Promise((resolve, reject) => {
    desktop.once("message", (value) => {
      try {
        assert.equal(JSON.parse(value.toString()).type, "hello_ack");
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    desktop.once("error", reject);
  });
  desktop.send(
    JSON.stringify({
      type: "request",
      requestId: "req_connector_1",
      method: "GET",
      path: "/capabilities",
    }),
  );
  const response = await new Promise((resolve, reject) => {
    desktop.once("message", (value) => resolve(JSON.parse(value.toString())));
    desktop.once("error", reject);
  });
  assert.deepEqual(response, {
    type: "response",
    requestId: "req_connector_1",
    status: 200,
    body: { protocolVersion: "1.0" },
  });
  desktop.send(
    JSON.stringify({
      type: "request",
      requestId: "req_connector_command",
      method: "POST",
      path: "/commands/execute",
      body: { name: "status" },
    }),
  );
  const commandResponse = await new Promise((resolve, reject) => {
    desktop.once("message", (value) => resolve(JSON.parse(value.toString())));
    desktop.once("error", reject);
  });
  assert.deepEqual(commandResponse, {
    type: "response",
    requestId: "req_connector_command",
    status: 200,
    body: { type: "handled", message: "ok" },
  });
  tunnel.close();
  desktop.close();
  await service.close();
});

test("generic Loopback Gateway adapter forwards only the shared command routes", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify({ commands: [{ name: "status" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const result = await loopbackGatewayAdapter({
      method: "GET",
      path: "/commands/catalog",
      runtimeId: "hers-home2",
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { commands: [{ name: "status" }] });
    assert.equal(requests[0].url.endsWith("/commands/catalog"), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
