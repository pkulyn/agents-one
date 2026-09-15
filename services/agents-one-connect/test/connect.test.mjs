import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { createConnectService } from "../src/server.mjs";
import {
  completeConnectorPairing,
  openConnectorTunnel,
  requestConnectorPairing,
} from "../../../plugins/agents-one-connector/src/connector-client.mjs";
import { createRemoteCliHost } from "../../../plugins/agents-one-plugin/src/remote-cli-host.mjs";
import { createOpenCodeAcpAdapter } from "../../../plugins/agents-one-plugin/src/adapters/opencode-acp.mjs";

function onceMessage(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message.")),
      2_000,
    );
    socket.once("message", (value) =>
      resolve(JSON.parse(value.toString("utf8"))),
    );
    socket.once("error", reject);
    socket.once("message", () => clearTimeout(timer));
  });
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (
      socket.readyState === WebSocket.CLOSED ||
      socket.readyState === WebSocket.CLOSING
    ) {
      resolve();
      return;
    }
    socket.once("close", resolve);
    socket.close();
  });
}

function memoryStore() {
  let credentials;
  let pending;
  return {
    savePending(value) {
      pending = value;
    },
    loadPending() {
      return pending;
    },
    clearPending() {
      pending = undefined;
    },
    save(value) {
      credentials = value;
    },
    load() {
      return credentials;
    },
  };
}

async function waitForRun(base, token, runId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${base}/runs/${runId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    if (["succeeded", "failed", "cancelled"].includes(body.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the OpenCode Host run.");
}

function withTimeout(promise, label, ms = 3_000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out.`)), ms),
    ),
  ]);
}

async function settleWithin(promise, ms = 3_000) {
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => setTimeout(resolve, ms)),
    ]);
  } catch {
    // Test cleanup must not mask the assertion that failed first.
  }
}

test("pairs a device, routes Gateway v1 frames, and revokes the device", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const pairingResponse = await fetch(`${base}/connect/v1/pair/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtimeId: "hers-home2", displayName: "Hers" }),
  });
  assert.equal(pairingResponse.status, 201);
  const pairing = await pairingResponse.json();

  const exchangeResponse = await fetch(`${base}/connect/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: pairing.pairingCode,
      runtimeId: "hers-home2",
      displayName: "Hers",
      publicKey: Buffer.alloc(32, 7).toString("base64"),
      connector: { id: "agents-one-connector", version: "0.1.0" },
    }),
  });
  assert.equal(exchangeResponse.status, 201);
  const device = await exchangeResponse.json();

  const pairingStatusResponse = await fetch(
    `${base}/connect/v1/pair/session/${encodeURIComponent(pairing.sessionId)}`,
    { headers: { authorization: `Bearer ${pairing.gatewayToken}` } },
  );
  assert.equal(pairingStatusResponse.status, 200);
  assert.deepEqual(await pairingStatusResponse.json(), {
    sessionId: pairing.sessionId,
    runtimeId: "hers-home2",
    displayName: "Hers",
    runtimes: [{ runtimeId: "hers-home2", displayName: "Hers" }],
    state: "paired",
    expiresAt: pairing.expiresAt,
    deviceId: device.deviceId,
  });

  const desktopDeviceStatusResponse = await fetch(
    base + "/connect/v1/devices/" + encodeURIComponent(device.deviceId),
    { headers: { authorization: "Bearer " + pairing.gatewayToken } },
  );
  assert.equal(desktopDeviceStatusResponse.status, 200);
  const desktopDeviceStatus = await desktopDeviceStatusResponse.json();
  assert.equal(typeof desktopDeviceStatus.checkedAt, "number");
  assert.deepEqual(
    { ...desktopDeviceStatus, checkedAt: 0 },
    {
      deviceId: device.deviceId,
      runtimeId: "hers-home2",
      runtimes: [{ runtimeId: "hers-home2", displayName: "Hers" }],
      state: "offline",
      protocolVersion: "1.1",
      connectorVersion: "0.1.0",
      checkedAt: 0,
    },
  );

  const connector = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    connector.once("open", resolve);
    connector.once("error", reject);
  });
  connector.send(
    JSON.stringify({
      type: "hello",
      role: "connector",
      protocolVersion: "1.0",
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
    }),
  );
  assert.equal((await onceMessage(connector)).type, "hello_ack");

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
  assert.equal((await onceMessage(desktop)).type, "hello_ack");

  desktop.send(
    JSON.stringify({
      type: "request",
      requestId: "req_1",
      method: "GET",
      path: "/capabilities",
    }),
  );
  assert.deepEqual(await onceMessage(connector), {
    type: "request",
    requestId: "req_1",
    method: "GET",
    path: "/capabilities",
    runtimeId: "hers-home2",
  });
  connector.send(
    JSON.stringify({
      type: "response",
      requestId: "req_1",
      status: 200,
      body: { protocolVersion: "1.0" },
    }),
  );
  assert.deepEqual(await onceMessage(desktop), {
    type: "response",
    requestId: "req_1",
    status: 200,
    body: { protocolVersion: "1.0" },
  });

  const revokeResponse = await fetch(
    `${base}/connect/v1/devices/${encodeURIComponent(device.deviceId)}/revoke`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${device.deviceToken}` },
      body: "{}",
    },
  );
  assert.equal(revokeResponse.status, 200);
  await closeSocket(connector);
  await closeSocket(desktop);
  await service.close();
});

