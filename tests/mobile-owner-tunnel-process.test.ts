import { expect, it, vi, type Mock } from "vitest";
vi.mock("electron", () => ({ utilityProcess: {} }));
import { OwnerTunnelMainBridge } from "../src/main/mobile-control/owner-tunnel-process";
import type {
  OwnerControlRequest,
  OwnerControlResponse,
} from "../src/main/mobile-control/owner-tunnel";
type Frame = {
  kind?: string;
  id?: number;
  ok?: boolean;
  error?: { code: string; status: number };
  result?: { body?: unknown };
};
type Setup = {
  bridge: OwnerTunnelMainBridge;
  handle: Mock<(request: OwnerControlRequest) => Promise<OwnerControlResponse>>;
  sent: Frame[];
  diagnostics: Record<string, unknown>[];
  receive(m: unknown): void;
};
function setup(active = true): Setup {
  let listener: (value: unknown) => void = () => {};
  const sent: Frame[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const handle = vi.fn<
    (request: OwnerControlRequest) => Promise<OwnerControlResponse>
  >(async () => ({ status: 200, body: { original: true } }));
  const bridge = new OwnerTunnelMainBridge(
    {
      onMessage: (fn) => (listener = fn),
      send: (value) => {
        sent.push(value as Frame);
        const m = value as Frame;
        if (m.kind === "probe")
          queueMicrotask(() =>
            listener({ kind: "probe_result", id: m.id, active }),
          );
      },
    },
    { status: () => ({}), handle },
    (value) => diagnostics.push(value),
  );
  return {
    bridge,
    handle,
    sent,
    diagnostics,
    receive: (m: unknown) => listener(m),
  };
}
it("rechecks delayed authorization before Main dispatch and preserves exact response DTO", async () => {
  const denied = setup(false);
  denied.receive({ kind: "call", id: 1, method: "handle", request: {} });
  await vi.waitFor(() =>
    expect(denied.sent.some((m) => m.kind === "reply")).toBe(true),
  );
  expect(denied.handle).not.toHaveBeenCalled();
  expect(denied.sent.at(-1)!.error!.code).toBe("revoked");
  denied.bridge.close();
  const allowed = setup();
  allowed.receive({ kind: "call", id: 1, method: "handle", request: {} });
  await vi.waitFor(() => expect(allowed.handle).toHaveBeenCalledOnce());
  expect(allowed.sent.at(-1)!.result!.body).toEqual({ original: true });
  allowed.bridge.close();
});
it("pulls only requested stream items and cancellation aborts source without redispatch", async () => {
  const s = setup();
  const pull = vi.fn(async () => ({
    done: false,
    value: { eventId: "original" },
  }));
  let signal: AbortSignal;
  s.handle.mockImplementation(async (request: OwnerControlRequest) => {
    signal = request.signal;
    return {
      status: 200,
      body: undefined,
      events: { [Symbol.asyncIterator]: () => ({ next: pull }) },
    } as OwnerControlResponse;
  });
  s.receive({ kind: "call", id: 1, method: "handle", request: {} });
  await vi.waitFor(() => expect(s.handle).toHaveBeenCalledOnce());
  expect(pull).not.toHaveBeenCalled();
  s.receive({ kind: "call", id: 2, method: "next", streamId: 1 });
  await vi.waitFor(() => expect(pull).toHaveBeenCalledOnce());
  s.receive({ kind: "cancel", id: 1 });
  expect(signal!.aborted).toBe(true);
  s.receive({ kind: "call", id: 3, method: "next", streamId: 1 });
  await vi.waitFor(() =>
    expect(s.sent.some((m) => m.id === 3 && m.ok === false)).toBe(true),
  );
  expect(pull).toHaveBeenCalledOnce();
  expect(s.handle).toHaveBeenCalledOnce();
  s.bridge.close();
});
it("rejects an oversized DTO before authorization or execution", async () => {
  const s = setup();
  s.receive({
    kind: "call",
    id: 1,
    method: "handle",
    request: { body: "x".repeat(8 * 1024 * 1024) },
  });
  await vi.waitFor(() => expect(s.sent.length).toBe(1));
  expect(s.sent[0].error).toEqual({ code: "payload_too_large", status: 413 });
  expect(s.handle).not.toHaveBeenCalled();
  s.bridge.close();
});

it("releases and aborts a stream when its initial response exceeds the IPC budget", async () => {
  const s = setup();
  let signal: AbortSignal;
  s.handle.mockImplementation(async (r: OwnerControlRequest) => {
    signal = r.signal;
    return {
      status: 200,
      body: "x".repeat(8 * 1024 * 1024),
      events: {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
        }),
      },
    } as OwnerControlResponse;
  });
  s.receive({ kind: "call", id: 1, method: "handle", request: {} });
  await vi.waitFor(() =>
    expect(s.sent.some((m) => m.kind === "reply" && m.ok === false)).toBe(true),
  );
  expect(signal!.aborted).toBe(true);
  expect(s.sent.at(-1).error.code).toBe("payload_too_large");
  s.bridge.close();
});

it("records route identity and fixed error type without body, stack or error text", async () => {
  const s = setup();
  s.handle.mockRejectedValueOnce(new TypeError("private-task-and-secret"));
  s.receive({
    kind: "call",
    id: 1,
    method: "handle",
    request: {
      requestId: "relay-request",
      operationId: "getConversation",
      body: { text: "private-prompt" },
    },
  });
  await vi.waitFor(() =>
    expect(s.sent.some((m) => m.kind === "reply" && !m.ok)).toBe(true),
  );
  expect(s.diagnostics.at(-1)).toEqual({
    event: "handler_failed",
    requestId: "relay-request",
    operationId: "getConversation",
    stage: "request",
    code: "requires_owner_action",
    status: 503,
    errorType: "TypeError",
  });
  expect(JSON.stringify(s.diagnostics)).not.toContain("private-");
  s.bridge.close();
});
