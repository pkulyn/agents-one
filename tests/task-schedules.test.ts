import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

const startAgentRuntimeTaskMock = vi.hoisted(() => vi.fn());
const getAgentRuntimeRunMock = vi.hoisted(() => vi.fn(async () => null));
const cancelAgentRuntimeTaskMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../src/main/agent-runtimes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/main/agent-runtimes")>();
  return {
    ...actual,
    startAgentRuntimeTask: startAgentRuntimeTaskMock,
    getAgentRuntimeRun: getAgentRuntimeRunMock,
    cancelAgentRuntimeTask: cancelAgentRuntimeTaskMock,
  };
});

let testHome: string;

async function loadModules(): Promise<{
  runtimes: typeof import("../src/main/agent-runtimes");
  schedules: typeof import("../src/main/task-schedules");
  conversations: typeof import("../src/main/runtime-conversation-store");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return {
    runtimes: await import("../src/main/agent-runtimes"),
    schedules: await import("../src/main/task-schedules"),
    conversations: await import("../src/main/runtime-conversation-store"),
  };
}

describe("local Runtime schedules", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-schedules-"));
    startAgentRuntimeTaskMock.mockReset();
    getAgentRuntimeRunMock.mockReset();
    cancelAgentRuntimeTaskMock.mockReset();
    startAgentRuntimeTaskMock.mockResolvedValue({
      id: "runtime-run-default",
      runtimeId: "pi-local",
      status: "running",
      startedAt: Date.now(),
      output: "",
      events: [],
    });
    getAgentRuntimeRunMock.mockResolvedValue(null);
    cancelAgentRuntimeTaskMock.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps a queued trigger behind its active direct Runtime run", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-local",
      name: "Local Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    startAgentRuntimeTaskMock
      .mockResolvedValueOnce({
        id: "runtime-run-1",
        runtimeId: "codex-local",
        status: "running",
        startedAt: Date.now(),
        events: [],
      })
      .mockResolvedValueOnce({
        id: "runtime-run-2",
        runtimeId: "codex-local",
        status: "running",
        startedAt: Date.now(),
        events: [],
      });
    const schedule = schedules.createTaskSchedule({
      name: "Nightly checks",
      schedule: "5m",
      prompt: "Run the test suite.",
      runtimeId: "codex-local",
      concurrencyPolicy: "queue",
    });

    const first = await schedules.triggerTaskSchedule(schedule.id);
    const queued = await schedules.triggerTaskSchedule(schedule.id);
    expect(first.run?.id).toBe("runtime-run-1");
    expect(queued.run).toBeUndefined();
    expect(schedules.listTaskSchedules()).toEqual([
      expect.objectContaining({
        activeRuntimeRunId: "runtime-run-1",
        pendingRuns: 1,
      }),
    ]);

    getAgentRuntimeRunMock.mockResolvedValue({
      id: "runtime-run-1",
      runtimeId: "codex-local",
      status: "succeeded",
      startedAt: Date.now(),
      completedAt: Date.now(),
      output: "Done.",
      events: [],
    });
    await schedules.tickTaskSchedules(undefined, Date.now());

    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(2);
    expect(schedules.listTaskSchedules()[0]).toMatchObject({
      activeRuntimeRunId: "runtime-run-2",
      pendingRuns: 0,
      runs: expect.arrayContaining([
        expect.objectContaining({
          runtimeRunId: "runtime-run-1",
          status: "succeeded",
        }),
        expect.objectContaining({ runtimeRunId: "runtime-run-2" }),
      ]),
    });
  });

  it("rejects every schedule that is not backed by an enabled local CLI Runtime", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "hermes-gateway",
      name: "Hermes Gateway",
      kind: "hermes",
      location: "remote",
      enabled: true,
      config: {
        transport: "http",
        endpoint: "https://example.invalid/agents-one/v1",
        remoteGateway: { protocol: "agents-one-v1" },
      },
    });
    expect(() =>
      schedules.createTaskSchedule({
        name: "Unsafe write",
        schedule: "0 9 * * 1",
        prompt: "Change production files.",
        runtimeId: "hermes-gateway",
      }),
    ).toThrow(/enabled local CLI Runtime/);
  });

  it("edits schedules and auto-enables writes only for an explicit project folder", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const created = schedules.createTaskSchedule({
      name: "Before",
      schedule: "5m",
      prompt: "Talk only.",
      runtimeId: "pi-local",
    });
    expect(created).toMatchObject({ mode: "auto" });
    expect(created).not.toHaveProperty("workspace");

    const updated = schedules.updateTaskSchedule(created.id, {
      name: "After",
      schedule: "10m",
      prompt: "Update the selected project.",
      runtimeId: "pi-local",
      mode: "auto",
      workspace: testHome,
      concurrencyPolicy: "queue",
    });
    expect(updated).toMatchObject({
      name: "After",
      mode: "auto",
      workspace: testHome,
      concurrencyPolicy: "queue",
    });
    await schedules.triggerTaskSchedule(created.id);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      "pi-local",
      expect.objectContaining({
        mode: "safe_write",
        workspace: testHome,
        conversation: true,
      }),
    );
  });

  it("runs an automatic schedule without a project as a capability-complete conversation", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli" },
    });
    const created = schedules.createTaskSchedule({
      name: "General assistant",
      schedule: "5m",
      prompt: "Use your configured tools.",
      runtimeId: "pi-local",
      mode: "auto",
      concurrencyPolicy: "skip",
    });
    await schedules.triggerTaskSchedule(created.id);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      "pi-local",
      expect.objectContaining({
        mode: "safe_write",
        workspace: undefined,
        conversation: true,
      }),
    );
  });

  it("migrates legacy implicit read-only schedules to automatic access", async () => {
    const { schedules } = await loadModules();
    const now = Date.now();
    const desktopDir = join(testHome, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(
      join(desktopDir, "task-schedules.json"),
      JSON.stringify({
        version: 1,
        schedules: [
          {
            id: "legacy-local",
            name: "Legacy local",
            schedule: "5m",
            prompt: "Hello.",
            runtimeId: "pi-local",
            mode: "analysis",
            timeoutMs: 600_000,
            enabled: false,
            concurrencyPolicy: "skip",
            pendingRuns: 0,
            runs: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
    expect(schedules.listTaskSchedules()[0]).toMatchObject({ mode: "auto" });
  });

  it("migrates the legacy writable mode to explicit full access", async () => {
    const { schedules } = await loadModules();
    const now = Date.now();
    const desktopDir = join(testHome, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(
      join(desktopDir, "task-schedules.json"),
      JSON.stringify({
        version: 2,
        schedules: [
          {
            id: "legacy-writable",
            name: "Legacy writable",
            schedule: "5m",
            prompt: "Update files.",
            runtimeId: "pi-local",
            mode: "implementation",
            workspace: testHome,
            timeoutMs: 600_000,
            enabled: false,
            concurrencyPolicy: "skip",
            pendingRuns: 0,
            runs: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );
    expect(schedules.listTaskSchedules()[0]).toMatchObject({
      mode: "full_access",
      workspace: testHome,
    });
  });

  it("delivers each completed run into a visible Runtime conversation", async () => {
    const { runtimes, schedules, conversations } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    startAgentRuntimeTaskMock.mockResolvedValue({
      id: "runtime-run-visible",
      runtimeId: "pi-local",
      status: "running",
      startedAt: Date.now(),
      output: "",
      events: [
        {
          id: "event-started",
          type: "started",
          summary: "任务已开始执行。",
          createdAt: Date.now(),
        },
      ],
    });
    const completed = vi.fn();
    const startedEvent = vi.fn();
    const dispose = schedules.onTaskScheduleRunCompleted(completed);
    const disposeStarted = schedules.onTaskScheduleRunStarted(startedEvent);
    const schedule = schedules.createTaskSchedule({
      name: "Morning greeting",
      schedule: "5m",
      prompt: "Say hello from the scheduled task.",
      runtimeId: "pi-local",
    });

    await schedules.triggerTaskSchedule(schedule.id, "default");
    const started = schedules.listTaskSchedules("default")[0];
    const conversationId = started.runs[0].conversationId;
    expect(conversationId).toMatch(/^runtime-conv-schedule-/);
    expect(
      conversations.getRuntimeConversation(conversationId as string, "default"),
    ).toMatchObject({
      title: "定时任务：Morning greeting",
      runtimeId: "pi-local",
      accessMode: "auto",
      activeRuntimeRunId: "runtime-run-visible",
      messages: [
        expect.objectContaining({
          role: "user",
          content: "Say hello from the scheduled task.",
        }),
      ],
    });
    await vi.waitFor(() =>
      expect(startedEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: schedule.id,
          runtimeRunId: "runtime-run-visible",
          conversationId,
        }),
      ),
    );

    getAgentRuntimeRunMock.mockResolvedValue({
      id: "runtime-run-visible",
      runtimeId: "pi-local",
      status: "succeeded",
      startedAt: Date.now(),
      completedAt: Date.now(),
      output:
        '{"type":"agent_end","messages":[{"role":"assistant","content":[{"type":"text","text":"Hello from Pi."}]}]}',
      events: [
        {
          id: "event-message",
          type: "message",
          summary: "Pi produced a reply.",
          createdAt: Date.now(),
        },
      ],
    });
    await schedules.tickTaskSchedules("default", Date.now() + 1_000);

    const finished = schedules.listTaskSchedules("default")[0];
    expect(finished.runs[0]).toMatchObject({
      status: "succeeded",
      conversationId,
      summary: "Hello from Pi.",
    });
    expect(
      conversations.getRuntimeConversation(conversationId as string, "default"),
    ).toMatchObject({
      messageCount: 2,
      activeRuntimeRunId: undefined,
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({
          role: "agent",
          content: "Hello from Pi.",
          execution: expect.objectContaining({
            runId: "runtime-run-visible",
            events: [expect.objectContaining({ type: "message" })],
          }),
        }),
      ],
    });
    expect(completed).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: "default",
        scheduleId: schedule.id,
        status: "succeeded",
        conversationId,
        summary: "Hello from Pi.",
      }),
    );
    disposeStarted();
    dispose();
  });

  it("marks a direct Runtime run as failed after restart instead of staying active", async () => {
    const { runtimes, schedules, conversations } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli" },
    });
    const schedule = schedules.createTaskSchedule({
      name: "Restart recovery",
      schedule: "5m",
      prompt: "Continue after restart.",
      runtimeId: "pi-local",
    });
    await schedules.triggerTaskSchedule(schedule.id, "default");
    getAgentRuntimeRunMock.mockResolvedValue(null);

    await schedules.tickTaskSchedules("default", Date.now());

    const recovered = schedules.listTaskSchedules("default")[0];
    expect(recovered.activeRuntimeRunId).toBeUndefined();
    expect(recovered.runs[0]).toMatchObject({
      status: "failed",
      summary: expect.stringContaining("桌面应用重启"),
    });
    expect(
      conversations.getRuntimeConversation(
        recovered.runs[0].conversationId as string,
        "default",
      ),
    ).toMatchObject({
      activeRuntimeRunId: undefined,
      messages: expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("桌面应用重启"),
        }),
      ]),
    });
  });

  it("retires a legacy active marker without touching its frozen archive or blocking rerun", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const now = Date.now();
    const desktopDir = join(testHome, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    const frozenArchive = '{"frozen":"legacy-task-center"}';
    writeFileSync(join(desktopDir, "task-center.json"), frozenArchive);
    writeFileSync(
      join(desktopDir, "task-schedules.json"),
      JSON.stringify({
        version: 4,
        schedules: [
          {
            id: "schedule-legacy-local",
            name: "Legacy greeting",
            schedule: "0 9 * * *",
            prompt: "Say hello.",
            runtimeId: "pi-local",
            mode: "auto",
            timeoutMs: 600_000,
            enabled: false,
            concurrencyPolicy: "skip",
            pendingRuns: 0,
            activeTaskCenterTaskId: "task-legacy-local",
            runs: [
              {
                id: "schedule-run-old",
                triggeredAt: now - 20_000,
                status: "running",
                taskCenterTaskId: "task-legacy-local",
              },
            ],
            createdAt: now - 30_000,
            updatedAt: now - 10_000,
          },
        ],
      }),
    );

    const migrated = schedules.listTaskSchedules("default")[0];
    expect(migrated).not.toHaveProperty("activeTaskCenterTaskId");
    expect(migrated.runs[0]).toMatchObject({
      status: "failed",
      completedAt: expect.any(Number),
      taskCenterTaskId: "task-legacy-local",
      summary: expect.stringContaining("旧版 Task Center 执行引擎已退役"),
    });
    expect(readFileSync(join(desktopDir, "task-center.json"), "utf8")).toBe(
      frozenArchive,
    );

    const triggered = await schedules.triggerTaskSchedule(
      migrated.id,
      "default",
    );
    expect(triggered.run?.id).toBe("runtime-run-default");
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(
      readFileSync(join(desktopDir, "task-schedules.json"), "utf8"),
    ) as { version: number; schedules: Array<Record<string, unknown>> };
    expect(persisted.version).toBe(5);
    expect(persisted.schedules[0]).not.toHaveProperty("activeTaskCenterTaskId");
    expect(readFileSync(join(desktopDir, "task-center.json"), "utf8")).toBe(
      frozenArchive,
    );
  });

  it("preserves legacy remote records without dispatching them", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "hermes-gateway",
      name: "Hermes Gateway",
      kind: "hermes",
      location: "remote",
      enabled: true,
      config: {
        transport: "http",
        endpoint: "https://example.invalid/agents-one/v1",
        remoteGateway: { protocol: "agents-one-v1" },
      },
    });
    const now = Date.now();
    const desktopDir = join(testHome, "desktop");
    mkdirSync(desktopDir, { recursive: true });
    writeFileSync(
      join(desktopDir, "task-schedules.json"),
      JSON.stringify({
        version: 1,
        schedules: [
          {
            id: "schedule-remote",
            name: "Legacy remote task",
            schedule: "5m",
            prompt: "Do not dispatch this task.",
            runtimeId: "hermes-gateway",
            mode: "analysis",
            timeoutMs: 600_000,
            enabled: true,
            concurrencyPolicy: "skip",
            pendingRuns: 0,
            lastDueAt: now - 10 * 60_000,
            nextRunAt: now - 5 * 60_000,
            runs: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );

    await schedules.tickTaskSchedules(undefined, now);
    expect(startAgentRuntimeTaskMock).not.toHaveBeenCalled();
    expect(schedules.listTaskSchedules()).toEqual([
      expect.objectContaining({ id: "schedule-remote", enabled: true }),
    ]);
    await expect(
      schedules.triggerTaskSchedule("schedule-remote"),
    ).rejects.toThrow(/enabled local CLI Runtime/);
  });
});
