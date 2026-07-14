import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectCenter from "./ProjectCenter";

describe("ProjectCenter", () => {
  const listProjectControlProjects = vi.fn();
  const listAgentRuntimes = vi.fn();
  const listProjectControlTasks = vi.fn();
  const listProjectControlEvents = vi.fn();
  const listProjectControlArtifacts = vi.fn();
  const startProjectCoordinatorPlan = vi.fn();
  const reviewProjectControlTask = vi.fn();
  const createProjectControlContext = vi.fn();

  beforeEach(() => {
    listProjectControlProjects.mockResolvedValue([{
      id: "project-1",
      title: "Runtime collaboration",
      objective: "Plan safely and require human acceptance.",
      status: "active",
      coordinator: { kind: "runtime", runtimeId: "codex-local", assignedBy: "user", assignedAt: 1 },
      createdAt: 1,
      updatedAt: 1,
    }]);
    listAgentRuntimes.mockResolvedValue([{
      id: "codex-local",
      name: "Local Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      managed: "user",
      config: {},
    }]);
    listProjectControlTasks.mockResolvedValue([{
      id: "task-1",
      projectId: "project-1",
      title: "Coordinator plan",
      requirement: "Propose a plan.",
      acceptanceCriteria: "Reviewed plan.",
      status: "review_required",
      dependencies: [],
      assignment: { runtimeId: "codex-local", role: "manager", requestedBy: "user", assignedAt: 1, mode: "analysis" },
      createdAt: 1,
      updatedAt: 1,
    }]);
    listProjectControlEvents.mockResolvedValue([]);
    listProjectControlArtifacts.mockResolvedValue([]);
    startProjectCoordinatorPlan.mockResolvedValue({ id: "task-plan" });
    reviewProjectControlTask.mockResolvedValue({ id: "task-1", status: "accepted" });
    createProjectControlContext.mockResolvedValue({ id: "context-1", version: 1, artifacts: [], upstreamSummaries: [] });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProjectControlProjects,
        listAgentRuntimes,
        listProjectControlTasks,
        listProjectControlEvents,
        listProjectControlArtifacts,
        startProjectCoordinatorPlan,
        reviewProjectControlTask,
        createProjectControlContext,
        createProjectControlProject: vi.fn(),
        createProjectControlTask: vi.fn(),
        assignProjectControlTask: vi.fn(),
        dispatchProjectControlTask: vi.fn(),
        cancelProjectControlTask: vi.fn(),
        setProjectControlTaskStatus: vi.fn(),
      },
    });
  });

  it("starts an auditable coordinator planning task and records an explicit review", async () => {
    render(<ProjectCenter />);
    await screen.findByRole("button", { name: /Runtime collaboration/ });

    fireEvent.click(screen.getByRole("button", { name: "Plan" }));
    await waitFor(() => expect(startProjectCoordinatorPlan).toHaveBeenCalledWith("project-1"));

    fireEvent.change(screen.getByLabelText("Review record"), { target: { value: "Plan is approved for implementation." } });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(reviewProjectControlTask).toHaveBeenCalledWith(
      "task-1",
      "accepted",
      "Plan is approved for implementation.",
    ));
  });
});
