import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { DesktopMobileScheduleControl } from "../src/main/mobile-control/schedule-control";
import { DesktopMobileScheduleReadRepository } from "../src/main/mobile-control/schedule-read";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import { controlMobileTaskSchedule } from "../src/main/task-schedules";
const state = vi.hoisted(() => ({
  root: "",
  active: "owner",
  cancel: vi.fn(),
  write: vi.fn(),
  locked: false,
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => state.active,
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (file: string, data: string) => {
    state.write();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  },
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/mobile-connection", () => ({
  isMobileConnectionChanging: () => state.locked,
}));
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: vi.fn(),
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [],
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  cancelAgentRuntimeTask: state.cancel,
}));
let ledger: MobileOwnerLedger;
let control: DesktopMobileScheduleControl;
const file = (): string =>
  join(state.root, "owner", "desktop", "task-schedules.json");
function seed(changes: Record<string, unknown> = {}): string {
  const row = {
    id: "schedule-1",
    revision: "1",
    name: "Original",
    runtimeId: "missing-runtime",
    schedule: "5m",
    prompt: "Original instructions",
    mode: "full_access",
    timeoutMs: 300000,
    enabled: true,
    concurrencyPolicy: "queue",
    pendingRuns: 2,
    activeRuntimeRunId: "native-active",
    lastDueAt: 1000,
    nextRunAt: 301000,
    createdAt: 1000,
    updatedAt: 1000,
    future: { preserve: true },
    runs: Array.from({ length: 125 }, (_, n) => ({
      id: `execution-${n}`,
      trigger: "manual",
      triggeredAt: 1000 + n,
      status: "succeeded",
      conversationId: `original-${n}`,
      privateExtension: "keep",
    })),
  };
  const bytes = JSON.stringify({
    version: 5,
    futureRoot: "keep",
    schedules: [{ ...row, ...changes }],
  });
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), bytes);
  return bytes;
}
function request(
  action = "pause",
  key = "mutation-1",
  revision = "1",
): OwnerControlRequest {
  const method = action === "delete" ? "DELETE" : "POST";
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/schedules/schedule-1${action === "delete" ? "" : `/${action}`}`;
  const route = resolveMobileRoute(method, path)!;
  return {
    requestId: "request-1",
    method,
    path,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    headers: {
      "if-match": `"${revision}"`,
      "idempotency-key": key,
      "x-client-mutation-id": key,
    },
    body: action === "delete" ? null : { clientMutationId: key },
    signal: new AbortController().signal,
    device: {
      deviceId: "phone-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      grantRevision: "1",
      expiresAt: "2099-01-01T00:00:00Z",
      revoked: false,
      scopes: ["schedule:manage", "schedule:read"],
    },
  };
}
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-schedule-control-"));
  state.active = "owner";
  state.locked = false;
  state.cancel.mockReset();
  state.write.mockReset();
  ledger = new MobileOwnerLedger(
    join(state.root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  control = new DesktopMobileScheduleControl("owner", ledger);
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
describe("original schedule mobile controls", () => {
  it("preserves corrupt stores and duplicate execution identities instead of repairing during a control", async () => {
    seed();
    writeFileSync(file(), "broken source");
    await expect(control.handle(request())).rejects.toMatchObject({
      code: "requires_owner_action",
    });
    expect(readFileSync(file(), "utf8")).toBe("broken source");
    const duplicate = seed({
      runs: [
        {
          id: "duplicate",
          trigger: "manual",
          status: "succeeded",
          triggeredAt: 1000,
        },
        {
          id: "duplicate",
          trigger: "manual",
          status: "succeeded",
          triggeredAt: 1001,
        },
      ],
    });
    await expect(control.handle(request())).rejects.toMatchObject({
      code: "requires_owner_action",
    });
    expect(readFileSync(file(), "utf8")).toBe(duplicate);
    expect(ledger.operations("phone-1")).toEqual([]);
  });
  it("uses the same original revision lock across distinct Owner handlers", async () => {
    seed();
    const other = new DesktopMobileScheduleControl("owner", ledger);
    const results = await Promise.allSettled([
      control.handle(request("pause", "one")),
      other.handle(request("pause", "two")),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = results.find(
      (result) => result.status === "rejected",
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "revision_conflict" });
    expect(state.write).toHaveBeenCalledTimes(1);
  });
  it("rejects management changes and same-name profile home replacement before touching original data", async () => {
    const original = seed();
    state.locked = true;
    await expect(control.handle(request())).rejects.toMatchObject({
      code: "owner_unavailable",
    });
    state.locked = false;
    const originalRoot = state.root;
    try {
      state.root = join(originalRoot, "different-home");
      await expect(control.handle(request())).rejects.toMatchObject({
        code: "profile_inactive",
      });
    } finally {
      state.root = originalRoot;
    }
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(ledger.operations("phone-1")).toEqual([]);
  });
  it("pauses an invalid Runtime plan without cancelling its Run or losing queue, cursor, history and extensions", async () => {
    seed();
    expect(await control.handle(request())).toMatchObject({
      status: "applied",
      resultRef: { scheduleId: "schedule-1", revision: "2" },
    });
    const value = JSON.parse(readFileSync(file(), "utf8"));
    expect(value).toMatchObject({
      futureRoot: "keep",
      schedules: [
        {
          enabled: false,
          pendingRuns: 2,
          activeRuntimeRunId: "native-active",
          lastDueAt: 1000,
          nextRunAt: 301000,
          future: { preserve: true },
        },
      ],
    });
    expect(value.schedules[0].runs).toHaveLength(125);
    expect(value.schedules[0].runs[0].privateExtension).toBe("keep");
    expect(state.cancel).not.toHaveBeenCalled();
  });
  it("returns the same concurrent duplicate receipt, rejects changed content, and replays after restart without writing again", async () => {
    seed();
    const req = request();
    const [a, b] = await Promise.all([
      control.handle(req),
      control.handle(req),
    ]);
    expect(b).toEqual(a);
    expect(state.write).toHaveBeenCalledTimes(1);
    await expect(
      control.handle({
        ...req,
        headers: { ...req.headers, "if-match": '"2"' },
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    const reopened = new DesktopMobileScheduleControl(
      "owner",
      new MobileOwnerLedger(
        join(state.root, "ledger.json"),
        "owner-1",
        "space-1",
      ),
    );
    expect(await reopened.handle(req)).toEqual(a);
    expect(state.write).toHaveBeenCalledTimes(1);
  });
  it("discards only a paused queue and deletes only inactive empty definitions, preserving result conversations", async () => {
    seed();
    await expect(
      control.handle(request("discard-pending")),
    ).rejects.toMatchObject({ code: "run_active" });
    expect(ledger.operations("phone-1")).toEqual([]);
    seed({ enabled: false });
    await expect(control.handle(request("delete"))).rejects.toMatchObject({
      code: "run_active",
    });
    expect(
      await control.handle(request("discard-pending", "discard-1")),
    ).toMatchObject({
      status: "applied",
      resultRef: { discardedCount: 2, revision: "2" },
    });
    expect(
      JSON.parse(readFileSync(file(), "utf8")).schedules[0].activeRuntimeRunId,
    ).toBe("native-active");
    seed({ enabled: false, activeRuntimeRunId: undefined, pendingRuns: 0 });
    const history = join(dirname(file()), "runtime-conversations.json");
    writeFileSync(
      history,
      '{"conversations":[{"id":"original-result","body":"keep"}]}',
    );
    const original = readFileSync(history, "utf8");
    expect(await control.handle(request("delete", "delete-1"))).toMatchObject({
      status: "applied",
    });
    expect(JSON.parse(readFileSync(file(), "utf8")).schedules).toEqual([]);
    expect(readFileSync(history, "utf8")).toBe(original);
  });
  it("denies stale versions, missing management scope, revoked devices and changed profile before writing intent", async () => {
    const original = seed();
    await expect(
      control.handle(request("pause", "stale", "2")),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    const readOnly = request();
    readOnly.device.scopes = ["schedule:read"];
    await expect(control.handle(readOnly)).rejects.toMatchObject({
      code: "scope_denied",
    });
    const revoked = request();
    revoked.device.revoked = true;
    await expect(control.handle(revoked)).rejects.toMatchObject({
      code: "revoked",
    });
    state.active = "other";
    await expect(control.handle(request())).rejects.toMatchObject({
      code: "profile_inactive",
    });
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(ledger.operations("phone-1")).toEqual([]);
  });
  it("rechecks authority inside the original lock before admitting a write", async () => {
    const original = seed();
    let checks = 0;
    const accept = vi.fn();
    await expect(
      controlMobileTaskSchedule(
        "schedule-1",
        "pause",
        "owner",
        "1",
        () => {
          if (++checks === 2) throw Error("revoked");
        },
        accept,
      ),
    ).rejects.toThrow("revoked");
    expect(accept).not.toHaveBeenCalled();
    expect(readFileSync(file(), "utf8")).toBe(original);
  });
  it("keeps original bytes on failed intent or failed source writes and never repeats uncertain controls", async () => {
    const original = seed();
    vi.spyOn(ledger, "accept").mockImplementationOnce(() => {
      throw Error("disk failure");
    });
    await expect(control.handle(request())).rejects.toThrow("disk failure");
    expect(readFileSync(file(), "utf8")).toBe(original);
    state.write.mockImplementationOnce(() => {
      throw Error("disk failure");
    });
    await expect(
      control.handle(request("pause", "source-failure")),
    ).rejects.toMatchObject({ code: "reconciliation_required" });
    expect(ledger.operations("phone-1")).toMatchObject([
      { status: "reconciliation_required" },
    ]);
    expect(
      await control.handle(request("pause", "source-failure")),
    ).toMatchObject({ status: "reconciliation_required" });
    expect(readFileSync(file(), "utf8")).toBe(original);
  });
  it("composes only real control actions and device scopes, without enabling unverified resume", async () => {
    seed();
    const source = new DesktopMobileScheduleReadRepository("owner");
    const controller = new MobileConversationController(
      {
        list: () => [],
        get: () => undefined,
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
      source,
      control,
    );
    const get = request();
    get.method = "GET";
    get.path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/schedules/schedule-1`;
    const route = resolveMobileRoute("GET", get.path)!;
    get.operationId = route.route.operationId;
    get.params = route.params;
    get.body = null;
    expect((await controller.handle(get)).body).toMatchObject({
      allowedActions: ["read", "pause"],
      executionPolicyId: null,
    });
    get.device.scopes = ["schedule:read"];
    expect((await controller.handle(get)).body).toMatchObject({
      allowedActions: ["read"],
    });
    expect(controller.status()).toMatchObject({
      capabilities: [
        "conversation:read",
        "conversation:manage",
        "schedule:read",
        "schedule:manage",
        "schedule:cancel",
      ],
      executionAvailable: false,
    });
    await expect(control.handle(request("resume"))).rejects.toMatchObject({
      code: "requires_owner_action",
    });
    const receipt = await controller.handle(request());
    expect(receipt).toMatchObject({
      status: 202,
      body: {
        status: "applied",
        resultRef: { scheduleId: "schedule-1", revision: "2" },
      },
    });
    expect((await controller.handle(get)).body).toMatchObject({
      enabled: false,
      revision: "2",
      pendingCount: 2,
      activeRunIds: ["native-active"],
    });
  });
});
