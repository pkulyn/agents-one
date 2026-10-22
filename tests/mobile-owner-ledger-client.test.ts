import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("electron", () => ({ utilityProcess: { fork: worker.fork } }));

import { MobileOwnerLedgerClient } from "../src/main/mobile-control/owner-ledger-client";

type FakeChild = EventEmitter & {
  postMessage: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

function childProcess(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.postMessage = vi.fn((request: { id: number; method: string }) => {
    queueMicrotask(() => {
      child.emit("message", {
        id: request.id,
        ok: true,
        ...(request.method === "operations" ? { result: [] } : {}),
        dataEpoch: "epoch-1",
        changeSeq: "1",
      });
      if (request.method === "close")
        queueMicrotask(() => child.emit("exit", 0));
    });
  });
  child.kill = vi.fn(() => child.emit("exit", 1));
  worker.fork.mockImplementation(() => {
    queueMicrotask(() =>
      child.emit("message", {
        kind: "ready",
        dataEpoch: "epoch-1",
        changeSeq: "0",
      }),
    );
    return child;
  });
  return child;
}

afterEach(() => worker.fork.mockReset());

describe("mobile Owner ledger worker client", () => {
  // @lat: [[mobile-data#Mobile data#Independent ledger worker RPC]]
  it("waits for worker readiness, updates ledger metadata and closes through one RPC", async () => {
    const child = childProcess();
    const ledger = new MobileOwnerLedgerClient(
      "C:/agents-one/ledger.json",
      "owner-1",
      "space-1",
    );

    await ledger.whenReady();
    expect(ledger.dataEpoch).toBe("epoch-1");
    expect(await ledger.operations("device-1")).toEqual([]);
    expect(ledger.changeSeq).toBe("1");

    await ledger.close();
    await ledger.close();

    const closes = child.postMessage.mock.calls.filter(
      ([message]) => message.method === "close",
    );
    expect(closes).toHaveLength(1);
    expect(child.kill).not.toHaveBeenCalled();
  });
});
