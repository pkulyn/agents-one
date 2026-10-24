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

const state = vi.hoisted(() => ({ root: "", start: vi.fn(), cancel: vi.fn() }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "owner",
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (file: string, data: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
  },
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () => undefined,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [
    {
      id: "runtime-1",
      kind: "codex",
      name: "Synthetic Runtime",
      enabled: true,
      location: "local",
      config: { transport: "cli" },
    },
  ],
  startAgentRuntimeTask: state.start,
  getAgentRuntimeRun: vi.fn(),
  cancelAgentRuntimeTask: state.cancel,
}));
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-mobile-schedules-"));
  state.start.mockReset();
  state.cancel.mockReset().mockResolvedValue(true);
  state.start.mockResolvedValue({
    id: "run-1",
    runtimeId: "runtime-1",
    status: "running",
    startedAt: Date.now(),
    events: [],
    output: "",
  });
  vi.resetModules();
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
const file = (): string =>
  join(state.root, "owner", "desktop", "task-schedules.json");
const base = (): TaskSchedule => ({
  id: "schedule-1",
  name: "Original",
  runtimeId: "runtime-1",
  schedule: "5m",
  prompt: "Synthetic task",
  mode: "analysis",
  timeoutMs: 300000,
  enabled: true,
  concurrencyPolicy: "queue",
  pendingRuns: 0,
  lastDueAt: 1000,
  nextRunAt: 301000,
  runs: [],
  createdAt: 1000,
  updatedAt: 1000,
});
function seed(value: unknown): void {
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(value));
}

