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

vi.mock("electron", () => ({
  app: { setPath: vi.fn(), getPath: () => "C:\\temp" },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
}));

const startAgentRuntimeTaskMock = vi.hoisted(() => vi.fn());
const getAgentRuntimeRunMock = vi.hoisted(() => vi.fn(async () => null));
const cancelAgentRuntimeTaskMock = vi.hoisted(() => vi.fn(async () => true));
const resolveAuthorizedWorkspaceIdMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: resolveAuthorizedWorkspaceIdMock,
}));

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

describe("Runtime schedules", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-schedules-"));
    startAgentRuntimeTaskMock.mockReset();
    getAgentRuntimeRunMock.mockReset();
    cancelAgentRuntimeTaskMock.mockReset();
    resolveAuthorizedWorkspaceIdMock.mockReset();
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
    const schedule = await schedules.createTaskSchedule({
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

  it("serializes concurrent manual triggers so only one Runtime starts", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-local",
      name: "Local Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const schedule = await schedules.createTaskSchedule({
      name: "Single click guard",
      schedule: "5m",
      prompt: "Run once.",
      runtimeId: "codex-local",
      concurrencyPolicy: "skip",
    });
    let resolveStart!: (run: {
      id: string;
      runtimeId: string;
      status: "running";
      startedAt: number;
      output: string;
      events: never[];
    }) => void;
    startAgentRuntimeTaskMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    const first = schedules.triggerTaskSchedule(schedule.id);
    const second = schedules.triggerTaskSchedule(schedule.id);
    await vi.waitFor(() =>
      expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(1),
    );
    resolveStart({
      id: "runtime-run-once",
      runtimeId: "codex-local",
      status: "running",
      startedAt: Date.now(),
      output: "",
      events: [],
    });
    await Promise.all([first, second]);

    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(1);
    expect(schedules.listTaskSchedules()[0]).toMatchObject({
      activeRuntimeRunId: "runtime-run-once",
      runs: expect.arrayContaining([
        expect.objectContaining({ runtimeRunId: "runtime-run-once" }),
        expect.objectContaining({ status: "skipped" }),
      ]),
    });
  });

  it("serializes 100 triggers and prevents an edit/delete race from reviving a schedule", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const triggerSchedule = await schedules.createTaskSchedule({
      name: "Burst trigger guard",
      schedule: "5m",
      prompt: "Run once.",
      runtimeId: "pi-local",
    });

    await Promise.all(
      Array.from({ length: 100 }, () =>
        schedules.triggerTaskSchedule(triggerSchedule.id),
      ),
    );
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(1);

    const schedule = await schedules.createTaskSchedule({
      name: "Delete wins over edit",
      schedule: "5m",
      prompt: "Do not revive after delete.",
      runtimeId: "pi-local",
    });
    // Submit 100 edits and 100 deletes at once. The queue serializes the
    // first winning update/delete pair, then every stale mutation must fail
    // closed without reviving the deleted schedule or rewriting the store.
    const races = Array.from({ length: 100 }, () => [
      schedules.updateTaskSchedule(schedule.id, {
        name: "This edit loses to delete.",
        schedule: "10m",
        prompt: "Do not revive after delete.",
        runtimeId: "pi-local",
      }),
      schedules.deleteTaskSchedule(schedule.id),
    ]).flat();
    await Promise.allSettled(races);
    expect(
      schedules.listTaskSchedules().find((item) => item.id === schedule.id),
    ).toBeUndefined();
  });

  it("coalesces an overdue schedule into one explicitly marked catch-up run", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const schedule = await schedules.createTaskSchedule({
      name: "Coalesced catch-up",
      schedule: "5m",
      prompt: "Run once after wake.",
      runtimeId: "pi-local",
    });
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const overdueAt = now - 5 * 60_000;
    const path = join(testHome, "desktop", "task-schedules.json");
    const store = JSON.parse(readFileSync(path, "utf8"));
    store.schedules[0].lastDueAt = now - 10 * 60_000;
    store.schedules[0].nextRunAt = overdueAt;
    writeFileSync(path, JSON.stringify(store));

    startAgentRuntimeTaskMock.mockResolvedValueOnce({
      id: "runtime-catch-up",
      runtimeId: "pi-local",
      status: "running",
      startedAt: now,
      output: "",
      events: [],
    });

    await schedules.tickTaskSchedules(undefined, now);
    const afterCatchUp = schedules
      .listTaskSchedules()
      .find((item) => item.id === schedule.id);
    expect(afterCatchUp).toMatchObject({
      activeRuntimeRunId: "runtime-catch-up",
      nextRunAt: expect.any(Number),
      runs: [
        expect.objectContaining({
          runtimeRunId: "runtime-catch-up",
          trigger: "missed",
          dueAt: overdueAt,
        }),
      ],
    });
    expect(afterCatchUp?.nextRunAt).toBeGreaterThan(now);

    await schedules.tickTaskSchedules(undefined, now);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch the same local cron minute twice after a clock rollback", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const schedule = await schedules.createTaskSchedule({
      name: "Civil minute only once",
      schedule: "* * * * *",
      prompt: "Run at most once in this local minute.",
      runtimeId: "pi-local",
    });
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const path = join(testHome, "desktop", "task-schedules.json");
    const store = JSON.parse(readFileSync(path, "utf8"));
    store.schedules[0].lastDueAt = now;
    store.schedules[0].nextRunAt = now;
    writeFileSync(path, JSON.stringify(store));

    await schedules.tickTaskSchedules(undefined, now);

    const afterRollback = schedules
      .listTaskSchedules()
      .find((item) => item.id === schedule.id);
    expect(startAgentRuntimeTaskMock).not.toHaveBeenCalled();
    expect(afterRollback).toMatchObject({ lastDueAt: now });
    expect(afterRollback?.nextRunAt).toBeGreaterThan(now);
  });

  it("continues ticking later schedules when one due Runtime cannot start", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const first = await schedules.createTaskSchedule({
      name: "Broken due task",
      schedule: "5m",
      prompt: "First.",
      runtimeId: "pi-local",
    });
    const second = await schedules.createTaskSchedule({
      name: "Healthy due task",
      schedule: "5m",
      prompt: "Second.",
      runtimeId: "pi-local",
    });
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const path = join(testHome, "desktop", "task-schedules.json");
    const store = JSON.parse(readFileSync(path, "utf8"));
    for (const item of store.schedules) item.nextRunAt = now;
    writeFileSync(path, JSON.stringify(store));
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    startAgentRuntimeTaskMock
      .mockRejectedValueOnce(new Error("token=secret-value"))
      .mockResolvedValueOnce({
        id: "runtime-healthy",
        runtimeId: "pi-local",
        status: "running",
        startedAt: now,
        output: "",
        events: [],
      });

    await schedules.tickTaskSchedules(undefined, now);

    expect(startAgentRuntimeTaskMock).toHaveBeenCalledTimes(2);
    expect(
      schedules.listTaskSchedules().find((item) => item.id === first.id),
    ).toMatchObject({ activeRuntimeRunId: "runtime-healthy" });
    expect(
      schedules.listTaskSchedules().find((item) => item.id === second.id),
    ).not.toHaveProperty("activeRuntimeRunId");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("[TASK SCHEDULE] Tick failed"),
    );
    expect(error).not.toHaveBeenCalledWith(
      expect.stringContaining("secret-value"),
    );
    error.mockRestore();
  });

  it("dispatches schedules through Web Agent and remote Gateway runtimes", async () => {
    const { runtimes, schedules } = await loadModules();
    const remote = runtimes.saveAgentRuntime({
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
    const web = runtimes.saveAgentRuntime({
      id: "chatgpt-web",
      name: "ChatGPT Web",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "chatgpt",
          profileId: "scheduled-account",
          adapterVersion: "1.0.0",
          enabled: true,
        },
      },
    });
    startAgentRuntimeTaskMock.mockImplementation(async (runtimeId: string) => ({
      id: `run-${runtimeId}`,
      runtimeId,
      status: "running",
      startedAt: Date.now(),
      output: "",
      events: [],
    }));

    const webSchedule = await schedules.createTaskSchedule({
      name: "Web digest",
      schedule: "5m",
      prompt: "Summarize the latest items.",
      runtimeId: web.id,
    });
    expect(webSchedule).toMatchObject({ mode: "analysis" });
    await schedules.triggerTaskSchedule(webSchedule.id);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      web.id,
      expect.objectContaining({
        mode: "analysis",
        conversation: true,
      }),
    );
    expect(startAgentRuntimeTaskMock.mock.calls[0][1]).not.toHaveProperty(
      "workspace",
    );

    const remoteSchedule = await schedules.createTaskSchedule({
      name: "Remote research",
      schedule: "0 9 * * 1",
      prompt: "Research on the remote agent.",
      runtimeId: remote.id,
      mode: "analysis",
    });
    await schedules.triggerTaskSchedule(remoteSchedule.id);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      remote.id,
      expect.objectContaining({
        mode: "analysis",
        conversation: true,
      }),
    );
  });

  it("rejects disabled or browser-disabled runtimes", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-disabled",
      name: "Disabled Pi",
      kind: "pi",
      location: "local",
      enabled: false,
      config: { transport: "cli" },
    });
    runtimes.saveAgentRuntime({
      id: "chatgpt-web-disabled",
      name: "Disabled Web Agent",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "chatgpt",
          profileId: "disabled-account",
          adapterVersion: "1.0.0",
          enabled: false,
        },
      },
    });

    for (const runtimeId of ["pi-disabled", "chatgpt-web-disabled"]) {
      await expect(
        schedules.createTaskSchedule({
          name: "Unavailable target",
          schedule: "5m",
          prompt: "Do not run.",
          runtimeId,
        }),
      ).rejects.toThrow(/local CLI, Web Agent, or remote Gateway v1 Runtime/);
    }
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
    const created = await schedules.createTaskSchedule({
      name: "Before",
      schedule: "5m",
      prompt: "Talk only.",
      runtimeId: "pi-local",
    });
    expect(created).toMatchObject({ mode: "auto" });
    expect(created).not.toHaveProperty("workspace");

    const updated = await schedules.updateTaskSchedule(created.id, {
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
    const created = await schedules.createTaskSchedule({
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

  it("allows a schedule to retain a finite 24-hour timeout", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-long-running",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli" },
    });
    const created = await schedules.createTaskSchedule({
      name: "Long running maintenance",
      schedule: "24h",
      prompt: "Complete the maintenance task.",
      runtimeId: "pi-long-running",
      timeoutMs: 24 * 60 * 60_000,
    });

    expect(created.timeoutMs).toBe(24 * 60 * 60_000);
    await schedules.triggerTaskSchedule(created.id);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      "pi-long-running",
      expect.objectContaining({ timeoutMs: 24 * 60 * 60_000 }),
    );
  });

  it("persists a selected workspace by opaque project id", async () => {
    const { runtimes, schedules } = await loadModules();
    resolveAuthorizedWorkspaceIdMock.mockReturnValue(testHome);
    runtimes.saveAgentRuntime({
      id: "pi-workspace-id",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli" },
    });

    const created = await schedules.createTaskSchedule({
      name: "Opaque workspace",
      schedule: "5m",
      prompt: "更新项目。",
      runtimeId: "pi-workspace-id",
      workspaceId: "project-opaque-workspace",
    });
    expect(created).toMatchObject({ workspaceId: "project-opaque-workspace" });
    expect(created).not.toHaveProperty("workspace");
  }, 15_000);

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
    const schedule = await schedules.createTaskSchedule({
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
          runtimeId: "pi-local",
          runtimeName: "Pi",
          runtimeKind: "pi",
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
    const schedule = await schedules.createTaskSchedule({
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

  it("starts an existing remote schedule once its Gateway Runtime is eligible", async () => {
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
            prompt: "Dispatch this task through the configured Gateway.",
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

    startAgentRuntimeTaskMock.mockResolvedValueOnce({
      id: "runtime-run-remote",
      runtimeId: "hermes-gateway",
      status: "running",
      startedAt: now,
      output: "",
      events: [],
    });

    await schedules.tickTaskSchedules(undefined, now);
    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      "hermes-gateway",
      expect.objectContaining({ mode: "safe_write", conversation: true }),
    );
    expect(schedules.listTaskSchedules()).toEqual([
      expect.objectContaining({
        id: "schedule-remote",
        enabled: true,
        activeRuntimeRunId: "runtime-run-remote",
      }),
    ]);
  });

  it("accepts only cron expressions that the scheduler can match", async () => {
    const { runtimes, schedules } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });

    const schedule = await schedules.createTaskSchedule({
      name: "Business-hour checks",
      schedule: "*/15 9-17/2 1-31 1-12 1-5",
      prompt: "Run the checks.",
      runtimeId: "pi-local",
    });
    expect(schedule.nextRunAt).toEqual(expect.any(Number));

    for (const invalid of [
      "61 * * * *",
      "*/0 * * * *",
      "10-2 * * * *",
      "* * * * 8",
      "this is not cron",
    ]) {
      await expect(
        schedules.createTaskSchedule({
          name: "Invalid cron",
          schedule: invalid,
          prompt: "Do not save.",
          runtimeId: "pi-local",
        }),
      ).rejects.toThrow(/5-field Cron or interval/);
    }
  });
});
