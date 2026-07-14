import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TaskCenter from "./TaskCenter";

describe("TaskCenter", () => {
  const listAgentRuntimes = vi.fn();
  const listTaskCenterTasks = vi.fn();
  const createTaskCenterTask = vi.fn();

  beforeEach(() => {
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
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listAgentRuntimes,
        listTaskCenterTasks,
        createTaskCenterTask,
        cancelTaskCenterTask: vi.fn(),
        setTaskCenterAcceptance: vi.fn(),
        openTaskCenterWorktree: vi.fn(),
      },
    });
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
});
