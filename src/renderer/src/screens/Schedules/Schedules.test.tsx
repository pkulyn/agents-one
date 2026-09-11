import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const translate = vi.hoisted(
  () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(":")}` : key,
);

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: translate }),
}));

import Schedules from "./Schedules";

describe("Runtime schedules", () => {
  const listCronJobs = vi.fn();
  const listTaskSchedules = vi.fn();
  const listAgentRuntimes = vi.fn();
  const listProjectFolders = vi.fn();
  const createTaskSchedule = vi.fn();
  const updateTaskSchedule = vi.fn();
  const triggerTaskSchedule = vi.fn();
  const onTaskScheduleRunCompleted = vi.fn();
  const onTaskScheduleRunStarted = vi.fn();
  let scheduleCompletedCallback:
    | ((event: {
        profile: string;
        scheduleId: string;
        scheduleName: string;
        runId: string;
        status: "succeeded";
        completedAt: number;
        conversationId?: string;
      }) => void)
    | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    scheduleCompletedCallback = undefined;
    listCronJobs.mockResolvedValue([]);
    listProjectFolders.mockResolvedValue([]);
    listTaskSchedules.mockResolvedValue([
      {
        id: "schedule-1",
        name: "Nightly checks",
        schedule: "5m",
        prompt: "Run tests.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 600000,
        enabled: true,
        concurrencyPolicy: "queue",
        pendingRuns: 0,
        runs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    listAgentRuntimes.mockResolvedValue([
      {
        id: "codex-local",
        name: "Local Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
      {
        id: "openclaw-remote",
        name: "Remote OpenClaw",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          transport: "http",
          endpoint: "https://example.invalid",
          remoteGateway: { protocol: "agents-one-v1" },
        },
      },
      {
        id: "chatgpt-web",
        name: "ChatGPT 网页版",
        kind: "web-agent",
        location: "local",
        enabled: true,
        managed: "user",
        config: {
          agentTransport: "local-web",
          webAgent: {
            provider: "chatgpt",
            profileId: "work",
            adapterVersion: "1.0.0",
            enabled: true,
          },
        },
      },
    ]);
    createTaskSchedule.mockResolvedValue({ id: "schedule-2" });
    updateTaskSchedule.mockResolvedValue({ id: "schedule-1" });
    triggerTaskSchedule.mockResolvedValue({ schedule: { id: "schedule-1" } });
    onTaskScheduleRunCompleted.mockImplementation((callback) => {
      scheduleCompletedCallback = callback;
      return vi.fn();
    });
    onTaskScheduleRunStarted.mockImplementation(() => vi.fn());
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        listCronJobs,
        listTaskSchedules,
        listAgentRuntimes,
        listProjectFolders,
        createTaskSchedule,
        updateTaskSchedule,
        triggerTaskSchedule,
        onTaskScheduleRunCompleted,
        onTaskScheduleRunStarted,
        setTaskScheduleEnabled: vi.fn(),
        deleteTaskSchedule: vi.fn(),
        createCronJob: vi.fn(),
        removeCronJob: vi.fn(),
        pauseCronJob: vi.fn(),
        resumeCronJob: vi.fn(),
        triggerCronJob: vi.fn(),
        selectFolder: vi.fn().mockResolvedValue("D:\\selected-project"),
        registerProjectFolder: vi
          .fn()
          .mockResolvedValue({ path: "D:\\selected-project" }),
      },
    });
  });

  it("manages local, web, and remote Runtime schedules together", async () => {
    listTaskSchedules.mockResolvedValueOnce([
      {
        id: "schedule-1",
        name: "Nightly checks",
        schedule: "5m",
        prompt: "Run tests.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 600000,
        enabled: true,
        concurrencyPolicy: "queue",
        pendingRuns: 0,
        runs: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "schedule-remote",
        name: "Remote research",
        schedule: "5m",
        prompt: "Research remotely.",
        runtimeId: "openclaw-remote",
        mode: "analysis",
        timeoutMs: 600000,
        enabled: true,
        concurrencyPolicy: "skip",
        pendingRuns: 0,
        runs: [],
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "schedule-web",
        name: "Web digest",
        schedule: "5m",
        prompt: "Summarize in the browser.",
        runtimeId: "chatgpt-web",
        mode: "analysis",
        timeoutMs: 600000,
        enabled: true,
        concurrencyPolicy: "skip",
        pendingRuns: 0,
        runs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    expect(screen.getByText("schedules.sourceTitle")).toBeInTheDocument();
    const remoteCard = screen
      .getByText("Remote research")
      .closest(".schedules-table-row");
    const webCard = screen
      .getByText("Web digest")
      .closest(".schedules-table-row");
    expect(remoteCard).toHaveTextContent("schedules.categoryRemote");
    expect(webCard).toHaveTextContent("schedules.categoryWeb");
    expect(listCronJobs).not.toHaveBeenCalled();

    const localCard = screen
      .getByText("Nightly checks")
      .closest(".schedules-table-row");
    expect(localCard).not.toBeNull();
    expect(localCard).toHaveTextContent("schedules.categoryLocal");
    fireEvent.click(
      within(localCard as HTMLElement).getByRole("button", {
        name: "schedules.runNowAction",
      }),
    );
    await waitFor(() =>
      expect(triggerTaskSchedule).toHaveBeenCalledWith("schedule-1", "default"),
    );
  });

  it("creates a Web Agent schedule in analysis-only mode", async () => {
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    fireEvent.click(screen.getByRole("button", { name: "schedules.newTask" }));
    expect(screen.queryByText("执行位置")).toBeNull();
    expect(screen.queryByText("执行方式")).toBeNull();
    expect(screen.queryByText("远程 Hermes")).toBeNull();
    expect(
      screen.getByRole("option", { name: /Remote OpenClaw/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /ChatGPT 网页版/ }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("schedules.namePlaceholder"), {
      target: { value: "Hourly research" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("schedules.promptPlaceholder"),
      { target: { value: "Summarize new findings." } },
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "schedules.runtime" }),
      {
        target: { value: "chatgpt-web" },
      },
    );
    expect(screen.getByText("schedules.webRuntimeHint")).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText("schedules.workspacePlaceholder"),
    ).toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "schedules.fileAccess" }),
    ).toBeNull();
    fireEvent.change(
      screen.getByRole("combobox", { name: "schedules.concurrency" }),
      {
        target: { value: "queue" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "schedules.create" }));

    await waitFor(() =>
      expect(createTaskSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Hourly research",
          runtimeId: "chatgpt-web",
          concurrencyPolicy: "queue",
        }),
        "default",
      ),
    );
    expect(createTaskSchedule.mock.calls[0][0]).toMatchObject({
      mode: "analysis",
      workspace: undefined,
    });
  });

  it("edits an existing schedule without inheriting an agent workspace", async () => {
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    fireEvent.click(
      screen.getByRole("button", { name: "schedules.editAction" }),
    );
    expect(
      screen.getByRole("heading", { name: "schedules.editTask" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("schedules.namePlaceholder"), {
      target: { value: "Updated checks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "schedules.save" }));
    await waitFor(() =>
      expect(updateTaskSchedule).toHaveBeenCalledWith(
        "schedule-1",
        expect.objectContaining({
          name: "Updated checks",
          workspace: undefined,
          mode: "analysis",
        }),
        "default",
      ),
    );
  });

  it("restores an opaque workspace id as its saved folder path when editing", async () => {
    listTaskSchedules.mockResolvedValueOnce([
      {
        id: "schedule-workspace",
        name: "Project task",
        schedule: "5m",
        prompt: "Update the project.",
        runtimeId: "codex-local",
        workspaceId: "project-pkulyn",
        mode: "auto",
        timeoutMs: 7_200_000,
        enabled: true,
        concurrencyPolicy: "skip",
        pendingRuns: 0,
        runs: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    listProjectFolders.mockResolvedValueOnce([
      {
        id: "project-pkulyn",
        path: "D:\\workspace\\vault",
        name: "pkulyn_vault",
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    render(<Schedules profile="default" />);
    await screen.findByText("Project task");
    fireEvent.click(
      screen.getByRole("button", { name: "schedules.editAction" }),
    );

    expect(
      screen.getByPlaceholderText("schedules.workspacePlaceholder"),
    ).toHaveValue("D:\\workspace\\vault");
    expect(
      screen.getByRole("combobox", { name: "schedules.timeout" }),
    ).toHaveValue("7200000");
    fireEvent.click(screen.getByRole("button", { name: "schedules.save" }));
    await waitFor(() =>
      expect(updateTaskSchedule).toHaveBeenCalledWith(
        "schedule-workspace",
        expect.objectContaining({
          workspace: "D:\\workspace\\vault",
          workspaceId: "project-pkulyn",
          timeoutMs: 7_200_000,
        }),
        "default",
      ),
    );
  });

  it("saves the explicit writable option as full access", async () => {
    render(<Schedules profile="default" />);
    await screen.findByText("Nightly checks");
    fireEvent.click(
      screen.getByRole("button", { name: "schedules.editAction" }),
    );
    const access = screen.getByRole("combobox", {
      name: "schedules.fileAccess",
    });
    expect(
      screen.getByRole("option", {
        name: "schedules.modeFullAccess",
      }),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByPlaceholderText("schedules.workspacePlaceholder"),
      {
        target: { value: "D:\\selected-project" },
      },
    );
    fireEvent.change(access, { target: { value: "full_access" } });
    fireEvent.click(screen.getByRole("button", { name: "schedules.save" }));

    await waitFor(() =>
      expect(updateTaskSchedule).toHaveBeenCalledWith(
        "schedule-1",
        expect.objectContaining({
          workspace: "D:\\selected-project",
          mode: "full_access",
        }),
        "default",
      ),
    );
  });

  it("refreshes completed runs and opens their visible conversation", async () => {
    listTaskSchedules.mockResolvedValueOnce([
      {
        id: "schedule-1",
        name: "Nightly checks",
        schedule: "5m",
        prompt: "Run tests.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 600000,
        enabled: true,
        concurrencyPolicy: "queue",
        pendingRuns: 0,
        runs: [
          {
            id: "schedule-run-1",
            triggeredAt: 1,
            completedAt: 2,
            status: "succeeded",
            conversationId: "runtime-conv-schedule-1",
            summary: "All checks passed.",
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);
    const opened = vi.fn();
    window.addEventListener("agents-one:open-runtime-conversation", opened);
    render(<Schedules profile="default" />);

    await screen.findByLabelText(
      "schedules.recentResult:schedules.statusSucceeded",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "schedules.openRecentAction" }),
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe(
      "runtime-conv-schedule-1",
    );

    const callsBeforeCompletion = listTaskSchedules.mock.calls.length;
    await act(async () => {
      scheduleCompletedCallback?.({
        profile: "default",
        scheduleId: "schedule-1",
        scheduleName: "Nightly checks",
        runId: "schedule-run-1",
        status: "succeeded",
        completedAt: 2,
        conversationId: "runtime-conv-schedule-1",
      });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(listTaskSchedules.mock.calls.length).toBeGreaterThan(
        callsBeforeCompletion,
      ),
    );
    window.removeEventListener("agents-one:open-runtime-conversation", opened);
  });

  it("uses one primary creation entry when both schedule sources are empty", async () => {
    listTaskSchedules.mockResolvedValue([]);
    render(<Schedules profile="default" />);

    await screen.findByText("schedules.empty");
    expect(
      screen.getAllByRole("button", { name: "schedules.newTask" }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "schedules.firstTask" }),
    ).toBeNull();
  });
});
