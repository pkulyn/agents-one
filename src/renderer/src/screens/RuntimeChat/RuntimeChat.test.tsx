import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../../shared/attachments";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        "chat.emptyTitle": "今天我可以帮你做什么？",
        "chat.emptyHint": "你可以让我写代码、回答问题、搜索网页等",
        "chat.setContextFolder": "选择项目目录",
        "chat.contextFolderActive": "当前项目目录",
        "chat.removeContextFolder": "移除项目目录",
        "chat.showWorktree": "显示项目树",
        "chat.hideWorktree": "隐藏项目树",
      };
      return labels[key] ?? key;
    },
  }),
}));

const testAttachment: Attachment = {
  id: "attachment-1",
  kind: "text-file",
  name: "brief.txt",
  mime: "text/plain",
  size: 5,
  text: "hello",
};

vi.mock("../Chat/ChatInput", () => ({
  ChatInput: (props: {
    attachmentsEnabled?: boolean;
    contextUsage?: { used: number; window: number } | null;
    toolbarExtras?: React.ReactNode;
    onSubmit: (text: string, attachments: Attachment[]) => void;
  }) => (
    <div
      data-testid="runtime-composer"
      data-attachments={String(props.attachmentsEnabled)}
    >
      {props.toolbarExtras}
      {props.contextUsage && (
        <span data-testid="runtime-context">
          {props.contextUsage.used}/{props.contextUsage.window}
        </span>
      )}
      <button
        type="button"
        onClick={() => props.onSubmit("检查输入", [testAttachment])}
      >
        发送测试输入
      </button>
    </div>
  ),
}));

import RuntimeChat from "./RuntimeChat";

const openClawRuntime: AgentRuntimeDefinition = {
  id: "openclaw-remote",
  name: "OpenClaw",
  kind: "openclaw",
  location: "remote",
  enabled: true,
  managed: "user",
  config: { transport: "http", endpoint: "https://example.test" },
};

const codexRuntime: AgentRuntimeDefinition = {
  id: "codex-local",
  name: "Codex",
  kind: "codex",
  location: "local",
  enabled: true,
  managed: "user",
  config: { transport: "cli", workspace: "D:\\default" },
};

const claudeRuntime: AgentRuntimeDefinition = {
  id: "claude-local",
  name: "Claude Code",
  kind: "claude-code",
  location: "local",
  enabled: true,
  managed: "user",
  config: { transport: "cli", workspace: "D:\\default" },
};

const piRuntime: AgentRuntimeDefinition = {
  id: "pi-local",
  name: "Pi",
  kind: "pi",
  location: "local",
  enabled: true,
  managed: "user",
  config: { transport: "cli", workspace: "D:\\default" },
};

const hers2Runtime: AgentRuntimeDefinition = {
  id: "hermes-home2",
  name: "Hers-2",
  kind: "hermes",
  location: "remote",
  enabled: true,
  managed: "user",
  config: {
    endpoint: "https://relay.example/agents-one/v1",
    remoteGateway: { protocol: "agents-one-v1" },
  },
};