test("supports connector-first pairing with a code entered in Agents One", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const requestResponse = await fetch(`${base}/connect/v1/pair/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "hers-connector-first",
      displayName: "Hers",
      publicKey: Buffer.alloc(32, 9).toString("base64"),
    }),
  });
  assert.equal(requestResponse.status, 201);
  const request = await requestResponse.json();

  const previewResponse = await fetch(`${base}/connect/v1/pair/preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: request.pairingCode,
      runtimeId: request.runtimeId,
    }),
  });
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.sessionId, request.sessionId);
  assert.equal(preview.runtimeId, request.runtimeId);
  assert.equal(preview.displayName, request.displayName);
  assert.match(preview.deviceFingerprint, /^sha256:[a-f0-9]{16}$/);
  assert.deepEqual(preview.runtimes, request.runtimes);
  assert.equal("gatewayToken" in preview, false);
  assert.equal("deviceToken" in preview, false);

  const claimResponse = await fetch(`${base}/connect/v1/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: request.pairingCode,
      runtimeId: request.runtimeId,
    }),
  });
  assert.equal(claimResponse.status, 200);
  const claim = await claimResponse.json();
  assert.equal(claim.runtimeId, request.runtimeId);
  assert.equal(typeof claim.gatewayToken, "string");
  assert.equal("deviceToken" in claim, false);

  const statusResponse = await fetch(
    `${base}/connect/v1/pair/request/${request.sessionId}`,
    {
      headers: { authorization: `Bearer ${request.requestToken}` },
    },
  );
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.state, "paired");
  assert.equal(typeof status.deviceToken, "string");
  await service.close();
});

test("runs OpenCode through Connect, Connector and the shared Remote CLI Host", async () => {
  const service = createConnectService();
  const store = memoryStore();
  const address = await service.listen(0);
  const connectBase = `http://127.0.0.1:${address.port}`;
  const runtime = {
    runtimeId: "opencode-e2e",
    displayName: "OpenCode E2E",
    kind: "opencode",
    adapterId: "opencode-acp",
  };

  const requested = await requestConnectorPairing({
    connectEndpoint: connectBase,
    runtimes: [runtime],
    store,
  });
  const previewResponse = await fetch(
    `${connectBase}/connect/v1/pair/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode: requested.pairingCode }),
    },
  );
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal("gatewayToken" in preview, false);
  assert.equal(preview.runtimes[0].runtimeId, runtime.runtimeId);

  const claimResponse = await fetch(`${connectBase}/connect/v1/pair/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: requested.pairingCode }),
  });
  assert.equal(claimResponse.status, 200);
  const desktopCredentials = await claimResponse.json();
  await assert.doesNotReject(() => completeConnectorPairing({ store }));

  const acpScript = [
    "const rl=require('node:readline').createInterface({input:process.stdin});",
    "const send=(v)=>process.stdout.write(JSON.stringify(v)+'\\n');",
    "rl.on('line',(line)=>{const m=JSON.parse(line);",
    "if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode E2E',version:'test'},configOptions:[{id:'model',category:'model',currentValue:{provider:'openai',id:'gpt-e2e'}}]}});",
    "else if(m.method==='session/new')send({id:m.id,result:{sessionId:'e2e-session'}});",
    "else if(m.method==='session/prompt'){send({method:'session/update',params:{sessionId:'e2e-session',update:{sessionUpdate:'agent_message_chunk',model:'openai/gpt-e2e',content:{type:'text',text:'OpenCode over Connect'}}}});send({id:m.id,result:{stopReason:'end_turn',model:'openai/gpt-e2e'}});}});",
  ].join("");
  const host = createRemoteCliHost({
    token: "host-e2e-token",
    runtimes: [
      {
        ...runtime,
        adapter: createOpenCodeAcpAdapter({
          executablePath: process.execPath,
          acpArgs: ["-e", acpScript],
        }),
      },
    ],
  });
  await host.listen(0);
  const hostAddress = host.server.address();
  assert.equal(typeof hostAddress?.port, "number");
  const hostBase = `http://127.0.0.1:${hostAddress.port}`;
  const connectorTunnel = openConnectorTunnel({
    store,
    runtimeAdapters: {
      [runtime.runtimeId]: async (frame) => {
        const response = await fetch(`${hostBase}${frame.path}`, {
          method: frame.method,
          headers: {
            authorization: "Bearer host-e2e-token",
            "x-agents-one-runtime-id": runtime.runtimeId,
            ...(frame.method === "POST"
              ? { "content-type": "application/json" }
              : {}),
          },
          ...(frame.method === "POST"
            ? { body: JSON.stringify(frame.body || {}) }
            : {}),
        });
        const contentType = response.headers.get("content-type") || "";
        return {
          status: response.status,
          body: contentType.startsWith("text/event-stream")
            ? await response.text()
            : await response.json(),
        };
      },
    },
  });
  let desktop;
  try {
    await withTimeout(connectorTunnel.ready, "Connector tunnel ready");
    desktop = new WebSocket(`ws://127.0.0.1:${address.port}/connect/v1/tunnel`);
    await new Promise((resolve, reject) => {
      desktop.once("open", resolve);
      desktop.once("error", reject);
    });
    desktop.send(
      JSON.stringify({
        type: "hello",
        role: "desktop",
        protocolVersion: "1.1",
        gatewayToken: desktopCredentials.runtimeTokens[runtime.runtimeId],
        runtimeId: runtime.runtimeId,
      }),
    );
    assert.equal(
      (await withTimeout(onceMessage(desktop), "Desktop hello ack")).state,
      "online",
    );
    desktop.send(
      JSON.stringify({
        type: "request",
        requestId: "capabilities-e2e",
        method: "GET",
        path: "/capabilities",
        runtimeId: runtime.runtimeId,
      }),
    );
    const capabilities = await withTimeout(
      onceMessage(desktop),
      "Gateway capabilities",
    );
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.runtimes[0].runtimeId, runtime.runtimeId);

    desktop.send(
      JSON.stringify({
        type: "request",
        requestId: "run-e2e",
        method: "POST",
        path: "/runs",
        runtimeId: runtime.runtimeId,
        body: {
          runtimeId: runtime.runtimeId,
          input: { text: "Say hello" },
        },
      }),
    );
    const started = await withTimeout(
      onceMessage(desktop),
      "Gateway run start",
    );
    assert.equal(started.status, 202);
    assert.equal(started.body.runtimeId, runtime.runtimeId);
    const completed = await waitForRun(
      hostBase,
      "host-e2e-token",
      started.body.id,
    );
    assert.equal(completed.status, "succeeded", JSON.stringify(completed));
    assert.equal(completed.output, "OpenCode over Connect");
    assert.equal(completed.actualModel.provider, "openai");
    assert.equal(completed.actualModel.id, "gpt-e2e");
    assert.ok(
      completed.events.some((event) => event.type === "assistant.completed"),
    );

    desktop.send(
      JSON.stringify({
        type: "request",
        requestId: "events-e2e",
        method: "GET",
        path: `/runs/${started.body.id}/events`,
        runtimeId: runtime.runtimeId,
      }),
    );
    const streamed = await withTimeout(
      onceMessage(desktop),
      "Gateway SSE snapshot",
    );
    assert.equal(streamed.status, 200);
    assert.match(streamed.body, /event: assistant\.completed/);
    assert.match(streamed.body, /event: run\.completed/);

    desktop.send(
      JSON.stringify({
        type: "request",
        requestId: "run-after-events-e2e",
        method: "POST",
        path: "/runs",
        runtimeId: runtime.runtimeId,
        body: {
          runtimeId: runtime.runtimeId,
          input: { text: "Continue after SSE" },
        },
      }),
    );
    const continued = await withTimeout(
      onceMessage(desktop),
      "Gateway run after SSE",
    );
    assert.equal(continued.status, 202);
    const continuedCompleted = await waitForRun(
      hostBase,
      "host-e2e-token",
      continued.body.id,
    );
    assert.equal(continuedCompleted.status, "succeeded");
  } finally {
    if (desktop) {
      await closeSocket(desktop);
      desktop.terminate();
    }
    connectorTunnel.close();
    connectorTunnel.socket.terminate();
    await settleWithin(connectorTunnel.closed);
    await settleWithin(host.close());
    await settleWithin(service.close());
  }
});

