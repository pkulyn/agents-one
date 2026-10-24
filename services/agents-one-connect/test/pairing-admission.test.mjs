import { createPairingAttemptLimiter } from "../src/pairing-admission.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { request } from "node:http";
import { createConnectService } from "../src/server.mjs";
const input = {
  runtimeId: "fixture-runtime",
  displayName: "Fixture",
  publicKey: Buffer.alloc(32, 7).toString("base64"),
};
async function post(base, route, body = input, headers = {}) {
  const res = await fetch(base + "/connect/v1/pair/" + route, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
for (const route of ["request", "session"]) {
  test(
    route +
      " shares a bounded source budget and recovers at its original window",
    async () => {
      let at = 1000;
      const service = createConnectService({ now: () => at });
      const address = await service.listen();
      const base = "http://127.0.0.1:" + address.port;
      try {
        for (let i = 0; i < 8; i++)
          assert.equal((await post(base, route)).status, 201);
        const before = service.pairings.size;
        const denied = await post(base, route, input, {
          "x-forwarded-for": "different-peer",
        });
        assert.equal(denied.status, 429);
        assert.equal(denied.body.error.code, "pairing_rate_limited");
        assert.equal(service.pairings.size, before);
        at += 60000;
        assert.equal((await post(base, route)).status, 201);
      } finally {
        await service.close();
      }
    },
  );
}
test("creation, preview, claim and exchange share the same socket budget", async () => {
  const service = createConnectService();
  const address = await service.listen();
  const base = "http://127.0.0.1:" + address.port;
  try {
    for (const route of [
      "request",
      "session",
      "preview",
      "claim",
      "exchange",
      "preview",
      "claim",
      "exchange",
    ]) {
      await post(base, route);
    }
    assert.equal((await post(base, "session")).status, 429);
  } finally {
    await service.close();
  }
});
test("rejects an exhausted request before waiting for its unfinished JSON body", async () => {
  const service = createConnectService();
  const address = await service.listen();
  const base = "http://127.0.0.1:" + address.port;
  try {
    for (let i = 0; i < 8; i++) await post(base, "session");
    await new Promise((resolve, reject) => {
      const req = request(
        base + "/connect/v1/pair/request",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "transfer-encoding": "chunked",
          },
        },
        (res) => {
          try {
            assert.equal(res.statusCode, 429);
            res.resume();
            req.destroy();
            resolve();
          } catch (error) {
            req.destroy();
            reject(error);
          }
        },
      );
      req.on("error", (error) => {
        if (error.code !== "ECONNRESET") reject(error);
      });
      req.setTimeout(2000, () => {
        req.destroy();
        reject(Error("limit waited for request body"));
      });
      req.write("{");
    });
  } finally {
    await service.close();
  }
});

test("caps source cardinality without evicting live budgets and releases expired peers", () => {
  let at = 1000;
  const allow = createPairingAttemptLimiter({
    now: () => at,
    maxPeers: 2,
    maxAttempts: 2,
  });
  assert.equal(allow("first"), true);
  assert.equal(allow("second"), true);
  assert.equal(allow("new-peer"), false);
  assert.equal(allow("first"), true);
  assert.equal(allow("first"), false);
  assert.equal(allow("new-peer"), false);
  at += 60000;
  assert.equal(allow("new-peer"), true);
  assert.equal(allow("first"), true);
});
test("clock rollback does not reset an existing exhausted source budget", () => {
  let at = 1000;
  const allow = createPairingAttemptLimiter({ now: () => at, maxAttempts: 1 });
  assert.equal(allow("peer"), true);
  at = 0;
  assert.equal(allow("peer"), false);
  at = 61000;
  assert.equal(allow("peer"), true);
});
