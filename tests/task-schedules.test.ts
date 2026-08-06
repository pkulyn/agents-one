import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const createTaskCenterTaskMock = vi.hoisted(() => vi.fn());
const listTaskCenterTasksMock = vi.hoisted(() => vi.fn(async () => []));
const cancelTaskCenterTaskMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../src/main/task-center", () => ({
  createTaskCenterTask: createTaskCenterTaskMock,
  listTaskCenterTasks: listTaskCenterTasksMock,
  cancelTaskCenterTask: cancelTaskCenterTaskMock,
}));

let testHome: string;

async function loadModules(): Promise<{
  runtimes: typeof import("../src/main/agent-runtimes");
  schedules: typeof import("../src/main/task-schedules");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return {
    runtimes: await import("../src/main/agent-runtimes"),
    schedules: await import("../src/main/task-schedules"),
  };
}

describe("Task Center local schedules", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-schedules-"));
    createTaskCenterTaskMock.mockReset();
    listTaskCenterTasksMock.mockReset();
    cancelTaskCenterTaskMock.mockReset();
    listTaskCenterTasksMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps a queued trigger behind its active run and preserves Task Center links", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-local",
      name: "Local Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    createTaskCenterTaskMock
      .mockResolvedValueOnce({ id: "task-run-1", status: "running" })
      .mockResolvedValueOnce({ id: "task-run-2", status: "queued" });
    const schedule = schedules.createTaskSchedule({
      name: "Nightly checks",
      schedule: "5m",
      prompt: "Run the test suite.",
      runtimeId: "codex-local",
      concurrencyPolicy: "queue",
    });

    const first = await schedules.triggerTaskSchedule(schedule.id);
    const queued = await schedules.triggerTaskSchedule(schedule.id);
    expect(first.task?.id).toBe("task-run-1");
    expect(queued.task).toBeUndefined();
    expect(schedules.listTaskSchedules()).toEqual([
      expect.objectContaining({ activeTaskCenterTaskId: "task-run-1", pendingRuns: 1 }),
    ]);

    listTaskCenterTasksMock.mockResolvedValue([{ id: "task-run-1", status: "succeeded" }]);
    await schedules.tickTaskSchedules(undefined, Date.now());

    expect(createTaskCenterTaskMock).toHaveBeenCalledTimes(2);
    expect(schedules.listTaskSchedules()[0]).toMatchObject({
      activeTaskCenterTaskId: "task-run-2",
      pendingRuns: 0,
      runs: expect.arrayContaining([
        expect.objectContaining({ taskCenterTaskId: "task-run-1", status: "succeeded" }),
        expect.objectContaining({ taskCenterTaskId: "task-run-2" }),
      ]),
    });
  });

  it("rejects implementation schedules for a non-coding Runtime", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "openclaw-remote",
      name: "OpenClaw",
      kind: "openclaw",
      location: "remote",
      enabled: true,
      config: { transport: "http", endpoint: "https://example.invalid" },
    });
    expect(() => schedules.createTaskSchedule({
      name: "Unsafe write",
      schedule: "0 9 * * 1",
      prompt: "Change production files.",
      runtimeId: "openclaw-remote",
      mode: "implementation",
    })).toThrow(/Codex, Claude Code, or Pi Agent CLI/);
  });
});