test("routes a shared Connector tunnel to two explicitly authorized Runtimes", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const runtimes = [
    { runtimeId: "opencode-main", displayName: "OpenCode", kind: "opencode" },
    { runtimeId: "pi-main", displayName: "Pi", kind: "pi" },
  ];
  const pairingResponse = await fetch(`${base}/connect/v1/pair/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runtimes }),
  });
  const pairing = await pairingResponse.json();
  const exchangeResponse = await fetch(`${base}/connect/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: pairing.pairingCode,
      runtimeId: runtimes[0].runtimeId,
      displayName: runtimes[0].displayName,
      publicKey: Buffer.alloc(32, 11).toString("base64"),
    }),
  });
  const device = await exchangeResponse.json();
  assert.deepEqual(device.runtimes, runtimes);
  assert.deepEqual(Object.keys(device.runtimeTokens).sort(), [
    "opencode-main",
    "pi-main",
  ]);
  assert.notEqual(
    device.runtimeTokens["opencode-main"],
    device.runtimeTokens["pi-main"],
  );

  const connector = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    connector.once("open", resolve);
    connector.once("error", reject);
  });
  connector.send(
    JSON.stringify({
      type: "hello",
      role: "connector",
      protocolVersion: "1.1",
      deviceId: device.deviceId,
      deviceToken: device.deviceToken,
      runtimes,
    }),
  );
  assert.deepEqual((await onceMessage(connector)).runtimes, runtimes);

  const desktops = [];
  for (const runtime of runtimes) {
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
        protocolVersion: "1.1",
        runtimeId: runtime.runtimeId,
        gatewayToken: pairing.gatewayToken,
      }),
    );
    const ack = await onceMessage(desktop);
    assert.equal(ack.runtimeId, runtime.runtimeId);
    desktops.push({ desktop, runtime });
  }
  for (const { desktop, runtime } of desktops) {
    desktop.send(
      JSON.stringify({
        type: "request",
        requestId: `req_${runtime.runtimeId}`,
        method: "GET",
        path: "/capabilities",
      }),
    );
    const request = await onceMessage(connector);
    assert.equal(request.runtimeId, runtime.runtimeId);
    connector.send(
      JSON.stringify({
        type: "response",
        requestId: request.requestId,
        status: 200,
        body: { runtimeId: runtime.runtimeId },
      }),
    );
    assert.deepEqual(await onceMessage(desktop), {
      type: "response",
      requestId: request.requestId,
      status: 200,
      body: { runtimeId: runtime.runtimeId },
    });
  }
  for (const { desktop } of desktops) await closeSocket(desktop);
  await closeSocket(connector);
  await service.close();
});

