import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectCenter from "./ProjectCenter";

describe("ProjectCenter", () => {
  const listProjectControlProjects = vi.fn();
  const listAgentRuntimes = vi.fn();
  const listProjectControlTasks = vi.fn();
  const listProjectControlEvents = vi.fn();
  const listProjectControlArtifacts = vi.fn();
  const listRuntimeConversations = vi.fn();
  const startProjectCoordinatorPlan = vi.fn();
  const reviewProjectControlTask = vi.fn();
  const createProjectControlContext = vi.fn();
  const previewProjectPlanTasks = vi.fn();
  const createProjectTasksFromPlan = vi.fn();
  const assignProjectControlTask = vi.fn();
  const updateProjectControlScope = vi.fn();
  const updateProjectControlCollaborators = vi.fn();

  async function openTasksView(): Promise<void> {
    fireEvent.click(await screen.findByRole("tab", { name: /^任务/ }));
  }

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
    listRuntimeConversations.mockResolvedValue([]);
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
        listRuntimeConversations,
        startProjectCoordinatorPlan,
        previewProjectPlanTasks,
        createProjectTasksFromPlan,
        reviewProjectControlTask,
        createProjectControlContext,
        createProjectControlProject: vi.fn(),
        createProjectControlTask: vi.fn(),
        assignProjectControlTask,
        updateProjectControlScope,
        updateProjectControlCollaborators,
        selectFolder: vi.fn(),
        dispatchProjectControlTask: vi.fn(),
        cancelProjectControlTask: vi.fn(),
        setProjectControlTaskStatus: vi.fn(),
      },
    });
  });

  it("starts an auditable coordinator planning task and records an explicit review", async () => {
    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });
    await openTasksView();

    fireEvent.click(screen.getByRole("button", { name: "生成计划" }));
    await waitFor(() => expect(startProjectCoordinatorPlan).toHaveBeenCalledWith("project-1"));

    fireEvent.change(screen.getByLabelText("验收记录"), { target: { value: "Plan is approved for implementation." } });
    fireEvent.click(screen.getByRole("button", { name: "通过" }));
    await waitFor(() => expect(reviewProjectControlTask).toHaveBeenCalledWith(
      "task-1",
      "accepted",
      "Plan is approved for implementation.",
    ));
  });

  it("previews coordinator plan task drafts before creating project tasks", async () => {
    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });
    await openTasksView();

    fireEvent.click(screen.getByRole("button", { name: "预览子任务" }));
    await screen.findByText("Implement adapter");
    expect(previewProjectPlanTasks).toHaveBeenCalledWith("project-1", "task-1");

    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(createProjectTasksFromPlan).toHaveBeenCalledWith({
      projectId: "project-1",
      sourceTaskId: "task-1",
      tasks: [expect.objectContaining({ title: "Implement adapter", suggestedRuntimeKind: "codex" })],
    }));
  });

  it("prefills assignment controls from coordinator Runtime suggestions", async () => {
    listProjectControlProjects.mockResolvedValue([{
      id: "project-1",
      title: "Runtime collaboration",
      objective: "Plan safely and require human acceptance.",
      status: "active",
      coordinator: { kind: "human", assignedBy: "user", assignedAt: 1 },
      collaborators: [
        { role: "manager", kind: "human", assignedAt: 1 },
        { role: "implementer", kind: "runtime", runtimeId: "codex-local", assignedAt: 1 },
      ],
      createdAt: 1,
      updatedAt: 1,
    }]);
    listAgentRuntimes.mockResolvedValue([
      {
        id: "hermes-remote",
        name: "Remote Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {},
      },
      {
        id: "codex-local",
        name: "Local Codex",
        kind: "codex",
        location: "local",
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
    await screen.findByRole("combobox", { name: "当前项目" });
    await openTasksView();
    await screen.findByRole("button", { name: /Implement adapter/ });

    expect(screen.getByText("建议：codex / 实施 / 实现")).toBeInTheDocument();
    await waitFor(() => expect((screen.getByLabelText("执行智能体") as HTMLSelectElement).value).toBe("codex-local"));
    expect((screen.getByLabelText("角色") as HTMLSelectElement).value).toBe("implementer");
    expect((screen.getByLabelText("执行方式") as HTMLSelectElement).value).toBe("implementation");

    fireEvent.click(screen.getByRole("button", { name: "分配" }));
    await waitFor(() => expect(assignProjectControlTask).toHaveBeenCalledWith({
      taskId: "task-2",
      runtimeId: "codex-local",
      role: "implementer",
      mode: "implementation",
    }));
  });

  it("stores explicit project resources and forwards the selected workspace only to the assigned task", async () => {
    listRuntimeConversations.mockResolvedValue([{
      id: "conversation-1",
      title: "Implementation discussion",
      runtimeId: "codex-local",
      runtimeName: "Local Codex",
      runtimeKind: "codex",
      runtimeLocation: "local",
      createdAt: 1,
      updatedAt: 1,
      messageCount: 2,
    }]);
    listProjectControlProjects.mockResolvedValue([{
      id: "project-1",
      title: "Runtime collaboration",
      objective: "Plan safely and require human acceptance.",
      status: "active",
      workspace: "D:\\repo",
      coordinator: { kind: "runtime", runtimeId: "codex-local", assignedBy: "user", assignedAt: 1 },
      createdAt: 1,
      updatedAt: 1,
    }]);
    listProjectControlTasks.mockResolvedValue([{
      id: "task-2",
      projectId: "project-1",
      title: "Implement adapter",
      requirement: "Build the adapter safely.",
      acceptanceCriteria: "Tests pass.",
      status: "ready",
      dependencies: [],
      createdAt: 1,
      updatedAt: 1,
    }]);

    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });

    const conversationSelect = screen.getByLabelText("关联对话") as HTMLSelectElement;
    conversationSelect.options[0].selected = true;
    fireEvent.change(conversationSelect);
    fireEvent.click(screen.getByRole("button", { name: "保存项目资源" }));
    await waitFor(() => expect(updateProjectControlScope).toHaveBeenCalledWith({
      projectId: "project-1",
      workspace: "D:\\repo",
      conversationIds: ["conversation-1"],
    }));

    await openTasksView();
    fireEvent.change(screen.getByLabelText("执行智能体"), {
      target: { value: "codex-local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "分配" }));
    await waitFor(() => expect(assignProjectControlTask).toHaveBeenCalledWith({
      taskId: "task-2",
      runtimeId: "codex-local",
      role: "implementer",
      mode: "analysis",
      workspace: "D:\\repo",
    }));
  });

  it("opens Task Center from a project task that has a dispatched run", async () => {
    const listener = vi.fn();
    window.addEventListener("navigation:goto", listener);
    try {
      render(<ProjectCenter />);
      await screen.findByRole("combobox", { name: "当前项目" });
      await openTasksView();

      fireEvent.click(screen.getByRole("button", { name: "在任务中心查看" }));
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        detail: {
          view: "tasks",
          taskId: "direct-plan",
        },
      }));
    } finally {
      window.removeEventListener("navigation:goto", listener);
    }
  });

  it("saves explicit project collaboration roles without dispatching any task", async () => {
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
        id: "openclaw-remote",
        name: "Remote OpenClaw",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {},
      },
    ]);
    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });

    fireEvent.change(screen.getByLabelText("项目经理协作者"), { target: { value: "openclaw-remote" } });
    fireEvent.change(screen.getByLabelText("实施协作者"), { target: { value: "codex-local" } });
    fireEvent.click(screen.getByRole("button", { name: "保存协作组" }));

    await waitFor(() => expect(updateProjectControlCollaborators).toHaveBeenCalledWith({
      projectId: "project-1",
      collaborators: expect.arrayContaining([
        expect.objectContaining({ role: "manager", kind: "runtime", runtimeId: "openclaw-remote" }),
        expect.objectContaining({ role: "implementer", kind: "runtime", runtimeId: "codex-local" }),
      ]),
    }));
    expect(assignProjectControlTask).not.toHaveBeenCalled();
  });

  it("opens with a compact overview and separates tasks, artifacts, and activity", async () => {
    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });

    expect(screen.queryByLabelText("项目列表")).toBeNull();
    expect(screen.getByLabelText("项目摘要")).toBeInTheDocument();
    expect(screen.queryByLabelText("执行智能体")).toBeNull();

    await openTasksView();
    expect(screen.getByLabelText("执行智能体")).toBeInTheDocument();
    expect(screen.queryByLabelText("任务标题")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "添加任务" }));
    expect(screen.getByLabelText("任务标题")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^产物/ }));
    expect(screen.getByText("尚未发布任务产物。")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /^活动/ }));
    expect(screen.getByText("暂无项目活动。")).toBeInTheDocument();
  });

  it("renders internal project event types as readable Chinese labels", async () => {
    listProjectControlEvents.mockResolvedValue([
      {
        id: "event-1",
        projectId: "project-1",
        type: "tool_result",
        actor: { kind: "runtime", runtimeId: "codex-local" },
        summary: "Codex completed a tool call.",
        createdAt: 1,
      },
      {
        id: "event-2",
        projectId: "project-1",
        type: "project_created",
        actor: { kind: "user" },
        summary: "Project created with human coordinator.",
        createdAt: 2,
      },
    ]);
    render(<ProjectCenter />);
    await screen.findByRole("combobox", { name: "当前项目" });

    fireEvent.click(screen.getByRole("tab", { name: /^活动/ }));
    expect(await screen.findByText("工具结果")).toBeInTheDocument();
    expect(screen.queryByText("tool_result")).toBeNull();
    expect(await screen.findByText("项目已创建，协调者为人工。")).toBeInTheDocument();
    expect(screen.queryByText("Project created with human coordinator.")).toBeNull();
  });
});
