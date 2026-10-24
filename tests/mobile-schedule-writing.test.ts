import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
import {
  issueMobileSchedulePreview,
  validateMobileSchedulePreview,
} from "../src/main/mobile-control/schedule-preview";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import {
  tickTaskSchedules,
  onTaskScheduleRunCompleted,
  updateTaskSchedule,
} from "../src/main/task-schedules";

// Synthetic authority verifies transaction composition only, never production capability.
const state = vi.hoisted(() => ({
  root: "",
  now: 1791220000000,
  revoked: false,
  writeFailure: false,
  conversationWriteFailure: false,
  finalWriteFailure: false,
  readRun: vi.fn(),
  start: vi.fn(),
  nativeEffect: vi.fn(),
  legacy: vi.fn(),
  cancel: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "owner",
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (file: string, data: string) => {
    if (state.finalWriteFailure && file.endsWith("task-schedules.json")) {
      const stored = JSON.parse(data);
      if (
        stored.schedules.some(
          (row: {
            runs: { status: string; mobileFinalCheckpoint?: unknown }[];
          }) =>
            row.runs.some(
              (run) => run.status === "succeeded" && !run.mobileFinalCheckpoint,
            ),
        )
      )
        throw Error("synthetic final schedule persistence failure");
    }
    if (
      state.conversationWriteFailure &&
      file.endsWith("runtime-conversations.json")
    )
      throw Error("synthetic conversation persistence failure");
    if (state.writeFailure && file.endsWith("task-schedules.json"))
      throw Error("synthetic original persistence failure");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  },
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/mobile-connection", () => ({
  isMobileConnectionChanging: () => false,
}));
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () => undefined,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [
    {
      id: "runtime-1",
      kind: "codex",
      name: "Synthetic",
      enabled: true,
      location: "local",
      config: { transport: "cli" },
    },
  ],
  startAgentRuntimeTask: state.legacy,
  getAgentRuntimeRun: state.readRun,
  cancelAgentRuntimeTask: state.cancel,
}));
vi.mock("../src/main/mobile-control/schedule-execution", () => ({
  authorizeOriginalMobileSchedule: (schedule: {
    mobileExecutionPolicyId?: string;
    mode: string;
    runtimeId: string;
    workspaceId?: string;
  }) => {
    state.authorize(schedule);
    if (
      state.revoked ||
      schedule.mobileExecutionPolicyId !== "policy-1" ||
      schedule.mode !== "analysis" ||
      schedule.runtimeId !== "runtime-1" ||
      schedule.workspaceId
    )
      throw Object.assign(Error("unverified_policy"), {
        code: "unverified_policy",
        status: 403,
      });
    return { backend: { start: state.start }, task: { mode: "analysis" } };
  },
}));
let ledger: MobileOwnerLedger;
let control: DesktopMobileScheduleControl;
let reader: DesktopMobileScheduleReadRepository;
const file = (): string =>
  join(state.root, "owner", "desktop", "task-schedules.json");
