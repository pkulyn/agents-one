import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
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

let root: string,
  file: string,
  ledger: MobileOwnerLedger,
  controller: MobileConversationController;
let sources: SourceConversation[],
  schedules: Json[],
  executions: Json[],
  broken: boolean,
  locked: boolean;
function setup(): void {
  ledger = new MobileOwnerLedger(file, "owner-1", "space-1");
  controller = new MobileConversationController(
    {
      list: () => {
        if (broken) throw Error("corrupt_source");
        return sources;
      },
      patch: () => {
        throw Error();
      },
    },
    ledger,
    "Owner",
    Date.now,
    undefined,
    undefined,
    undefined,
    {
      list: () => schedules,
      get: (id) => schedules.find((row) => row.id === id)!,
      executions: () => executions,
      preview: () => {
        throw Error();
      },
    },
    undefined,
    () => {
      if (locked) throw Error("owner_unavailable");
    },
  );
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-source-events-"));
  file = join(root, "ledger.json");
  sources = [
    {
      id: "original",
      sourceKind: "native_session",
      title: "Original",
      runtimeId: "hermes-local",
      runtimeName: "Hermes",
      pinned: false,
      archived: false,
      createdAt: 1000,
      updatedAt: 2000,
      activeRunIds: [],
      manageable: false,
      messages: [
        {
          id: "-7",
          kind: "assistant",
          content: "原始正文\n".repeat(5000),
          createdAt: 2000,
        },
      ],
    },
  ];
  const fixtures = JSON.parse(
    readFileSync("contracts/mobile-control/v1/fixtures.json", "utf8"),
  ).objects;
  schedules = [structuredClone(fixtures.Schedule)];
  executions = [structuredClone(fixtures.ScheduleExecution)];
  executions[0].scheduleId = schedules[0].id;
  broken = false;
  locked = false;
  setup();
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function request(
  suffix: string,
  scopes = ["conversation:read", "schedule:read"],
  deviceId = "phone-1",
): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${suffix}`;
  const route = resolveMobileRoute("GET", path)!;
  return {
    requestId: "request",
    method: "GET",
    path,
    operationId: route.route.operationId,
    params: route.params,
    headers: {},
    query: {},
    body: null,
    signal: new AbortController().signal,
    device: {
      ownerId: "owner-1",
      spaceId: "space-1",
      deviceId,
      grantRevision: "1",
      scopes,
      revoked: false,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  };
}
async function sync(): Promise<void> {
  await controller.handle(request("/snapshots"));
}

it("seeds silently, publishes full original changes once, and resumes after reopening the ledger", async () => {
  await sync();
  expect(ledger.changeSeq).toBe("0");
  const body = sources[0].messages[0].content + "updated";
  sources[0].messages[0].content = body;
  sources[0].title = "Updated";
  await sync();
  const events = ledger.eventsAfter("0");
  expect(events.map((row) => row.type)).toEqual([
    "conversation.updated",
    "message.upsert",
  ]);
  expect(events[1]).toMatchObject({
    resourceRef: { id: "original" },
    payload: { id: "-7", content: body, messageSeq: "1", messageRevision: "2" },
  });
  await sync();
  expect(ledger.eventsAfter("0")).toHaveLength(2);
  setup();
  await sync();
  expect(ledger.eventsAfter("0")).toEqual(events);
  sources[0].messages.push({
    id: "new-original-message",
    kind: "user",
    content: "new",
    createdAt: 3000,
  });
  await sync();
  expect(ledger.eventsAfter("2").at(-1)).toMatchObject({
    type: "message.upsert",
    payload: { id: "new-original-message", messageSeq: "2" },
  });
});
it("publishes only changed executions and explicit original deletions", async () => {
  await sync();
  schedules[0].name = "Renamed";
  schedules[0].revision = "2";
  await sync();
  expect(ledger.eventsAfter("0").map((row) => row.type)).toEqual([
    "schedule.updated",
  ]);
  executions[0].summary = "Changed result";
  await sync();
  expect(ledger.eventsAfter("1")).toMatchObject([
    {
      type: "schedule.execution.updated",
      resourceRevision: "2",
      payload: { id: executions[0].id, scheduleId: schedules[0].id },
    },
  ]);
  const seq = ledger.changeSeq;
  sources = [];
  schedules = [];
  executions = [];
  await sync();
  expect(ledger.eventsAfter(seq).map((row) => row.payload)).toEqual(
    expect.arrayContaining([
      { kind: "conversation", id: "original" },
      { kind: "message", id: "-7", conversationId: "original" },
      {
        kind: "schedule",
        id: JSON.parse(
          readFileSync("contracts/mobile-control/v1/fixtures.json", "utf8"),
        ).objects.Schedule.id,
      },
    ]),
  );
  expect(
    ledger.eventsAfter(seq).every((row) => row.type === "resource.deleted"),
  ).toBe(true);
  await sync();
  expect(ledger.eventsAfter(seq)).toHaveLength(4);
});
it("does not publish false deletions on source or guard failures and retries an atomic checkpoint failure", async () => {
  await sync();
  const initial = readFileSync(file, "utf8");
  broken = true;
  sources = [];
  await expect(sync()).rejects.toThrow("corrupt_source");
  expect(readFileSync(file, "utf8")).toBe(initial);
  broken = false;
  locked = true;
  await expect(sync()).rejects.toThrow("owner_unavailable");
  expect(ledger.changeSeq).toBe("0");
  locked = false;
  const original = ledger.observeSourceEvents.bind(ledger);
  const failure = vi
    .spyOn(ledger, "observeSourceEvents")
    .mockImplementationOnce((entries) =>
      original([
        ...entries,
        { key: "invalid", event: { type: "bad" }, deletion: { type: "bad" } },
      ]),
    );
  await expect(sync()).rejects.toThrow();
  expect(ledger.changeSeq).toBe("0");
  failure.mockRestore();
  await sync();
  expect(ledger.eventsAfter("0")).toHaveLength(2);
  const persisted = JSON.parse(readFileSync(file, "utf8"));
  persisted.sourceEvents[
    Object.keys(persisted.sourceEvents)[0]
  ].deletion.resourceRef = { type: "bad", id: "id" };
  writeFileSync(file, JSON.stringify(persisted));
  expect(() => setup()).toThrow("mobile_ledger_invalid");
});
it("filters deletion topics and registers only authorized offered message sequences for read acknowledgement", async () => {
  await sync();
  const req = request("/events", ["conversation:read"]);
  req.query.cursor = ledger.cursor("phone-1", "1");
  sources[0].messages[0].content = "changed";
  schedules = [];
  executions = [];
  const abort = new AbortController();
  req.signal = abort.signal;
  const iterator = (await controller.handle(req)).events![
    Symbol.asyncIterator
  ]();
  expect((await iterator.next()).value.type).toBe("conversation.updated");
  expect((await iterator.next()).value).toMatchObject({
    type: "message.upsert",
    payload: { id: "-7" },
  });
  expect(ledger.markRead("phone-1", "original", "1")).toBe("1");
  expect(() => ledger.markRead("other-phone", "original", "1")).toThrow();
  const pending = iterator.next();
  abort.abort();
  expect((await pending).done).toBe(true);
});

it("rolls back event sequence and checkpoints on atomic file replacement failure", async () => {
  await sync();
  const initial = readFileSync(file, "utf8");
  const entry = Object.values(JSON.parse(initial).sourceEvents).find(
    (value: unknown) =>
      (value as { deletion: Json }).deletion.payload &&
      ((value as { deletion: Json }).deletion.payload as Json).kind ===
        "schedule",
  ) as { deletion: Json };
  const changed = {
    key: JSON.stringify(["schedule", schedules[0].id]),
    event: {
      type: "schedule.updated",
      resourceRef: entry.deletion.resourceRef,
      resourceRevision: "2",
      payload: { ...schedules[0], revision: "2", name: "Changed" },
    },
    deletion: entry.deletion,
  };
  rmSync(file);
  mkdirSync(file);
  expect(() => ledger.observeSourceEvents([changed])).toThrow();
  expect(ledger.changeSeq).toBe("0");
  rmSync(file, { recursive: true });
  writeFileSync(file, initial);
  ledger.observeSourceEvents([changed]);
  expect(ledger.eventsAfter("0")).toHaveLength(4);
  ledger.observeSourceEvents([changed]);
  expect(ledger.changeSeq).toBe("4");
  expect(
    new MobileOwnerLedger(file, "owner-1", "space-1").eventsAfter("0"),
  ).toHaveLength(4);
});
