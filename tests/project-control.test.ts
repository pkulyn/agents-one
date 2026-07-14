import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const createTaskCenterTaskMock = vi.hoisted(() => vi.fn());
const listTaskCenterTasksMock = vi.hoisted(() => vi.fn(async () => []));
const cancelTaskCenterTaskMock = vi.hoisted(() => vi.fn(async () => null));
const setTaskCenterAcceptanceMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../src/main/task-center", () => ({
  createTaskCenterTask: createTaskCenterTaskMock,
  listTaskCenterTasks: listTaskCenterTasksMock,
  cancelTaskCenterTask: cancelTaskCenterTaskMock,
  setTaskCenterAcceptance: setTaskCenterAcceptanceMock,
}));

let testHome: string;

async function loadModules(): Promise<{
  runtimes: typeof import("../src/main/agent-runtimes");
  projects: typeof import("../src/main/project-control");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return {
    runtimes: await import("../src/main/agent-runtimes"),
    projects: await import("../src/main/project-control"),
  };
}

describe("project control plane", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-project-control-"));
    createTaskCenterTaskMock.mockReset();
    listTaskCenterTasksMock.mockReset();
    cancelTaskCenterTaskMock.mockReset();
    setTaskCenterAcceptanceMock.mockReset();
    listTaskCenterTasksMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists a user-selected coordinator without changing direct Task Center state", async () => {
    const { projects } = await loadModules();
    const project = projects.createProject({
      title: "Runtime collaboration",
      objective: "Coordinate a safe implementation and review.",
      coordinator: { kind: "human" },
    });

    expect(project).toMatchObject({ status: "active", coordinator: { kind: "human" } });
    expect(projects.listProjects()).toEqual([expect.objectContaining({ id: project.id })]);
    expect(projects.listProjectEvents(project.id)).toEqual([
      expect.objectContaining({ type: "project_created", actor: { kind: "user" } }),
    ]);
    const paused = projects.setProjectStatus(project.id, "paused", "Paused while requirements are clarified.");
    expect(paused.status).toBe("paused");
    expect(() => projects.createProjectTask({
      projectId: project.id,
      title: "No task while paused",
      requirement: "R",
      acceptanceCriteria: "A",
    })).toThrow(/active project/i);
    const resumed = projects.setProjectStatus(project.id, "active", "Requirements clarified.");
    expect(resumed.status).toBe("active");
  });

  it("unblocks dependencies, validates assignments, and creates a minimal context package", async () => {
    const { runtimes, projects } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-test",
      name: "Codex test",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const project = projects.createProject({
      title: "Dependency project",
      objective: "Validate controlled handoff.",
      coordinator: { kind: "runtime", runtimeId: "codex-test" },
    });
    const first = projects.createProjectTask({
      projectId: project.id,
      title: "Investigate",
      requirement: "Inspect the repository.",
      acceptanceCriteria: "A short review is available.",
    });
    const dependent = projects.createProjectTask({
      projectId: project.id,
      title: "Implement",
      requirement: "Make the isolated change.",
      acceptanceCriteria: "A diff is available for review.",
      dependencies: [first.id],
    });
    expect(dependent.status).toBe("blocked");

    projects.assignProjectTask({
      taskId: first.id,
      runtimeId: "codex-test",
      role: "implementer",
      mode: "analysis",
      workspace: testHome,
    });
    projects.setProjectTaskStatus(first.id, "running", "Runtime started.");
    projects.setProjectTaskStatus(first.id, "accepted", "Review accepted.");

    const assigned = projects.assignProjectTask({
      taskId: dependent.id,
      runtimeId: "codex-test",
      role: "implementer",
      mode: "implementation",
      workspace: testHome,
    });
    expect(assigned).toMatchObject({ status: "queued", assignment: { runtimeId: "codex-test", mode: "implementation" } });

    const context = projects.createProjectContextPackage(dependent.id);
    expect(context).toMatchObject({ taskId: dependent.id, version: 1, upstreamSummaries: expect.any(Array) });
    await expect(projects.listProjectTasks(project.id)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: dependent.id, contextPackageId: context.id })]),
    );
  });

  it("rejects cross-project dependencies and implementation assignment to non-coding runtimes", async () => {
    const { runtimes, projects } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "openclaw-test",
      name: "OpenClaw test",
      kind: "openclaw",
      location: "remote",
      enabled: true,
      config: { endpoint: "https://openclaw.example/bridge", transport: "http" },
    });
    const left = projects.createProject({ title: "Left", objective: "Left objective", coordinator: { kind: "human" } });
    const right = projects.createProject({ title: "Right", objective: "Right objective", coordinator: { kind: "human" } });
    const foreign = projects.createProjectTask({ projectId: left.id, title: "Foreign", requirement: "R", acceptanceCriteria: "A" });
    await expect(() => projects.createProjectTask({
      projectId: right.id,
      title: "Invalid dependency",
      requirement: "R",
      acceptanceCriteria: "A",
      dependencies: [foreign.id],
    })).toThrow(/same project/i);
    const task = projects.createProjectTask({ projectId: right.id, title: "Analysis", requirement: "R", acceptanceCriteria: "A" });
    expect(() => projects.assignProjectTask({
      taskId: task.id,
      runtimeId: "openclaw-test",
      role: "implementer",
      mode: "implementation",
    })).toThrow(/Codex or Claude Code/i);
  });

  it("dispatches through Task Center and archives only artifact references", async () => {
    const { runtimes, projects } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-dispatch",
      name: "Codex dispatch",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const project = projects.createProject({ title: "Dispatch", objective: "Verify Task Center delegation.", coordinator: { kind: "human" } });
    const task = projects.createProjectTask({ projectId: project.id, title: "Review", requirement: "Inspect safely.", acceptanceCriteria: "Return a summary." });
    projects.assignProjectTask({ taskId: task.id, runtimeId: "codex-dispatch", role: "reviewer", mode: "analysis" });
    createTaskCenterTaskMock.mockResolvedValue({
      id: "direct-1",
      runtimeId: "codex-dispatch",
      status: "review_required",
      artifacts: [{ kind: "diff", label: "Git diff", content: "must-not-be-copied" }],
    });

    const dispatched = await projects.dispatchProjectTask(task.id);
    expect(createTaskCenterTaskMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeId: "codex-dispatch", prompt: expect.stringContaining("Acceptance criteria") }));
    expect(dispatched).toMatchObject({ status: "review_required", directTaskCenterTaskId: "direct-1" });
    expect(projects.listProjectArtifacts(project.id)).toEqual([
      expect.objectContaining({ label: "Git diff" }),
    ]);
    const context = projects.createProjectContextPackage(task.id);
    expect(context.artifacts).toEqual([]);
    expect(JSON.stringify(projects.listProjectArtifacts(project.id))).not.toContain("must-not-be-copied");
  });

  it("runs only a constrained local Runtime coordinator as an auditable planning task", async () => {
    const { runtimes, projects } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-manager",
      name: "Codex manager",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const project = projects.createProject({
      title: "Plan safely",
      objective: "Produce a staged plan before assigning implementation work.",
      coordinator: { kind: "runtime", runtimeId: "codex-manager" },
    });
    createTaskCenterTaskMock.mockResolvedValue({
      id: "manager-run",
      runtimeId: "codex-manager",
      status: "running",
      artifacts: [],
    });

    const plan = await projects.startCoordinatorPlanningTask(project.id);
    expect(plan).toMatchObject({
      title: "Coordinator plan: Plan safely",
      status: "running",
      assignment: { runtimeId: "codex-manager", role: "manager", mode: "analysis" },
    });
    expect(createTaskCenterTaskMock).toHaveBeenCalledWith(expect.objectContaining({
      runtimeId: "codex-manager",
      mode: "analysis",
      prompt: expect.stringContaining("Do not execute changes"),
    }));

    runtimes.saveAgentRuntime({
      id: "hermes-manager",
      name: "Hermes manager",
      kind: "hermes",
      location: "remote",
      enabled: true,
      config: { endpoint: "https://hermes.example", transport: "http" },
    });
    const remoteProject = projects.createProject({
      title: "Remote plan",
      objective: "Remote planning must not depend on a prompt-only boundary.",
      coordinator: { kind: "runtime", runtimeId: "hermes-manager" },
    });
    createTaskCenterTaskMock.mockResolvedValue({
      id: "remote-manager-run",
      runtimeId: "hermes-manager",
      status: "review_required",
      artifacts: [{ kind: "final", label: "Coordinator plan", content: "plan" }],
    });
    await expect(projects.startCoordinatorPlanningTask(remoteProject.id)).resolves.toMatchObject({
      title: "Coordinator plan: Remote plan",
      status: "review_required",
      assignment: { runtimeId: "hermes-manager", role: "manager", mode: "analysis" },
    });
    expect(createTaskCenterTaskMock).toHaveBeenLastCalledWith(expect.objectContaining({
      runtimeId: "hermes-manager",
      coordinatorPlan: expect.objectContaining({
        projectId: remoteProject.id,
        title: "Remote plan",
      }),
    }));
  });

  it("writes review and cancellation decisions through the Task Center boundary", async () => {
    const { runtimes, projects } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-review",
      name: "Codex review",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { transport: "cli", workspace: testHome },
    });
    const project = projects.createProject({ title: "Review project", objective: "Keep decisions auditable.", coordinator: { kind: "human" } });
    const task = projects.createProjectTask({ projectId: project.id, title: "Review me", requirement: "R", acceptanceCriteria: "A" });
    projects.assignProjectTask({ taskId: task.id, runtimeId: "codex-review", role: "reviewer", mode: "analysis" });
    createTaskCenterTaskMock.mockResolvedValue({ id: "review-run", runtimeId: "codex-review", status: "review_required", artifacts: [] });
    const dispatched = await projects.dispatchProjectTask(task.id);
    listTaskCenterTasksMock.mockResolvedValue([{ id: "review-run", runtimeId: "codex-review", status: "review_required", acceptance: "accepted" }]);

    const accepted = await projects.reviewProjectTask(dispatched.id, "accepted", "Human acceptance recorded.");
    expect(accepted.status).toBe("accepted");
    expect(projects.listProjectEvents(project.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "acceptance", summary: "Human acceptance recorded." }),
    ]));

    const second = projects.createProjectTask({ projectId: project.id, title: "Cancel me", requirement: "R", acceptanceCriteria: "A" });
    projects.assignProjectTask({ taskId: second.id, runtimeId: "codex-review", role: "reviewer", mode: "analysis" });
    createTaskCenterTaskMock.mockResolvedValue({ id: "cancel-run", runtimeId: "codex-review", status: "running", artifacts: [] });
    const running = await projects.dispatchProjectTask(second.id);
    listTaskCenterTasksMock.mockResolvedValue([{ id: "cancel-run", runtimeId: "codex-review", status: "cancelled", artifacts: [] }]);
    const cancelled = await projects.cancelProjectTask(running.id);
    expect(cancelled.status).toBe("cancelled");
  });
});
