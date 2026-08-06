import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string): string => key,
  }),
}));

import TaskCenter from "./TaskCenter";

describe("TaskCenter", () => {
  const listAgentRuntimes = vi.fn();
  const listTaskCenterTasks = vi.fn();
  const createTaskCenterTask = vi.fn();
  const cancelTaskCenterTask = vi.fn();
  const setTaskCenterAcceptance = vi.fn();
  const openTaskCenterWorktree = vi.fn();
  const listTaskCenterWorktrees = vi.fn();
  const removeTaskCenterWorktree = vi.fn();
  const listCronJobs = vi.fn();
  const listTaskSchedules = vi.fn();
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listAgentRuntimes.mockResolvedValue([
      {
        id: "codex-local",
        name: "Local Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: { workspace: "D:\\repo" },
      },
    ]);
    listTaskCenterTasks.mockResolvedValue([]);
    createTaskCenterTask.mockResolvedValue({ id: "task-1" });
    cancelTaskCenterTask.mockResolvedValue({});
    setTaskCenterAcceptance.mockResolvedValue({});
    openTaskCenterWorktree.mockResolvedValue(true);
    listTaskCenterWorktrees.mockResolvedValue([]);
    removeTaskCenterWorktree.mockResolvedValue(true);
    listCronJobs.mockResolvedValue([]);
    listTaskSchedules.mockResolvedValue([]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listAgentRuntimes,
        listTaskCenterTasks,
        createTaskCenterTask,
        cancelTaskCenterTask,
        setTaskCenterAcceptance,
        openTaskCenterWorktree,
        listTaskCenterWorktrees,
        removeTaskCenterWorktree,
        listCronJobs,
        listTaskSchedules,
        createTaskSchedule: vi.fn(),
        setTaskScheduleEnabled: vi.fn(),
        triggerTaskSchedule: vi.fn(),
        deleteTaskSchedule: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches an implementation task to the manually selected runtime", async () => {
    render(<TaskCenter />);
    await screen.findByRole("option", { name: /Local Codex/ });
    fireEvent.change(screen.getByLabelText("执行方式"), {
      target: { value: "implementation" },
    });
    fireEvent.change(screen.getByLabelText("任务说明"), {
      target: { value: "Add a regression test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "派发任务" }));

    await waitFor(() =>
      expect(createTaskCenterTask).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeId: "codex-local",
          mode: "implementation",
          prompt: "Add a regression test",
        }),
      ),
    );
  });

  it("keeps scheduled tasks out of the task workbench", async () => {
    render(<TaskCenter profile="default" />);
    expect(
      screen.queryByRole("tab", { name: "navigation.scheduledTasks" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "任务" })).toBeInTheDocument();
  });

  it("renders review artifacts and supports review actions", async () => {
    listTaskCenterTasks.mockResolvedValue([
      {
        id: "task-review",
        title: "Review implementation",
        prompt: "Inspect the diff.",
        runtimeId: "codex-local",
        mode: "implementation",
        timeoutMs: 300000,
        status: "review_required",
        createdAt: Date.now(),
        startedAt: Date.now(),
        worktreePath: "C:\\worktrees\\task-review",
        diffSummary: "docs/file.md | 2 ++",
        artifacts: [
          {
            kind: "diff",
            label: "Git diff",
            content: "diff --git a/docs/file.md b/docs/file.md\n+hello",
          },
          {
            kind: "final",
            label: "Coordinator plan",
            content: "Plan summary",
          },
        ],
        acceptance: "pending",
      },
    ]);

    render(<TaskCenter />);

    await screen.findByText("Review implementation");
    expect(screen.queryByLabelText("Review implementation 任务详情")).toBeNull();
    fireEvent.click(screen.getByTitle("查看 Review implementation 的任务详情"));
    expect(screen.getByLabelText("Review implementation 任务详情")).toBeInTheDocument();
    expect(screen.getByText("验收产物")).toBeInTheDocument();
    expect(screen.getByText("docs/file.md | 2 ++")).toBeInTheDocument();
    expect(screen.getByText(/diff --git/)).toBeInTheDocument();
    expect(screen.getAllByText("待验收").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "打开隔离工作树" }),
    );
    await waitFor(() =>
      expect(openTaskCenterWorktree).toHaveBeenCalledWith(
        "C:\\worktrees\\task-review",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "复制差异" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("diff --git"),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "退回修改" }),
    );
    await waitFor(() =>
      expect(setTaskCenterAcceptance).toHaveBeenCalledWith(
        "task-review",
        "rejected",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "验收通过" }),
    );
    await waitFor(() =>
      expect(setTaskCenterAcceptance).toHaveBeenCalledWith(
        "task-review",
        "accepted",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
    expect(screen.queryByLabelText("Review implementation 任务详情")).toBeNull();
  });

  it("opens a requested task detail when navigating from a project", async () => {
    listTaskCenterTasks.mockResolvedValue([
      {
        id: "task-from-project",
        title: "Project-linked task",
        prompt: "Inspect the linked run.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 300000,
        status: "succeeded",
        createdAt: Date.now(),
      },
    ]);

    const { rerender } = render(
      <TaskCenter
        initialTab="scheduled"
        initialTaskId="task-from-project"
        initialTaskNonce={1}
      />,
    );

    expect(
      await screen.findByLabelText("Project-linked task 任务详情"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "任务" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭任务详情" }));
    expect(screen.queryByLabelText("Project-linked task 任务详情")).toBeNull();

    rerender(
      <TaskCenter
        initialTab="tasks"
        initialTaskId="task-from-project"
        initialTaskNonce={2}
      />,
    );
    expect(
      screen.getByLabelText("Project-linked task 任务详情"),
    ).toBeInTheDocument();
  });

  it("shows an accepted review as passed instead of leaving a stale pending label", async () => {
    listTaskCenterTasks.mockResolvedValue([
      {
        id: "task-accepted",
        title: "Accepted project task",
        prompt: "Review is complete.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 300000,
        status: "review_required",
        acceptance: "accepted",
        createdAt: Date.now(),
      },
    ]);

    render(<TaskCenter />);

    expect((await screen.findAllByText("已通过")).length).toBeGreaterThan(0);
    expect(screen.queryByText("待验收")).not.toBeInTheDocument();
  });

  it("switches between the detailed task list and the status board", async () => {
    listTaskCenterTasks.mockResolvedValue([
      {
        id: "task-running",
        title: "Running implementation",
        prompt: "Implement the board view.",
        runtimeId: "codex-local",
        mode: "implementation",
        timeoutMs: 300000,
        status: "running",
        createdAt: Date.now(),
        startedAt: Date.now(),
      },
    ]);

    render(<TaskCenter />);

    expect((await screen.findAllByText("Running implementation")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "看板视图" }));

    expect(
      await screen.findByRole("heading", { name: "执行中" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Running implementation").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect((await screen.findAllByText("Running implementation")).length).toBeGreaterThan(0);
  });

  it("shows restart recovery and cleans up inactive managed worktrees after confirmation", async () => {
    listTaskCenterTasks.mockResolvedValue([
      {
        id: "task-recovered",
        title: "Recovered task",
        prompt: "This was running before restart.",
        runtimeId: "codex-local",
        mode: "analysis",
        timeoutMs: 300000,
        status: "failed",
        createdAt: Date.now(),
        error: "The desktop restarted before this task completed.",
        recovery: {
          reason: "desktop_restarted",
          message:
            "The desktop restarted before this task completed. Inspect the runtime output before retrying.",
          at: Date.now(),
        },
      },
    ]);
    listTaskCenterWorktrees.mockResolvedValue([
      {
        path: "C:\\Users\\me\\AppData\\Local\\hermes\\desktop\\worktrees\\claude-code\\task-old",
        runtimeKind: "claude-code",
        exists: true,
        updatedAt: Date.now(),
        active: false,
        taskTitle: "Old implementation",
        taskStatus: "accepted",
      },
    ]);

    render(<TaskCenter />);

    expect((await screen.findAllByText("Recovered task")).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/desktop restarted before this task completed/i)
        .length,
    ).toBeGreaterThan(0);
    await screen.findByText("隔离工作树");
    expect(screen.getByText("claude-code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /删除工作树/ }));
    await waitFor(() =>
      expect(removeTaskCenterWorktree).toHaveBeenCalledWith(
        expect.stringContaining("task-old"),
      ),
    );
    expect(window.confirm).toHaveBeenCalled();
  });
});
