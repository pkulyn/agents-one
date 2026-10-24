import assert from "node:assert/strict";
import test from "node:test";
import WebSocket from "ws";
import { createConnectService } from "../src/server.mjs";

function inbox(socket) {
  const frames = [],
    waiting = [];
  socket.on("message", (raw) => {
    const frame = JSON.parse(raw.toString());
    const waiter = waiting.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    } else frames.push(frame);
  });
  return {
    frames,
    next() {
      if (frames.length) return Promise.resolve(frames.shift());
      return new Promise((resolve, reject) => {
        const waiter = {
          resolve,
          timer: setTimeout(() => {
            waiting.splice(waiting.indexOf(waiter), 1);
            reject(new Error("tunnel frame deadline"));
          }, 1500),
        };
        waiting.push(waiter);
      });
    },
  };
}
async function setup() {
  let clock = Date.now();
  const service = createConnectService({ now: () => clock });
  const address = await service.listen();
  const base = "http://127.0.0.1:" + address.port;
  const runtimes = [
    { runtimeId: "fixture-one", displayName: "One" },
    { runtimeId: "fixture-two", displayName: "Two" },
  ];
  const post = async (route, body) =>
    (
      await fetch(base + route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    ).json();
  const pairing = await post("/connect/v1/pair/session", { runtimes });
  const device = await post("/connect/v1/pair/exchange", {
    pairingCode: pairing.pairingCode,
    runtimes,
    publicKey: Buffer.alloc(32, 3).toString("base64"),
  });
  const clients = [];
  async function open(
    role,
    runtimeId = runtimes[0].runtimeId,
    advertised = runtimes,
  ) {
    const socket = new WebSocket(
      base.replace("http:", "ws:") + "/connect/v1/tunnel",
    );
    clients.push(socket);
    const box = inbox(socket);
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const hello =
      role === "connector"
        ? {
            deviceId: device.deviceId,
            deviceToken: device.deviceToken,
            runtimes: advertised,
          }
        : { runtimeId, gatewayToken: pairing.gatewayToken };
    socket.send(
      JSON.stringify({ type: "hello", protocolVersion: "1.1", role, ...hello }),
    );
    const ack = await box.next();
    assert.equal(ack.type, "hello_ack");
    return {
      socket,
      box,
      ack,
      send(frame) {
        socket.send(JSON.stringify(frame));
      },
    };
  }
  return {
    service,
    open,
    runtimes,
    advance() {
      clock += 2000;
    },
    state: () => service.devices.get(device.deviceId),
    async close() {
      await Promise.all(
        clients.map(
          (socket) =>
            new Promise((resolve) => {
              if (socket.readyState === WebSocket.CLOSED) return resolve();
              socket.once("close", resolve);
              socket.terminate();
            }),
        ),
      );
      await service.close();
    },
  };
}
const request = (requestId) => ({
  type: "request",
  requestId,
  method: "GET",
  path: "/capabilities",
});
const response = (requestId, extra = {}) => ({
  type: "response",
  requestId,
  status: 200,
  body: { marker: "correct" },
  ...extra,
});
async function barrier(connector) {
  connector.send({ type: "heartbeat" });
  assert.equal((await connector.box.next()).type, "heartbeat_ack");
}

test("Connector disconnect settles saturated requests and releases the Runtime budget", async () => {
  const ctx = await setup();
  try {
    const connector = await ctx.open("connector");
    const desktop = await ctx.open("desktop");
    for (let index = 0; index < 32; index++) {
      desktop.send(request("request-" + index));
      assert.equal((await connector.box.next()).type, "request");
    }
    assert.equal(ctx.state().pendingRequests.size, 32);
    connector.socket.terminate();
    for (let index = 0; index < 32; index++) {
      const failed = await desktop.box.next();
      assert.equal(failed.requestId, "request-" + index);
      assert.equal(failed.status, 503);
      assert.equal(failed.body.error.code, "connector_offline");
    }
    assert.equal(ctx.state().pendingRequests.size, 0);
    ctx.advance();
    const reconnected = await ctx.open("connector");
    desktop.send(request("request-0"));
    const forwarded = await reconnected.box.next();
    reconnected.send(response(forwarded.requestId));
    assert.equal((await desktop.box.next()).requestId, "request-0");
    assert.equal(ctx.state().pendingRequests.size, 0);
  } finally {
    await ctx.close();
  }
});

test("Desktop replacement cannot inherit pending responses or erase new requests on old close", async () => {
  const ctx = await setup();
  try {
    const connector = await ctx.open("connector");
    const oldDesktop = await ctx.open("desktop");
    const oldServerSocket = ctx.state().desktopSockets.get("fixture-one");
    oldDesktop.send(request("reused-id"));
    const oldRequest = await connector.box.next();
    const desktop = await ctx.open("desktop");
    const settled = await oldDesktop.box.next();
    assert.equal(settled.status, 503);
    assert.equal(settled.body.error.code, "desktop_replaced");
    desktop.send(request("reused-id"));
    const newRequest = await connector.box.next();
    assert.notEqual(newRequest.requestId, oldRequest.requestId);
    // Deliver a late old-close callback after the new request is registered.
    oldServerSocket.emit("close");
    assert.equal(ctx.state().pendingRequests.size, 1);
    connector.send(response(oldRequest.requestId));
    await barrier(connector);
    assert.equal(desktop.box.frames.length, 0);
    assert.equal(ctx.state().pendingRequests.size, 1);
    connector.send(response(newRequest.requestId));
    assert.equal((await desktop.box.next()).requestId, "reused-id");
    assert.equal(ctx.state().pendingRequests.size, 0);
  } finally {
    await ctx.close();
  }
});

test("Connector replacement settles old generation and ignores its delayed response", async () => {
  const ctx = await setup();
  try {
    const oldConnector = await ctx.open("connector");
    const desktop = await ctx.open("desktop");
    desktop.send(request("reused-id"));
    const oldRequest = await oldConnector.box.next();
    const connector = await ctx.open("connector");
    assert.equal(
      (await desktop.box.next()).body.error.code,
      "connector_offline",
    );
    desktop.send(request("reused-id"));
    const newRequest = await connector.box.next();
    connector.send(response(oldRequest.requestId));
    await barrier(connector);
    assert.equal(desktop.box.frames.length, 0);
    assert.equal(ctx.state().pendingRequests.size, 1);
    connector.send(response(newRequest.requestId));
    assert.equal((await desktop.box.next()).requestId, "reused-id");
  } finally {
    await ctx.close();
  }
});

test("a response cannot consume or redirect a request using another Runtime ID", async () => {
  const ctx = await setup();
  try {
    const connector = await ctx.open("connector");
    const one = await ctx.open("desktop", "fixture-one");
    const two = await ctx.open("desktop", "fixture-two");
    one.send(request("shared-id"));
    const forwarded = await connector.box.next();
    connector.send(response(forwarded.requestId, { runtimeId: "fixture-two" }));
    await barrier(connector);
    assert.equal(one.box.frames.length, 0);
    assert.equal(two.box.frames.length, 0);
    assert.equal(ctx.state().pendingRequests.size, 1);
    connector.send(response(forwarded.requestId));
    assert.equal((await one.box.next()).requestId, "shared-id");
    assert.equal(ctx.state().pendingRequests.size, 0);
  } finally {
    await ctx.close();
  }
});

test("an online Connector cannot receive requests for a Runtime it did not advertise", async () => {
  const ctx = await setup();
  try {
    const connector = await ctx.open("connector", "fixture-one", [
      ctx.runtimes[0],
    ]);
    const desktop = await ctx.open("desktop", "fixture-two");
    assert.equal(desktop.ack.state, "offline");
    desktop.send(request("offline-runtime"));
    const failed = await desktop.box.next();
    assert.equal(failed.status, 503);
    assert.equal(failed.body.error.code, "runtime_offline");
    await barrier(connector);
    assert.equal(connector.box.frames.length, 0);
    assert.equal(ctx.state().pendingRequests.size, 0);
  } finally {
    await ctx.close();
  }
});

test("equal Desktop IDs in different Runtimes stay isolated while same-origin duplicates conflict", async () => {
  const ctx = await setup();
  try {
    const connector = await ctx.open("connector");
    const one = await ctx.open("desktop", "fixture-one");
    const two = await ctx.open("desktop", "fixture-two");
    one.send(request("same-id"));
    const first = await connector.box.next();
    two.send(request("same-id"));
    const second = await connector.box.next();
    assert.notEqual(first.requestId, second.requestId);
    one.send(request("same-id"));
    assert.equal((await one.box.next()).status, 409);
    assert.equal(ctx.state().pendingRequests.size, 2);
    connector.send(response(second.requestId, { body: { marker: "two" } }));
    assert.equal((await two.box.next()).body.marker, "two");
    connector.send(response(first.requestId, { body: { marker: "one" } }));
    assert.equal((await one.box.next()).body.marker, "one");
    one.send(request("abandoned-id"));
    const abandoned = await connector.box.next();
    const serverSocket = ctx.state().desktopSockets.get("fixture-one");
    const closed = new Promise((resolve) =>
      serverSocket.once("close", resolve),
    );
    one.socket.terminate();
    await closed;
    assert.equal(ctx.state().pendingRequests.size, 0);
    connector.send(response(abandoned.requestId));
    await barrier(connector);
    assert.equal(two.box.frames.length, 0);
  } finally {
    await ctx.close();
  }
});
