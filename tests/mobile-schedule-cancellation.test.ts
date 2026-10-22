import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { DesktopMobileScheduleControl } from "../src/main/mobile-control/schedule-control";
import { DesktopMobileScheduleReadRepository } from "../src/main/mobile-control/schedule-read";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
const state = vi.hoisted(() => ({
  root: "",
  active: "owner",
  locked: false,
  cancel: vi.fn(),
  write: vi.fn(),
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
  resolveAuthorizedWorkspaceId: () => undefined,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [],
  startAgentRuntimeTask: vi.fn(),
  getAgentRuntimeRun: vi.fn(),
  cancelAgentRuntimeTask: vi.fn(),
  requestAgentRuntimeTaskCancellation: state.cancel,
}));
let ledger: MobileOwnerLedger;
let control: DesktopMobileScheduleControl;
const file = (): string =>
  join(state.root, "owner", "desktop", "task-schedules.json");
function seed(): string {
  const bytes = JSON.stringify({
    version: 5,
    futureRoot: "preserve",
    schedules: [
      {
        id: "schedule-1",
        revision: "7",
        name: "Original",
        prompt: "Original instructions",
        runtimeId: "missing-runtime",
        mode: "full_access",
        schedule: "5m",
        timeoutMs: 300000,
        enabled: true,
        concurrencyPolicy: "queue",
        pendingRuns: 2,
        activeRuntimeRunId: "native-active",
        lastDueAt: 1000,
        nextRunAt: 301000,
        createdAt: 1000,
        updatedAt: 1000,
        future: "keep",
        runs: [
          {
            id: "original-execution",
            runtimeRunId: "native-active",
            trigger: "scheduled",
            triggeredAt: 1000,
            status: "running",
            futureExecution: "keep",
          },
          {
            id: "old-execution",
            runtimeRunId: "native-old",
            trigger: "manual",
            triggeredAt: 500,
            completedAt: 800,
            status: "succeeded",
          },
        ],
      },
    ],
  });
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), bytes);
  return bytes;
}
function request(
  run = "native-active",
  key = "cancel-1",
  scopes = ["schedule:cancel"],
): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/runs/${run}/cancel`;
  const route = resolveMobileRoute("POST", path)!;
  return {
    requestId: key,
    method: "POST",
    path,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    body: { clientMutationId: key },
    headers: { "idempotency-key": key, "x-client-mutation-id": key },
    signal: new AbortController().signal,
    device: {
      deviceId: "phone-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      grantRevision: "1",
      revoked: false,
      expiresAt: "2099-01-01T00:00:00Z",
      scopes,
    },
  };
}
function acknowledgement(accepted = true): Record<string, unknown> {
  return {
    accepted,
    run: {
      id: "native-active",
      runtimeId: "missing-runtime",
      status: "running",
      startedAt: 1000,
      events: [],
    },
  };
}
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "mobile-schedule-cancel-"));
  state.active = "owner";
  state.locked = false;
  state.cancel.mockReset().mockResolvedValue(acknowledgement());
  state.write.mockReset();
  ledger = new MobileOwnerLedger(
    join(state.root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  control = new DesktopMobileScheduleControl("owner", ledger);
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
describe("original schedule Run cancellation", () => {
  // @lat: [[mobile-data#Mobile data#Schedule cancellation original identity]]
  it("controls only the original native ID, preserves definitions and running status, and replays the original receipt after restart", async () => {
    const bytes = seed(),
      req = request();
    const receipt = await control.cancelRun(req);
    expect(receipt).toMatchObject({
      action: "cancelRun",
      status: "applied",
      resourceRef: { type: "run", id: "native-active" },
      resultRef: {
        scheduleId: "schedule-1",
        runId: "native-active",
        cancellationRequested: true,
        alreadyTerminal: false,
      },
    });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(
      new DesktopMobileScheduleReadRepository("owner").get("schedule-1"),
    ).toMatchObject({
      effectiveState: "running",
      activeRunIds: ["native-active"],
      enabled: true,
      pendingCount: 2,
      revision: "7",
    });
    const restarted = new DesktopMobileScheduleControl(
      "owner",
      new MobileOwnerLedger(
        join(state.root, "ledger.json"),
        "owner-1",
        "space-1",
      ),
    );
    expect(await restarted.cancelRun(req)).toEqual(receipt);
    expect(state.cancel).toHaveBeenCalledTimes(1);
    expect(state.cancel).toHaveBeenCalledWith("native-active");
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation scope and source admission]]
  it("rejects foreign scopes, devices, inactive profiles, locks, unknown IDs and ambiguous original ownership before acceptance", async () => {
    const bytes = seed();
    for (const scopes of [
      [],
      ["conversation:cancel"],
      ["schedule:manage"],
      ["schedule:trigger"],
    ])
      await expect(
        control.cancelRun(request("native-active", "denied", scopes)),
      ).rejects.toMatchObject({ code: "scope_denied" });
    const foreign = request();
    foreign.device.ownerId = "owner-other";
    await expect(control.cancelRun(foreign)).rejects.toMatchObject({
      code: "scope_denied",
    });
    const revoked = request();
    revoked.device.revoked = true;
    await expect(control.cancelRun(revoked)).rejects.toMatchObject({
      code: "revoked",
    });
    state.active = "other";
    await expect(control.cancelRun(request())).rejects.toMatchObject({
      code: "profile_inactive",
    });
    state.active = "owner";
    state.locked = true;
    await expect(control.cancelRun(request())).rejects.toMatchObject({
      code: "owner_unavailable",
    });
    state.locked = false;
    await expect(control.cancelRun(request("not-owned"))).rejects.toMatchObject(
      { code: "resource_not_found" },
    );
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    const stored = JSON.parse(bytes);
    stored.schedules.push({ ...stored.schedules[0], id: "another-plan" });
    writeFileSync(file(), JSON.stringify(stored));
    await expect(control.cancelRun(request())).rejects.toMatchObject({
      code: "requires_owner_action",
    });
    expect(ledger.operations("phone-1")).toEqual([]);
    expect(state.cancel).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation terminal history]]
  it("completes an old terminal Run without controlling the next active Run", async () => {
    const bytes = seed();
    expect(await control.cancelRun(request("native-old"))).toMatchObject({
      status: "applied",
      resultRef: {
        runId: "native-old",
        cancellationRequested: false,
        alreadyTerminal: true,
      },
    });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(state.cancel).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation rejection evidence]]
  it("persists a confirmed rejection without fabricating terminal state or resending that request", async () => {
    const bytes = seed(),
      req = request();
    state.cancel.mockResolvedValueOnce(acknowledgement(false));
    await expect(control.cancelRun(req)).rejects.toMatchObject({
      code: "requires_owner_action",
    });
    expect(await control.cancelRun(req)).toMatchObject({
      status: "rejected",
      error: { code: "requires_owner_action" },
    });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(state.cancel).toHaveBeenCalledTimes(1);
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation uncertain acknowledgement]]
  it("retains unknown acknowledgement, missing or foreign handle, and thrown control outcomes without replay", async () => {
    const bytes = seed();
    for (const [index, result] of [
      { ...acknowledgement(), uncertain: true },
      { accepted: false, run: null },
      {
        accepted: true,
        run: { id: "foreign", runtimeId: "missing-runtime", status: "running" },
      },
      {
        accepted: true,
        run: {
          id: "native-active",
          runtimeId: "foreign-runtime",
          status: "running",
        },
      },
      null,
    ].entries()) {
      const req = request("native-active", `uncertain-${index}`);
      if (result) state.cancel.mockResolvedValueOnce(result);
      else
        state.cancel.mockRejectedValueOnce(
          Error("synthetic lost control response"),
        );
      await expect(control.cancelRun(req)).rejects.toMatchObject({
        code: "reconciliation_required",
      });
      expect(await control.cancelRun(req)).toMatchObject({
        status: "reconciliation_required",
      });
      expect(readFileSync(file(), "utf8")).toBe(bytes);
    }
    const spoofed = request("native-active", "spoofed-acknowledgement");
    state.cancel.mockRejectedValueOnce(
      Object.assign(Error("synthetic unconfirmed backend error"), {
        cancellationAcknowledged: true,
      }),
    );
    await expect(control.cancelRun(spoofed)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    expect(await control.cancelRun(spoofed)).toMatchObject({
      status: "reconciliation_required",
    });
    expect(state.cancel).toHaveBeenCalledTimes(6);
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation persistence gate]]
  it("never controls without a durable intent and retains an unknown receipt commit after actual cancellation", async () => {
    const bytes = seed();
    vi.spyOn(ledger, "accept").mockImplementationOnce(() => {
      throw Error("synthetic intent write failure");
    });
    await expect(control.cancelRun(request())).rejects.toThrow(
      "synthetic intent write failure",
    );
    expect(state.cancel).not.toHaveBeenCalled();
    const req = request("native-active", "receipt-failure");
    vi.spyOn(ledger, "complete").mockImplementationOnce(() => {
      throw Error("synthetic receipt write failure");
    });
    await expect(control.cancelRun(req)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    expect(await control.cancelRun(req)).toMatchObject({
      status: "reconciliation_required",
    });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(state.cancel).toHaveBeenCalledTimes(1);
  });
  // @lat: [[mobile-data#Mobile data#Schedule cancellation public route composition]]
  it("routes schedule cancellation without a conversation coordinator and filters actions by independent scopes", async () => {
    seed();
    const api = new MobileConversationController(
      {
        list: () => [],
        patch: () => {
          throw Error("unused");
        },
      },
      ledger,
      "Owner",
      Date.now,
      undefined,
      undefined,
      undefined,
      new DesktopMobileScheduleReadRepository("owner"),
      control,
    );
    expect(api.status().capabilities).toContain("schedule:cancel");
    expect(api.status().capabilities).not.toContain("schedule:trigger");
    expect(await api.handle(request())).toMatchObject({
      status: 202,
      body: { status: "applied" },
    });
    const get = request();
    get.method = "GET";
    get.path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/schedules/schedule-1`;
    const route = resolveMobileRoute(get.method, get.path)!;
    get.params = route.params;
    get.operationId = route.route.operationId;
    get.body = null;
    get.device.scopes = ["schedule:read", "schedule:cancel"];
    expect((await api.handle(get)).body).toMatchObject({
      allowedActions: ["read", "cancel"],
    });
    get.device.scopes = ["schedule:read", "schedule:manage"];
    expect((await api.handle(get)).body).toMatchObject({
      allowedActions: ["read", "pause"],
    });
  });
});