const draft = (): Record<string, unknown> => ({
  name: "Original",
  prompt: "Synthetic instructions",
  runtimeId: "runtime-1",
  projectId: null,
  executionPolicyId: "policy-1",
  scheduleExpression: "5m",
  timeoutMs: 300000,
  concurrencyPolicy: "queue",
});
function request(
  method: string,
  suffix: string,
  body: unknown,
  key = "mutation-1",
  revision?: string,
): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/${suffix}`;
  const route = resolveMobileRoute(method, path)!;
  return {
    requestId: key,
    method,
    path,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    body,
    headers: {
      "idempotency-key": key,
      "x-client-mutation-id": key,
      ...(revision ? { "if-match": `"${revision}"` } : {}),
    },
    signal: new AbortController().signal,
    device: {
      deviceId: "phone-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      grantRevision: "1",
      expiresAt: "2099-01-01T00:00:00Z",
      revoked: false,
      scopes: [
        "schedule:manage",
        "schedule:read",
        "schedule:trigger",
        "schedule:cancel",
      ],
    },
  };
}
async function preview(input = draft()): Promise<string> {
  const req = request("POST", "schedules/preview", input);
  return String(
    (await issueMobileSchedulePreview(input, req, ledger, reader, state.now))
      .previewRevision,
  );
}
async function create(): Promise<{
  req: OwnerControlRequest;
  receipt: unknown;
  original: Record<string, unknown>;
  id: string;
}> {
  const input = {
    ...draft(),
    previewRevision: await preview(),
    clientMutationId: "create-1",
  };
  const req = request("POST", "schedules", input, "create-1");
  const receipt = await control.handle(req);
  const original = reader.list()[0];
  return { req, receipt, original, id: String(original.id) };
}
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-schedule-writing-"));
  state.now = 1791220000000;
  state.revoked = false;
  state.writeFailure = false;
  state.conversationWriteFailure = false;
  state.finalWriteFailure = false;
  state.readRun.mockReset().mockResolvedValue(null);
  state.start.mockReset().mockImplementation(async (_id, _task, options) => {
    const run = {
      id: "native-run",
      runtimeId: "runtime-1",
      status: "running",
      startedAt: state.now,
      output: "",
      events: [],
    };
    await options.persistBeforeDispatch(run);
    state.nativeEffect();
    return run;
  });
  state.legacy.mockReset();
  state.nativeEffect.mockReset();
  state.cancel.mockReset().mockResolvedValue(true);
  state.authorize.mockReset();
  ledger = new MobileOwnerLedger(
    join(state.root, "ledger.json"),
    "owner-1",
    "space-1",
    () => state.now,
  );
  reader = new DesktopMobileScheduleReadRepository("owner");
  control = new DesktopMobileScheduleControl(
    "owner",
    ledger,
    {
      available: () => !state.revoked,
      authorize: (input) => {
        if (
          state.revoked ||
          input.executionPolicyId !== "policy-1" ||
          input.runtimeId !== "runtime-1" ||
          input.projectId != null
        )
          throw Object.assign(Error("unverified_policy"), {
            code: "unverified_policy",
            status: 403,
          });
        return "analysis";
      },
    },
    () => state.now,
  );
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
describe("original schedule mobile write channel", () => {
  it("reuses the deterministic original conversation after a lost pointer without overwriting user edits", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "run" },
        "run",
        "1",
      ),
    );
    const stored = JSON.parse(readFileSync(file(), "utf8"));
    const conversationId = stored.schedules[0].runs[0].conversationId;
    delete stored.schedules[0].runs[0].conversationId;
    writeFileSync(file(), JSON.stringify(stored));
    const conversationFile = join(
      state.root,
      "owner",
      "desktop",
      "runtime-conversations.json",
    );
    const source = JSON.parse(readFileSync(conversationFile, "utf8"));
    const original = source.conversations.find(
      (row: { id: string }) => row.id === conversationId,
    );
    original.title = "User modified title";
    original.messages.push({
      id: "annotation",
      role: "system",
      content: "User annotation",
      createdAt: state.now,
    });
    writeFileSync(conversationFile, JSON.stringify(source));
    state.readRun.mockResolvedValue({
      id: "native-run",
      runtimeId: "runtime-1",
      status: "succeeded",
      startedAt: state.now,
      completedAt: state.now + 1000,
      output: "Final reply",
      events: [],
    });
    await tickTaskSchedules("owner", state.now);
    const result = JSON.parse(
      readFileSync(conversationFile, "utf8"),
    ).conversations.find((row: { id: string }) => row.id === conversationId);
    expect(result.title).toBe("User modified title");
    expect(result.messages).toHaveLength(3);
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "annotation",
          content: "User annotation",
        }),
        expect.objectContaining({ content: "Final reply" }),
      ]),
    );
    expect(
      JSON.parse(readFileSync(file(), "utf8")).schedules[0].runs[0]
        .conversationId,
    ).toBe(conversationId);
    expect(state.nativeEffect).toHaveBeenCalledTimes(1);
  });
  it("replays an already-written result once when the subsequent schedule commit failed", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "run" },
        "run",
        "1",
      ),
    );
    state.readRun.mockResolvedValue({
      id: "native-run",
      runtimeId: "runtime-1",
      status: "succeeded",
      startedAt: state.now,
      completedAt: state.now + 1000,
      output: "Written once",
      events: [],
    });
    state.finalWriteFailure = true;
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    const completed = vi.fn(),
      dispose = onTaskScheduleRunCompleted(completed);
    try {
      await tickTaskSchedules("owner", state.now);
      const pending = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      expect(pending.activeRuntimeRunId).toBe("native-run");
      expect(pending.runs[0].mobileFinalCheckpoint).toBeDefined();
      expect(completed).not.toHaveBeenCalled();
      state.finalWriteFailure = false;
      state.readRun.mockResolvedValue(null);
      await tickTaskSchedules("owner", state.now);
      const finished = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      const rows = JSON.parse(
        readFileSync(
          join(state.root, "owner", "desktop", "runtime-conversations.json"),
          "utf8",
        ),
      ).conversations;
      const original = rows.find(
        (row: { id: string }) => row.id === finished.runs[0].conversationId,
      );
      expect(original.messages).toHaveLength(2);
      expect(
        original.messages.filter(
          (message: { execution?: { runId: string } }) =>
            message.execution?.runId === "native-run",
        ),
      ).toHaveLength(1);
      expect(finished.runs[0].mobileFinalCheckpoint).toBeUndefined();
      expect(completed).toHaveBeenCalledTimes(1);
      expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      logging.mockRestore();
    }
  });
  it("preserves a mismatched checkpoint without publishing results or dispatching", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "run" },
        "run",
        "1",
      ),
    );
    const store = JSON.parse(readFileSync(file(), "utf8"));
    store.schedules[0].runs[0].mobileFinalCheckpoint = {
      id: "other-native",
      runtimeId: "runtime-1",
      status: "succeeded",
      completedAt: state.now,
      events: [],
      output: "Must not commit",
    };
    const bytes = JSON.stringify(store);
    writeFileSync(file(), bytes);
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await tickTaskSchedules("owner", state.now);
      expect(readFileSync(file(), "utf8")).toBe(bytes);
      expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    } finally {
      logging.mockRestore();
    }
  });
  it("recovers a persisted real terminal result after native registry loss without launching again", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "run" },
        "run",
        "1",
      ),
    );
    const native = {
      id: "native-run",
      runtimeId: "runtime-1",
      status: "succeeded",
      startedAt: state.now,
      completedAt: state.now + 1000,
      output: "Recovered actual result",
      events: [],
    };
    state.readRun.mockResolvedValue(native);
    state.conversationWriteFailure = true;
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    const completed = vi.fn();
    const dispose = onTaskScheduleRunCompleted(completed);
    try {
      await tickTaskSchedules("owner", state.now);
      const pending = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      expect(pending).toMatchObject({
        activeRuntimeRunId: "native-run",
        mobileRecoveryRequired: true,
      });
      expect(pending.runs[0]).toMatchObject({
        mobileDispatchState: "final_pending",
        mobileFinalCheckpoint: native,
      });
      expect(pending.runs[0].completedAt).toBeUndefined();
      expect(completed).not.toHaveBeenCalled();
      state.readRun.mockResolvedValue(null);
      state.conversationWriteFailure = false;
      await tickTaskSchedules("owner", state.now);
      await tickTaskSchedules("owner", state.now);
      const finished = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      expect(finished.activeRuntimeRunId).toBeUndefined();
      expect(finished.mobileRecoveryRequired).toBeUndefined();
      expect(finished.runs[0]).toMatchObject({
        status: "succeeded",
        summary: "Recovered actual result",
        completedAt: state.now + 1000,
      });
      expect(finished.runs[0].mobileFinalCheckpoint).toBeUndefined();
      const conversations = JSON.parse(
        readFileSync(
          join(state.root, "owner", "desktop", "runtime-conversations.json"),
          "utf8",
        ),
      );
      const original = conversations.conversations.find(
        (row: { id: string }) => row.id === finished.runs[0].conversationId,
      );
      expect(original.messages).toHaveLength(2);
      expect(original.messages[1]).toMatchObject({
        content: "Recovered actual result",
        execution: { runId: "native-run" },
      });
      expect(completed).toHaveBeenCalledTimes(1);
      expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      logging.mockRestore();
    }
  });
  it("does not publish completion or start queued work if the terminal checkpoint cannot be saved", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "run" },
        "run",
        "1",
      ),
    );
    const store = JSON.parse(readFileSync(file(), "utf8"));
    store.schedules[0].pendingRuns = 2;
    writeFileSync(file(), JSON.stringify(store));
    const bytes = readFileSync(file(), "utf8");
    state.readRun.mockResolvedValue({
      id: "native-run",
      runtimeId: "runtime-1",
      status: "succeeded",
      startedAt: state.now,
      completedAt: state.now + 1000,
      output: "Not yet persisted",
      events: [],
    });
    state.writeFailure = true;
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    const completed = vi.fn(),
      dispose = onTaskScheduleRunCompleted(completed);
    try {
      await tickTaskSchedules("owner", state.now);
      expect(completed).not.toHaveBeenCalled();
      expect(state.nativeEffect).toHaveBeenCalledTimes(1);
      expect(readFileSync(file(), "utf8")).toBe(bytes);
    } finally {
      dispose();
      logging.mockRestore();
    }
  });
  it("persists native ownership and consumes queued work before the native effect", async () => {
    const { id } = await create();
    const store = JSON.parse(readFileSync(file(), "utf8"));
    Object.assign(store.schedules[0], {
      pendingRuns: 2,
      nextRunAt: state.now + 600000,
      extension: { preserved: true },
    });
    writeFileSync(file(), JSON.stringify(store));
    state.nativeEffect.mockImplementation(() => {
      const original = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      expect(original).toMatchObject({
        id,
        pendingRuns: 1,
        activeRuntimeRunId: "native-run",
        extension: { preserved: true },
      });
      expect(original.runs).toHaveLength(1);
      expect(original.runs[0]).toMatchObject({
        runtimeRunId: "native-run",
        status: "queued",
        mobileDispatchState: "prepared",
      });
    });
    await tickTaskSchedules("owner", state.now);
    expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    const original = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
    expect(original.runs[0].mobileDispatchState).toBe("observed");
    // The process-local registry is now missing: no second dispatch or queue consumption.
    await tickTaskSchedules("owner", state.now + 1000000);
    await tickTaskSchedules("owner", state.now + 2000000);
    expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    expect(JSON.parse(readFileSync(file(), "utf8")).schedules[0]).toMatchObject(
      {
        pendingRuns: 1,
        activeRuntimeRunId: "native-run",
        mobileRecoveryRequired: true,
        nextRunAt: state.now + 600000,
        extension: { preserved: true },
      },
    );
  });
  it("commits the due cursor with native identity before any external effect", async () => {
    await create();
    const store = JSON.parse(readFileSync(file(), "utf8"));
    store.schedules[0].nextRunAt = state.now - 300000;
    writeFileSync(file(), JSON.stringify(store));
    state.nativeEffect.mockImplementation(() => {
      const original = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
      expect(original.lastDueAt).toBe(state.now);
      expect(original.nextRunAt).toBe(state.now + 300000);
      expect(original.runs[0]).toMatchObject({
        runtimeRunId: "native-run",
        dueAt: state.now - 300000,
      });
    });
    await tickTaskSchedules("owner", state.now);
    expect(state.nativeEffect).toHaveBeenCalledTimes(1);
  });
  it("does not launch native work or consume due state when the barrier write fails", async () => {
    await create();
    const store = JSON.parse(readFileSync(file(), "utf8"));
    store.schedules[0].nextRunAt = state.now - 300000;
    writeFileSync(file(), JSON.stringify(store));
    const bytes = readFileSync(file(), "utf8");
    state.writeFailure = true;
    const logging = vi.spyOn(console, "error").mockImplementation(() => {});
    await tickTaskSchedules("owner", state.now);
    logging.mockRestore();
    expect(state.nativeEffect).not.toHaveBeenCalled();
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  it("keeps admitted unknown work and rejects manual replacement after a start failure", async () => {
    const { id } = await create();
    state.start.mockImplementation(async (_id, _task, options) => {
      await options.persistBeforeDispatch({
        id: "uncertain-native",
        runtimeId: "runtime-1",
        status: "running",
        startedAt: state.now,
        events: [],
      });
      state.nativeEffect();
      throw Error("synthetic connection lost after admission");
    });
    const req = request(
      "POST",
      `schedules/${id}/trigger`,
      { clientMutationId: "uncertain" },
      "uncertain",
      "1",
    );
    await expect(control.handle(req)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    await control.handle(req);
    await tickTaskSchedules("owner", state.now + 1000000);
    const original = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
    expect(original).toMatchObject({
      mobileRecoveryRequired: true,
      activeRuntimeRunId: "uncertain-native",
    });
    expect(original.runs[0]).toMatchObject({
      mobileDispatchState: "reconciliation_required",
    });
    expect(original.runs[0].completedAt).toBeUndefined();
    expect(reader.get(id)).toMatchObject({
      effectiveState: "blocked",
      restrictionReason: "unknown_state",
    });
    expect(control.actions(reader.get(id))).not.toContain("trigger");
    expect(control.actions(reader.get(id))).not.toContain("resume");
    expect(state.nativeEffect).toHaveBeenCalledTimes(1);
    await expect(
      control.handle(
        request(
          "POST",
          `schedules/${id}/trigger`,
          { clientMutationId: "replacement" },
          "replacement",
          original.revision,
        ),
      ),
    ).rejects.toMatchObject({ code: "reconciliation_required" });
    expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("requires trigger scope for manual dispatch and exposes its action independently of plan management", async () => {
    const { id } = await create();
    const denied = request(
      "POST",
      `schedules/${id}/trigger`,
      { clientMutationId: "manage-only" },
      "manage-only",
      "1",
    );
    denied.device.scopes = ["schedule:manage"];
    await expect(control.handle(denied)).rejects.toMatchObject({
      code: "scope_denied",
    });
    expect(state.start).not.toHaveBeenCalled();
    expect(ledger.operations("phone-1")).toHaveLength(1);
    const api = new MobileConversationController(
      {
        list: () => [],
        patch: () => {
          throw Error("unused");
        },
      },
      ledger,
      "Owner",
      () => state.now,
      undefined,
      undefined,
      undefined,
      reader,
      control,
    );
    expect(api.status().capabilities).toContain("schedule:trigger");
    const get = request("GET", `schedules/${id}`, null);
    get.device.scopes = ["schedule:read", "schedule:trigger"];
    expect((await api.handle(get)).body).toMatchObject({
      allowedActions: ["read", "trigger"],
    });
    const trigger = request(
      "POST",
      `schedules/${id}/trigger`,
      { clientMutationId: "trigger-only" },
      "trigger-only",
      "1",
    );
    trigger.device.scopes = ["schedule:trigger"];
    expect(await api.handle(trigger)).toMatchObject({
      status: 202,
      body: { status: "applied" },
    });
    expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("keeps the enforced unattended trigger policy selectable with schedule management alone", async () => {
    const { id } = await create();
    expect(control.actions(reader.get(id))).toContain("edit");
    expect(control.actions(reader.get(id))).toContain("trigger");
    const api = new MobileConversationController(
      {
        list: () => [],
        patch: () => {
          throw Error("unused");
        },
      },
      ledger,
      "Owner",
      () => state.now,
      undefined,
      undefined,
      {
        snapshot: () => ({
          runtimes: [],
          projects: [],
          policies: [
            {
              id: "policy-1",
              runtimeId: "runtime-1",
              projectId: null,
              mode: "inspect",
              enforced: true,
              unattendedApproved: true,
              allowedActions: ["create", "advance", "trigger"],
              restrictionReason: null,
            },
          ],
        }),
      },
      reader,
      control,
    );
    const req = request("GET", "execution-policies", null);
    const response = await api.handle(req);
    expect(
      (response.body as { items: Record<string, unknown>[] }).items[0]
        .allowedActions,
    ).toEqual(["trigger"]);
    const readOnly = {
      ...req,
      device: { ...req.device, scopes: ["schedule:read"] },
    };
    const readResponse = await api.handle(readOnly);
    expect(
      (readResponse.body as { items: Record<string, unknown>[] }).items[0]
        .allowedActions,
    ).toEqual([]);
  });
  it("validates the original preview anchor, full draft, device, grant, purpose, timezone and expiry", async () => {
    const input = {
      ...draft(),
      previewRevision: await preview(),
      clientMutationId: "mutation-1",
    };
    const req = request("POST", "schedules", input);
    state.now += 10000;
    await expect(
      validateMobileSchedulePreview(input, req, ledger, reader, state.now),
    ).resolves.toEqual(draft());
    const {
      projectId: ignoredProject,
      timeoutMs: ignoredTimeout,
      concurrencyPolicy: ignoredConcurrency,
      ...minimal
    } = draft();
    void ignoredProject;
    void ignoredTimeout;
    void ignoredConcurrency;
    const normalized = { ...minimal, previewRevision: await preview(minimal) };
    await expect(
      validateMobileSchedulePreview(normalized, req, ledger, reader, state.now),
    ).resolves.toMatchObject({
      projectId: null,
      timeoutMs: 600000,
      concurrencyPolicy: "skip",
    });
    for (const field of [
      "name",
      "prompt",
      "runtimeId",
      "executionPolicyId",
      "scheduleExpression",
      "projectId",
      "timeoutMs",
      "concurrencyPolicy",
    ]) {
      const changes: Record<string, unknown> = {
        name: "Changed",
        prompt: "Changed",
        runtimeId: "other",
        executionPolicyId: "other",
        scheduleExpression: "10m",
        projectId: "project-1",
        timeoutMs: 1000,
        concurrencyPolicy: "skip",
      };
      await expect(
        validateMobileSchedulePreview(
          { ...input, [field]: changes[field] },
          req,
          ledger,
          reader,
          state.now,
        ),
      ).rejects.toThrow("preview_expired");
    }
    for (const device of [
      { ...req.device, deviceId: "phone-2" },
      { ...req.device, grantRevision: "2" },
    ])
      await expect(
        validateMobileSchedulePreview(
          input,
          { ...req, device },
          ledger,
          reader,
          state.now,
        ),
      ).rejects.toThrow("preview_expired");
    await expect(
      validateMobileSchedulePreview(
        { ...input, previewRevision: ledger.cursor("phone-1", "1") },
        req,
        ledger,
        reader,
        state.now,
      ),
    ).rejects.toThrow("preview_expired");
    const wrongZone = new DesktopMobileScheduleReadRepository(
      "owner",
      undefined,
      () => "wrong-zone",
    );
    await expect(
      validateMobileSchedulePreview(input, req, ledger, wrongZone, state.now),
    ).rejects.toThrow();
    state.now += 300000;
    await expect(
      validateMobileSchedulePreview(input, req, ledger, reader, state.now),
    ).rejects.toThrow("preview_expired");
  });
  it("creates an enabled original definition with persistent policy binding and idempotent original receipt", async () => {
    const { req, receipt, id } = await create();
    const bytes = readFileSync(file(), "utf8");
    expect(reader.get(id)).toMatchObject({
      executionPolicyId: "policy-1",
      enabled: true,
      revision: "1",
      pendingCount: 0,
    });
    expect(JSON.parse(bytes).schedules[0]).toMatchObject({
      mobileExecutionPolicyId: "policy-1",
      mode: "analysis",
      runs: [],
    });
    expect(await control.handle(req)).toEqual(receipt);
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(state.start).not.toHaveBeenCalled();
    expect(state.legacy).not.toHaveBeenCalled();
  });
  it("edits original definitions without resetting cursors and rejects stale revisions before accepting", async () => {
    const { id } = await create();
    const prior = JSON.parse(readFileSync(file(), "utf8")).schedules[0];
    const input = { ...draft(), name: "Renamed" };
    const body = {
      ...input,
      previewRevision: await preview(input),
      clientMutationId: "edit-1",
    };
    await control.handle(
      request("PATCH", `schedules/${id}`, body, "edit-1", "1"),
    );
    expect(JSON.parse(readFileSync(file(), "utf8")).schedules[0]).toMatchObject(
      {
        name: "Renamed",
        revision: "2",
        lastDueAt: prior.lastDueAt,
        nextRunAt: prior.nextRunAt,
        mobileExecutionPolicyId: "policy-1",
      },
    );
    const bytes = readFileSync(file(), "utf8");
    await expect(
      control.handle(
        request(
          "PATCH",
          `schedules/${id}`,
          { ...body, clientMutationId: "edit-stale" },
          "edit-stale",
          "1",
        ),
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(ledger.operations("phone-1")).toHaveLength(2);
  });
  it("does not accept or write an invalid preview, revoked policy or active definition edit", async () => {
    const { id } = await create();
    const stored = JSON.parse(readFileSync(file(), "utf8"));
    stored.schedules[0].activeRuntimeRunId = "existing-run";
    writeFileSync(file(), JSON.stringify(stored));
    const bytes = readFileSync(file(), "utf8");
    const body = {
      ...draft(),
      previewRevision: await preview(),
      clientMutationId: "edit-active",
    };
    await expect(
      control.handle(
        request("PATCH", `schedules/${id}`, body, "edit-active", "1"),
      ),
    ).rejects.toThrow("active run");
    state.revoked = true;
    await expect(
      control.handle(
        request(
          "POST",
          "schedules",
          { ...body, clientMutationId: "create-denied" },
          "create-denied",
        ),
      ),
    ).rejects.toMatchObject({ code: "unverified_policy" });
    state.revoked = false;
    await expect(
      control.handle(
        request(
          "POST",
          "schedules",
          { ...body, name: "Changed", clientMutationId: "create-invalid" },
          "create-invalid",
        ),
      ),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(ledger.operations("phone-1")).toHaveLength(1);
  });
  it("retains an accepted uncertain intent when original persistence fails and never retries that creation", async () => {
    const body = {
      ...draft(),
      previewRevision: await preview(),
      clientMutationId: "create-failed",
    };
    const req = request("POST", "schedules", body, "create-failed");
    state.writeFailure = true;
    await expect(control.handle(req)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    state.writeFailure = false;
    expect(await control.handle(req)).toMatchObject({
      status: "reconciliation_required",
    });
    expect(reader.list()).toEqual([]);
    expect(ledger.operations("phone-1")).toHaveLength(1);
    const committedDraft = { ...draft(), name: "Committed" };
    const committedBody = {
      ...committedDraft,
      previewRevision: await preview(committedDraft),
      clientMutationId: "receipt-failed",
    };
    const committedRequest = request(
      "POST",
      "schedules",
      committedBody,
      "receipt-failed",
    );
    vi.spyOn(ledger, "complete").mockImplementationOnce(() => {
      throw Error("synthetic receipt persistence failure");
    });
    await expect(control.handle(committedRequest)).rejects.toMatchObject({
      code: "reconciliation_required",
    });
    const committedBytes = readFileSync(file(), "utf8");
    expect(reader.list()).toHaveLength(1);
    expect(await control.handle(committedRequest)).toMatchObject({
      status: "reconciliation_required",
    });
    expect(readFileSync(file(), "utf8")).toBe(committedBytes);
  });
  it("resumes only the original bound definition and manually triggers a paused schedule without enabling it", async () => {
    const { id } = await create();
    await control.handle(
      request(
        "POST",
        `schedules/${id}/pause`,
        { clientMutationId: "pause" },
        "pause",
        "1",
      ),
    );
    await control.handle(
      request(
        "POST",
        `schedules/${id}/trigger`,
        { clientMutationId: "trigger" },
        "trigger",
        "2",
      ),
    );
    expect(reader.get(id)).toMatchObject({
      enabled: false,
      effectiveState: "running",
      revision: "4",
      activeRunIds: ["native-run"],
    });
    expect(state.start).toHaveBeenCalledTimes(1);
    expect(state.legacy).not.toHaveBeenCalled();
    state.revoked = true;
    await expect(
      control.handle(
        request(
          "POST",
          `schedules/${id}/resume`,
          { clientMutationId: "resume-denied" },
          "resume-denied",
          "4",
        ),
      ),
    ).rejects.toMatchObject({ code: "unverified_policy" });
    expect(reader.get(id).enabled).toBe(false);
    state.revoked = false;
    await control.handle(
      request(
        "POST",
        `schedules/${id}/resume`,
        { clientMutationId: "resume" },
        "resume",
        "4",
      ),
    );
    expect(reader.get(id)).toMatchObject({ enabled: true, revision: "5" });
    expect(state.start).toHaveBeenCalledTimes(1);
  });
  it("rechecks persisted policy before queued and due dispatch and preserves denied cursors during another schedule commit", async () => {
    const { id } = await create();
    for (const pendingRuns of [2, 0]) {
      const stored = JSON.parse(readFileSync(file(), "utf8"));
      const bound = {
        ...stored.schedules.find((row: { id: string }) => row.id === id),
        pendingRuns,
        lastDueAt: 1000,
        nextRunAt: 301000,
      };
      stored.schedules = [
        bound,
        {
          ...bound,
          id: "other",
          enabled: false,
          activeRuntimeRunId: "missing",
          mobileExecutionPolicyId: "policy-1",
        },
      ];
      writeFileSync(file(), JSON.stringify(stored));
      state.revoked = true;
      const logging = vi.spyOn(console, "error").mockImplementation(() => {});
      await tickTaskSchedules("owner", state.now);
      logging.mockRestore();
      expect(JSON.parse(readFileSync(file(), "utf8")).schedules[0]).toEqual(
        bound,
      );
    }
    expect(state.authorize).toHaveBeenCalled();
    expect(state.start).not.toHaveBeenCalled();
    expect(state.legacy).not.toHaveBeenCalled();
  });
  it("retains mobile binding after a desktop edit and refuses its changed execution mode", async () => {
    const { id } = await create();
    await updateTaskSchedule(
      id,
      {
        name: "Desktop edit",
        prompt: "Changed",
        runtimeId: "runtime-1",
        schedule: "5m",
        mode: "auto",
      },
      "owner",
      "1",
    );
    expect(
      JSON.parse(readFileSync(file(), "utf8")).schedules[0]
        .mobileExecutionPolicyId,
    ).toBe("policy-1");
    const bytes = readFileSync(file(), "utf8");
    await expect(
      control.handle(
        request(
          "POST",
          `schedules/${id}/trigger`,
          { clientMutationId: "changed-mode" },
          "changed-mode",
          "2",
        ),
      ),
    ).rejects.toMatchObject({ code: "unverified_policy" });
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(state.start).not.toHaveBeenCalled();
  });
});
