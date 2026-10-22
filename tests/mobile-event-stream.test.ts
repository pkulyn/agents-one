import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { MobileOwnerEventStream } from "../src/main/mobile-control/event-stream";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import type {
  SourceConversation,
  Json,
} from "../src/main/mobile-control/conversation-projection";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";

let root: string;
let ledger: MobileOwnerLedger;
let sources: SourceConversation[];
let controller: MobileConversationController;
let now: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-event-stream-"));
  now = Date.now();
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
    () => now,
  );
  sources = [
    {
      id: "original-1",
      sourceKind: "runtime_conversation",
      title: "Original",
      runtimeId: "runtime-1",
      runtimeName: "Original agent",
      revision: "1",
      manageable: true,
      archived: false,
      pinned: false,
      createdAt: 1000,
      updatedAt: 2000,
      activeRunIds: [],
      messages: [],
    },
  ];
  controller = new MobileConversationController(
    {
      list: () => sources,
      get: (id) => sources.find((row) => row.id === id),
      patch: () => {
        throw Error();
      },
    },
    ledger,
    "Owner",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function request(
  suffix = "/events",
  query: Record<string, string> = {},
  scopes = ["conversation:read"],
): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${suffix}`;
  const route = resolveMobileRoute("GET", path)!;
  return {
    method: "GET",
    requestId: "request-1",
    path,
    operationId: route.route.operationId,
    params: route.params,
    headers: {},
    query,
    body: null,
    signal: new AbortController().signal,
    device: {
      ownerId: "owner-1",
      spaceId: "space-1",
      deviceId: "phone-1",
      grantRevision: "1",
      scopes,
      revoked: false,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  };
}
async function publish(): Promise<Json> {
  const payload = (
    await controller.handle(
      request("/conversations/original-1", {}, [
        "conversation:read",
        "conversation:manage",
      ]),
    )
  ).body as Json;
  return ledger.publish({
    type: "conversation.updated",
    resourceRef: { type: "conversation", id: "original-1" },
    resourceRevision: "1",
    payload,
  });
}
describe("Owner persistent event replay and snapshots", () => {
  // @lat: [[mobile-data#Mobile data#Original artifact event scope projection]]
  it("removes artifact metadata from Run events for a device without artifact read scope", async () => {
    const anchor = ledger.cursor("phone-1", "1");
    const fixtures = JSON.parse(
      readFileSync("contracts/mobile-control/v1/fixtures.json", "utf8"),
    ).objects;
    const payload = { ...fixtures.Run, artifacts: [fixtures.Artifact] };
    ledger.publish({
      type: "run.updated",
      resourceRef: { type: "run", id: payload.runId },
      resourceRevision: "1",
      runId: payload.runId,
      runEventSeq: payload.lastRunEventSeq,
      payload,
    });
    const abort = new AbortController();
    const deniedStream = await new MobileOwnerEventStream(ledger).open({
      ...request("/events", { cursor: anchor }),
      signal: abort.signal,
    });
    const denied = deniedStream[Symbol.asyncIterator]();
    expect((await denied.next()).value).toMatchObject({
      payload: { artifacts: [], allowedActions: ["read"] },
    });
    abort.abort();
    await denied.next();
    const allowedAbort = new AbortController();
    const allowedStream = await new MobileOwnerEventStream(ledger).open({
        ...request("/events", { cursor: anchor }, [
          "conversation:read",
          "artifact:read",
        ]),
        signal: allowedAbort.signal,
      });
    const allowed = allowedStream[Symbol.asyncIterator]();
    expect((await allowed.next()).value).toMatchObject({
      payload: { artifacts: [fixtures.Artifact] },
    });
    allowedAbort.abort();
    await allowed.next();
  });
  // @lat: [[mobile-data#Mobile data#Owner event stream resume]]
  it("replays from a device-bound snapshot anchor and resumes once after Last-Event-ID", async () => {
    const anchor = ledger.cursor("phone-1", "1");
    const first = await publish();
    const second = await publish();
    const abort = new AbortController();
    const req = {
      ...request("/events", { cursor: anchor }),
      signal: abort.signal,
    };
    const response = await controller.handle(req);
    const iterator = response.events![Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({
      eventId: first.eventId,
    });
    expect((await iterator.next()).value).toMatchObject({
      eventId: second.eventId,
    });
    abort.abort();
    expect((await iterator.next()).done).toBe(true);
    const resume = {
      ...request(),
      headers: { "last-event-id": String(first.eventId) },
      signal: abort.signal,
    };
    const live = new AbortController();
    resume.signal = live.signal;
    const resumeStream = await new MobileOwnerEventStream(ledger).open(resume);
    const again = resumeStream[Symbol.asyncIterator]();
    expect((await again.next()).value).toMatchObject({
      eventId: second.eventId,
    });
    live.abort();
    expect((await again.next()).done).toBe(true);
  });
  // @lat: [[mobile-data#Mobile data#Event authorization projection]]
  it("filters denied topics and other-device permission events, and recomputes this device read position and actions", async () => {
    const anchor = ledger.cursor("phone-1", "1");
    const schedule = JSON.parse(
      readFileSync("contracts/mobile-control/v1/fixtures.json", "utf8"),
    ).objects.Schedule;
    ledger.publish({
      type: "schedule.updated",
      resourceRef: { type: "schedule", id: schedule.id },
      resourceRevision: schedule.revision,
      payload: schedule,
    });
    ledger.publish({
      type: "permission.changed",
      resourceRef: { type: "owner", id: "owner-1" },
      resourceRevision: "2",
      payload: {
        deviceId: "other-phone",
        grantRevision: "2",
        revoked: false,
        scopes: ["schedule:manage"],
      },
    });
    const sourceEvent = await publish();
    const abort = new AbortController();
    const sourceStream = await new MobileOwnerEventStream(ledger).open({
      ...request("/events", { cursor: anchor }),
      signal: abort.signal,
    });
    const iterator = sourceStream[Symbol.asyncIterator]();
    const value = (await iterator.next()).value as Json;
    expect(value).toMatchObject({
      eventId: sourceEvent.eventId,
      payload: { lastReadMessageSeq: "0", allowedActions: ["read"] },
    });
    abort.abort();
    expect((await iterator.next()).done).toBe(true);
  });
  // @lat: [[mobile-data#Mobile data#Event expired resume rejection]]
  it("returns 410 before opening SSE for foreign cursors, epochs, future sequence or expired retention", async () => {
    const first = await publish();
    const service = new MobileOwnerEventStream(ledger);
    await expect(
      service.open(
        request("/events", { cursor: ledger.cursor("other-phone", "1") }),
      ),
    ).rejects.toThrow("cursor_expired");
    await expect(
      service.open({
        ...request(),
        headers: { "last-event-id": "other-epoch:1" },
      }),
    ).rejects.toThrow("cursor_expired");
    await expect(
      service.open({
        ...request(),
        headers: { "last-event-id": `${ledger.dataEpoch}:2` },
      }),
    ).rejects.toThrow("cursor_expired");
    now += 8 * 86400000;
    await expect(
      service.open({
        ...request(),
        headers: { "last-event-id": `${ledger.dataEpoch}:0` },
      }),
    ).rejects.toThrow("cursor_expired");
    await expect(
      service.open({
        ...request(),
        headers: { "last-event-id": String(first.eventId) },
      }),
    ).resolves.toBeDefined();
  });
  // @lat: [[mobile-data#Mobile data#Event abort and grant expiry]]
  it("ends an idle iterator on cancellation and denies an expired grant before opening", async () => {
    const abort = new AbortController();
    const stream = await new MobileOwnerEventStream(ledger).open({
      ...request(),
      signal: abort.signal,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next();
    abort.abort();
    expect((await pending).done).toBe(true);
    const req = request();
    req.device.expiresAt = "2000-01-01T00:00:00Z";
    await expect(new MobileOwnerEventStream(ledger).open(req)).rejects.toThrow(
      "revoked",
    );
  });
  // @lat: [[mobile-data#Mobile data#Frozen recovery snapshot anchor]]
  it("freezes all original conversations over pages and retains the first event anchor across concurrent changes", async () => {
    sources = Array.from({ length: 125 }, (_, n) => ({
      ...sources[0],
      id: `original-${n}`,
      title: `Original ${n}`,
    }));
    const first = (await controller.handle(request("/snapshots"))).body as Json;
    expect(first.conversations).toHaveLength(100);
    expect(first.nextCursor).toBeTypeOf("string");
    sources[100] = { ...sources[100], title: "Concurrent edit" };
    await publish();
    const second = (
      await controller.handle(
        request("/snapshots", { cursor: String(first.nextCursor) }),
      )
    ).body as Json;
    expect(second).toMatchObject({
      snapshotRevision: first.snapshotRevision,
      snapshotCursor: first.snapshotCursor,
      nextCursor: null,
    });
    expect(second.conversations).toHaveLength(25);
    expect((second.conversations as Json[])[0].title).toBe("Original 100");
    const foreign = request("/snapshots", { cursor: String(first.nextCursor) });
    foreign.device.deviceId = "other-phone";
    await expect(controller.handle(foreign)).rejects.toMatchObject({
      code: "cursor_expired",
    });
    expect(
      ((await controller.handle(request("/snapshots", {}, []))).body as Json)
        .conversations,
    ).toEqual([]);
  });
});