describe("RuntimeChat inputs and persistence", () => {
  const probeAgentRuntime = vi.fn();
  const startAgentRuntimeTask = vi.fn();
  const getAgentRuntimeRun = vi.fn();
  const saveRuntimeConversation = vi.fn();
  const updateTaskCollaborationExecution = vi.fn();
  const getTaskCollaboration = vi.fn();
  const selectFolder = vi.fn();
  const listRecentSessionContextFolders = vi.fn();
  const prepareProjectContext = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    probeAgentRuntime.mockResolvedValue({
      runtimeId: "openclaw-remote",
      state: "healthy",
      checkedAt: Date.now(),
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: false,
        cancellation: true,
        tools: true,
        memory: false,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        workspaceAccess: false,
      },
    });
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-1",
      runtimeId: "openclaw-remote",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-1",
      runtimeId: "openclaw-remote",
      status: "succeeded",
      output: "输入已读取。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    saveRuntimeConversation.mockResolvedValue(undefined);
    updateTaskCollaborationExecution.mockResolvedValue(undefined);
    getTaskCollaboration.mockResolvedValue(null);
    selectFolder.mockResolvedValue("D:\\selected-project");
    listRecentSessionContextFolders.mockResolvedValue([]);
    prepareProjectContext.mockResolvedValue({
      id: "project-context",
      kind: "text-file",
      name: "project-project-context.txt",
      mime: "text/plain",
      size: 128,
      text: "Project context snapshot: project\n--- PROJECT FILE: README.md ---\n# Demo",
    });
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        probeAgentRuntime,
        startAgentRuntimeTask,
        getAgentRuntimeRun,
        saveRuntimeConversation,
        updateTaskCollaborationExecution,
        getTaskCollaboration,
        selectFolder,
        listRecentSessionContextFolders,
        prepareProjectContext,
        mediaFileExists: vi.fn().mockResolvedValue(false),
        cancelAgentRuntimeTask: vi.fn(),
      },
    });
  });

  it("enables controlled OpenClaw attachments after probing artifact support", async () => {
    render(
      <RuntimeChat
        runId="chat-openclaw"
        runtime={openClawRuntime}
        profile="default"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments",
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "openclaw-remote",
        expect.objectContaining({
          prompt: "检查输入",
          mode: "analysis",
          attachments: [testAttachment],
        }),
      ),
    );
    await screen.findByText("输入已读取。");
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeId: "openclaw-remote",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "检查输入" }),
          expect.objectContaining({ role: "agent", content: "输入已读取。" }),
        ]),
      }),
    );
  });

  it("sends recent conversation context with an OpenClaw follow-up", async () => {
    render(
      <RuntimeChat
        runId="chat-openclaw-follow-up"
        runtime={openClawRuntime}
        profile="default"
        initialMessages={[
          {
            id: "user-previous",
            role: "user",
            content: "先检查项目结构",
            createdAt: 1,
          },
          {
            id: "agent-previous",
            role: "agent",
            content: "已读取项目结构。",
            createdAt: 2,
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments",
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "openclaw-remote",
        expect.objectContaining({
          prompt: expect.stringContaining("用户：先检查项目结构"),
          sessionId: undefined,
          conversation: true,
        }),
      ),
    );
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "智能体：已读取项目结构。",
    );
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "当前用户消息：检查输入",
    );
  });

  it("passes an explicitly selected project directory to local Codex", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-codex",
      runtimeId: "codex-local",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-codex",
      runtimeId: "codex-local",
      status: "succeeded",
      output: "项目已读取。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="chat-codex"
        runtime={codexRuntime}
        profile="default"
      />,
    );

    expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
      "data-attachments",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "default" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(selectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "codex-local",
        expect.objectContaining({
          workspace: "D:\\selected-project",
          attachments: [testAttachment],
        }),
      ),
    );
    await screen.findByText("项目已读取。");
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeId: "codex-local",
        workspace: "D:\\selected-project",
      }),
    );
  });

  it("starts a full-access run after the user chooses the permission", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-codex-full-access",
      runtimeId: "codex-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-codex-full-access",
      runtimeId: "codex-local",
      status: "succeeded",
      output: "已在项目目录完成更新。",
      startedAt: Date.now(),
      events: [
        {
          id: "event-tool",
          type: "tool_call",
          summary: "Codex 正在调用 bash。",
          createdAt: Date.now(),
        },
        {
          id: "event-completed",
          type: "completed",
          summary: "Codex 已完成本轮任务。",
          createdAt: Date.now(),
        },
      ],
    });
    render(
      <RuntimeChat
        runId="chat-codex-implementation"
        runtime={codexRuntime}
        profile="default"
      />,
    );

    const confirm = vi.spyOn(window, "confirm");
    fireEvent.click(screen.getByRole("button", { name: "管理本轮任务权限" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "codex-local",
        expect.objectContaining({
          mode: "full_access",
          fullAccessConfirmed: true,
          workspace: "D:\\default",
        }),
      ),
    );
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getAllByText("Terminal").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Codex 正在调用 bash。").length).toBeGreaterThan(
      0,
    );
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "agent",
            content: "已在项目目录完成更新。",
            execution: expect.objectContaining({
              runId: "run-codex-full-access",
              events: expect.arrayContaining([
                expect.objectContaining({
                  type: "tool_call",
                  summary: "Codex 正在调用 bash。",
                }),
              ]),
            }),
          }),
        ]),
      }),
    );
  });

  it("renders Gateway model and context metadata after the run completes", async () => {
    probeAgentRuntime.mockResolvedValueOnce({
      runtimeId: "hermes-home2",
      state: "healthy",
      checkedAt: Date.now(),
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: true,
        cancellation: true,
        tools: true,
        memory: true,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        artifactUpload: true,
        workspaceAccess: false,
      },
    });
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "run-hers-2",
      runtimeId: "hermes-home2",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValueOnce({
      id: "run-hers-2",
      runtimeId: "hermes-home2",
      status: "succeeded",
      output: "Hers-2 已完成。",
      startedAt: Date.now(),
      model: { provider: "ark", id: "glm-5.2", contextWindowTokens: 1_000_000 },
      usage: {
        inputTokens: 120,
        contextUsedTokens: 9_000,
        contextWindowTokens: 1_000_000,
      },
    });

    render(
      <RuntimeChat
        runId="chat-hers-2"
        runtime={hers2Runtime}
        profile="default"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments",
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await screen.findByText("Hers-2 已完成。");
    expect(screen.getByText("ark / glm-5.2")).toBeInTheDocument();
    expect(screen.getByTestId("runtime-context")).toHaveTextContent(
      "9000/1000000",
    );
  });

  it("does not present input tokens as context occupancy", async () => {
    probeAgentRuntime.mockResolvedValueOnce({
      runtimeId: "hermes-home2",
      state: "healthy",
      checkedAt: Date.now(),
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: true,
        cancellation: true,
        tools: true,
        memory: true,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        artifactUpload: true,
        workspaceAccess: false,
      },
    });
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "run-hers-2-no-context",
      runtimeId: "hermes-home2",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValueOnce({
      id: "run-hers-2-no-context",
      runtimeId: "hermes-home2",
      status: "succeeded",
      output: "没有上下文占用元数据。",
      startedAt: Date.now(),
      model: { provider: "ark", id: "glm-5.2", contextWindowTokens: 1_000_000 },
      usage: { inputTokens: 120, contextWindowTokens: 1_000_000 },
    });

    render(
      <RuntimeChat
        runId="chat-hers-2-no-context"
        runtime={hers2Runtime}
        profile="default"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments",
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await screen.findByText("没有上下文占用元数据。");
    expect(screen.queryByTestId("runtime-context")).not.toBeInTheDocument();
  });

  it("opens the shared Web Preview when a runtime message requests navigation", async () => {
    render(
      <RuntimeChat
        runId="chat-hers-2-web-preview"
        runtime={hers2Runtime}
        profile="default"
      />,
    );

    fireEvent(
      document,
      new CustomEvent("web-preview:navigate", {
        detail: "https://example.test/chart.html",
      }),
    );

    await waitFor(() =>
      expect(
        screen.getByDisplayValue("https://example.test/chart.html"),
      ).toBeInTheDocument(),
    );
    expect(document.querySelector(".web-preview-panel")).toBeInTheDocument();
  });

  it("uses the latest configured runtime avatar for an already-open conversation", () => {
    const avatar = "data:image/png;base64,YXZhdGFy";
    render(
      <RuntimeChat
        runId="chat-hers-2-avatar"
        runtime={hers2Runtime}
        profile="default"
        runtimeCatalog={{
          "hermes-home2": { ...hers2Runtime, avatar },
        }}
        initialMessages={[
          {
            id: "agent-avatar-reply",
            role: "agent",
            content: "头像已更新。",
            createdAt: Date.now(),
          },
        ]}
      />,
    );

    expect(screen.getByAltText("Hers-2")).toHaveAttribute("src", avatar);
  });

  it("keeps collaboration planning out of the compact composer toolbar", () => {
    const onRequestCollaboration = vi.fn();
    render(
      <RuntimeChat
        runId="chat-collaboration-entry"
        runtime={codexRuntime}
        profile="default"
        onRequestCollaboration={onRequestCollaboration}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "制定协作方案" }),
    ).not.toBeInTheDocument();
    expect(onRequestCollaboration).not.toHaveBeenCalled();
  });

  it("places collaboration policy before the user request when multiple runtimes are available", async () => {
    render(
      <RuntimeChat
        runId="chat-collaboration-policy"
        runtime={piRuntime}
        profile="default"
        runtimeCatalog={{
          "pi-local": piRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));

    const prompt = startAgentRuntimeTask.mock.calls[0][1].prompt as string;
    expect(prompt).toContain("用户明确要求多个智能体");
    expect(prompt.indexOf("Agents One 平台协作规则")).toBeLessThan(
      prompt.indexOf("检查输入"),
    );
  });

  it("turns a runtime proposal into an explicit, user-confirmed collaboration entry", () => {
    const onRequestCollaboration = vi.fn();
    render(
      <RuntimeChat
        runId="chat-collaboration-proposal"
        runtime={piRuntime}
        profile="default"
        runtimeCatalog={{
          "pi-local": piRuntime,
          "claude-local": claudeRuntime,
        }}
        onRequestCollaboration={onRequestCollaboration}
        initialMessages={[
          {
            id: "proposal-message",
            role: "agent",
            createdAt: Date.now(),
            content: [
              "这个任务需要独立实施与复核。",
              "<agents-one-collaboration-proposal>",
              '{"title":"文档协作","reason":"需要独立复核","brief":"生成并验证文档","assignments":[{"role":"协调","runtimeId":"pi-local","responsibility":"拆分","context":"全部"},{"role":"实施","runtimeId":"claude-local","responsibility":"交付","context":"任务说明"}]}',
              "</agents-one-collaboration-proposal>",
            ].join("\n"),
          },
        ]}
      />,
    );

    expect(screen.getByText("建议启用多智能体协作")).toBeInTheDocument();
    expect(
      screen.queryByText("agents-one-collaboration-proposal"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "配置并启动协作" }));
    expect(onRequestCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "文档协作",
        assignments: expect.arrayContaining([
          expect.objectContaining({ role: "实施", runtimeId: "claude-local" }),
        ]),
      }),
    );
  });

  it("passes controlled attachments and the selected project to Claude Code", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-claude",
      runtimeId: "claude-local",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-claude",
      runtimeId: "claude-local",
      status: "succeeded",
      output: "Claude Code 已读取项目。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="chat-claude"
        runtime={claudeRuntime}
        profile="default"
      />,
    );

    expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
      "data-attachments",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "default" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(selectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "claude-local",
        expect.objectContaining({
          prompt: "检查输入",
          workspace: "D:\\selected-project",
          attachments: [testAttachment],
        }),
      ),
    );
    await screen.findByText("Claude Code 已读取项目。");
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeId: "claude-local",
        workspace: "D:\\selected-project",
      }),
    );
  });

  it("sends bounded conversation context when Claude Code has no resumable session", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-claude-follow-up",
      runtimeId: "claude-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-claude-follow-up",
      runtimeId: "claude-local",
      status: "succeeded",
      output: "上下文已延续。",
      startedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="chat-claude-follow-up"
        runtime={claudeRuntime}
        profile="default"
        initialMessages={[
          {
            id: "user-previous",
            role: "user",
            content: "附件标记是什么？",
            createdAt: 1,
          },
          {
            id: "agent-previous",
            role: "agent",
            content: "AO-U5-20260717",
            createdAt: 2,
          },
          {
            id: "system-previous",
            role: "system",
            content: "这条错误不应进入上下文",
            createdAt: 3,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "claude-local",
        expect.objectContaining({
          prompt: expect.stringContaining("智能体：AO-U5-20260717"),
          sessionId: undefined,
        }),
      ),
    );
    const prompt = startAgentRuntimeTask.mock.calls[0][1].prompt as string;
    expect(prompt).toContain("当前用户消息：检查输入");
    expect(prompt).not.toContain("这条错误不应进入上下文");
  });

  it("continues Claude Code with its persisted CLI session when one exists", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-claude-resume",
      runtimeId: "claude-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-claude-resume",
      runtimeId: "claude-local",
      status: "succeeded",
      output: "已续接 Claude Code 对话。",
      startedAt: Date.now(),
      sessionId: "11111111-1111-4111-8111-111111111111",
    });
    render(
      <RuntimeChat
        runId="chat-claude-resume"
        runtime={claudeRuntime}
        profile="default"
        initialRuntimeSessionId="11111111-1111-4111-8111-111111111111"
        initialMessages={[
          {
            id: "previous-user",
            role: "user",
            content: "先检查配置",
            createdAt: 1,
          },
          {
            id: "previous-agent",
            role: "agent",
            content: "配置正常。",
            createdAt: 2,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "claude-local",
        expect.objectContaining({
          prompt: "检查输入",
          sessionId: "11111111-1111-4111-8111-111111111111",
        }),
      ),
    );
  });

  it("runs collaboration roles in order and forwards only real prior handoffs", async () => {
    const outputs: Record<string, string> = {
      "run-lead": "已完成任务拆分：先实施，再测试。",
      "run-implement": "已完成代码修改：src/feature.ts。",
      "run-test": "测试通过：3/3。",
    };
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id:
        runtimeId === "pi-local"
          ? "run-lead"
          : runtimeId === "codex-local"
            ? "run-implement"
            : "run-test",
      runtimeId,
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId:
        id === "run-lead"
          ? "pi-local"
          : id === "run-implement"
            ? "codex-local"
            : "claude-local",
      status: "succeeded",
      output: outputs[id],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(id === "run-implement"
        ? {
            artifacts: [
              {
                kind: "diff",
                label: "Git diff",
                content: "diff --git a/src/feature.ts",
              },
            ],
          }
        : {}),
    }));

    render(
      <RuntimeChat
        runId="collaboration-runtime"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "lead",
              role: "协调",
              runtimeId: "pi-local",
              responsibility: "拆分与交接",
            },
            {
              id: "implement",
              role: "实施",
              runtimeId: "codex-local",
              responsibility: "开发交付",
            },
            {
              id: "test",
              role: "测试",
              runtimeId: "claude-local",
              responsibility: "测试复核",
            },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-runtime",
          content: "完成一个三阶段协作测试",
          collaboration: {
            taskId: "collaboration-task",
            projectFolder: "D:\\collaboration-project",
            assignments: [
              {
                id: "lead",
                role: "协调",
                runtimeId: "pi-local",
                responsibility: "拆分与交接",
              },
              {
                id: "implement",
                role: "实施",
                runtimeId: "codex-local",
                responsibility: "开发交付",
              },
              {
                id: "test",
                role: "测试",
                runtimeId: "claude-local",
                responsibility: "测试复核",
              },
            ],
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(3));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["pi-local", "codex-local", "claude-local"]);
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "只执行“协调”角色",
    );
    expect(startAgentRuntimeTask.mock.calls[1][1].prompt).toContain(
      "【协调 已完成】",
    );
    expect(startAgentRuntimeTask.mock.calls[1][1].prompt).toContain(
      "已完成任务拆分",
    );
    expect(startAgentRuntimeTask.mock.calls[2][1].prompt).toContain(
      "【实施 已完成】",
    );
    expect(startAgentRuntimeTask.mock.calls[2][1].mode).toBe("analysis");
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-task",
        execution: expect.objectContaining({ status: "needs_review" }),
      }),
      "default",
    );
  });

  it("blocks downstream roles when an implementation role has no concrete delivery", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-implementation-without-artifact",
      runtimeId: "codex-local",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-implementation-without-artifact",
      runtimeId: "codex-local",
      status: "succeeded",
      output: "我已经完成实施。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="collaboration-missing-artifact"
        runtime={codexRuntime}
        profile="default"
        collaboration={{
          assignments: [
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
        }}
        runtimeCatalog={{
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-missing-artifact",
          content: "先实施，再测试",
          collaboration: {
            taskId: "collaboration-missing-artifact-task",
            assignments: [
              { id: "implement", role: "实施", runtimeId: "codex-local" },
              { id: "test", role: "测试", runtimeId: "claude-local" },
            ],
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-missing-artifact-task",
        execution: expect.objectContaining({
          status: "waiting_for_user",
          activeAssignmentId: "implement",
          roleRuns: expect.arrayContaining([
            expect.objectContaining({
              assignmentId: "implement",
              status: "waiting_for_user",
            }),
            expect.objectContaining({
              assignmentId: "test",
              status: "blocked",
            }),
          ]),
        }),
      }),
      "default",
    );
  });

  it("blocks a remote implementation role that only has a read-only evidence bundle", async () => {
    render(
      <RuntimeChat
        runId="collaboration-remote-preflight"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "implement",
              role: "实施",
              runtimeId: "openclaw-remote",
              workspaceAccess: "evidence_bundle",
            },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
        }}
        runtimeCatalog={{
          "openclaw-remote": openClawRuntime,
          "claude-local": claudeRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-remote-preflight",
          content: "远程实施预检",
          collaboration: {
            taskId: "collaboration-remote-preflight-task",
            projectFolder: "D:\\project",
            assignments: [
              {
                id: "implement",
                role: "实施",
                runtimeId: "openclaw-remote",
                workspaceAccess: "evidence_bundle",
              },
              { id: "test", role: "测试", runtimeId: "claude-local" },
            ],
          },
        },
      }),
    );

    await waitFor(() =>
      expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          taskId: "collaboration-remote-preflight-task",
          execution: expect.objectContaining({
            status: "waiting_for_user",
            activeAssignmentId: "implement",
            roleRuns: expect.arrayContaining([
              expect.objectContaining({
                assignmentId: "implement",
                status: "waiting_for_user",
              }),
              expect.objectContaining({
                assignmentId: "test",
                status: "blocked",
              }),
            ]),
          }),
        }),
        "default",
      ),
    );
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/改派本地智能体或配置远程映射/).length,
    ).toBeGreaterThan(0);
  });

  it("allows a remote testing role to validate a read-only evidence bundle", async () => {
    render(
      <RuntimeChat
        runId="collaboration-remote-acceptance"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "acceptance",
              role: "测试验收",
              responsibility: "基于实施交付逐项验收并输出结论",
              runtimeId: "openclaw-remote",
              workspaceAccess: "evidence_bundle",
            },
          ],
        }}
        runtimeCatalog={{
          "openclaw-remote": openClawRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-remote-acceptance",
          content: "远程证据验收",
          collaboration: {
            taskId: "collaboration-remote-acceptance-task",
            projectFolder: "D:\\project",
            assignments: [
              {
                id: "acceptance",
                role: "测试验收",
                responsibility: "基于实施交付逐项验收并输出结论",
                runtimeId: "openclaw-remote",
                workspaceAccess: "evidence_bundle",
              },
            ],
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/协作未启动/)).not.toBeInTheDocument();
    expect(prepareProjectContext).toHaveBeenCalledWith("D:\\project");
    expect(startAgentRuntimeTask).toHaveBeenCalledWith(
      "openclaw-remote",
      expect.objectContaining({
        attachments: [
          expect.objectContaining({ name: "project-project-context.txt" }),
        ],
      }),
    );
    const remotePrompt = startAgentRuntimeTask.mock.calls[0][1]
      .prompt as string;
    expect(remotePrompt).toContain("仅以平台转交的只读证据包为准");
    expect(remotePrompt).not.toContain("D:\\project");
  });

  it("blocks a remote evidence role when no local project folder is selected", async () => {
    render(
      <RuntimeChat
        runId="collaboration-remote-evidence-without-project"
        runtime={{ ...piRuntime, config: { transport: "cli" } }}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "acceptance",
              role: "测试验收",
              runtimeId: "openclaw-remote",
              workspaceAccess: "evidence_bundle",
            },
          ],
        }}
        runtimeCatalog={{
          "openclaw-remote": openClawRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-remote-evidence-without-project",
          content: "远程证据验收",
          collaboration: {
            taskId: "collaboration-remote-evidence-without-project-task",
            assignments: [
              {
                id: "acceptance",
                role: "测试验收",
                runtimeId: "openclaw-remote",
                workspaceAccess: "evidence_bundle",
              },
            ],
          },
        },
      }),
    );

    await waitFor(() =>
      expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          taskId: "collaboration-remote-evidence-without-project-task",
          execution: expect.objectContaining({ status: "waiting_for_user" }),
        }),
        "default",
      ),
    );
    expect(prepareProjectContext).not.toHaveBeenCalled();
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/尚未关联本地项目文件夹/).length,
    ).toBeGreaterThan(0);
  });

  it("collects concrete runtime artifacts and requires an acceptance role to cite them", async () => {
    const outputs: Record<string, string> = {
      "run-lead": "已完成任务拆分。",
      "run-implement":
        "代码已经修改。\n[交付契约]\n路径：D:\\worktrees\\feature\\src\\feature.ts\nSHA-256：aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n来源机器：本机工作区\n变更摘要：新增 feature 实现。",
      "run-test": "测试已执行。",
      "run-accept":
        "[验收结论]\n状态：通过\n依据：#1、#2、#3\n结论：代码变更与测试结果均已核对。",
    };
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id:
        runtimeId === "pi-local"
          ? "run-lead"
          : runtimeId === "codex-local"
            ? "run-implement"
            : runtimeId === "claude-local"
              ? "run-test"
              : "run-accept",
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId:
        id === "run-lead"
          ? "pi-local"
          : id === "run-implement"
            ? "codex-local"
            : id === "run-test"
              ? "claude-local"
              : "openclaw-remote",
      status: "succeeded",
      output: outputs[id],
      startedAt: Date.now(),
      completedAt: Date.now(),
      ...(id === "run-implement"
        ? {
            diffSummary: " src/feature.ts | 2 ++",
            artifacts: [
              {
                kind: "worktree",
                label: "隔离工作目录",
                path: "D:\\worktrees\\feature",
              },
              {
                kind: "diff",
                label: "Git diff",
                content: "diff --git a/src/feature.ts b/src/feature.ts",
              },
            ],
          }
        : {}),
      ...(id === "run-test"
        ? {
            events: [
              {
                id: "test-result",
                type: "tool_result",
                summary: "npm test: 12 passed",
                createdAt: Date.now(),
              },
            ],
          }
        : {}),
    }));
    render(
      <RuntimeChat
        runId="collaboration-artifacts"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            { id: "lead", role: "协调", runtimeId: "pi-local" },
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            {
              id: "test",
              role: "测试",
              runtimeId: "claude-local",
              responsibility: "运行自动化测试",
            },
            {
              id: "accept",
              role: "验收",
              runtimeId: "openclaw-remote",
              responsibility: "基于真实产物验收",
            },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
          "openclaw-remote": openClawRuntime,
        }}
      />,
    );
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-artifacts",
          content: "实现功能并运行测试后验收",
          collaboration: {
            taskId: "collaboration-artifacts-task",
            assignments: [
              { id: "lead", role: "协调", runtimeId: "pi-local" },
              { id: "implement", role: "实施", runtimeId: "codex-local" },
              {
                id: "test",
                role: "测试",
                runtimeId: "claude-local",
                responsibility: "运行自动化测试",
              },
              {
                id: "accept",
                role: "验收",
                runtimeId: "openclaw-remote",
                responsibility: "基于真实产物验收",
              },
            ],
          },
        },
      }),
    );
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(4));
    const acceptancePrompt = startAgentRuntimeTask.mock.calls[3][1].prompt;
    expect(acceptancePrompt).toContain("待验收的真实产物");
    expect(acceptancePrompt).toContain("产物 #1");
    expect(acceptancePrompt).toContain("npm test: 12 passed");
    expect(acceptancePrompt).not.toContain("D:\\worktrees\\feature");
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-artifacts-task",
        execution: expect.objectContaining({
          status: "succeeded",
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              kind: "file",
              path: "D:\\worktrees\\feature\\src\\feature.ts",
            }),
            expect.objectContaining({ kind: "code_diff" }),
            expect.objectContaining({
              kind: "test_result",
              summary: "npm test: 12 passed",
            }),
          ]),
          acceptance: expect.objectContaining({
            status: "passed",
            reviewedArtifactIds: expect.arrayContaining([expect.any(String)]),
          }),
        }),
      }),
      "default",
    );
  });

  it("runs the designated lead a final time for evidence-based terminal review", async () => {
    const started: string[] = [];
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => {
      const runId =
        runtimeId === "pi-local" && started.includes("pi-local")
          ? "run-final-review"
          : runtimeId === "pi-local"
            ? "run-lead"
            : runtimeId === "codex-local"
              ? "run-implement"
              : runtimeId === "claude-local"
                ? "run-test"
                : "run-accept";
      started.push(runtimeId);
      return {
        id: runId,
        runtimeId,
        status: "running",
        output: "",
        startedAt: Date.now(),
      };
    });
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId:
        id === "run-implement"
          ? "codex-local"
          : id === "run-test"
            ? "claude-local"
            : id === "run-accept"
              ? "openclaw-remote"
              : "pi-local",
      status: "succeeded",
      output:
        id === "run-implement"
          ? "完成实施。\n[交付契约]\n路径：D:\\project\\output.txt\nSHA-256：bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n来源机器：本机工作区\n变更摘要：创建 output.txt。"
          : id === "run-accept" || id === "run-final-review"
            ? "[验收结论]\n状态：通过\n依据：#1、#2\n结论：交付和测试证据一致。"
            : id === "run-test"
              ? "测试完成。"
              : "已完成任务拆分。",
      startedAt: Date.now(),
      completedAt: Date.now(),
      ...(id === "run-implement"
        ? {
            artifacts: [
              {
                kind: "worktree",
                label: "交付文件",
                path: "D:\\project\\output.txt",
              },
            ],
          }
        : {}),
      ...(id === "run-test"
        ? {
            events: [
              {
                id: "test",
                type: "tool_result",
                summary: "测试通过",
                createdAt: Date.now(),
              },
            ],
          }
        : {}),
    }));
    render(
      <RuntimeChat
        runId="collaboration-final-review"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "lead",
              role: "项目负责人",
              runtimeId: "pi-local",
              responsibility: "拆分、协调和终验汇总",
            },
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "test", role: "测试", runtimeId: "claude-local" },
            { id: "accept", role: "验收", runtimeId: "openclaw-remote" },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
          "openclaw-remote": openClawRuntime,
        }}
      />,
    );
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-final-review",
          content: "实施、测试并终验",
          collaboration: {
            taskId: "collaboration-final-review-task",
            assignments: [
              {
                id: "lead",
                role: "项目负责人",
                runtimeId: "pi-local",
                responsibility: "拆分、协调和终验汇总",
              },
              { id: "implement", role: "实施", runtimeId: "codex-local" },
              { id: "test", role: "测试", runtimeId: "claude-local" },
              { id: "accept", role: "验收", runtimeId: "openclaw-remote" },
            ],
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(5));
    expect(started).toEqual([
      "pi-local",
      "codex-local",
      "claude-local",
      "openclaw-remote",
      "pi-local",
    ]);
    expect(startAgentRuntimeTask.mock.calls[4][1].prompt).toContain("终验汇总");
    expect(startAgentRuntimeTask.mock.calls[4][1].prompt).toContain(
      "不得自行补做其他角色的工作",
    );
  });

  it("blocks successor roles when a collaboration role fails", async () => {
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: runtimeId === "pi-local" ? "run-lead" : "run-implement-failed",
      runtimeId,
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId: id === "run-lead" ? "pi-local" : "codex-local",
      status: id === "run-lead" ? "succeeded" : "failed",
      output: id === "run-lead" ? "任务已拆分。" : "实施失败。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));

    render(
      <RuntimeChat
        runId="collaboration-failure"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            { id: "lead", role: "协调", runtimeId: "pi-local" },
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-failure",
          content: "失败链路测试",
          collaboration: {
            taskId: "collaboration-failure-task",
            assignments: [
              { id: "lead", role: "协调", runtimeId: "pi-local" },
              { id: "implement", role: "实施", runtimeId: "codex-local" },
              { id: "test", role: "测试", runtimeId: "claude-local" },
            ],
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["pi-local", "codex-local"]);
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-failure-task",
        execution: expect.objectContaining({
          status: "waiting_for_user",
          roleRuns: expect.arrayContaining([
            expect.objectContaining({
              assignmentId: "test",
              status: "blocked",
            }),
          ]),
        }),
      }),
      "default",
    );
  });

  it("keeps downstream roles blocked when a runtime times out so a user can intervene safely", async () => {
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: runtimeId === "pi-local" ? "run-lead" : "run-codex-timeout",
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId: id === "run-lead" ? "pi-local" : "codex-local",
      status: id === "run-lead" ? "succeeded" : "timed_out",
      output:
        id === "run-lead"
          ? "请实施后再测试。"
          : "Runtime task exceeded 120000ms.",
      startedAt: Date.now(),
      completedAt: Date.now(),
    }));
    render(
      <RuntimeChat
        runId="collaboration-timeout"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            { id: "lead", role: "协调", runtimeId: "pi-local" },
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-timeout",
          content: "验证超时恢复",
          collaboration: {
            taskId: "collaboration-timeout-task",
            assignments: [
              { id: "lead", role: "协调", runtimeId: "pi-local" },
              { id: "implement", role: "实施", runtimeId: "codex-local" },
              { id: "test", role: "测试", runtimeId: "claude-local" },
            ],
          },
        },
      }),
    );
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-timeout-task",
        execution: expect.objectContaining({
          status: "waiting_for_user",
          activeAssignmentId: "implement",
          roleRuns: expect.arrayContaining([
            expect.objectContaining({
              assignmentId: "implement",
              status: "waiting_for_user",
            }),
            expect.objectContaining({
              assignmentId: "test",
              status: "blocked",
            }),
          ]),
        }),
      }),
      "default",
    );
  });

  it("keeps an intervention private to its role and resumes the blocked chain from that role", async () => {
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id:
        runtimeId === "codex-local" ? "run-implement-retry" : "run-test-retry",
      runtimeId,
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId: id === "run-implement-retry" ? "codex-local" : "claude-local",
      status: "succeeded",
      output:
        id === "run-implement-retry" ? "已按人工指令完成实施。" : "测试通过。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(id === "run-implement-retry"
        ? {
            artifacts: [
              {
                kind: "diff",
                label: "Git diff",
                content: "diff --git a/docs/guide.md",
              },
            ],
          }
        : {}),
    }));
    render(
      <RuntimeChat
        runId="collaboration-resume"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          taskId: "collaboration-resume-task",
          assignments: [
            { id: "lead", role: "协调", runtimeId: "pi-local" },
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
          execution: {
            status: "waiting_for_user",
            brief: "完成一个需要实施和测试的任务",
            updatedAt: Date.now(),
            activeAssignmentId: "implement",
            roleRuns: [
              {
                assignmentId: "lead",
                role: "协调",
                runtimeId: "pi-local",
                status: "succeeded",
                handoff: "先完成实施。",
              },
              {
                assignmentId: "implement",
                role: "实施",
                runtimeId: "codex-local",
                status: "waiting_for_user",
              },
              {
                assignmentId: "test",
                role: "测试",
                runtimeId: "claude-local",
                status: "blocked",
              },
            ],
          },
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "介入" })[1]);
    fireEvent.change(screen.getByLabelText("给当前角色的人工指令"), {
      target: { value: "只修改 docs 目录，并说明改动文件。" },
    });
    fireEvent.change(screen.getByLabelText("本角色权限"), {
      target: { value: "full_access" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存并继续" }));

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["codex-local", "claude-local"]);
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "【仅给本角色的人工指令】只修改 docs 目录",
    );
    expect(startAgentRuntimeTask.mock.calls[1][1].prompt).not.toContain(
      "只修改 docs 目录",
    );
    expect(startAgentRuntimeTask.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        mode: "full_access",
        fullAccessConfirmed: true,
      }),
    );
    expect(updateTaskCollaborationExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "collaboration-resume-task",
        execution: expect.objectContaining({
          status: "needs_review",
          interventions: expect.arrayContaining([
            expect.objectContaining({
              visibility: "role",
              assignmentId: "implement",
              accessMode: "full_access",
            }),
          ]),
        }),
      }),
      "default",
    );
  });
});
