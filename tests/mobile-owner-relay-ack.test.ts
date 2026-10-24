import { afterEach, expect, it } from "vitest";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { createMobileOwnerTunnel } from "../services/agents-one-connect/src/mobile-owner-tunnel.mjs";
const owner = JSON.parse(
  readFileSync(
    new URL("../contracts/mobile-control/v1/fixtures.json", import.meta.url),
    "utf8",
  ),
).objects.OwnerSpace;
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function setup() {
  let clock = Date.now();
  const diagnostics: any[] = [];
  const tunnel = createMobileOwnerTunnel({
    stateKey: "e".repeat(64),
    now: () => clock,
    authenticate: () => owner,
    authorization: () => ({ enabled: true, devices: [] }),
    authorizeDevice: () => {},
    diagnostic: (d: any) => diagnostics.push(d),
  });
  const server = createServer();
  server.on("upgrade", (r, s, h) => tunnel.upgrade(r, s, h));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const socket = new WebSocket(
    "ws://127.0.0.1:" +
      (server.address() as any).port +
      "/agents-one/mobile/owner/v1/tunnel",
  );
  const frames: any[] = [];
  socket.on("message", (raw) => frames.push(JSON.parse(String(raw))));
  await new Promise<void>((r, j) => {
    socket.once("open", r);
    socket.once("error", j);
  });
  cleanup.push(async () => {
    socket.terminate();
    await tunnel.close();
    await new Promise<void>((r) => server.close(() => r()));
  });
  socket.send(
    JSON.stringify({
      type: "hello",
      role: "owner",
      protocolVersion: "mobile-owner/1.0",
      ownerId: owner.ownerId,
      spaceId: owner.spaceId,
      hostCredential: "synthetic",
    }),
  );
  for (
    let i = 0;
    i < 100 && !frames.some((f) => f.type === "authorization");
    i++
  )
    await wait(10);
  const auth = frames.find((f) => f.type === "authorization");
  expect(auth).toBeTruthy();
  socket.send(JSON.stringify({ type: "owner_status", owner }));
  const ack = (id = auth.payload.updateId) =>
    socket.send(JSON.stringify({ type: "authorization_ack", updateId: id }));
  return {
    socket,
    tunnel,
    frames,
    diagnostics,
    auth,
    ack,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
it("accepts a six-second ACK without extending the signed thirty-second lease", async () => {
  const s = await setup();
  await wait(6100);
  s.advance(6100);
  expect(s.socket.readyState).toBe(WebSocket.OPEN);
  s.ack();
  await wait(30);
  expect(s.tunnel.ownerView(owner.ownerId)).toEqual(owner);
  s.advance(23901);
  expect(s.tunnel.ownerView(owner.ownerId)).toBeNull();
  expect(s.diagnostics).toContainEqual(
    expect.objectContaining({
      event: "authorization_ack_received",
      updateId: s.auth.payload.updateId,
    }),
  );
}, 12000);
it("closes an unconfirmed current update even after a stale ACK", async () => {
  const s = await setup();
  s.tunnel.changed(owner.ownerId);
  await wait(40);
  expect(s.frames.filter((f) => f.type === "authorization")).toHaveLength(2);
  s.ack();
  await wait(30);
  expect(s.tunnel.ownerView(owner.ownerId)).toBeNull();
  expect(s.diagnostics.some((d) => d.event === "authorization_ack_stale")).toBe(
    true,
  );
  await wait(10100);
  expect(s.socket.readyState).toBe(WebSocket.CLOSED);
  expect(s.diagnostics.some((d) => d.event === "authorization_timeout")).toBe(
    true,
  );
}, 15000);
