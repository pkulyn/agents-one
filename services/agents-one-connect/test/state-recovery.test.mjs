import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { createConnectService } from "../src/server.mjs";

const empty = () => ({
  schemaVersion: 1,
  pairings: [],
  devices: [],
  desktopTokens: [],
});
const input = {
  runtimeId: "fixture-runtime",
  displayName: "Fixture",
  publicKey: Buffer.alloc(32, 4).toString("base64"),
};
async function start(storagePath, logs = []) {
  const service = createConnectService({
    storagePath,
    logger: (error) => logs.push(String(error)),
  });
  const address = await service.listen();
  return { service, base: "http://127.0.0.1:" + address.port };
}
async function createPair(base) {
  return fetch(base + "/connect/v1/pair/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}
const invalid = [
  ["invalid JSON", '{"credential":"private-fixture-secret",broken'],
  ["unsupported version", JSON.stringify({ ...empty(), schemaVersion: 2 })],
  ["missing collection", JSON.stringify({ schemaVersion: 1 })],
  ["wrong collection", JSON.stringify({ ...empty(), devices: {} })],
  [
    "null record after partial load",
    JSON.stringify({
      ...empty(),
      pairings: [
        {
          codeDigest: "fixture",
          sessionId: "partial",
          state: "pending",
          expiresAt: Date.now() + 600000,
        },
        null,
      ],
    }),
  ],
  [
    "duplicate pairing",
    JSON.stringify({
      ...empty(),
      pairings: [{ codeDigest: "same" }, { codeDigest: "same" }],
    }),
  ],
  [
    "duplicate device",
    JSON.stringify({
      ...empty(),
      devices: [{ deviceId: "same" }, { deviceId: "same" }],
    }),
  ],
  [
    "duplicate token",
    JSON.stringify({
      ...empty(),
      desktopTokens: [{ value: "same" }, { value: "same" }],
    }),
  ],
  [
    "malformed runtimes",
    JSON.stringify({
      ...empty(),
      devices: [{ deviceId: "fixture", runtimes: [null] }],
    }),
  ],
];
for (const [name, original] of invalid) {
  test(
    "invalid state fails closed and preserves bytes on request and close: " +
      name,
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "connect-recovery-"));
      const storagePath = join(directory, "state.json");
      writeFileSync(storagePath, original);
      const logs = [];
      const { service, base } = await start(storagePath, logs);
      try {
        const health = await fetch(base + "/connect/v1/health");
        assert.equal(health.status, 503);
        assert.equal(
          (await health.json()).error.code,
          "gateway_state_unavailable",
        );
        const denied = await createPair(base);
        assert.equal(denied.status, 503);
        assert.equal(
          (await denied.json()).error.code,
          "gateway_state_unavailable",
        );
        assert.equal(service.pairings.size, 0);
        assert.equal(service.devices.size, 0);
        assert.equal(readFileSync(storagePath, "utf8"), original);
        assert.equal(logs.length, 1);
        assert.ok(logs[0].includes("gateway_state_unavailable"));
        assert.ok(!logs.join("").includes("private-fixture-secret"));
      } finally {
        await service.close();
        try {
          assert.equal(readFileSync(storagePath, "utf8"), original);
        } finally {
          rmSync(directory, { recursive: true, force: true });
        }
      }
    },
  );
}

test("unavailable state rejects the actual WebSocket upgrade", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-recovery-ws-"));
  const storagePath = join(directory, "state.json");
  writeFileSync(storagePath, "broken");
  const { service, base } = await start(storagePath);
  let client;
  try {
    const status = await new Promise((resolve, reject) => {
      client = new WebSocket(
        base.replace("http:", "ws:") + "/connect/v1/tunnel",
        { handshakeTimeout: 2000 },
      );
      client.on("error", () => {});
      client.once("open", () => {
        client.terminate();
        reject(new Error("unexpected authenticated tunnel admission"));
      });
      client.once("unexpected-response", (_request, response) => {
        response.resume();
        client.terminate();
        resolve(response.statusCode);
      });
      client.once("close", () =>
        reject(new Error("upgrade closed without 503 response")),
      );
    });
    assert.equal(status, 503);
    assert.equal(service.wss.clients.size, 0);
  } finally {
    client?.terminate();
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repair requires restart and shutdown preserves an operator repaired file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-repair-"));
  const storagePath = join(directory, "state.json");
  writeFileSync(storagePath, "broken");
  const { service, base } = await start(storagePath);
  let restarted;
  try {
    const repaired = JSON.stringify({
      ...empty(),
      operatorMetadata: { unknown: "preserve on blocked close" },
    });
    writeFileSync(storagePath, repaired);
    assert.equal((await createPair(base)).status, 503);
    await service.close();
    assert.equal(readFileSync(storagePath, "utf8"), repaired);
    restarted = await start(storagePath);
    assert.equal(
      (await fetch(restarted.base + "/connect/v1/health")).status,
      200,
    );
    assert.equal((await createPair(restarted.base)).status, 201);
  } finally {
    if (service.server.listening) await service.close();
    if (restarted) await restarted.service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("missing state is a healthy new store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-new-"));
  const storagePath = join(directory, "state.json");
  const { service, base } = await start(storagePath);
  try {
    assert.equal((await createPair(base)).status, 201);
    assert.equal(
      JSON.parse(readFileSync(storagePath, "utf8")).pairings.length,
      1,
    );
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("independent mobile authorization remains available with invalid Gateway state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-mobile-recovery-"));
  const storagePath = join(directory, "gateway.json");
  writeFileSync(storagePath, "broken");
  const adminToken = "fixture-admin-token-" + "x".repeat(32);
  const service = createConnectService({
    storagePath,
    mobile: {
      storagePath: join(directory, "mobile.json"),
      stateKey: "ab".repeat(32),
      owners: [
        {
          ownerId: "fixture-owner",
          spaceId: "fixture-space",
          label: "Fixture",
          adminToken,
        },
      ],
    },
  });
  const address = await service.listen();
  const base = "http://127.0.0.1:" + address.port;
  try {
    assert.equal(
      (
        await fetch(base + "/agents-one/mobile/admin/v1/status", {
          headers: { authorization: "Bearer " + adminToken },
        })
      ).status,
      200,
    );
    assert.equal(
      (await fetch(base + "/agents-one/mobile/admin/v1/status")).status,
      403,
    );
    assert.equal((await createPair(base)).status, 503);
  } finally {
    await service.close();
    try {
      assert.equal(readFileSync(storagePath, "utf8"), "broken");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test("unreadable state path is not treated as a missing store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-read-failure-"));
  const { service, base } = await start(directory);
  try {
    assert.equal((await createPair(base)).status, 503);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