describe("shared desktop and mobile schedule transactions", () => {
  it("persists desktop versions and checks mobile revisions inside the same async schedule lock", async () => {
    seed({ version: 5, schedules: [base()] });
    const schedules = await import("../src/main/task-schedules");
    expect(schedules.listTaskSchedules("owner")[0].revision).toBe("1");
    const events: unknown[] = [];
    const dispose = schedules.onTaskScheduleChanged((event) =>
      events.push(event),
    );
    const results = await Promise.allSettled([
      schedules.updateTaskSchedule(
        "schedule-1",
        { ...base(), name: "Desktop rename" },
        "owner",
        "1",
      ),
      schedules.setTaskScheduleEnabled("schedule-1", false, "owner", "1"),
    ]);
    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(schedules.listTaskSchedules("owner")[0]).toMatchObject({
      name: "Desktop rename",
      enabled: true,
      revision: "2",
    });
    expect(events).toEqual([
      { profile: "owner", scheduleId: "schedule-1", revision: "2" },
    ]);
    dispose();
    const before = readFileSync(file(), "utf8");
    await expect(
      schedules.triggerTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toThrow("revision_conflict");
    expect(state.start).not.toHaveBeenCalled();
    expect(readFileSync(file(), "utf8")).toBe(before);
  });
  it("preserves root/definition/execution extensions and execution history beyond the desktop window", async () => {
    const runs = Array.from({ length: 140 }, (_, index) => ({
      id: `original-run-${index}`,
      triggeredAt: index + 1000,
      status: "succeeded",
      futureExecution: { keep: index },
    }));
    seed({
      version: 5,
      futureRoot: { keep: true },
      schedules: [
        { ...base(), futureDefinition: "keep", runs },
        { id: "unknown-source", opaque: "preserve" },
      ],
    });
    const schedules = await import("../src/main/task-schedules");
    expect(schedules.listTaskSchedules("owner")[0].runs).toHaveLength(100);
    await schedules.setTaskScheduleEnabled("schedule-1", false, "owner", "1");
    const stored = JSON.parse(readFileSync(file(), "utf8"));
    expect(stored).toMatchObject({
      futureRoot: { keep: true },
      schedules: [
        { futureDefinition: "keep" },
        { id: "unknown-source", opaque: "preserve" },
      ],
    });
    expect(stored.schedules[0].runs).toEqual(runs);
    expect(schedules.listFullTaskSchedules("owner")[0].runs).toHaveLength(140);
  });
  it("keeps due cursors for name/prompt edits and recalculates only when the expression changes", async () => {
    seed({ version: 5, schedules: [base()] });
    const schedules = await import("../src/main/task-schedules");
    const renamed = await schedules.updateTaskSchedule(
      "schedule-1",
      { ...base(), name: "New name", prompt: "New prompt" },
      "owner",
      "1",
    );
    expect(renamed).toMatchObject({
      lastDueAt: 1000,
      nextRunAt: 301000,
      revision: "2",
    });
    const edited = await schedules.updateTaskSchedule(
      "schedule-1",
      { ...base(), schedule: "10m" },
      "owner",
      "2",
    );
    expect(edited.lastDueAt).toBeGreaterThan(1000);
    expect(edited.nextRunAt).toBe(edited.lastDueAt! + 600000);
  });
  it("does not overwrite a damaged or incompatible original schedule file on create", async () => {
    seed({ version: 5, schedules: [base()] });
    const schedules = await import("../src/main/task-schedules");
    for (const bad of [
      "broken",
      JSON.stringify({ schedules: {}, futureRoot: "keep" }),
    ]) {
      writeFileSync(file(), bad);
      await expect(
        schedules.createTaskSchedule(base(), "owner"),
      ).rejects.toThrow("schedule_storage_invalid");
      expect(readFileSync(file(), "utf8")).toBe(bad);
    }
  });
  it("rejects a full queue before dispatch or cancellation instead of silently losing a trigger", async () => {
    const schedules = await import("../src/main/task-schedules");
    for (const concurrencyPolicy of ["queue", "replace"] as const) {
      seed({
        version: 5,
        schedules: [
          {
            ...base(),
            concurrencyPolicy,
            activeRuntimeRunId: "active-run",
            pendingRuns: 20,
          },
        ],
      });
      const before = readFileSync(file(), "utf8");
      await expect(
        schedules.triggerTaskSchedule("schedule-1", "owner", "1"),
      ).rejects.toThrow("queue_full");
      expect(readFileSync(file(), "utf8")).toBe(before);
    }
    expect(state.start).not.toHaveBeenCalled();
    expect(state.cancel).not.toHaveBeenCalled();
  });
  it("queues replacement only after cancellation acknowledgement and keeps the active run until runner reconciliation", async () => {
    seed({
      version: 5,
      futureRoot: { keep: true },
      schedules: [
        {
          ...base(),
          concurrencyPolicy: "replace",
          activeRuntimeRunId: "active-run",
          pendingRuns: 2,
          futureDefinition: "keep",
          runs: [
            {
              id: "original-execution",
              triggeredAt: 1000,
              status: "running",
              runtimeRunId: "active-run",
              futureExecution: "keep",
            },
          ],
        },
      ],
    });
    const schedules = await import("../src/main/task-schedules");
    const original = readFileSync(file(), "utf8");
    const changes: unknown[] = [];
    const dispose = schedules.onTaskScheduleChanged((change) =>
      changes.push(change),
    );
    state.cancel.mockResolvedValueOnce(false);
    await expect(
      schedules.triggerTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toMatchObject({ code: "requires_owner_action", status: 409 });
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(changes).toEqual([]);
    state.cancel.mockRejectedValueOnce(Error("synthetic cancellation failure"));
    await expect(
      schedules.triggerTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toThrow("synthetic cancellation failure");
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(changes).toEqual([]);
    const accepted = await schedules.triggerTaskSchedule(
      "schedule-1",
      "owner",
      "1",
    );
    expect(accepted).toMatchObject({
      schedule: {
        activeRuntimeRunId: "active-run",
        pendingRuns: 3,
        revision: "2",
        runs: [{ id: "original-execution", status: "running" }],
      },
    });
    expect(accepted.run).toBeUndefined();
    expect(state.start).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(file(), "utf8"))).toMatchObject({
      futureRoot: { keep: true },
      schedules: [
        { futureDefinition: "keep", runs: [{ futureExecution: "keep" }] },
      ],
    });
    expect(changes).toEqual([
      { profile: "owner", scheduleId: "schedule-1", revision: "2" },
    ]);
    const committed = readFileSync(file(), "utf8");
    await expect(
      schedules.triggerTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toThrow("revision_conflict");
    expect(state.cancel).toHaveBeenCalledTimes(3);
    expect(readFileSync(file(), "utf8")).toBe(committed);
    dispose();
  });
  it("requires a paused definition and empty queue for versioned deletion and leaves result conversations intact", async () => {
    seed({ version: 5, schedules: [base()] });
    const historyFile = join(
      state.root,
      "owner",
      "desktop",
      "runtime-conversations.json",
    );
    writeFileSync(
      historyFile,
      JSON.stringify({
        conversations: [{ id: "original-result", content: "keep" }],
      }),
    );
    const original = readFileSync(historyFile, "utf8"),
      schedules = await import("../src/main/task-schedules");
    await expect(
      schedules.deleteTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toThrow("run_active");
    const paused = await schedules.setTaskScheduleEnabled(
      "schedule-1",
      false,
      "owner",
      "1",
    );
    expect(
      await schedules.deleteTaskSchedule(
        "schedule-1",
        "owner",
        paused.revision,
      ),
    ).toBe(true);
    expect(schedules.listTaskSchedules("owner")).toEqual([]);
    expect(readFileSync(historyFile, "utf8")).toBe(original);
    seed({
      version: 5,
      schedules: [{ ...base(), enabled: false, pendingRuns: 1 }],
    });
    await expect(
      schedules.deleteTaskSchedule("schedule-1", "owner", "1"),
    ).rejects.toThrow("run_active");
  });
  it("keeps active-run cancellation separate from paused pending-work discard", async () => {
    seed({
      version: 5,
      schedules: [
        { ...base(), activeRuntimeRunId: "active-run", pendingRuns: 2 },
      ],
    });
    const schedules = await import("../src/main/task-schedules");
    const cancelled = await schedules.cancelTaskScheduleActiveRun(
      "schedule-1",
      "owner",
      "1",
    );
    expect(cancelled).toMatchObject({
      runId: "active-run",
      schedule: { pendingRuns: 2, activeRuntimeRunId: "active-run" },
    });
    expect(state.cancel).toHaveBeenCalledWith("active-run");
    await expect(
      schedules.discardTaskSchedulePending("schedule-1", "owner", "1"),
    ).rejects.toThrow("run_active");
    const paused = await schedules.setTaskScheduleEnabled(
      "schedule-1",
      false,
      "owner",
      "1",
    );
    const discarded = await schedules.discardTaskSchedulePending(
      "schedule-1",
      "owner",
      paused.revision!,
    );
    expect(discarded).toMatchObject({
      discardedCount: 2,
      schedule: {
        pendingRuns: 0,
        activeRuntimeRunId: "active-run",
        revision: "3",
      },
    });
  });
});
