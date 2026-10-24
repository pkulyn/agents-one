import { request } from "node:http";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectService } from "../src/server.mjs";
import { CONNECT_STATE_LIMITS } from "../src/state-retention.mjs";
const input = {
  runtimeId: "fixture-runtime",
  displayName: "Fixture",
  publicKey: Buffer.alloc(32, 4).toString("base64"),
};
async function post(base, route, body = input, token) {
  const response = await fetch(base + route, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}
async function setup() {
  let clock = 1000;
  const directory = mkdtempSync(join(tmpdir(), "connect-retention-"));
  const storagePath = join(directory, "state.json");
  const service = createConnectService({ now: () => clock, storagePath });
  const address = await service.listen();
  return {
    service,
    storagePath,
    directory,
    base: "http://127.0.0.1:" + address.port,
    advance(ms) {
      clock += ms;
    },
    now: () => clock,
  };
}
async function pair(ctx) {
  const session = await post(ctx.base, "/connect/v1/pair/session");
  assert.equal(session.status, 201);
  const device = await post(ctx.base, "/connect/v1/pair/exchange", {
    ...input,
    pairingCode: session.body.pairingCode,
  });
  assert.equal(device.status, 201);
  return { session: session.body, device: device.body };
}
for (const route of ["request", "session"]) {
  test(
    route +
      " capacity rejects without state mutation and expired entries release it",
    async () => {
      const ctx = await setup();
      try {
        for (let i = 0; i < CONNECT_STATE_LIMITS.pairings; i++)
          ctx.service.pairings.set("seed-" + i, {
            sessionId: "seed-" + i,
            state: "pending",
            expiresAt: ctx.now() + 300000,
          });
        const denied = await post(ctx.base, "/connect/v1/pair/" + route);
        assert.equal(denied.status, 503);
        assert.equal(denied.body.error.code, "pairing_capacity_reached");
        assert.equal(ctx.service.pairings.size, CONNECT_STATE_LIMITS.pairings);
        ctx.advance(600001);
        assert.equal(
          (await post(ctx.base, "/connect/v1/pair/" + route)).status,
          201,
        );
        assert.equal(ctx.service.pairings.size, 1);
      } finally {
        await ctx.service.close();
        rmSync(ctx.directory, { recursive: true, force: true });
      }
    },
  );
}
test("device capacity leaves an approved pending pairing unconsumed", async () => {
  const ctx = await setup();
  try {
    const session = await post(ctx.base, "/connect/v1/pair/session");
    for (let i = 0; i < CONNECT_STATE_LIMITS.devices; i++)
      ctx.service.devices.set("seed-" + i, {
        deviceId: "seed-" + i,
        sessionId: "device-session-" + i,
        state: "paired",
        runtimes: [],
      });
    const before = readFileSync(ctx.storagePath, "utf8");
    const denied = await post(ctx.base, "/connect/v1/pair/exchange", {
      ...input,
      pairingCode: session.body.pairingCode,
    });
    assert.equal(denied.status, 503);
    assert.equal(denied.body.error.code, "device_capacity_reached");
    assert.equal(ctx.service.pairings.values().next().value.state, "pending");
    assert.equal(readFileSync(ctx.storagePath, "utf8"), before);
  } finally {
    await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});
test("pending expiry removes credentials but briefly preserves authenticated expired status", async () => {
  const ctx = await setup();
  try {
    const session = await post(ctx.base, "/connect/v1/pair/session");
    ctx.advance(300001);
    const response = await fetch(
      ctx.base + "/connect/v1/pair/session/" + session.body.sessionId,
      { headers: { authorization: "Bearer " + session.body.gatewayToken } },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, "expired");
    await ctx.service.close();
    const stored = JSON.parse(readFileSync(ctx.storagePath, "utf8"));
    assert.equal(stored.desktopTokens.length, 0);
    assert.equal(stored.pairings.length, 1);
  } finally {
    if (ctx.service.server.listening) await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});
test("paired authority survives pairing TTL and restart without credential eviction", async () => {
  const ctx = await setup();
  let restarted;
  try {
    const { session, device } = await pair(ctx);
    ctx.advance(2 * 86400000);
    const response = await fetch(
      ctx.base + "/connect/v1/devices/" + device.deviceId,
      { headers: { authorization: "Bearer " + session.gatewayToken } },
    );
    assert.equal(response.status, 200);
    assert.equal(ctx.service.devices.size, 1);
    await ctx.service.close();
    restarted = createConnectService({
      now: ctx.now,
      storagePath: ctx.storagePath,
    });
    const address = await restarted.listen();
    const restored = await fetch(
      "http://127.0.0.1:" +
        address.port +
        "/connect/v1/devices/" +
        device.deviceId,
      { headers: { authorization: "Bearer " + session.gatewayToken } },
    );
    assert.equal(restored.status, 200);
  } finally {
    if (restarted) await restarted.close();
    if (ctx.service.server.listening) await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});
test("revoked devices retain status then release their pairing and credential indexes", async () => {
  const ctx = await setup();
  try {
    const { device } = await pair(ctx);
    assert.equal(
      (
        await post(
          ctx.base,
          "/connect/v1/devices/" + device.deviceId + "/revoke",
          {},
          device.deviceToken,
        )
      ).status,
      200,
    );
    const response = await fetch(
      ctx.base + "/connect/v1/devices/" + device.deviceId,
      { headers: { authorization: "Bearer " + device.deviceToken } },
    );
    assert.equal(response.status, 200);
    ctx.advance(CONNECT_STATE_LIMITS.revokedDeviceRetentionMs / 2);
    assert.equal(
      (
        await post(
          ctx.base,
          "/connect/v1/devices/" + device.deviceId + "/revoke",
          {},
          device.deviceToken,
        )
      ).status,
      200,
    );
    ctx.advance(CONNECT_STATE_LIMITS.revokedDeviceRetentionMs / 2 + 1);
    await fetch(ctx.base + "/connect/v1/health");
    assert.equal(ctx.service.devices.size, 0);
    assert.equal(ctx.service.pairings.size, 0);
    await ctx.service.close();
    const stored = JSON.parse(readFileSync(ctx.storagePath, "utf8"));
    assert.equal(stored.devices.length, 0);
    assert.equal(stored.desktopTokens.length, 0);
  } finally {
    if (ctx.service.server.listening) await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});

test("concurrent delayed bodies cannot overrun the final pairing slot", async () => {
  const ctx = await setup();
  const requests = [];
  try {
    for (let i = 0; i < CONNECT_STATE_LIMITS.pairings - 1; i++)
      ctx.service.pairings.set("seed-" + i, {
        sessionId: "seed-" + i,
        state: "pending",
        expiresAt: ctx.now() + 300000,
      });
    let entered = 0;
    let ready;
    const allEntered = new Promise((resolve) => {
      ready = resolve;
    });
    ctx.service.server.on("request", () => {
      if (++entered === 8) ready();
    });
    const results = [];
    for (let i = 0; i < 8; i++) {
      results.push(
        new Promise((resolve, reject) => {
          const req = request(
            ctx.base + "/connect/v1/pair/session",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "transfer-encoding": "chunked",
              },
            },
            (res) => {
              res.resume();
              res.on("end", () => resolve(res.statusCode));
            },
          );
          requests.push(req);
          req.on("error", reject);
          req.setTimeout(3000, () =>
            req.destroy(Error("delayed pairing timed out")),
          );
          req.write("{");
        }),
      );
    }
    await allEntered;
    for (const req of requests) req.end(JSON.stringify(input).slice(1));
    const statuses = await Promise.all(results);
    assert.equal(statuses.filter((x) => x === 201).length, 1);
    assert.equal(statuses.filter((x) => x === 503).length, 7);
    assert.equal(ctx.service.pairings.size, CONNECT_STATE_LIMITS.pairings);
  } finally {
    for (const req of requests) req.destroy();
    await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});

test("read traffic amortizes cleanup while mutations still force credential cleanup", async () => {
  const ctx = await setup();
  try {
    const iterate = ctx.service.devices[Symbol.iterator].bind(
      ctx.service.devices,
    );
    let scans = 0;
    ctx.service.devices[Symbol.iterator] = function* () {
      scans++;
      yield* iterate();
    };
    for (let i = 0; i < 8; i++) await fetch(ctx.base + "/connect/v1/health");
    assert.equal(scans, 0);
    ctx.advance(1000);
    await fetch(ctx.base + "/connect/v1/health");
    assert.equal(scans, 1);
    ctx.service.pairings.set("expired", {
      sessionId: "expired",
      state: "pending",
      expiresAt: ctx.now() - 600001,
    });
    assert.equal(
      (await post(ctx.base, "/connect/v1/pair/session")).status,
      201,
    );
    assert.equal(ctx.service.pairings.has("expired"), false);
    assert.equal(scans, 2);
  } finally {
    await ctx.service.close();
    rmSync(ctx.directory, { recursive: true, force: true });
  }
});
