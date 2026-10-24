import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileOwnerLifecycle } from "../src/main/mobile-control/owner-lifecycle";
import type { MobileOwnerScope } from "../src/main/mobile-control/owner-lifecycle";
import type {
  OwnerControlHandler,
  OwnerControlRequest,
  OwnerControlResponse,
  OwnerTunnelBinding,
} from "../src/main/mobile-control/owner-tunnel";

const binding: OwnerTunnelBinding = {
  endpoint: "https://relay.example",
  ownerId: "owner",
  spaceId: "space",
  hostCredential: "secret-host",
  signingPublicKey: "public-key",
};
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return {
    promise: new Promise<T>((done) => {
      resolve = done;
    }),
    resolve: (value) => resolve(value),
  };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});
function fixture(): {
  lifecycle: MobileOwnerLifecycle;
  transports: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    handler: OwnerControlHandler;
  }>;
  lookup: ReturnType<typeof vi.fn>;
  factory: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  handle: ReturnType<typeof vi.fn>;
  unavailable: ReturnType<typeof vi.fn>;
  scope(value: MobileOwnerScope): void;
  lock(value: boolean): void;
} {
  let scope: MobileOwnerScope = { profile: "owner", home: "D:/original" };
  let locked = false;
  const status = vi.fn(() => ({ ownerId: "owner" }));
  const handle = vi.fn(
    async (): Promise<OwnerControlResponse> => ({
      status: 200,
      body: { original: true },
    }),
  );
  const lookup = vi.fn(
    async (): Promise<OwnerTunnelBinding | undefined> => binding,
  );
  const factory = vi.fn(() => ({ status, handle }));
  const transports: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    handler: OwnerControlHandler;
  }> = [];
  const unavailable = vi.fn();
  const lifecycle = new MobileOwnerLifecycle({
    scope: () => scope,
    locked: () => locked,
    binding: lookup,
    handler: factory,
    transport: (_binding, handler) => {
      const result = { start: vi.fn(), stop: vi.fn(), handler };
      transports.push(result);
      return result;
    },
    onUnavailable: unavailable,
  });
  cleanups.push(() => lifecycle.stop());
  return {
    lifecycle,
    transports,
    lookup,
    factory,
    status,
    handle,
    unavailable,
    scope: (value: MobileOwnerScope) => {
      scope = value;
    },
    lock: (value: boolean) => {
      locked = value;
    },
  };
}
describe("production Owner lifecycle", () => {
  it("starts once, refreshes unchanged binding without rebuilding ledger handlers, and stops once", async () => {
    const f = fixture();
    f.lifecycle.start();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(1);
    expect(f.factory).toHaveBeenCalledTimes(1);
    expect(f.transports[0].start).toHaveBeenCalledTimes(1);
    f.lifecycle.stop();
    f.lifecycle.stop();
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({
      code: "owner_unavailable",
    });
  });
  it("rejects stale binding completion after shutdown", async () => {
    const f = fixture();
    const wait = deferred<OwnerTunnelBinding>();
    f.lookup.mockReturnValueOnce(wait.promise);
    f.lifecycle.start();
    const pending = f.lifecycle.refresh();
    f.lifecycle.stop();
    wait.resolve(binding);
    await pending;
    expect(f.transports).toHaveLength(0);
    expect(f.factory).not.toHaveBeenCalled();
  });
  it("rejects old profile data immediately, including a changed home for the same profile name", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.scope({ profile: "owner", home: "D:/different" });
    await expect(
      f.transports[0].handler.handle({} as OwnerControlRequest),
    ).rejects.toMatchObject({ status: 503 });
    expect(f.handle).not.toHaveBeenCalled();
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(2);
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    expect(f.factory.mock.calls[1][0]).toEqual({
      profile: "owner",
      home: "D:/different",
    });
  });
  it("suppresses an in-flight response after profile changes", async () => {
    const f = fixture();
    const wait = deferred<{ status: number; body: { original: boolean } }>();
    f.handle.mockReturnValueOnce(wait.promise);
    f.lifecycle.start();
    await f.lifecycle.refresh();
    const response = f.transports[0].handler.handle({} as OwnerControlRequest);
    f.scope({ profile: "another", home: "D:/another" });
    wait.resolve({ status: 200, body: { original: true } });
    await expect(response).rejects.toMatchObject({ code: "owner_unavailable" });
  });
  it("stops while restore or management is locked, then reuses the existing handler", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.lock(true);
    f.lifecycle.invalidate();
    await f.lifecycle.refresh();
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    expect(f.lookup).toHaveBeenCalledTimes(1);
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({
      status: 503,
    });
    f.lock(false);
    f.lifecycle.invalidate();
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(2);
    expect(f.factory).toHaveBeenCalledTimes(1);
  });
  it("disables and rotates transport credentials without replaying or reconstructing operations", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.lookup.mockResolvedValueOnce(undefined);
    await f.lifecycle.refresh();
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({
      status: 503,
    });
    f.lookup.mockResolvedValueOnce({ ...binding, hostCredential: "rotated" });
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(2);
    expect(f.factory).toHaveBeenCalledTimes(1);
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({
      status: 503,
    });
  });
  it("fails closed on binding lookup errors, retries without logging the credential-bearing exception", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.lookup.mockRejectedValueOnce(Error("secret-host"));
    await f.lifecycle.refresh();
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    expect(f.unavailable).toHaveBeenCalledWith();
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(2);
    expect(f.factory).toHaveBeenCalledTimes(1);
  });
  it("keeps the signed tunnel on a transient management outage but honors disable and scope changes", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.lookup.mockRejectedValueOnce(Error("service_unavailable"));
    await f.lifecycle.refresh();
    expect(f.transports[0].stop).not.toHaveBeenCalled();
    await expect(f.transports[0].handler.status()).resolves.toEqual({ ownerId: "owner" });
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(1);
    f.lookup.mockResolvedValueOnce(undefined);
    await f.lifecycle.refresh();
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
    f.scope({ profile: "other", home: "D:/other" });
    f.lookup.mockRejectedValueOnce(Error("service_unavailable"));
    await f.lifecycle.refresh();
    expect(f.transports).toHaveLength(1);
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({ status: 503 });
  });
  it("serializes refresh and schedules a fresh lookup after settings invalidate a pending result", async () => {
    const f = fixture();
    const wait = deferred<OwnerTunnelBinding>();
    f.lookup.mockReturnValueOnce(wait.promise);
    f.lifecycle.start();
    const pending = f.lifecycle.refresh();
    f.lifecycle.invalidate();
    wait.resolve(binding);
    await pending;
    await Promise.resolve();
    expect(f.lookup).toHaveBeenCalledTimes(2);
    expect(f.transports).toHaveLength(1);
  });
  it("detects root changes by timer and ignores repeated start calls", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.scope({ profile: "other", home: "D:/other" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.transports).toHaveLength(2);
    expect(f.transports[0].stop).toHaveBeenCalledTimes(1);
  });
  it("guards every event and download chunk after changing data domains", async () => {
    const f = fixture();
    async function* rows(): AsyncGenerator<string> {
      yield "first";
      yield "private-second";
    }
    async function* chunks(): AsyncGenerator<Buffer> {
      yield Buffer.from("first");
      yield Buffer.from("private-second");
    }
    f.handle.mockResolvedValueOnce({
      status: 200,
      events: rows(),
      download: { metadata: {}, chunks: chunks() },
    });
    f.lifecycle.start();
    await f.lifecycle.refresh();
    const result = await f.transports[0].handler.handle(
      {} as OwnerControlRequest,
    );
    const events = result.events![Symbol.asyncIterator]();
    const download = result.download!.chunks[Symbol.asyncIterator]();
    expect((await events.next()).value).toBe("first");
    expect(Buffer.from((await download.next()).value).toString()).toBe("first");
    f.scope({ profile: "other", home: "D:/other" });
    await expect(events.next()).rejects.toMatchObject({ status: 503 });
    await expect(download.next()).rejects.toMatchObject({ status: 503 });
  });
  it("never revives a retired handler when the identical credential is reenabled", async () => {
    const f = fixture();
    f.lifecycle.start();
    await f.lifecycle.refresh();
    f.lookup.mockResolvedValueOnce(undefined);
    await f.lifecycle.refresh();
    await f.lifecycle.refresh();
    await expect(f.transports[0].handler.status()).rejects.toMatchObject({
      status: 503,
    });
    await expect(f.transports[1].handler.status()).resolves.toEqual({
      ownerId: "owner",
    });
  });
});