test("persists pairings and devices across a Connect service restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agents-one-connect-"));
  const storagePath = join(directory, "connect-state.json");
  const first = createConnectService({ storagePath });
  const firstAddress = await first.listen(0);
  const firstBase = `http://127.0.0.1:${firstAddress.port}`;
  const pairingResponse = await fetch(`${firstBase}/connect/v1/pair/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "opencode-restart",
      displayName: "OpenCode",
    }),
  });
  const pairing = await pairingResponse.json();
  await first.close();

  const second = createConnectService({ storagePath });
  const secondAddress = await second.listen(0);
  const exchange = await fetch(
    `http://127.0.0.1:${secondAddress.port}/connect/v1/pair/exchange`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pairingCode: pairing.pairingCode,
        runtimeId: "opencode-restart",
        displayName: "OpenCode",
        publicKey: Buffer.alloc(32, 15).toString("base64"),
      }),
    },
  );
  assert.equal(exchange.status, 201);
  assert.equal((await exchange.json()).runtimeId, "opencode-restart");
  await second.close();
});

test("requires Desktop approval for Runtime list changes and returns offline errors", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const pairingResponse = await fetch(`${base}/connect/v1/pair/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "opencode-policy",
      displayName: "OpenCode",
    }),
  });
  const pairing = await pairingResponse.json();
  const exchange = await fetch(`${base}/connect/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: pairing.pairingCode,
      runtimeId: "opencode-policy",
      displayName: "OpenCode",
      publicKey: Buffer.alloc(32, 16).toString("base64"),
    }),
  });
  const device = await exchange.json();
  const runtimePath = `${base}/connect/v1/devices/${device.deviceId}/runtimes`;
  const forbidden = await fetch(runtimePath, {
    method: "POST",
    headers: {
      authorization: `Bearer ${device.deviceToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      approved: true,
      runtimes: [
        { runtimeId: "opencode-policy", displayName: "OpenCode" },
        { runtimeId: "pi-policy", displayName: "Pi" },
      ],
    }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error.code, "permission_denied");

  const approved = await fetch(runtimePath, {
    method: "POST",
    headers: {
      authorization: `Bearer ${pairing.gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      approved: true,
      runtimes: [
        { runtimeId: "opencode-policy", displayName: "OpenCode" },
        { runtimeId: "pi-policy", displayName: "Pi" },
      ],
    }),
  });
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json();
  assert.equal(approvedBody.runtimes.length, 2);
  assert.match(approvedBody.runtimeTokens["pi-policy"], /^gw_/);

  const scopedStatus = await fetch(
    `${base}/connect/v1/devices/${device.deviceId}`,
    {
      headers: {
        authorization: `Bearer ${approvedBody.runtimeTokens["pi-policy"]}`,
      },
    },
  );
  assert.equal(scopedStatus.status, 200);
  const scopedStatusBody = await scopedStatus.json();
  assert.equal(scopedStatusBody.runtimeId, "pi-policy");
  assert.deepEqual(scopedStatusBody.runtimes, [
    { runtimeId: "pi-policy", displayName: "Pi" },
  ]);

  // A Runtime-scoped credential may use its own Runtime, but cannot mutate
  // the device-wide Runtime allow-list.
  const scopedMutation = await fetch(runtimePath, {
    method: "POST",
    headers: {
      authorization: `Bearer ${approvedBody.runtimeTokens["pi-policy"]}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      approved: true,
      runtimes: [
        { runtimeId: "opencode-policy", displayName: "OpenCode" },
        { runtimeId: "pi-policy", displayName: "Pi" },
      ],
    }),
  });
  assert.equal(scopedMutation.status, 403);
  assert.equal((await scopedMutation.json()).error.code, "permission_denied");

  const scopedDesktop = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    scopedDesktop.once("open", resolve);
    scopedDesktop.once("error", reject);
  });
  scopedDesktop.send(
    JSON.stringify({
      type: "hello",
      role: "desktop",
      protocolVersion: "1.1",
      runtimeId: "pi-policy",
      gatewayToken: approvedBody.runtimeTokens["pi-policy"],
    }),
  );
  assert.equal((await onceMessage(scopedDesktop)).state, "offline");
  await closeSocket(scopedDesktop);

  const removed = await fetch(runtimePath, {
    method: "POST",
    headers: {
      authorization: `Bearer ${pairing.gatewayToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      approved: true,
      runtimes: [{ runtimeId: "opencode-policy", displayName: "OpenCode" }],
    }),
  });
  assert.equal(removed.status, 200);
  const removedBody = await removed.json();
  assert.deepEqual(removedBody.runtimes, [
    { runtimeId: "opencode-policy", displayName: "OpenCode" },
  ]);
  assert.equal("pi-policy" in removedBody.runtimeTokens, false);

  const revokedScopedDesktop = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    revokedScopedDesktop.once("open", resolve);
    revokedScopedDesktop.once("error", reject);
  });
  const revokedClose = new Promise((resolve) =>
    revokedScopedDesktop.once("close", () => resolve()),
  );
  revokedScopedDesktop.send(
    JSON.stringify({
      type: "hello",
      role: "desktop",
      protocolVersion: "1.1",
      runtimeId: "pi-policy",
      gatewayToken: approvedBody.runtimeTokens["pi-policy"],
    }),
  );
  await withTimeout(revokedClose, "revoked Runtime token close");

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
      protocolVersion: "1.1",
      runtimeId: "opencode-policy",
      gatewayToken: pairing.gatewayToken,
    }),
  );
  assert.equal((await onceMessage(desktop)).state, "offline");
  desktop.send(
    JSON.stringify({
      type: "request",
      requestId: "offline-request",
      method: "GET",
      path: "/capabilities",
    }),
  );
  const offline = await onceMessage(desktop);
  assert.equal(offline.body.error.code, "connector_offline");
  await closeSocket(desktop);
  await service.close();
});

