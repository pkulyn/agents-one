import assert from "node:assert/strict";
import test from "node:test";
import { connect } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectService } from "../src/server.mjs";

async function rawPeer(port, request, expected) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const ready = new Promise((resolve, reject) => {
    let data = "";
    const timer = setTimeout(
      () => reject(new Error("peer setup deadline")),
      1500,
    );
    const onData = (chunk) => {
      data += chunk.toString();
      if (data.includes(expected)) {
        clearTimeout(timer);
        socket.off("data", onData);
        resolve();
      }
    };
    socket.on("data", onData);
  });
  socket.write(request);
  await ready;
  return socket;
}
function deadline(promise) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("service close exceeded 2.5 seconds")),
        2500,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
test("shutdown bounds an upgraded peer that never sends hello or acknowledges close", async () => {
  const service = createConnectService();
  const address = await service.listen();
  let peer, closing;
  try {
    peer = await rawPeer(
      address.port,
      "GET /connect/v1/tunnel HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      "101 Switching Protocols",
    );
    assert.equal(service.wss.clients.size, 1);
    closing = service.close();
    await deadline(closing);
    assert.equal(service.wss.clients.size, 0);
    assert.equal(service.server.listening, false);
  } finally {
    peer?.destroy();
    await (closing || service.close());
  }
});

test("shutdown bounds an incomplete HTTP body and repeated close shares completion", async () => {
  const service = createConnectService();
  const address = await service.listen();
  const peer = connect(address.port, "127.0.0.1");
  peer.on("error", () => {});
  let closing;
  try {
    await new Promise((resolve, reject) => {
      peer.once("connect", resolve);
      peer.once("error", reject);
    });
    const admitted = new Promise((resolve) =>
      service.server.once("request", resolve),
    );
    peer.write(
      "POST /connect/v1/pair/session HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{",
    );
    await admitted;
    closing = service.close();
    const duplicate = service.close();
    assert.equal(duplicate, closing);
    await deadline(Promise.all([closing, duplicate]));
    assert.equal(service.server.listening, false);
    await service.close();
  } finally {
    peer.destroy();
    await (closing || service.close());
  }
});

test("persistence failure is reported after sockets and listener are cleaned up", async () => {
  const directory = mkdtempSync(join(tmpdir(), "connect-close-write-"));
  const storagePath = join(directory, "state.json");
  const service = createConnectService({ storagePath });
  const address = await service.listen();
  let peer;
  try {
    mkdirSync(storagePath);
    peer = await rawPeer(
      address.port,
      "GET /connect/v1/tunnel HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      "101 Switching Protocols",
    );
    await assert.rejects(
      deadline(service.close()),
      (cause) => cause instanceof AggregateError && cause.errors.length === 1,
    );
    assert.equal(service.server.listening, false);
    assert.equal(service.wss.clients.size, 0);
    assert.ok(statSync(storagePath).isDirectory());
    await assert.rejects(service.close(), AggregateError);
  } finally {
    peer?.destroy();
    if (service.server.listening) await service.close().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
});
