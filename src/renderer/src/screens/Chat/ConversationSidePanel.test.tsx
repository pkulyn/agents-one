import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationSidePanel } from "./ConversationSidePanel";

describe("ConversationSidePanel", () => {
  const listConversationTasks = vi.fn();
  const createTaskCenterTask = vi.fn();
  const linkConversationTask = vi.fn();
  const listProjectControlProjects = vi.fn();
  const listTaskCenterTasks = vi.fn();
  const openTaskCenterWorktree = vi.fn();
  const getTaskCollaboration = vi.fn();
  const listAgentRuntimes = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listConversationTasks.mockResolvedValue([]);
    listProjectControlProjects.mockResolvedValue([]);
    listTaskCenterTasks.mockResolvedValue([]);
    createTaskCenterTask.mockResolvedValue({ id: "task-1" });
    linkConversationTask.mockResolvedValue({
      conversationId: "conversation-1",
      taskId: "task-1",
      createdAt: Date.now(),
    });
    openTaskCenterWorktree.mockResolvedValue(true);
    getTaskCollaboration.mockResolvedValue(null);
    listAgentRuntimes.mockResolvedValue([]);
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        listConversationTasks,
        listProjectControlProjects,
        listTaskCenterTasks,
        createTaskCenterTask,
        linkConversationTask,
        openTaskCenterWorktree,
        getTaskCollaboration,
        listAgentRuntimes,
      },
    });
  });

  it("shows explicit collaboration assignments without creating or dispatching tasks", async () => {
    getTaskCollaboration.mockResolvedValue({
      taskId: "conversation-1",
      title: "整理项目文档",
      assignments: [
        { role: "coordinator", runtimeId: "hermes" },
        { role: "implementer", runtimeId: "codex" },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    listAgentRuntimes.mockResolvedValue([
      { id: "hermes", name: "Hermes" },
      { id: "codex", name: "Codex" },
    ]);

    render(
      <ConversationSidePanel
        agentName="Hermes"
        conversationId="conversation-1"
        runtimeId="hermes"
        prompt="整理项目文档"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("协作分工")).toBeInTheDocument();
    expect(screen.getByText("协调者")).toBeInTheDocument();
    expect(screen.getAllByText("Hermes").length).toBeGreaterThan(0);
    expect(screen.getByText("实施")).toBeInTheDocument();
    expect(screen.getAllByText("Codex").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "打开协作看板" })).toBeInTheDocument();
    expect(createTaskCenterTask).not.toHaveBeenCalled();
  });

  it("creates and persists a Task Center task from the latest conversation request", async () => {
    render(
      <ConversationSidePanel
        agentName="Codex"
        conversationId="conversation-1"
        runtimeId="codex-local"
        prompt="Add a focused regression test"
        workspace="D:/repo"
        onClose={vi.fn()}
      />,
    );

    await screen.findByText("这段对话尚未关联任务。创建任务后，这里会显示计划、进展和验收状态。");
    fireEvent.click(screen.getByRole("button", { name: "从对话创建任务" }));

    await waitFor(() =>
      expect(createTaskCenterTask).toHaveBeenCalledWith({
        title: "Codex 对话任务",
        prompt: "Add a focused regression test",
        runtimeId: "codex-local",
        mode: "analysis",
        workspace: "D:/repo",
      }),
    );
    expect(linkConversationTask).toHaveBeenCalledWith("conversation-1", "task-1");
    expect(listConversationTasks).toHaveBeenCalledTimes(2);
  });

  it("shows persisted task status and acceptance", async () => {
    listConversationTasks.mockResolvedValue([
      {
        id: "task-accepted",
        title: "Review the implementation",
        prompt: "Review the implementation",
        runtimeId: "codex-local",
        mode: "implementation",
        timeoutMs: 300_000,
        status: "review_required",
        acceptance: "accepted",
        createdAt: Date.now(),
      },
    ]);

    render(
      <ConversationSidePanel
        agentName="Codex"
        conversationId="conversation-1"
        runtimeId="codex-local"
        prompt="Review the implementation"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Review the implementation")).toBeInTheDocument();
    expect(screen.getByText("待验收")).toBeInTheDocument();
    expect(screen.getByText("验收：已通过")).toBeInTheDocument();
  });

  it("shows the final response instead of raw structured runtime logs", async () => {
    render(
      <ConversationSidePanel
        agentName="Codex"
        conversationId="conversation-1"
        runtimeId="codex-local"
        prompt="Run a safe check"
        runtimeRun={{
          id: "run-1",
          runtimeId: "codex-local",
          status: "succeeded",
          startedAt: Date.now(),
          output: [
            "Reading additional input from stdin...",
            JSON.stringify({ type: "error", message: "request timed out" }),
            JSON.stringify({
              type: "item.completed",
              item: {
                type: "agent_message",
                text: "Codex 对话界面验收通过。",
              },
            }),
          ].join("\n"),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Codex 对话界面验收通过。")).toBeInTheDocument();
    expect(screen.queryByText(/Reading additional input/)).not.toBeInTheDocument();
    expect(screen.queryByText(/request timed out/)).not.toBeInTheDocument();
  });

  it("previews final artifacts and opens isolated worktrees", async () => {
    render(
      <ConversationSidePanel
        agentName="Claude Code"
        conversationId="conversation-1"
        runtimeId="claude-local"
        prompt="Inspect the project"
        runtimeRun={{
          id: "run-artifacts",
          runtimeId: "claude-local",
          status: "succeeded",
          startedAt: Date.now(),
          output: "artifact preview marker",
          artifacts: [
            {
              kind: "final",
              label: "最终答复",
              content: "artifact preview marker",
            },
            {
              kind: "worktree",
              label: "隔离工作树",
              path: "D:/Agents One/worktrees/task-1",
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("最终答复")).toBeInTheDocument();
    expect(screen.getAllByText("artifact preview marker").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "打开隔离工作树" }));
    expect(openTaskCenterWorktree).toHaveBeenCalledWith(
      "D:/Agents One/worktrees/task-1",
    );
  });

  it("previews a final answer from the native Hermes conversation", async () => {
    render(
      <ConversationSidePanel
        agentName="Hermes"
        conversationId="conversation-hermes"
        runtimeId="hermes-remote"
        prompt="Inspect the attachment"
        conversationArtifacts={[
          {
            kind: "final",
            label: "最终答复",
            content: "Hermes conversation artifact marker",
          },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("最终答复")).toBeInTheDocument();
    expect(screen.getByText("Hermes conversation artifact marker")).toBeInTheDocument();
  });

  it("shows projects linked to the current conversation", async () => {
    listProjectControlProjects.mockResolvedValue([
      {
        id: "project-1",
        title: "Agents One UI 验收",
        objective: "完成对话工作台验收",
        status: "active",
        coordinator: {
          kind: "human",
          assignedBy: "user",
          assignedAt: Date.now(),
        },
        conversations: [
          {
            id: "conversation-1",
            title: "UI 验收",
            runtimeId: "codex-local",
            runtimeName: "Codex",
            linkedAt: Date.now(),
          },
        ],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);

    render(
      <ConversationSidePanel
        agentName="Codex"
        conversationId="conversation-1"
        runtimeId="codex-local"
        prompt="Run a safe check"
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("Agents One UI 验收")).toBeInTheDocument();
    expect(screen.getByText("完成对话工作台验收")).toBeInTheDocument();
  });
});
