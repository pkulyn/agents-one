import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches an implementation task to the manually selected runtime", async () => {
    render(<TaskCenter />);
    await screen.findByRole("option", { name: /Local Codex/ });
    fireEvent.change(screen.getByLabelText("Mode"), {
      target: { value: "implementation" },
    });
    fireEvent.change(screen.getByLabelText("Task"), {
      target: { value: "Add a regression test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run task" }));

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
    expect(screen.getByText("Review artifacts")).toBeInTheDocument();
    expect(screen.getByText("docs/file.md | 2 ++")).toBeInTheDocument();
    expect(screen.getByText(/diff --git/)).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open isolated worktree" }));
    await waitFor(() =>
      expect(openTaskCenterWorktree).toHaveBeenCalledWith("C:\\worktrees\\task-review"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy diff" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("diff --git")),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject reviewed result" }));
    await waitFor(() =>
      expect(setTaskCenterAcceptance).toHaveBeenCalledWith("task-review", "rejected"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Accept reviewed result" }));
    await waitFor(() =>
      expect(setTaskCenterAcceptance).toHaveBeenCalledWith("task-review", "accepted"),
    );
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
          message: "The desktop restarted before this task completed. Inspect the runtime output before retrying.",
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

    await screen.findByText("Recovered task");
    expect(screen.getAllByText(/desktop restarted before this task completed/i).length).toBeGreaterThan(0);
    await screen.findByText("Managed worktrees");
    expect(screen.getByText("claude-code")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Remove worktree/ }));
    await waitFor(() =>
      expect(removeTaskCenterWorktree).toHaveBeenCalledWith(expect.stringContaining("task-old")),
    );
    expect(window.confirm).toHaveBeenCalled();
  });
});
