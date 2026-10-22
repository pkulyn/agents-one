import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TaskSchedule } from "../src/shared/task-schedules";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import { DesktopMobileScheduleReadRepository } from "../src/main/mobile-control/schedule-read";
import {
  previewTaskSchedule,
  listFullTaskSchedules,
  listTaskSchedules,
} from "../src/main/task-schedules";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "other",
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: vi.fn(),
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: vi.fn(),
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: vi.fn(),
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  cancelAgentRuntimeTask: vi.fn(),
}));
const now = Date.parse("2026-10-05T00:00:00Z");
const file = (): string =>
  join(state.root, "owner", "desktop", "task-schedules.json");
function row(id = "schedule-1"): TaskSchedule {
  return {
    id,
    revision: "9",
    name: `Original ${id}`,
    runtimeId: "runtime-1",
    workspaceId: "project-1",
    workspace: "D:/private/project",
    schedule: "5m",
    prompt: "Original prompt",
    mode: "analysis",
    timeoutMs: 600000,
    enabled: true,
    concurrencyPolicy: "queue",
    pendingRuns: 2,
    activeRuntimeRunId: "native-active",
    nextRunAt: now + 300000,
    createdAt: now,
    updatedAt: now,
    runs: Array.from({ length: 125 }, (_, n) => ({
      id: `execution-${n}`,
      trigger: "scheduled",
      dueAt: now + n * 1000,
      triggeredAt: now + n * 1000,
      status: "succeeded",
      runtimeRunId: `native-${n}`,
      conversationId: `conversation-${n}`,
      completedAt: now + n * 1000 + 500,
      summary: "Output at D:/private/result.txt",
      secretExtension: "must-stay-private",
    })),
  };
}
function seed(rows: TaskSchedule[]): string {
  const bytes = JSON.stringify({
    version: 5,
    privateExtension: "private",
    schedules: rows,
  });
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), bytes);
  return bytes;
}
function request(
  path: string,
  changes: Partial<OwnerControlRequest> = {},
): OwnerControlRequest {
  const full = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${path}`;
  const route = resolveMobileRoute(changes.method ?? "GET", full)!;
  return {
    requestId: "request-1",
    method: "GET",
    path: full,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    headers: {},
    body: null,
    signal: new AbortController().signal,
    device: {
      deviceId: "phone-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      scopes: ["schedule:read"],
      grantRevision: "1",
      expiresAt: "2026-10-06T00:00:00Z",
      revoked: false,
    },
    ...changes,
  };
}
function controller(): MobileConversationController {
  const repository = { list: () => [], patch: vi.fn() };
  const ledger = new MobileOwnerLedger(
    join(state.root, "ledger.json"),
    "owner-1",
    "space-1",
    () => now,
  );
  return new MobileConversationController(
    repository,
    ledger,
    "Owner",
    () => now,
    undefined,
    undefined,
    undefined,
    new DesktopMobileScheduleReadRepository("owner"),
  );
}
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-mobile-schedule-read-"));
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));

describe("real Owner schedule reads", () => {
  // @lat: [[mobile-data#Mobile data#Schedule recent execution original projection]]
  it("projects the latest original execution from the same history snapshot with stable ties and no invented completion", () => {
    const original = row();
    const timestamp = now + 999000;
    original.runs.unshift({
      id: "latest-b",
      trigger: "manual",
      triggeredAt: timestamp,
      status: "failed",
      summary: "b",
    });
    original.runs.push({
      id: "latest-a",
      trigger: "scheduled",
      triggeredAt: timestamp,
      status: "running",
      runtimeRunId: "original-live-run",
      summary: "Authorization: Bearer private-key\nD:/private/output",
      conversationId: "original-result",
    });
    const bytes = seed([original]);
    const reader = new DesktopMobileScheduleReadRepository("owner");
    const latest = (reader.list()[0].recentExecution as { execution: unknown })
      .execution;
    expect(latest).toEqual(reader.executions(original.id)[0]);
    expect(latest).toMatchObject({
      id: "latest-a",
      scheduleId: original.id,
      status: "running",
      runtimeRunId: "original-live-run",
      conversationId: "original-result",
    });
    expect(latest).not.toHaveProperty("completedAt");
    expect(JSON.stringify(latest)).not.toMatch(
      /private-key|D:\/private|secretExtension/,
    );
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  // @lat: [[mobile-data#Mobile data#Schedule recent execution empty and corrupt source]]
  it("distinguishes a known empty history and refuses duplicate, malformed latest and unorderable timestamps", () => {
    const original = row();
    original.runs = [];
    const reader = new DesktopMobileScheduleReadRepository(
      "owner",
      () => [original],
      () => "Asia/Shanghai",
    );
    expect(reader.get(original.id).recentExecution).toEqual({
      execution: null,
    });
    original.runs = [
      { id: "x", trigger: "manual", triggeredAt: now, status: "running" },
    ];
    original.runs.push({ ...original.runs[0] });
    expect(() => reader.list()).toThrow("requires_owner_action");
    original.runs = [
      {
        id: "x",
        trigger: "manual",
        triggeredAt: now,
        status: "pretend_success" as never,
      },
    ];
    expect(() => reader.list()).toThrow("requires_owner_action");
    original.runs = [
      { id: "x", trigger: "manual", triggeredAt: Infinity, status: "running" },
    ];
    expect(() => reader.list()).toThrow("requires_owner_action");
  });
  // @lat: [[mobile-data#Mobile data#Schedule recent execution authorized frozen pages]]
  it("freezes latest execution with paged definitions and only exposes new history on a fresh authorized read", async () => {
    const originals = [row("schedule-1"), row("schedule-2")];
    seed(originals);
    const owner = controller();
    const first = (
      await owner.handle(request("/schedules", { query: { limit: "1" } }))
    ).body as { nextCursor: string };
    originals[1].runs.push({
      id: "new-original",
      trigger: "manual",
      triggeredAt: now + 999999,
      status: "cancelled",
    });
    const bytes = seed(originals);
    const page = (
      await owner.handle(
        request("/schedules", {
          query: { limit: "1", cursor: first.nextCursor },
        }),
      )
    ).body as { items: { recentExecution: { execution: { id: string } } }[] };
    expect(page.items[0].recentExecution.execution.id).toBe("execution-124");
    const fresh = (await owner.handle(request("/schedules/schedule-2")))
      .body as { recentExecution: { execution: { id: string } } };
    expect(fresh.recentExecution.execution.id).toBe("new-original");
    const denied = request("/schedules");
    denied.device.scopes = [];
    await expect(owner.handle(denied)).rejects.toThrow("scope_denied");
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  // @lat: [[mobile-data#Mobile data#Schedule recovery read state]]
  it("shows admitted uncertain runs as blocked and retains their native IDs without mutating history", () => {
    const original = row();
    original.mobileRecoveryRequired = true;
    const bytes = seed([original]);
    const reader = new DesktopMobileScheduleReadRepository("owner");
    expect(reader.get(original.id)).toMatchObject({
      effectiveState: "blocked",
      restrictionReason: "unknown_state",
      activeRunIds: ["native-active"],
      pendingCount: 2,
    });
    expect(reader.executions(original.id)).toHaveLength(125);
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  // @lat: [[mobile-data#Mobile data#Original schedule read projection]]
  it("reads all original history from the fixed profile without changing bytes or exposing paths and extensions", () => {
    const bytes = seed([row()]);
    const adapter = new DesktopMobileScheduleReadRepository("owner");
    expect(adapter.get("schedule-1")).toMatchObject({
      id: "schedule-1",
      prompt: "Original prompt",
      revision: "9",
      projectId: "project-1",
      activeRunIds: ["native-active"],
      allowedActions: ["read"],
    });
    expect(adapter.list()[0]).not.toHaveProperty("prompt");
    const runs = adapter.executions("schedule-1");
    expect(runs).toHaveLength(125);
    expect(runs[0]).toMatchObject({
      id: "execution-124",
      runtimeRunId: "native-124",
      conversationId: "conversation-124",
    });
    expect(JSON.stringify(runs)).not.toContain("D:/private");
    expect(JSON.stringify(runs)).not.toContain("secretExtension");
    expect(listTaskSchedules("owner")[0].runs).toHaveLength(100);
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  // @lat: [[mobile-data#Mobile data#Schedule read corruption failures]]
  it("refuses malformed stores and duplicate original IDs while preserving them", () => {
    seed([row()]);
    for (const bytes of [
      "{broken",
      "{}",
      JSON.stringify({ schedules: [null] }),
      JSON.stringify({ schedules: [row(), row()] }),
    ]) {
      writeFileSync(file(), bytes);
      expect(() => listFullTaskSchedules("owner", true)).toThrow();
      expect(readFileSync(file(), "utf8")).toBe(bytes);
    }
  });
  // @lat: [[mobile-data#Mobile data#Schedule execution source integrity]]
  it("refuses unknown trigger and invalid original timestamps rather than fabricating history", () => {
    const value = row();
    delete value.runs[0].trigger;
    seed([value]);
    const adapter = new DesktopMobileScheduleReadRepository("owner");
    expect(() => adapter.executions(value.id)).toThrow("requires_owner_action");
    value.runs[0].trigger = "manual";
    value.runs[0].triggeredAt = NaN;
    expect(() =>
      new DesktopMobileScheduleReadRepository("owner", () => [
        value,
      ]).executions(value.id),
    ).toThrow("requires_owner_action");
    expect(() => adapter.get("missing")).toThrow("resource_not_found");
  });
  // @lat: [[mobile-data#Mobile data#Frozen schedule history pages]]
  it("freezes history and binds page cursors to the original schedule, device and grant", async () => {
    seed([row(), row("schedule-2")]);
    const api = controller();
    const first = (
      await api.handle(
        request("/schedules/schedule-1/executions", { query: { limit: 100 } }),
      )
    ).body as Record<string, unknown>;
    expect(first.items).toHaveLength(100);
    const cursor = first.nextCursor as string;
    const changed = row();
    changed.runs = [];
    seed([changed, row("schedule-2")]);
    const second = (
      await api.handle(
        request("/schedules/schedule-1/executions", {
          query: { cursor, limit: 100 },
        }),
      )
    ).body as Record<string, unknown>;
    expect(second.items).toHaveLength(25);
    await expect(
      api.handle(
        request("/schedules/schedule-2/executions", { query: { cursor } }),
      ),
    ).rejects.toMatchObject({ status: 410 });
    const another = request("/schedules/schedule-1/executions", {
      query: { cursor },
    });
    another.device = { ...another.device, deviceId: "phone-2" };
    await expect(api.handle(another)).rejects.toMatchObject({ status: 410 });
    another.device = {
      ...another.device,
      deviceId: "phone-1",
      grantRevision: "2",
    };
    await expect(api.handle(another)).rejects.toMatchObject({ status: 410 });
  });
  // @lat: [[mobile-data#Mobile data#Schedule read capabilities and scope]]
  it("advertises read alone without claiming scheduler online, enforces scope and filters actual state", async () => {
    const paused = row("paused");
    paused.enabled = false;
    delete paused.activeRuntimeRunId;
    seed([row(), paused]);
    const api = controller();
    expect(api.status()).toMatchObject({ schedulerOnline: false });
    expect(api.status().capabilities).toContain("schedule:read");
    expect(api.status().capabilities).not.toContain("schedule:manage");
    const result = (
      await api.handle(request("/schedules", { query: { state: "paused" } }))
    ).body as Record<string, unknown>;
    expect(result.items).toHaveLength(1);
    const denied = request("/schedules");
    denied.device = { ...denied.device, scopes: [] };
    await expect(api.handle(denied)).rejects.toMatchObject({ status: 403 });
  });
  // @lat: [[mobile-data#Mobile data#Shared desktop schedule preview calculation]]
  it("calculates five future interval and local cron occurrences using the original scheduler clock", () => {
    const interval = previewTaskSchedule(" 5M ", now);
    expect(interval.normalizedExpression).toBe("5m");
    expect(interval.nextOccurrences).toEqual(
      [1, 2, 3, 4, 5].map((n) => new Date(now + n * 300000).toISOString()),
    );
    const cron = previewTaskSchedule(" 0   9 * * * ", now);
    expect(cron.schedulerTimeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(cron.nextOccurrences).toHaveLength(5);
    for (const occurrence of cron.nextOccurrences) {
      const date = new Date(occurrence);
      expect(date.getHours()).toBe(9);
      expect(date.getMinutes()).toBe(0);
      expect(date.getTime()).toBeGreaterThan(now);
    }
    for (const invalid of ["0m", "99999999999999999h", "61 * * * *", "bad"])
      expect(() => previewTaskSchedule(invalid, now)).toThrow();
    if (
      Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York"
    ) {
      const fallBack = previewTaskSchedule(
        "30 1 * * *",
        Date.parse("2026-11-01T04:59:00Z"),
      );
      expect(fallBack.nextOccurrences).toEqual([
        "2026-11-01T05:30:00.000Z",
        "2026-11-02T06:30:00.000Z",
        "2026-11-03T06:30:00.000Z",
        "2026-11-04T06:30:00.000Z",
        "2026-11-05T06:30:00.000Z",
      ]);
      const spring = previewTaskSchedule(
        "30 2 * * *",
        Date.parse("2026-03-08T05:00:00Z"),
      );
      expect(spring.nextOccurrences[0]).toBe("2026-03-09T06:30:00.000Z");
    }
  });
  // @lat: [[mobile-data#Mobile data#Schedule preview is a bound calculation]]
  it("returns a device-bound expiring preview without executing, mutating definitions or approving policies", async () => {
    const bytes = seed([row()]);
    const api = controller();
    const input = {
      name: "New",
      prompt: "New task",
      runtimeId: "runtime-1",
      executionPolicyId: "policy-not-approved",
      scheduleExpression: "5m",
    };
    const req = request("/schedules/preview", { method: "POST", body: input });
    req.device = { ...req.device, scopes: ["schedule:manage"] };
    const result = (await api.handle(req)).body as Record<string, unknown>;
    expect(result.nextOccurrences).toHaveLength(5);
    const ledger = new MobileOwnerLedger(
      join(state.root, "ledger.json"),
      "owner-1",
      "space-1",
      () => now,
    );
    const token = String(result.previewRevision);
    expect(ledger.parseCursor(token, "phone-1", "1")).toMatchObject({
      purpose: "schedule-preview",
      schedulerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      expiresAt: now + 300000,
    });
    expect(() => ledger.parseCursor(token, "phone-2", "1")).toThrow();
    expect(() => ledger.parseCursor(token, "phone-1", "2")).toThrow();
    expect(
      Buffer.from(token.split(".")[0], "base64url").toString(),
    ).not.toContain("New task");
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    const denied = {
      ...req,
      device: { ...req.device, scopes: ["schedule:read"] },
    };
    await expect(api.handle(denied)).rejects.toMatchObject({ status: 403 });
  });
  // @lat: [[mobile-data#Mobile data#Schedule search filters stay bound]]
  it("searches original names with project and state filters and rejects filter-swapped cursors", async () => {
    seed([row("a"), row("b")]);
    const api = controller();
    const result = (
      await api.handle(
        request("/schedules/search", {
          method: "POST",
          body: {
            query: "original",
            projectId: "project-1",
            state: "running",
            limit: 1,
          },
        }),
      )
    ).body as Record<string, unknown>;
    expect(result.items).toHaveLength(1);
    await expect(
      api.handle(
        request("/schedules/search", {
          method: "POST",
          body: {
            query: "original",
            projectId: "project-2",
            state: "running",
            cursor: result.nextCursor,
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 410 });
  });
});
