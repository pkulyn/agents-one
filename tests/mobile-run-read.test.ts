import { afterEach, beforeEach, expect, it } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type {
  AgentRuntimeRun,
  AgentRuntimeEvent,
} from "../src/shared/agent-runtimes";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
import type { TaskSchedule } from "../src/shared/task-schedules";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import {
  OriginalMobileRunRepository,
  originalRunReferences,
} from "../src/main/mobile-control/run-read";
import { projectRuntimeConversation } from "../src/main/mobile-control/conversation-projection";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";

let root: string,
  ledger: MobileOwnerLedger,
  rows: RuntimeConversation[],
  schedules: TaskSchedule[],
  native: AgentRuntimeRun | null,
  reader: OriginalMobileRunRepository,
  locked: boolean;
function conversation(): RuntimeConversation {
  return {
    id: "original",
    title: "Original",
    runtimeId: "runtime-1",
    runtimeName: "Agent",
    runtimeKind: "codex",
    runtimeLocation: "local",
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 1,
    messages: [
      {
        id: "message-1",
        role: "agent",
        content: "ordinary reply",
        createdAt: 2000,
        execution: { runId: "run-1", events: [] },
      },
    ],
  };
}
function setup(): void {
  reader = new OriginalMobileRunRepository(
    {
      conversations: () => rows,
      schedules: () => schedules,
      native: async () => native,
      guard: () => {
        if (locked) throw Error("owner_unavailable");
      },
    },
    ledger,
  );
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-run-read-"));
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  rows = [conversation()];
  schedules = [];
  native = null;
  locked = false;
  setup();
});
afterEach(() => {
  const rel = relative(realpathSync(tmpdir()), realpathSync(root));
  if (
    isAbsolute(rel) ||
    rel.startsWith("..") ||
    !rel.startsWith("agents-one-run-read-")
  )
    throw Error("unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});
function event(type: AgentRuntimeEvent["type"]): AgentRuntimeEvent {
  return { type, createdAt: 2000 } as AgentRuntimeEvent;
}
function request(
  suffix: string,
  scopes = ["conversation:read"],
): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${suffix}`,
    route = resolveMobileRoute("GET", path)!;
  return {
    requestId: "read-original",
    method: "GET",
    path,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    headers: {},
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
function controller(): MobileConversationController {
  return new MobileConversationController(
    {
      list: () => rows.map((row) => projectRuntimeConversation(row)),
      patch: () => {
        throw Error("no write");
      },
    },
    ledger,
    "Owner",
    Date.now,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => {
      if (locked) throw Error("owner_unavailable");
    },
    () => false,
    () => false,
    undefined,
    reader,
  );
}

// @lat: [[mobile-data#Mobile data#Original Run evidence projection]]
it("uses real native status and explicit terminal evidence without guessing from ordinary replies or intermediate errors", async () => {
  const original = JSON.stringify(rows);
  await reader.sync();
  expect(reader.get("run-1")).toMatchObject({
    status: "reconciliation_required",
    startedAt: null,
    completedAt: null,
    allowedActions: ["read"],
    lastRunEventSeq: "1",
    artifacts: [],
  });
  rows[0].messages[0].execution!.events = [event("error"), event("progress")];
  await reader.sync();
  expect(reader.get("run-1")!.status).toBe("reconciliation_required");
  rows[0].messages[0].execution!.events = [
    event("completed"),
    event("artifact_published"),
  ];
  await reader.sync();
  expect(reader.get("run-1")).toMatchObject({
    status: "succeeded",
    lastRunEventSeq: "2",
  });
  native = {
    id: "run-1",
    runtimeId: "runtime-1",
    status: "running",
    startedAt: 3000,
  };
  await reader.sync();
  expect(reader.get("run-1")!.status).toBe("running");
  native.status = "cancelled";
  native.completedAt = 4000;
  await reader.sync();
  expect(reader.get("run-1")).toMatchObject({
    status: "cancelled",
    completedAt: new Date(4000).toISOString(),
  });
  rows = JSON.parse(original);
  native = null;
  await reader.sync();
  expect(JSON.stringify(rows)).toBe(original);
});
// @lat: [[mobile-data#Mobile data#Original scheduled Run evidence]]
it("uses actual original scheduler terminal evidence and rejects conflicting or foreign native results", async () => {
  schedules = [
    {
      runtimeId: "runtime-1",
      runs: [
        {
          runtimeRunId: "run-1",
          conversationId: "original",
          status: "timed_out",
          completedAt: 5000,
        },
      ],
    } as TaskSchedule,
  ];
  await reader.sync();
  expect(reader.get("run-1")).toMatchObject({
    status: "timed_out",
    completedAt: new Date(5000).toISOString(),
    startedAt: null,
  });
  rows[0].messages[0].execution!.events = [event("completed")];
  await expect(reader.sync()).rejects.toMatchObject({
    code: "requires_owner_action",
  });
  native = {
    id: "run-1",
    runtimeId: "foreign",
    status: "succeeded",
    startedAt: 1000,
  };
  await expect(reader.sync()).rejects.toMatchObject({
    code: "requires_owner_action",
  });
  expect(reader.get("run-1")!.status).toBe("timed_out");
});
// @lat: [[mobile-data#Mobile data#Original Run branch identity]]
it("recognizes explicit inherited branches but rejects unrelated collisions, cycles and private-only records", () => {
  const child = structuredClone(rows[0]);
  child.id = "branch";
  child.branch = { parentConversationId: "original" };
  expect(
    originalRunReferences([rows[0], child].map(projectRuntimeConversation)),
  ).toEqual([
    { runId: "run-1", runtimeId: "runtime-1", conversationId: "original" },
  ]);
  delete child.branch;
  expect(() =>
    originalRunReferences([rows[0], child].map(projectRuntimeConversation)),
  ).toThrow("requires_owner_action");
  child.branch = { parentConversationId: "original" };
  rows[0].branch = { parentConversationId: "branch" };
  expect(() =>
    originalRunReferences([rows[0], child].map(projectRuntimeConversation)),
  ).toThrow();
  rows[0].messages[0].meta = {
    audience: ["audit"],
    origin: "runtime",
    persistence: "durable",
  };
  expect(originalRunReferences([projectRuntimeConversation(rows[0])])).toEqual(
    [],
  );
});
// @lat: [[mobile-data#Mobile data#Original Run stable revision and guard]]
it("keeps revisions across reopening, coalesces refresh and hides deleted sources without writing original data", async () => {
  const bytes = JSON.stringify(rows);
  const first = reader.sync();
  expect(reader.sync()).toBe(first);
  await first;
  expect(JSON.stringify(rows)).toBe(bytes);
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  setup();
  await reader.sync();
  expect(reader.get("run-1")!.lastRunEventSeq).toBe("1");
  locked = true;
  await expect(reader.sync()).rejects.toThrow("owner_unavailable");
  expect(() => reader.list()).toThrow("owner_unavailable");
  locked = false;
  rows = [];
  expect(reader.list()).toEqual([]);
});
// @lat: [[mobile-data#Mobile data#Original Run controller read and scope]]
it("exposes original Runs through scoped GET and filtered snapshots with execution disabled", async () => {
  const api = controller();
  expect(api.status().executionAvailable).toBe(false);
  expect((await api.handle(request("/runs/run-1"))).body).toMatchObject({
    runId: "run-1",
    status: "reconciliation_required",
    allowedActions: ["read"],
  });
  const req = request("/snapshots");
  req.query.conversationId = "original";
  expect((await api.handle(req)).body).toMatchObject({
    runs: [{ runId: "run-1" }],
    conversations: [{ id: "original" }],
  });
  req.query.conversationId = "other";
  expect((await api.handle(req)).body).toMatchObject({
    runs: [],
    conversations: [],
  });
  await expect(api.handle(request("/runs/run-1", []))).rejects.toMatchObject({
    code: "scope_denied",
  });
  await expect(api.handle(request("/runs/unknown"))).rejects.toMatchObject({
    code: "resource_not_found",
  });
});
// @lat: [[mobile-data#Mobile data#Original Run async stream and deletion]]
it("refreshes original native Runs in SSE and publishes explicit Run deletion without submitting tasks", async () => {
  const api = controller();
  await api.handle(request("/bootstrap"));
  const req = request("/events"),
    abort = new AbortController();
  req.query.cursor = ledger.cursor("phone-1", "1");
  req.signal = abort.signal;
  native = {
    id: "run-1",
    runtimeId: "runtime-1",
    status: "succeeded",
    startedAt: 1000,
    completedAt: 2000,
  };
  const iterator = (await api.handle(req)).events![Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({
    type: "run.updated",
    runId: "run-1",
    runEventSeq: "2",
    resourceRef: { type: "run", id: "run-1" },
    payload: { status: "succeeded", lastRunEventSeq: "2" },
  });
  rows[0].messages = [];
  await api.handle(request("/snapshots"));
  const events = ledger.eventsAfter("1");
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "resource.deleted",
        resourceRef: { type: "run", id: "run-1" },
        payload: { kind: "run", id: "run-1" },
      }),
    ]),
  );
  abort.abort();
  await iterator.return?.();
  // Reopening directly into SSE must not seed an empty Run cache or invent deletions.
  rows = [conversation()];
  await api.handle(request("/bootstrap"));
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  setup();
  const seq = ledger.changeSeq,
    restarted = controller(),
    resume = request("/events");
  resume.headers["last-event-id"] = `${ledger.dataEpoch}:${seq}`;
  await restarted.handle(resume);
  expect(ledger.eventsAfter(seq)).toEqual([]);
});
