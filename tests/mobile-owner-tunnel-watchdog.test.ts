import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import WebSocket from "ws";
import { canonical } from "../contracts/mobile-control/v1/owner-tunnel.mjs";
import { MobileOwnerTunnel } from "../src/main/mobile-control/owner-tunnel";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../contracts/mobile-control/v1/fixtures.json", import.meta.url),
    "utf8",
  ),
).objects;
const clients: MobileOwnerTunnel[] = [];
afterEach(() => {
  clients.splice(0).forEach((c) => c.stop());
  vi.useRealTimers();
});
class Socket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  frames: any[] = [];
  terminated = false;
  send(value: string, done?: (error?: Error) => void) {
    this.frames.push(JSON.parse(value));
    done?.();
  }
  terminate() {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
    this.emit("close", 1006, Buffer.alloc(0));
  }
  close(code: number, reason: string) {
    this.readyState = WebSocket.CLOSED;
    this.emit("close", code, Buffer.from(reason));
  }
  receive(frame: unknown) {
    this.emit("message", Buffer.from(JSON.stringify(frame)));
  }
}
function setup() {
  vi.useFakeTimers({
    toFake: [
      "Date",
      "performance",
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
    ],
  });
  vi.setSystemTime(new Date("2026-10-14T08:00:00Z"));
  const keys = generateKeyPairSync("ed25519");
  const binding = {
    endpoint: "https://owner.example",
    ownerId: "owner-1",
    spaceId: "space-1",
    hostCredential: "synthetic-only",
    signingPublicKey: keys.publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
  };
  const sockets: Socket[] = [];
  const diagnostic: any[] = [];
  const accepted: any[] = [];
  const handler = {
    status: () => ({
      ...fixtures.OwnerSpace,
      ownerId: "owner-1",
      spaceId: "space-1",
    }),
    handle: async (r: any) => {
      accepted.push(r);
      return await new Promise<any>(() => {});
    },
  };
  const client = new MobileOwnerTunnel(
    binding,
    handler,
    () => {
      const socket = new Socket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    false,
    (d) => diagnostic.push(d),
  );
  clients.push(client);
  client.start();
  const signed = (payload: any) => ({
    payload,
    signature: sign(
      null,
      Buffer.from(canonical(payload)),
      keys.privateKey,
    ).toString("base64"),
  });
  const device = {
    ...fixtures.DeviceGrant,
    ownerId: "owner-1",
    spaceId: "space-1",
    deviceId: "phone-1",
    grantRevision: "1",
    revoked: false,
    expiresAt: "2099-01-01T00:00:00Z",
    scopes: ["conversation:read", "conversation:manage"],
  };
  const authorize = (id: string) =>
    sockets
      .at(-1)!
      .receive({
        type: "authorization",
        ...signed({
          protocolVersion: "mobile-owner/1.0",
          ownerId: "owner-1",
          spaceId: "space-1",
          updateId: id,
          grants: { enabled: true, devices: [device] },
          expiresAt: Date.now() + 30000,
        }),
      });
  return { client, sockets, diagnostic, accepted, authorize, signed };
}
describe("signed authorization lease watchdog", () => {
  it("reconnects after signed authorization expires even when the socket never emits close, without replaying an accepted request", async () => {
    const s = setup();
    s.authorize("auth-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(s.diagnostic.filter((d) => d.event === "frame_rejected")).toEqual(
      [],
    );
    const body = {title:"Accepted once",clientMutationId:"stable-m"};
    const payload = {
      protocolVersion: "mobile-owner/1.0",
      audience: "owner-1",
      spaceId: "space-1",
      deviceId: "phone-1",
      grantRevision: "1",
      authorizationId: "auth-1",
      method: "PATCH",
      path: "/agents-one/mobile/v1/owners/owner-1/spaces/space-1/conversations/original",
      query: {},
      headers: {"if-match": '"1"', "idempotency-key":"stable-m", "x-client-mutation-id":"stable-m"},
      bodyHash: createHash("sha256").update(canonical(body)).digest("hex"),
      requestId: "accepted-once",
      nonce: "once",
      expiresAt: Date.now() + 30000,
    };
    s.sockets[0].receive({
      type: "request",
      requestId: payload.requestId,
      body,
      ...s.signed(payload),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(s.accepted).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(29999);
    expect(s.sockets[0].terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.sockets[0].terminated).toBe(true);
    expect(s.accepted[0].signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(s.sockets).toHaveLength(2);
    expect(s.accepted).toHaveLength(1);
    expect(s.diagnostic).toContainEqual(
      expect.objectContaining({ event: "authorization_lease_expired" }),
    );
  });
  it("keeps a refreshed connection healthy and uses monotonic expiry despite a wall-clock rollback", async () => {
    const s = setup();
    s.authorize("a1");
    expect(s.diagnostic.filter((d) => d.event === "frame_rejected")).toEqual(
      [],
    );
    await vi.advanceTimersByTimeAsync(20000);
    s.authorize("a2");
    await vi.advanceTimersByTimeAsync(20000);
    expect(s.sockets).toHaveLength(1);
    expect(s.sockets[0].terminated).toBe(false);
    vi.setSystemTime(new Date(Date.now() - 86400000));
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.sockets[0].terminated).toBe(true);
  });
  it("does not reconnect after stop, explicit credential revocation or owner replacement", async () => {
    for (const code of [4001, 4002]) {
      const s = setup();
      s.authorize("auth-" + code);
      s.sockets[0].close(code, "host credential changed");
      await vi.advanceTimersByTimeAsync(60000);
      expect(s.sockets).toHaveLength(1);
      s.client.stop();
    }
    const s = setup();
    s.authorize("stopped");
    s.client.stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.sockets).toHaveLength(1);
  });
});
