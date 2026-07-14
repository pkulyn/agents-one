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
  const previewProjectPlanTasks = vi.fn();
  const createProjectTasksFromPlan = vi.fn();
  const assignProjectControlTask = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
      directTaskCenterTaskId: "direct-plan",
      createdAt: 1,
      updatedAt: 1,
    }]);
    listProjectControlEvents.mockResolvedValue([]);
    listProjectControlArtifacts.mockResolvedValue([]);
    startProjectCoordinatorPlan.mockResolvedValue({ id: "task-plan" });
    reviewProjectControlTask.mockResolvedValue({ id: "task-1", status: "accepted" });
    createProjectControlContext.mockResolvedValue({ id: "context-1", version: 1, artifacts: [], upstreamSummaries: [] });
    previewProjectPlanTasks.mockResolvedValue({
      projectId: "project-1",
      sourceTaskId: "task-1",
      sourceTaskCenterTaskId: "direct-plan",
      warnings: [],
      tasks: [{
        title: "Implement adapter",
        requirement: "Build the adapter safely.",
        acceptanceCriteria: "Tests pass.",
        suggestedRuntimeKind: "codex",
        role: "implementer",
        mode: "implementation",
      }],
    });
    createProjectTasksFromPlan.mockResolvedValue([{ id: "task-2", title: "Implement adapter" }]);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listProjectControlProjects,
        listAgentRuntimes,
        listProjectControlTasks,
        listProjectControlEvents,
        listProjectControlArtifacts,
        startProjectCoordinatorPlan,
        previewProjectPlanTasks,
        createProjectTasksFromPlan,
        reviewProjectControlTask,
        createProjectControlContext,
        createProjectControlProject: vi.fn(),
        createProjectControlTask: vi.fn(),
        assignProjectControlTask,
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

  it("previews coordinator plan task drafts before creating project tasks", async () => {
    render(<ProjectCenter />);
    await screen.findByRole("button", { name: /Runtime collaboration/ });

    fireEvent.click(screen.getByRole("button", { name: "Preview tasks" }));
    await screen.findByText("Implement adapter");
    expect(previewProjectPlanTasks).toHaveBeenCalledWith("project-1", "task-1");

    fireEvent.click(screen.getByRole("button", { name: "Create tasks" }));
    await waitFor(() => expect(createProjectTasksFromPlan).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceTaskId: "task-1",
      tasks: [expect.objectContaining({ title: "Implement adapter", suggestedRuntimeKind: "codex" })],
    }));
  });

  it("prefills assignment controls from coordinator Runtime suggestions", async () => {
    listAgentRuntimes.mockResolvedValue([
      {
        id: "codex-local",
        name: "Local Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: {},
      },
      {
        id: "hermes-remote",
        name: "Remote Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {},
      },
    ]);
    listProjectControlTasks.mockResolvedValue([{
      id: "task-2",
      projectId: "project-1",
      title: "Implement adapter",
      requirement: "Build the adapter safely.",
      acceptanceCriteria: "Tests pass.",
      status: "ready",
      dependencies: [],
      suggestedRuntimeKind: "codex",
      suggestedRole: "implementer",
      suggestedMode: "implementation",
      createdAt: 1,
      updatedAt: 1,
    }]);

    render(<ProjectCenter />);
    await screen.findByRole("button", { name: /Implement adapter/ });

    expect(screen.getByText("Suggested: codex / implementer / implementation")).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText("Runtime") as HTMLSelectElement).value).toBe("codex-local"));
    expect((screen.getByLabelText("Role") as HTMLSelectElement).value).toBe("implementer");
    expect((screen.getByLabelText("Mode") as HTMLSelectElement).value).toBe("implementation");

    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(assignProjectControlTask).toHaveBeenCalledWith({
      taskId: "task-2",
      runtimeId: "codex-local",
      role: "implementer",
      mode: "implementation",
    }));
  });
});