test("limits in-flight requests independently per Runtime tunnel", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  const pairingResponse = await fetch(`${base}/connect/v1/pair/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      runtimeId: "opencode-limit",
      displayName: "OpenCode",
    }),
  });
  const pairing = await pairingResponse.json();
  const exchange = await fetch(`${base}/connect/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: pairing.pairingCode,
      runtimeId: "opencode-limit",
      displayName: "OpenCode",
      publicKey: Buffer.alloc(32, 17).toString("base64"),
    }),
  });
  const device = await exchange.json();
  const connector = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  const desktop = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  try {
    await Promise.all(
      [connector, desktop].map(
        (socket) =>
          new Promise((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
          }),
      ),
    );
    connector.send(
      JSON.stringify({
        type: "hello",
        role: "connector",
        protocolVersion: "1.1",
        deviceId: device.deviceId,
        deviceToken: device.deviceToken,
        runtimeId: "opencode-limit",
        displayName: "OpenCode",
      }),
    );
    assert.equal((await onceMessage(connector)).state, undefined);
    desktop.send(
      JSON.stringify({
        type: "hello",
        role: "desktop",
        protocolVersion: "1.1",
        runtimeId: "opencode-limit",
        gatewayToken: device.runtimeTokens["opencode-limit"],
      }),
    );
    assert.equal((await onceMessage(desktop)).state, "online");
    for (let index = 0; index < 33; index += 1) {
      desktop.send(
        JSON.stringify({
          type: "request",
          requestId: `limit-${index}`,
          method: "GET",
          path: "/capabilities",
        }),
      );
    }
    const limited = await onceMessage(desktop);
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, "tunnel_rate_limited");
  } finally {
    await closeSocket(desktop);
    await closeSocket(connector);
    await service.close();
  }
});

test("returns an explicit incompatible-version handshake response", async () => {
  const service = createConnectService();
  const address = await service.listen(0);
  const socket = new WebSocket(
    `ws://127.0.0.1:${address.port}/connect/v1/tunnel`,
  );
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(
    JSON.stringify({
      type: "hello",
      role: "connector",
      protocolVersion: "9.0",
      deviceId: "unknown",
      deviceToken: "redacted",
    }),
  );
  const ack = await onceMessage(socket);
  assert.equal(ack.state, "incompatible");
  assert.equal(ack.error.code, "incompatible_version");
  await closeSocket(socket);
  await service.close();
});
