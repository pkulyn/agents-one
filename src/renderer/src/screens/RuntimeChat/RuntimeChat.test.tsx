import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../../shared/attachments";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        "chat.emptyTitle": "今天我可以帮你做什么？",
        "chat.emptyHint": "你可以让我写代码、回答问题、搜索网页等",
        "chat.setContextFolder": "选择项目目录",
        "chat.contextFolderActive": "当前项目目录",
        "chat.removeContextFolder": "移除项目目录",
        "chat.showWorktree": "显示项目树",
        "chat.hideWorktree": "隐藏项目树",
        "chat.worktree.openTerminal": "在此打开终端",
        "chat.worktree.openTerminalFailed": "无法打开终端",
        "chat.worktree.loading": "正在加载",
        "chat.worktree.empty": "文件夹为空",
        "chat.worktree.emptyFolder": "文件夹为空",
        "chat.worktree.errorLoading": "无法读取文件夹",
      };
      return labels[key] ?? translate(key, i18nTestState.locale, options);
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
    allowAttachmentsWhileLoading?: boolean;
    contextUsage?: { used: number; window: number } | null;
    onContextUsageClick?: () => void;
    toolbarExtras?: React.ReactNode;
    slashCommands?: Array<{ name: string }>;
    onSubmit: (text: string, attachments: Attachment[]) => void;
  }) => (
    <div
      data-testid="runtime-composer"
      data-attachments={String(props.attachmentsEnabled)}
      data-attachments-while-loading={String(
        props.allowAttachmentsWhileLoading,
      )}
    >
      {props.toolbarExtras}
      {props.contextUsage && (
        <>
          <span data-testid="runtime-context">
            {props.contextUsage.used}/{props.contextUsage.window}
          </span>
          {props.onContextUsageClick ? (
            <button type="button" onClick={props.onContextUsageClick}>
              提交 Runtime 上下文压缩
            </button>
          ) : null}
        </>
      )}
      <button
        type="button"
        onClick={() => props.onSubmit("检查输入", [testAttachment])}
      >
        发送测试输入
      </button>
      <button
        type="button"
        onClick={() =>
          props.onSubmit(
            "Agents One 冒烟测试，想测试多智能协助。你负责编排、验收，Pi 负责执行，Claude 负责复核。",
            [],
          )
        }
      >
        发送明确协作输入
      </button>
      <button
        type="button"
        onClick={() => props.onSubmit("请使用多智能体协作完成这个任务。", [])}
      >
        发送泛化协作输入
      </button>
      <button type="button" onClick={() => props.onSubmit("/status", [])}>
        提交 Runtime 状态命令
      </button>
      <button
        type="button"
        onClick={() => props.onSubmit("/compact 保留接口", [])}
      >
        提交 Runtime 压缩命令
      </button>
      <button
        type="button"
        onClick={() => props.onSubmit("/statuz", [testAttachment])}
      >
        提交未知 Runtime 命令
      </button>
    </div>
  ),
}));

import RuntimeChat, {
  collaborationPermissionPreflight,
  collaborationWorkspacePreflight,
} from "./RuntimeChat";

function selectFullAccess(): void {
  fireEvent.click(screen.getByRole("button", { name: "管理本轮任务权限" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
}

const gatewayRuntime: AgentRuntimeDefinition = {
  id: "hermes-gateway",
  name: "Hermes Gateway",
  kind: "hermes",
  location: "remote",
  enabled: true,
  managed: "user",
  config: {
    transport: "http",
    endpoint: "https://example.test/agents-one/v1",
    remoteGateway: { protocol: "agents-one-v1" },
  },
};

const doubaoRuntime: AgentRuntimeDefinition = {
  id: "doubao-web-test",
  name: "豆包网页版",
  kind: "web-agent",
  location: "local",
  enabled: true,
  managed: "user",
  config: {
    agentTransport: "local-web",
    webAgent: {
      provider: "doubao",
      profileId: "doubao-test",
      adapterVersion: "1.0.0",
      enabled: true,
    },
  },
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

const openCodeRuntime: AgentRuntimeDefinition = {
  id: "opencode-local",
  name: "OpenCode",
  kind: "opencode",
  location: "local",
  enabled: true,
  managed: "user",
  config: { transport: "cli", executablePath: "opencode" },
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
  const retryAgentRuntimeArtifact = vi.fn();
  const getAgentRuntimeModelContextWindow = vi.fn();
  const getRuntimeConversation = vi.fn();
  const saveRuntimeConversation = vi.fn();
  const forkRuntimeConversation = vi.fn();
  const saveTaskCollaboration = vi.fn();
  const updateTaskCollaborationExecution = vi.fn();
  const getTaskCollaboration = vi.fn();
  const linkTaskCollaboration = vi.fn();
  const selectFolder = vi.fn();
  const registerProjectFolder = vi.fn();
  const listProjectWorkspaces = vi.fn();
  const listRecentSessionContextFolders = vi.fn();
  const prepareProjectContext = vi.fn();
  const readDirectory = vi.fn();
  const readWorkspaceDirectory = vi.fn();
  const openTerminal = vi.fn();
  const getAgentRuntimeCommandCatalog = vi.fn();
  const executeAgentRuntimeCommand = vi.fn();
  const onAgentRuntimeCommandProgress = vi.fn();

  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
    // resetAllMocks also clears leftover mockResolvedValueOnce queues, which
    // would otherwise leak across tests and break order-dependent polling.
    vi.resetAllMocks();
    probeAgentRuntime.mockResolvedValue({
      runtimeId: "hermes-gateway",
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
      runtimeId: "hermes-gateway",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-1",
      runtimeId: "hermes-gateway",
      status: "succeeded",
      output: "输入已读取。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    retryAgentRuntimeArtifact.mockResolvedValue(null);
    getAgentRuntimeModelContextWindow.mockResolvedValue(null);
    getRuntimeConversation.mockResolvedValue(null);
    saveRuntimeConversation.mockResolvedValue(undefined);
    forkRuntimeConversation.mockResolvedValue({ id: "branch-conversation" });
    saveTaskCollaboration.mockResolvedValue(undefined);
    updateTaskCollaborationExecution.mockResolvedValue(undefined);
    getTaskCollaboration.mockResolvedValue(null);
    linkTaskCollaboration.mockResolvedValue(undefined);
    selectFolder.mockResolvedValue("D:\\selected-project");
    registerProjectFolder.mockResolvedValue({ path: "D:\\selected-project" });
    listProjectWorkspaces.mockResolvedValue([]);
    listRecentSessionContextFolders.mockResolvedValue([]);
    prepareProjectContext.mockResolvedValue({
      id: "project-context",
      kind: "text-file",
      name: "project-project-context.txt",
      mime: "text/plain",
      size: 128,
      text: "Project context snapshot: project\n--- PROJECT FILE: README.md ---\n# Demo",
    });
    readDirectory.mockResolvedValue([
      { name: "docs", isDirectory: true },
      { name: "README.md", isDirectory: false },
    ]);
    readWorkspaceDirectory.mockResolvedValue([
      { name: "remote-docs", isDirectory: true },
      { name: "remote-README.md", isDirectory: false },
    ]);
    openTerminal.mockResolvedValue(true);
    getAgentRuntimeCommandCatalog.mockResolvedValue({
      commands: [
        {
          name: "status",
          description: "查看运行状态",
          category: "Runtime",
          source: "desktop",
          target: "runtime-control",
          availability: "any",
        },
      ],
      fetchedAt: Date.now(),
    });
    executeAgentRuntimeCommand.mockResolvedValue({
      type: "handled",
      message: "运行时：Hermes Gateway",
    });
    onAgentRuntimeCommandProgress.mockReturnValue(vi.fn());
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        probeAgentRuntime,
        startAgentRuntimeTask,
        getAgentRuntimeRun,
        retryAgentRuntimeArtifact,
        getAgentRuntimeModelContextWindow,
        getRuntimeConversation,
        saveRuntimeConversation,
        forkRuntimeConversation,
        saveTaskCollaboration,
        updateTaskCollaborationExecution,
        getTaskCollaboration,
        linkTaskCollaboration,
        selectFolder,
        registerProjectFolder,
        listProjectWorkspaces,
        listRecentSessionContextFolders,
        prepareProjectContext,
        readDirectory,
        readWorkspaceDirectory,
        openTerminal,
        getAgentRuntimeCommandCatalog,
        executeAgentRuntimeCommand,
        onAgentRuntimeCommandProgress,
        mediaFileExists: vi.fn().mockResolvedValue(false),
        cancelAgentRuntimeTask: vi.fn(),
      },
    });
  });

  it("renders core Runtime controls in English", () => {
    i18nTestState.locale = "en";

    render(
      <RuntimeChat
        runId="runtime-english-controls"
        runtime={openCodeRuntime}
        profile="default"
        runtimeCatalog={{ [openCodeRuntime.id]: openCodeRuntime }}
        collaboration={{
          assignments: [
            {
              id: "implementation",
              role: "Implementation",
              runtimeId: openCodeRuntime.id,
            },
          ],
          execution: {
            status: "paused",
            roleRuns: [
              {
                assignmentId: "implementation",
                role: "Implementation",
                runtimeId: openCodeRuntime.id,
                status: "paused",
              },
            ],
            updatedAt: Date.now(),
          },
        }}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "Manage permissions for this task",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Model: Model unavailable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "Reasoning level: Auto; OpenCode ACP did not provide switchable options",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show web preview" }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Agent collaboration dashboard"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Talk to OpenCode (Implementation)",
      }),
    );
    expect(screen.getByLabelText("Role intervention")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Instruction for the current role"),
    ).toBeInTheDocument();
  });

  it("routes a slash control through IPC without starting a normal Runtime task", async () => {
    render(
      <RuntimeChat
        runId="runtime-command"
        runtime={gatewayRuntime}
        profile="default"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "提交 Runtime 状态命令" }),
    );

    await waitFor(() => {
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          runtimeId: "hermes-gateway",
          name: "status",
          requestId: expect.stringMatching(/^runtime-command-/),
        }),
      );
    });
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(screen.getByText("运行时：Hermes Gateway")).toBeInTheDocument();
    await waitFor(() => {
      const persisted = saveRuntimeConversation.mock.calls.at(-1)?.[0];
      expect(persisted?.messages.at(-1)?.controlAudit).toMatchObject({
        command: "status",
        runtimeId: "hermes-gateway",
        target: "runtime-control",
        outcome: "handled",
      });
      const audit = persisted?.messages.at(-1)?.controlAudit;
      expect(audit?.completedAt).toBeGreaterThanOrEqual(audit?.startedAt ?? 0);
    });
  });

  it("opens a reply branch in a new task without replacing the parent conversation", async () => {
    const onConversationIdChange = vi.fn();
    const opened = vi.fn();
    window.addEventListener("agents-one:open-runtime-conversation", opened);

    render(
      <RuntimeChat
        runId="parent-task"
        runtime={piRuntime}
        profile="default"
        initialConversationId="parent-conversation"
        onConversationIdChange={onConversationIdChange}
        initialMessages={[
          {
            id: "user-1",
            role: "user",
            content: "请先完成第一步",
            createdAt: 1,
          },
          {
            id: "reply-1",
            role: "agent",
            content: "第一步已经完成",
            createdAt: 2,
          },
          {
            id: "user-2",
            role: "user",
            content: "这是父对话后续历史",
            createdAt: 3,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText("从这条答复创建新对话分支"));

    await waitFor(() => {
      expect(forkRuntimeConversation).toHaveBeenCalledWith(
        "parent-conversation",
        expect.objectContaining({ forkedFromMessageId: "reply-1" }),
        "default",
      );
    });
    expect(opened).toHaveBeenCalledTimes(1);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toBe(
      "branch-conversation",
    );
    expect(onConversationIdChange).not.toHaveBeenCalled();
    expect(screen.getByText("这是父对话后续历史")).toBeInTheDocument();
    expect(saveRuntimeConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "parent-conversation",
        messages: expect.arrayContaining([
          expect.objectContaining({ id: "user-2" }),
        ]),
      }),
    );
    window.removeEventListener("agents-one:open-runtime-conversation", opened);
  });

  it("follows live output until the user scrolls back, then offers a jump to the latest message", () => {
    render(
      <RuntimeChat
        runId="scroll-follow"
        runtime={piRuntime}
        profile="default"
        initialMessages={[
          {
            id: "user-1",
            role: "user",
            content: "请持续展示最新进度",
            createdAt: 1,
          },
          {
            id: "reply-1",
            role: "agent",
            content: "正在执行第一步",
            createdAt: 2,
          },
        ]}
      />,
    );

    const messagePane = document.querySelector(
      ".runtime-chat .chat-messages",
    ) as HTMLDivElement;
    Object.defineProperties(messagePane, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, writable: true, value: 120 },
    });

    fireEvent.scroll(messagePane);
    expect(
      screen.getByRole("button", { name: "回到最新消息" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "回到最新消息" }));
    expect(messagePane.scrollTop).toBe(1_200);
    expect(
      screen.queryByRole("button", { name: "回到最新消息" }),
    ).not.toBeInTheDocument();
  });

  it("shows compact lifecycle feedback without submitting a normal prompt", async () => {
    getAgentRuntimeCommandCatalog.mockResolvedValue({
      commands: [
        {
          name: "compact",
          description: "压缩上下文",
          category: "Runtime",
          source: "desktop",
          target: "runtime-control",
          availability: "idle",
          argumentHint: "[保留重点]",
        },
      ],
      fetchedAt: Date.now(),
    });
    executeAgentRuntimeCommand.mockResolvedValue({
      type: "handled",
      message: "Pi 上下文压缩完成：1200 → 300 tokens。",
      statePatch: {
        compacted: true,
        compaction: {
          trigger: "manual",
          tokensBefore: 1_200,
          tokensAfter: 300,
        },
      },
    });
    render(
      <RuntimeChat
        runId="runtime-compact"
        runtime={piRuntime}
        profile="default"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "提交 Runtime 压缩命令" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "确认压缩当前会话上下文" }),
    ).toBeInTheDocument();
    expect(screen.getByText("保留重点：保留接口")).toBeInTheDocument();
    expect(executeAgentRuntimeCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认压缩" }));

    expect(
      screen.queryByText("正在请求 Runtime 压缩当前会话上下文…"),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "compact", args: "保留接口" }),
      );
    });
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Pi 上下文压缩完成：1200 → 300 tokens。"),
    ).toBeInTheDocument();
    await waitFor(() => {
      const audit = saveRuntimeConversation.mock.calls
        .at(-1)?.[0]
        ?.messages.at(-1)?.controlAudit;
      expect(audit?.compaction).toEqual({
        trigger: "manual",
        tokensBefore: 1_200,
        tokensAfter: 300,
      });
    });
  });

  it("routes the model label through the same Runtime /model handler", async () => {
    getAgentRuntimeCommandCatalog.mockResolvedValue({
      commands: [
        {
          name: "model",
          description: "选择模型",
          category: "Runtime",
          source: "desktop",
          target: "runtime-control",
          availability: "any",
        },
      ],
      fetchedAt: Date.now(),
    });
    executeAgentRuntimeCommand.mockImplementation(async (request) =>
      request.args
        ? {
            type: "handled",
            message: `当前会话已切换到模型：${request.args}`,
            statePatch: { model: request.args },
          }
        : {
            type: "needs-input",
            input: "model-picker",
            models: [{ id: "ark/glm-5.2" }],
          },
    );
    render(
      <RuntimeChat
        runId="runtime-model-label"
        runtime={piRuntime}
        profile="default"
      />,
    );

    const trigger = await screen.findByRole("button", {
      name: "模型：未提供模型",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "model", runtimeId: "pi-local" }),
      ),
    );
    expect(
      screen.getByRole("dialog", { name: "选择当前会话模型" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("模型列表")).toHaveValue("ark/glm-5.2");
    expect(
      screen.queryByText("Runtime 命令正在等待补充输入。"),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型列表"), {
      target: { value: "ark/glm-5.2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    await waitFor(() => {
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "model", args: "ark/glm-5.2" }),
      );
    });
  });

  it("renders a readable execution-boundary badge instead of a raw host label", async () => {
    render(
      <RuntimeChat
        runId="runtime-isolation-badge"
        runtime={piRuntime}
        profile="default"
        initialMessages={[
          {
            id: "host-execution",
            role: "agent",
            content: "已完成本机分析。",
            createdAt: Date.now(),
            execution: {
              runId: "host-run",
              events: [],
              isolation: {
                level: "host",
                summary: "使用启动 Agents One 的本机用户权限直接执行。",
              },
            },
          },
        ]}
      />,
    );

    const badge = await screen.findByLabelText("执行边界：host");
    expect(badge).toHaveTextContent("本机执行");
    expect(badge).toHaveAttribute(
      "title",
      "使用启动 Agents One 的本机用户权限直接执行。",
    );
  });

  it("optimistically shows the chosen model while Pi confirms the live session switch", async () => {
    let resolveSwitch: ((result: Record<string, unknown>) => void) | undefined;
    getAgentRuntimeCommandCatalog.mockResolvedValue({
      commands: [
        {
          name: "model",
          description: "选择模型",
          category: "Runtime",
          source: "desktop",
          target: "runtime-control",
          availability: "any",
        },
      ],
      fetchedAt: Date.now(),
    });
    executeAgentRuntimeCommand.mockImplementation((request) => {
      if (!request.args) {
        return Promise.resolve({
          type: "needs-input",
          input: "model-picker",
          models: [
            { id: "ark/deepseek-v4-flash" },
            { id: "ark/doubao-seed-2.1-turbo" },
          ],
        });
      }
      return new Promise((resolve) => {
        resolveSwitch = resolve;
      });
    });
    render(
      <RuntimeChat
        runId="runtime-model-optimistic"
        runtime={{
          ...piRuntime,
          config: { ...piRuntime.config, model: "ark/deepseek-v4-flash" },
        }}
        profile="default"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", {
        name: "模型：ark/deepseek-v4-flash",
      }),
    );
    await screen.findByRole("dialog", { name: "选择当前会话模型" });
    fireEvent.change(screen.getByLabelText("模型列表"), {
      target: { value: "ark/doubao-seed-2.1-turbo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));

    const trigger = screen.getByRole("button", {
      name: "正在切换模型：ark/doubao-seed-2.1-turbo",
    });
    expect(trigger).toBeDisabled();
    resolveSwitch?.({
      type: "handled",
      message: "当前会话已切换到模型：ark/doubao-seed-2.1-turbo",
      statePatch: { model: "ark/doubao-seed-2.1-turbo" },
    });
    await screen.findByText("当前会话已切换到模型：ark/doubao-seed-2.1-turbo");
  });

  it("renders only matching native command progress as system feedback", async () => {
    let progressListener: ((progress: Record<string, unknown>) => void) | null =
      null;
    onAgentRuntimeCommandProgress.mockImplementation((listener) => {
      progressListener = listener;
      return vi.fn();
    });
    executeAgentRuntimeCommand.mockImplementation(async (request) => {
      progressListener?.({
        requestId: "other-command",
        runtimeId: "pi-local",
        phase: "progress",
        message: "这条旧命令不得显示。",
      });
      progressListener?.({
        requestId: request.requestId,
        runtimeId: request.runtimeId,
        phase: "progress",
        message: "Pi 正在整理并压缩会话上下文…",
      });
      return { type: "handled", message: "Pi 上下文压缩完成。" };
    });
    render(
      <RuntimeChat
        runId="runtime-command-progress"
        runtime={piRuntime}
        profile="default"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "提交 Runtime 压缩命令" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "确认压缩" }));

    expect(
      await screen.findByText("Pi 正在整理并压缩会话上下文…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("这条旧命令不得显示。")).not.toBeInTheDocument();
  });

  it("keeps unknown slash input on the control path even when it has attachments", async () => {
    executeAgentRuntimeCommand.mockResolvedValue({
      type: "error",
      message: "未知命令 /statuz。你是否想使用：/status？",
    });
    render(
      <RuntimeChat
        runId="runtime-unknown-command"
        runtime={gatewayRuntime}
        profile="default"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "提交未知 Runtime 命令" }),
    );

    await waitFor(() => {
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "statuz" }),
      );
    });
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(
      await screen.findByText("未知命令 /statuz。你是否想使用：/status？"),
    ).toBeInTheDocument();
  });

  it("refreshes an open scheduled-task conversation after its result is persisted", async () => {
    getRuntimeConversation.mockResolvedValue({
      id: "runtime-conv-schedule-open",
      title: "定时任务：知识库整理",
      createdAt: 1,
      updatedAt: 2,
      runtimeId: "pi-local",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      workspace: "D:\\vault",
      accessMode: "full_access",
      messageCount: 2,
      messages: [
        {
          id: "scheduled-user",
          role: "user",
          content: "整理知识库",
          createdAt: 1,
        },
        {
          id: "scheduled-result",
          role: "agent",
          content: "知识库整理完成。",
          createdAt: 2,
          execution: {
            runId: "runtime-run-scheduled",
            events: [
              {
                id: "completed",
                type: "completed",
                summary: "Pi 已完成本轮任务。",
                createdAt: 2,
              },
            ],
          },
        },
      ],
    });
    render(
      <RuntimeChat
        runId="scheduled-open"
        runtime={piRuntime}
        profile="default"
        initialConversationId="runtime-conv-schedule-open"
        initialMessages={[
          {
            id: "scheduled-user",
            role: "user",
            content: "整理知识库",
            createdAt: 1,
          },
        ]}
      />,
    );

    expect(screen.queryByText("知识库整理完成。")).toBeNull();
    window.dispatchEvent(
      new CustomEvent("agents-one:runtime-conversation-updated", {
        detail: {
          profile: "default",
          conversationId: "runtime-conv-schedule-open",
        },
      }),
    );

    await screen.findByText("知识库整理完成。");
    expect(getRuntimeConversation).toHaveBeenCalledWith(
      "runtime-conv-schedule-open",
      "default",
    );
    expect(getRuntimeConversation.mock.results.at(-1)?.value).toBeDefined();
    expect(screen.getByText("完全访问")).toBeInTheDocument();
  });

  it("resumes a scheduled Runtime run immediately when its conversation opens", async () => {
    getAgentRuntimeRun
      .mockResolvedValueOnce({
        id: "runtime-run-live-schedule",
        runtimeId: "pi-local",
        status: "running",
        startedAt: 1,
        output: "",
        events: [
          {
            id: "started",
            type: "started",
            summary: "任务已开始执行。",
            createdAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "runtime-run-live-schedule",
        runtimeId: "pi-local",
        status: "succeeded",
        startedAt: 1,
        completedAt: 2,
        output: "定时整理完成。",
        events: [
          {
            id: "completed",
            type: "completed",
            summary: "任务执行完成。",
            createdAt: 2,
          },
        ],
      });

    render(
      <RuntimeChat
        runId="scheduled-live"
        runtime={piRuntime}
        profile="default"
        initialConversationId="runtime-conv-schedule-live"
        initialRuntimeRunId="runtime-run-live-schedule"
        initialMessages={[
          {
            id: "scheduled-user",
            role: "user",
            content: "整理知识库",
            createdAt: 1,
          },
        ]}
      />,
    );

    await screen.findByText("正在思考并准备执行……");
    await screen.findByText("定时整理完成。", {}, { timeout: 3_000 });
    expect(getAgentRuntimeRun).toHaveBeenCalledWith(
      "runtime-run-live-schedule",
    );
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "runtime-conv-schedule-live",
        activeRuntimeRunId: null,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "agent",
            content: "定时整理完成。",
          }),
        ]),
      }),
    );
  });

  it("does not append a duplicate when background reconciliation wins the terminal race", async () => {
    getAgentRuntimeRun.mockResolvedValue({
      id: "runtime-run-background-finished",
      runtimeId: "pi-local",
      status: "succeeded",
      startedAt: 1,
      completedAt: 2,
      output: "后台完成。",
      events: [],
    });
    getRuntimeConversation.mockResolvedValue({
      id: "runtime-conv-background-finished",
      title: "定时任务：后台完成",
      createdAt: 1,
      updatedAt: 2,
      runtimeId: "pi-local",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      messageCount: 2,
      messages: [
        { id: "user", role: "user", content: "执行", createdAt: 1 },
        {
          id: "result",
          role: "agent",
          content: "后台完成。",
          createdAt: 2,
          execution: {
            runId: "runtime-run-background-finished",
            events: [],
          },
        },
      ],
    });

    render(
      <RuntimeChat
        runId="scheduled-background-finished"
        runtime={piRuntime}
        profile="default"
        initialConversationId="runtime-conv-background-finished"
        initialRuntimeRunId="runtime-run-background-finished"
        initialMessages={[
          { id: "user", role: "user", content: "执行", createdAt: 1 },
        ]}
      />,
    );

    await screen.findByText("后台完成。");
    expect(screen.getAllByText("后台完成。")).toHaveLength(1);
  });

  it("blocks implementation roles before dispatch when collaboration remains read-only", () => {
    const assignment = {
      id: "implement",
      role: "实施",
      runtimeId: "pi-local",
      responsibility: "执行",
      workspaceAccess: "local_direct" as const,
    };

    expect(collaborationPermissionPreflight([assignment], "analysis")).toEqual([
      expect.objectContaining({
        assignment,
        reason: expect.stringContaining("完全访问"),
      }),
    ]);
    expect(
      collaborationPermissionPreflight([assignment], "full_access"),
    ).toEqual([]);
  });

  it("localizes collaboration preflight failures for English Runtime chats", () => {
    const translateEnglish = (
      key: string,
      options?: Record<string, unknown>,
    ): string => translate(key, "en", options);
    const implementation = {
      id: "implement",
      role: "Implementation",
      runtimeId: "pi-local",
      responsibility: "Deliver the change",
      workspaceAccess: "local_direct" as const,
    };
    const remoteEvidenceRole = {
      id: "remote-review",
      role: "Review",
      runtimeId: "hermes-home2",
      workspaceAccess: "evidence_bundle" as const,
    };

    expect(
      collaborationPermissionPreflight(
        [implementation],
        "analysis",
        [],
        translateEnglish,
      )[0]?.reason,
    ).toContain("Full access");
    expect(
      collaborationWorkspacePreflight(
        [remoteEvidenceRole],
        { "hermes-home2": hers2Runtime },
        undefined,
        translateEnglish,
      )[0]?.reason,
    ).toContain("no linked local project folder");
  });

  it("does not require a local project for work on a remote runtime's own device", () => {
    const assignment = {
      id: "remote-maintenance",
      role: "实施",
      runtimeId: "hermes-home2",
      responsibility: "维护智能体所在设备",
    };

    expect(
      collaborationWorkspacePreflight(
        [assignment],
        { "hermes-home2": hers2Runtime },
        undefined,
      ),
    ).toEqual([]);
  });

  it("enables controlled Gateway attachments after probing artifact support", async () => {
    render(
      <RuntimeChat
        runId="chat-openclaw"
        runtime={gatewayRuntime}
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
        "hermes-gateway",
        expect.objectContaining({
          prompt: expect.stringContaining("当前用户请求：\n检查输入"),
          mode: "analysis",
          attachments: [testAttachment],
        }),
      ),
    );
    await screen.findByText("输入已读取。");
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeId: "hermes-gateway",
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "user", content: "检查输入" }),
          expect.objectContaining({ role: "agent", content: "输入已读取。" }),
        ]),
      }),
    );
  });

  it("keeps the Web Agent attachment affordance available for queued follow-ups", async () => {
    render(
      <RuntimeChat
        runId="chat-doubao"
        runtime={doubaoRuntime}
        profile="default"
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments",
        "true",
      ),
    );
    expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
      "data-attachments-while-loading",
      "true",
    );
  });

  it("queues a Web Agent prompt and its attachment until the current run ends", async () => {
    probeAgentRuntime.mockResolvedValue({
      runtimeId: "doubao-web-test",
      state: "healthy",
      checkedAt: Date.now(),
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: true,
        cancellation: true,
        tools: false,
        memory: false,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        artifactUpload: true,
        workspaceAccess: false,
        steering: "follow_up",
      },
    });
    startAgentRuntimeTask
      .mockResolvedValueOnce({
        id: "doubao-run-1",
        runtimeId: "doubao-web-test",
        status: "running",
        output: "",
        sessionId: "web-doubao:conversation-1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        id: "doubao-run-2",
        runtimeId: "doubao-web-test",
        status: "running",
        output: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    getAgentRuntimeRun
      .mockResolvedValueOnce({
        id: "doubao-run-1",
        runtimeId: "doubao-web-test",
        status: "running",
        output: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        id: "doubao-run-1",
        runtimeId: "doubao-web-test",
        status: "succeeded",
        output: "首轮答复",
        sessionId: "web-doubao:conversation-1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .mockResolvedValueOnce({
        id: "doubao-run-2",
        runtimeId: "doubao-web-test",
        status: "succeeded",
        output: "跟进答复",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

    render(
      <RuntimeChat
        runId="chat-doubao-queue"
        runtime={doubaoRuntime}
        profile="default"
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("runtime-composer")).toHaveAttribute(
        "data-attachments-while-loading",
        "true",
      ),
    );

    const send = screen.getByRole("button", { name: "发送测试输入" });
    fireEvent.click(send);
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    fireEvent.click(send);

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
    expect(startAgentRuntimeTask.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        attachments: [testAttachment],
        sessionId: "web-doubao:conversation-1",
      }),
    );
    expect(screen.queryByText("停止当前运行并以新消息恢复？")).toBeNull();
    await screen.findByText("跟进答复");
  });

  it("releases a completed Web Agent turn even when terminal persistence fails", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "doubao-storage-run",
      runtimeId: "doubao-web-test",
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "doubao-storage-run",
      runtimeId: "doubao-web-test",
      status: "succeeded",
      output: "豆包最终答复",
      sessionId: "web-doubao:storage-test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    saveRuntimeConversation.mockImplementation(async (input) => {
      if (
        input.messages.some(
          (message: { role: string; content: string }) =>
            message.role === "agent" && message.content === "豆包最终答复",
        )
      ) {
        throw new Error("storage unavailable");
      }
    });

    render(
      <RuntimeChat
        runId="chat-doubao-storage-failure"
        runtime={doubaoRuntime}
        profile="default"
      />,
    );

    const send = screen.getByRole("button", { name: "发送测试输入" });
    fireEvent.click(send);
    expect(await screen.findByText("豆包最终答复")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "答复已收到，但本地会话记录保存失败；本轮运行已正常结束。",
      ),
    ).toBeInTheDocument();

    fireEvent.click(send);
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
  });

  it("retries an unavailable remote artifact without rerunning the task", async () => {
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-1",
      runtimeId: "hermes-gateway",
      status: "succeeded",
      output: "产物已生成。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      artifacts: [
        {
          id: "remote-report",
          kind: "file",
          label: "报告.pdf",
          unavailableReason: "下载暂时失败。",
        },
      ],
    });
    retryAgentRuntimeArtifact.mockResolvedValue({
      id: "run-1",
      runtimeId: "hermes-gateway",
      status: "succeeded",
      output: "产物已生成。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      artifacts: [
        {
          id: "remote-report",
          kind: "file",
          label: "报告.pdf",
          mime: "application/pdf",
          path: "C:\\Users\\tester\\AppData\\Local\\Temp\\报告.pdf",
        },
      ],
    });
    render(
      <RuntimeChat
        runId="chat-retry-artifact"
        runtime={gatewayRuntime}
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
    await screen.findByRole("complementary", { name: "远程产物重新同步" });
    fireEvent.click(
      screen.getByRole("button", { name: "重新同步产物 报告.pdf" }),
    );

    await waitFor(() =>
      expect(retryAgentRuntimeArtifact).toHaveBeenCalledWith(
        "run-1",
        "remote-report",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "远程产物重新同步" }),
      ).not.toBeInTheDocument(),
    );
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            execution: expect.objectContaining({
              artifacts: [
                expect.objectContaining({
                  id: "remote-report",
                  path: expect.stringContaining("报告.pdf"),
                }),
              ],
            }),
          }),
        ]),
      }),
    );
  });

  it("sends recent conversation context with a Gateway follow-up", async () => {
    render(
      <RuntimeChat
        runId="chat-openclaw-follow-up"
        runtime={gatewayRuntime}
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
        "hermes-gateway",
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
    fireEvent.click(screen.getByRole("button", { name: "选择项目目录" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(selectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "codex-local",
        expect.objectContaining({
          mode: "safe_write",
          fullAccessConfirmed: false,
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

  it("does not inherit the agent's configured workspace in a new conversation", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-pi-dialogue",
      runtimeId: "pi-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-pi-dialogue",
      runtimeId: "pi-local",
      status: "succeeded",
      output: "普通对话已完成。",
      startedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="chat-pi-dialogue"
        runtime={piRuntime}
        profile="default"
      />,
    );

    expect(screen.getByText("自动")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "管理本轮任务权限" }));
    expect(
      screen.getByText("可读写，无移动、删除文件权限"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /自动/ }));
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "pi-local",
        expect.objectContaining({
          mode: "safe_write",
          workspace: undefined,
        }),
      ),
    );
    expect(startAgentRuntimeTask.mock.calls[0][1].workspace).not.toBe(
      piRuntime.config.workspace,
    );
  });

  it("keeps a workspace-less OpenCode greeting read-only and persists the transcript", async () => {
    startAgentRuntimeTask.mockResolvedValue({
      id: "run-opencode-dialogue",
      runtimeId: "opencode-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValue({
      id: "run-opencode-dialogue",
      runtimeId: "opencode-local",
      status: "succeeded",
      output: "OpenCode 已连接。",
      startedAt: Date.now(),
    });
    render(
      <RuntimeChat
        runId="chat-opencode-dialogue"
        runtime={openCodeRuntime}
        profile="default"
      />,
    );

    expect(
      screen.getByRole("button", { name: "选择项目目录" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "opencode-local",
        expect.objectContaining({
          mode: "analysis",
          workspace: undefined,
        }),
      ),
    );
    expect(await screen.findByText("OpenCode 已连接。")).toBeInTheDocument();
    expect(saveRuntimeConversation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runtimeKind: "opencode",
        messages: expect.arrayContaining([
          expect.objectContaining({ content: "OpenCode 已连接。" }),
        ]),
      }),
    );
    expect(
      screen.queryByText(
        "答复已收到，但本地会话记录保存失败；本轮运行已正常结束。",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows OpenCode's automatic reasoning status when ACP has no thinking picker", async () => {
    render(
      <RuntimeChat
        runId="chat-opencode-thinking-status"
        runtime={openCodeRuntime}
        profile="default"
      />,
    );

    const indicator = await screen.findByRole("status", {
      name: "思考等级：自动；OpenCode ACP 未提供可切换选项",
    });
    expect(indicator).toHaveTextContent("思考自动");
    expect(indicator).toHaveAttribute(
      "title",
      "OpenCode ACP 当前未声明可切换的思考等级，思考过程由当前模型自动决定。",
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
    fireEvent.click(screen.getByRole("button", { name: "选择项目目录" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹…" }));
    await waitFor(() => expect(selectFolder).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "管理本轮任务权限" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /完全访问/ }));
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "codex-local",
        expect.objectContaining({
          mode: "full_access",
          fullAccessConfirmed: true,
          workspace: "D:\\selected-project",
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

  it("keeps the last reported model visible while the next reply is pending", async () => {
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "run-model-pending",
      runtimeId: "hermes-home2",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockImplementationOnce(
      () => new Promise<never>(() => undefined),
    );

    render(
      <RuntimeChat
        runId="chat-model-pending"
        runtime={hers2Runtime}
        profile="default"
        initialMessages={[
          {
            id: "previous-answer",
            role: "agent",
            content: "上一轮答复。",
            createdAt: Date.now() - 1_000,
            execution: {
              runId: "previous-run",
              events: [],
              model: { provider: "ark", id: "glm-5.2" },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("ark / glm-5.2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    expect(screen.getByText("ark / glm-5.2")).toBeInTheDocument();
    expect(screen.queryByText("未提供模型")).not.toBeInTheDocument();
  });

  it("keeps a remote final answer out of the thinking group when the operation also failed", async () => {
    const answer =
      "老大，删除被拒了：目标文件存在，但当前 Workspace Gateway 不允许 delete。";
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "run-remote-answer-with-error",
      runtimeId: "hermes-home2",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValueOnce({
      id: "run-remote-answer-with-error",
      runtimeId: "hermes-home2",
      status: "failed",
      output: answer,
      error: "Workspace operation failed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      events: [
        {
          id: "remote-answer-progress",
          type: "progress",
          summary: answer,
          createdAt: Date.now(),
        },
      ],
    });

    render(
      <RuntimeChat
        runId="chat-remote-answer-with-error"
        runtime={hers2Runtime}
        profile="default"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));

    await screen.findByText(answer);
    expect(
      [...document.querySelectorAll(".chat-history-pre")].some(
        (node) => node.textContent === answer,
      ),
    ).toBe(false);
    expect(
      screen.queryByText("Workspace operation failed"),
    ).not.toBeInTheDocument();
  });

  it("shows the actual OpenCode model when the requested model falls back", () => {
    render(
      <RuntimeChat
        runId="chat-opencode-model-fallback"
        runtime={{
          ...openCodeRuntime,
          config: {
            ...openCodeRuntime.config,
            model: "opencode/deepseek-v4-flash-free",
          },
        }}
        profile="default"
        initialMessages={[
          {
            id: "opencode-answer",
            role: "agent",
            content: "我是 OpenCode。",
            createdAt: Date.now(),
            execution: {
              runId: "opencode-model-run",
              events: [],
              model: { provider: "opencode", id: "big-pickle" },
            },
          },
        ]}
      />,
    );

    expect(screen.getByText("opencode / big-pickle")).toBeInTheDocument();
    expect(
      screen.queryByText("opencode/deepseek-v4-flash-free"),
    ).not.toBeInTheDocument();
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

  it("restores local CLI context occupancy using Pi's selected model window", async () => {
    getAgentRuntimeModelContextWindow.mockResolvedValueOnce(1_000_000);
    render(
      <RuntimeChat
        runId="chat-pi-context-history"
        runtime={{
          ...piRuntime,
          config: {
            ...piRuntime.config,
            model: "ark/deepseek-v4-flash",
          },
        }}
        profile="default"
        initialMessages={[
          {
            id: "pi-context-answer",
            role: "agent",
            content: "上下文占用已上报。",
            createdAt: Date.now(),
            execution: {
              runId: "pi-context-run",
              events: [],
              model: { provider: "ark", id: "deepseek-v4-flash" },
              usage: { contextUsedTokens: 3_680 },
            },
          },
        ]}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("runtime-context")).toHaveTextContent(
        "3680/1000000",
      ),
    );
    expect(getAgentRuntimeModelContextWindow).toHaveBeenCalledWith(
      "pi-local",
      "ark",
      "deepseek-v4-flash",
      "default",
    );
  });

  it("routes an interactive Runtime context gauge through /compact", async () => {
    getAgentRuntimeCommandCatalog.mockResolvedValue({
      commands: [
        {
          name: "compact",
          description: "压缩上下文",
          category: "Runtime",
          source: "desktop",
          target: "runtime-control",
          availability: "idle",
        },
      ],
      fetchedAt: Date.now(),
    });
    getAgentRuntimeModelContextWindow.mockResolvedValueOnce(1_000_000);
    render(
      <RuntimeChat
        runId="runtime-context-compact"
        runtime={{
          ...piRuntime,
          config: { ...piRuntime.config, model: "ark/deepseek-v4-flash" },
        }}
        profile="default"
        initialMessages={[
          {
            id: "context-answer",
            role: "agent",
            content: "上下文占用已上报。",
            createdAt: Date.now(),
            execution: {
              runId: "context-run",
              events: [],
              model: { provider: "ark", id: "deepseek-v4-flash" },
              usage: { contextUsedTokens: 3_680 },
            },
          },
        ]}
      />,
    );

    await screen.findByTestId("runtime-context");
    fireEvent.click(
      await screen.findByRole("button", { name: "提交 Runtime 上下文压缩" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "确认压缩" }));
    await waitFor(() =>
      expect(executeAgentRuntimeCommand).toHaveBeenCalledWith(
        expect.objectContaining({ name: "compact", runtimeId: "pi-local" }),
      ),
    );
  });

  it("opens the shared project tree and launches a terminal in its folder", async () => {
    render(
      <RuntimeChat
        runId="chat-pi-worktree"
        runtime={piRuntime}
        profile="default"
        initialWorkspace="D:\selected-project"
      />,
    );

    fireEvent.click(screen.getByTitle("显示项目树"));

    await screen.findByText("README.md");
    expect(readDirectory).toHaveBeenCalledWith("D:\\selected-project");

    fireEvent.click(screen.getByRole("button", { name: "在此打开终端" }));
    await waitFor(() =>
      expect(openTerminal).toHaveBeenCalledWith("D:\\selected-project"),
    );
  });

  it("opens the project tree for a remote Gateway workspace capability", async () => {
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
        memory: false,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        artifactUpload: true,
        workspaceAccess: true,
      },
    });
    render(
      <RuntimeChat
        runId="chat-hers-2-worktree"
        runtime={hers2Runtime}
        profile="default"
        initialWorkspace="test"
        initialWorkspaceId="project-test"
      />,
    );

    const treeButton = await screen.findByTitle("显示项目树");
    fireEvent.click(treeButton);

    await screen.findByText("remote-README.md");
    expect(readWorkspaceDirectory).toHaveBeenCalledWith("project-test", "");
    expect(readDirectory).not.toHaveBeenCalled();
  });

  it("keeps remote Gateway host full access separate from the desktop Workspace Grant", async () => {
    render(
      <RuntimeChat
        runId="chat-hers-2-host-access"
        runtime={hers2Runtime}
        profile="default"
      />,
    );

    const permissionButton = await screen.findByRole("button", {
      name: "管理本轮任务权限",
    });
    fireEvent.click(permissionButton);
    const fullAccess = screen.getByRole("menuitemradio", {
      name: /完全访问/,
    });
    expect(fullAccess).toBeEnabled();
    fireEvent.click(fullAccess);
    expect(screen.getByText("完全访问")).toBeInTheDocument();
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

  it("keeps collaboration control syntax out of ordinary single-agent requests", async () => {
    render(
      <RuntimeChat
        runId="chat-collaboration-policy"
        runtime={piRuntime}
        profile="default"
        runtimeCatalog={{
          "claude-local": claudeRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));

    const prompt = startAgentRuntimeTask.mock.calls[0][1].prompt as string;
    expect(prompt).toBe("检查输入");
    expect(prompt).not.toContain("agents-one-collaboration-proposal");
  });

  it("adds collaboration control only after the user explicitly asks for it", async () => {
    render(
      <RuntimeChat
        runId="chat-collaboration-policy-explicit"
        runtime={piRuntime}
        profile="default"
        runtimeCatalog={{
          "claude-local": claudeRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送泛化协作输入" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));

    const prompt = startAgentRuntimeTask.mock.calls[0][1].prompt as string;
    expect(prompt).toContain("协作必须由用户在当前请求中明确提出");
    expect(prompt.indexOf("Agents One 平台协作规则")).toBeLessThan(
      prompt.indexOf("请使用多智能体协作完成这个任务"),
    );
  });

  it("describes remote native tools separately from an Agents One project grant", async () => {
    render(
      <RuntimeChat
        runId="chat-remote-environment-boundary"
        runtime={hers2Runtime}
        profile="default"
        runtimeCatalog={{ "claude-local": claudeRuntime }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));

    const prompt = startAgentRuntimeTask.mock.calls[0][1].prompt as string;
    expect(prompt).toContain("你的原生工具、终端和绝对路径属于智能体所在设备");
    expect(prompt).toContain("只有本轮明确附带 Workspace Grant");
    expect(prompt).not.toContain("agents-one-collaboration-proposal");
  });

  it("does not auto-start an agent-proposed collaboration without user consent", async () => {
    const onStartCollaboration = vi.fn();
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "run-unrequested-proposal",
      runtimeId: "hermes-home2",
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
    getAgentRuntimeRun.mockResolvedValueOnce({
      id: "run-unrequested-proposal",
      runtimeId: "hermes-home2",
      status: "succeeded",
      output: [
        "我建议分成实施和复核两个角色。",
        "<agents-one-collaboration-proposal>",
        '{"title":"自行分工","assignments":[{"role":"实施","runtimeId":"hermes-home2"},{"role":"复核","runtimeId":"claude-local"}]}',
        "</agents-one-collaboration-proposal>",
      ].join("\n"),
      startedAt: Date.now(),
      completedAt: Date.now(),
    });

    render(
      <RuntimeChat
        runId="chat-unrequested-proposal"
        runtime={hers2Runtime}
        profile="default"
        runtimeCatalog={{ "claude-local": claudeRuntime }}
        onStartCollaboration={onStartCollaboration}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "发送测试输入" }));
    await screen.findByText("我建议分成实施和复核两个角色。");
    expect(onStartCollaboration).not.toHaveBeenCalled();
    expect(screen.queryByText("建议启用多智能体协作")).not.toBeInTheDocument();
  });

  it("keeps a persisted runtime proposal available for optional manual adjustment", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "调整协作安排" }));
    expect(onRequestCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "文档协作",
        assignments: expect.arrayContaining([
          expect.objectContaining({ role: "实施", runtimeId: "claude-local" }),
        ]),
      }),
    );
  });

  it("automatically starts explicit collaboration without duplicating the user brief", async () => {
    const onStartCollaboration = vi.fn().mockResolvedValue({
      taskId: "chat-explicit-collaboration",
      projectFolder: "D:\\default",
      assignments: [
        {
          id: "lead",
          role: "项目负责人",
          runtimeId: "hermes-home2",
          responsibility: "编排、验收",
          workspaceAccess: "evidence_bundle",
        },
        {
          id: "implement",
          role: "实施",
          runtimeId: "pi-local",
          responsibility: "执行",
          workspaceAccess: "local_direct",
        },
        {
          id: "review",
          role: "复核",
          runtimeId: "claude-local",
          responsibility: "复核",
          workspaceAccess: "local_direct",
        },
      ],
    });
    let call = 0;
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: `explicit-run-${++call}`,
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId:
        id === "explicit-run-2"
          ? "pi-local"
          : id === "explicit-run-3"
            ? "claude-local"
            : "hermes-home2",
      status: "succeeded",
      output:
        id === "explicit-run-2"
          ? "已完成实施。"
          : id === "explicit-run-3" || id === "explicit-run-4"
            ? "[验收结论]\n状态：通过\n依据：#1\n结论：文件已核验。"
            : "已完成编排，下一步由 Pi 执行。",
      startedAt: Date.now(),
      completedAt: Date.now(),
      ...(id === "explicit-run-2"
        ? {
            artifacts: [
              {
                kind: "file",
                label: "multi-agent-smoke-test.txt",
                path: "multi-agent-smoke-test.txt",
                sha256: "b".repeat(64),
                sourceMachine: "本机工作区",
                changeSummary: "创建冒烟测试文件。",
              },
            ],
          }
        : {}),
    }));
    render(
      <RuntimeChat
        runId="chat-explicit-collaboration"
        runtime={hers2Runtime}
        profile="default"
        runtimeCatalog={{
          "claude-local": claudeRuntime,
          "pi-local": piRuntime,
        }}
        onStartCollaboration={onStartCollaboration}
      />,
    );

    selectFullAccess();
    fireEvent.click(screen.getByRole("button", { name: "发送明确协作输入" }));

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(4));
    expect(onStartCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({
        assignments: expect.arrayContaining([
          expect.objectContaining({
            role: "项目负责人",
            runtimeId: "hermes-home2",
          }),
          expect.objectContaining({ role: "实施", runtimeId: "pi-local" }),
          expect.objectContaining({
            role: "复核",
            runtimeId: "claude-local",
          }),
        ]),
      }),
      expect.any(Object),
    );
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["hermes-home2", "pi-local", "claude-local", "hermes-home2"]);
    // The platform-owned remote final review receives only the verified
    // handoff/artifact evidence and must not probe a different filesystem.
    expect(startAgentRuntimeTask.mock.calls[3][1].attachments).toBeUndefined();
    const saved = saveRuntimeConversation.mock.calls.at(-1)?.[0];
    expect(linkTaskCollaboration).toHaveBeenCalledWith(
      {
        taskId: "chat-explicit-collaboration",
        conversationId: saved.id,
      },
      "default",
    );
    expect(
      saved.messages.filter(
        (message: { role: string; content: string }) =>
          message.role === "user" &&
          message.content.includes("Agents One 冒烟测试"),
      ),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "调整协作安排" }),
    ).not.toBeInTheDocument();
  });

  it("renders collaboration reasoning and tool events while the assigned runtime is still running", async () => {
    startAgentRuntimeTask.mockResolvedValueOnce({
      id: "live-collaboration-run",
      runtimeId: "pi-local",
      status: "running",
      output: "",
      startedAt: Date.now(),
      events: [],
    });
    getAgentRuntimeRun
      .mockResolvedValueOnce({
        id: "live-collaboration-run",
        runtimeId: "pi-local",
        status: "running",
        output: "",
        startedAt: Date.now(),
        events: [
          {
            id: "thought-1",
            type: "progress",
            summary: "正在检查交付文件。",
            createdAt: Date.now(),
          },
          {
            id: "tool-1",
            type: "tool_call",
            summary: "Pi Agent 调用 read：D:\\default\\smoke-test.txt",
            createdAt: Date.now(),
            tool: {
              name: "read",
              kind: "tool",
              callId: "call-read-1",
              inputSummary: "D:\\default\\smoke-test.txt",
            },
          },
        ],
      })
      // First poll returns the running reasoning/tool events; every later poll
      // returns the succeeded run. A persistent mock (not once) keeps the test
      // stable when the collaboration DAG polls more than twice under load.
      .mockResolvedValue({
        id: "live-collaboration-run",
        runtimeId: "pi-local",
        status: "succeeded",
        output: "复核完成。",
        startedAt: Date.now(),
        completedAt: Date.now(),
        events: [],
      });

    render(
      <RuntimeChat
        runId="live-collaboration"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          assignments: [
            {
              id: "review",
              role: "复核",
              runtimeId: "pi-local",
              responsibility: "只读复核交付物",
              workspaceAccess: "local_direct",
            },
          ],
        }}
        runtimeCatalog={{ "pi-local": piRuntime }}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "live-collaboration",
          content: "复核冒烟测试交付物",
          collaboration: {
            taskId: "live-collaboration-task",
            projectFolder: "D:\\default",
            assignments: [
              {
                id: "review",
                role: "复核",
                runtimeId: "pi-local",
                responsibility: "只读复核交付物",
                workspaceAccess: "local_direct",
              },
            ],
          },
        },
      }),
    );

    expect(await screen.findByText("正在检查交付文件。")).toBeInTheDocument();
    expect(screen.getAllByText("Read File").length).toBeGreaterThan(0);
    expect(document.querySelector(".chat-agent-name")?.textContent).toBe("Pi");
    expect(
      (await screen.findAllByText("复核完成。", {}, { timeout: 8_000 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("正在检查交付文件。")).toBeInTheDocument();
  }, 15_000);

  it("routes a failed review back to implementation and closes only after re-review and lead acceptance", async () => {
    const assignments = [
      {
        id: "lead",
        role: "项目负责人",
        runtimeId: "hermes-home2",
        workspaceAccess: "evidence_bundle" as const,
      },
      {
        id: "implement",
        role: "实施",
        runtimeId: "pi-local",
        workspaceAccess: "local_direct" as const,
      },
      {
        id: "review",
        role: "复核",
        runtimeId: "claude-local",
        workspaceAccess: "local_direct" as const,
      },
    ];
    const runtimeOrder = [
      "hermes-home2",
      "pi-local",
      "claude-local",
      "pi-local",
      "claude-local",
      "hermes-home2",
    ];
    let startIndex = 0;
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: `closed-loop-${++startIndex}`,
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => {
      const attempt = Number(id.split("-").at(-1));
      const runtimeId = runtimeOrder[attempt - 1];
      const implementation = attempt === 2 || attempt === 4;
      const failedReview = attempt === 3;
      return {
        id,
        runtimeId,
        status: "succeeded",
        output: implementation
          ? `第 ${attempt === 2 ? 1 : 2} 次实施完成。`
          : failedReview
            ? "[验收结论]\n状态：不通过\n依据：#1\n结论：文件内容不符合要求，请 Pi 修正。"
            : attempt === 5 || attempt === 6
              ? "[验收结论]\n状态：通过\n依据：#1\n结论：修正后的文件符合要求。"
              : "已完成编排。",
        startedAt: Date.now(),
        completedAt: Date.now(),
        ...(implementation
          ? {
              artifacts: [
                {
                  kind: "file",
                  label: "multi-agent-smoke-test.txt",
                  path: "multi-agent-smoke-test.txt",
                  sha256: (attempt === 2 ? "a" : "b").repeat(64),
                  sourceMachine: "本机工作区",
                  changeSummary:
                    attempt === 2 ? "首次创建。" : "按复核意见修正。",
                },
              ],
            }
          : {}),
      };
    });

    render(
      <RuntimeChat
        runId="collaboration-closed-loop"
        runtime={hers2Runtime}
        profile="default"
        initialWorkspace="D:\\default"
        collaboration={{ assignments }}
        runtimeCatalog={{
          "hermes-home2": hers2Runtime,
          "pi-local": piRuntime,
          "claude-local": claudeRuntime,
        }}
      />,
    );
    selectFullAccess();
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "collaboration-closed-loop",
          content: "闭环测试",
          collaboration: {
            taskId: "collaboration-closed-loop-task",
            assignments,
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(6));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(runtimeOrder);
    expect(startAgentRuntimeTask.mock.calls[3][1].prompt).toContain(
      "文件内容不符合要求",
    );
    expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
      expect.objectContaining({
        taskId: "collaboration-closed-loop-task",
        execution: expect.objectContaining({
          status: "succeeded",
          roleRuns: expect.arrayContaining([
            expect.objectContaining({
              assignmentId: "implement",
              attempt: 2,
              status: "succeeded",
            }),
          ]),
          acceptance: expect.objectContaining({ status: "passed" }),
        }),
      }),
      "default",
    );
  });

  it("automatically dispatches a validated coordinator proposal and reuses its visible planning turn", async () => {
    const assignments = [
      {
        id: "lead",
        role: "项目负责人",
        runtimeId: "hermes-home2",
        workspaceAccess: "evidence_bundle" as const,
      },
      {
        id: "implement",
        role: "实施",
        runtimeId: "pi-local",
        workspaceAccess: "local_direct" as const,
      },
      {
        id: "review",
        role: "复核",
        runtimeId: "claude-local",
        workspaceAccess: "local_direct" as const,
      },
    ];
    const onStartCollaboration = vi.fn().mockResolvedValue({
      taskId: "auto-proposal-task",
      projectFolder: "D:\\default",
      assignments,
    });
    let call = 0;
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: `auto-proposal-run-${++call}`,
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId:
        id === "auto-proposal-run-2"
          ? "pi-local"
          : id === "auto-proposal-run-3"
            ? "claude-local"
            : "hermes-home2",
      status: "succeeded",
      output:
        id === "auto-proposal-run-1"
          ? [
              "我来负责安排并终验。",
              "<agents-one-collaboration-proposal>",
              JSON.stringify({
                title: "自动协作",
                brief: "生成并复核测试文件",
                assignments: [
                  { role: "协调", runtimeId: "hermes-home2" },
                  { role: "实施", runtimeId: "pi-local" },
                  { role: "复核", runtimeId: "claude-local" },
                ],
              }),
              "</agents-one-collaboration-proposal>",
            ].join("\n")
          : id === "auto-proposal-run-2"
            ? "文件已生成。"
            : "[验收结论]\n状态：通过\n依据：#1\n结论：文件符合要求。",
      startedAt: Date.now(),
      completedAt: Date.now(),
      ...(id === "auto-proposal-run-2"
        ? {
            artifacts: [
              {
                kind: "file",
                label: "smoke.txt",
                path: "smoke.txt",
                sha256: "c".repeat(64),
                sourceMachine: "本机工作区",
                changeSummary: "创建 smoke.txt。",
              },
            ],
          }
        : {}),
    }));
    render(
      <RuntimeChat
        runId="auto-proposal-chat"
        runtime={hers2Runtime}
        profile="default"
        runtimeCatalog={{
          "pi-local": piRuntime,
          "claude-local": claudeRuntime,
        }}
        onStartCollaboration={onStartCollaboration}
      />,
    );

    selectFullAccess();
    fireEvent.click(screen.getByRole("button", { name: "发送泛化协作输入" }));

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(4));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["hermes-home2", "pi-local", "claude-local", "hermes-home2"]);
    expect(onStartCollaboration).toHaveBeenCalledTimes(1);
    expect(screen.getByText("我来负责安排并终验。")).toBeInTheDocument();
    const saved = saveRuntimeConversation.mock.calls.at(-1)?.[0];
    expect(
      saved.messages.filter(
        (message: { role: string; content: string }) =>
          message.role === "user" &&
          message.content === "请使用多智能体协作完成这个任务。",
      ),
    ).toHaveLength(1);
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
    fireEvent.click(screen.getByRole("button", { name: "选择项目目录" }));
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

    selectFullAccess();
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

  it("dispatches DAG branches in parallel and waits for both before the join", async () => {
    let branchesReleased = false;
    let call = 0;
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id: `dag-${runtimeId}-${++call}`,
      runtimeId,
      status: "running",
      output: "",
      startedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => {
      const runtimeId = id.split("-").slice(1, -1).join("-");
      const isBranch =
        runtimeId === "codex-local" || runtimeId === "claude-local";
      if (isBranch && !branchesReleased) {
        return {
          id,
          runtimeId,
          status: "running",
          output: "",
          startedAt: Date.now(),
        };
      }
      return {
        id,
        runtimeId,
        status: "succeeded",
        output:
          runtimeId === "hermes-gateway"
            ? "[验收结论]\n状态：通过\n依据：#1 #2\n结论：两个分支均完成。"
            : `${runtimeId} 完成`,
        startedAt: Date.now(),
        completedAt: Date.now(),
        ...(isBranch
          ? {
              artifacts: [
                {
                  kind: "file",
                  label: `${runtimeId}.txt`,
                  path: `${runtimeId}.txt`,
                  sha256: "d".repeat(64),
                  sourceMachine: "本机工作区",
                  changeSummary: "创建分支产物。",
                },
              ],
            }
          : {}),
      };
    });
    const assignments = [
      { id: "plan", role: "设计", runtimeId: "pi-local", dependsOn: [] },
      {
        id: "front",
        role: "开发前端",
        runtimeId: "codex-local",
        dependsOn: ["plan"],
        workspaceAccess: "local_direct" as const,
      },
      {
        id: "back",
        role: "开发后端",
        runtimeId: "claude-local",
        dependsOn: ["plan"],
        workspaceAccess: "local_direct" as const,
      },
      {
        id: "join",
        role: "验收",
        runtimeId: "hermes-gateway",
        dependsOn: ["front", "back"],
        workspaceAccess: "remote_mapping" as const,
        workspaceRef: "D:\\default",
      },
    ];
    render(
      <RuntimeChat
        runId="dag-collaboration"
        runtime={piRuntime}
        profile="default"
        initialMessages={[
          {
            id: "parent-history",
            role: "agent",
            content: "主会话已有答复",
            createdAt: 1,
          },
        ]}
        collaboration={{ assignments }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
          "hermes-gateway": gatewayRuntime,
        }}
      />,
    );
    selectFullAccess();
    window.dispatchEvent(
      new CustomEvent("agents-one:submit-task-message", {
        detail: {
          runId: "dag-collaboration",
          content: "并行开发后汇合验收",
          collaboration: {
            taskId: "dag-task",
            projectFolder: "D:\\default",
            assignments,
          },
        },
      }),
    );

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(3));
    expect(
      startAgentRuntimeTask.mock.calls
        .slice(1, 3)
        .map(([runtimeId]) => runtimeId)
        .sort(),
    ).toEqual(["claude-local", "codex-local"]);
    expect(startAgentRuntimeTask).not.toHaveBeenCalledWith(
      "hermes-gateway",
      expect.anything(),
    );
    await waitFor(() => {
      expect(screen.getAllByText("执行中")).toHaveLength(2);
      expect(
        screen.getByText("Codex 正在思考并准备执行……"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Claude Code 正在思考并准备执行……"),
      ).toBeInTheDocument();
      expect(
        screen
          .getByText("主会话已有答复")
          .closest(".chat-message")
          ?.querySelector(".chat-agent-name")?.textContent,
      ).toBe("Pi");
    });
    branchesReleased = true;
    await waitFor(
      () => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(4),
      { timeout: 4_000 },
    );
    expect(startAgentRuntimeTask.mock.calls[3][0]).toBe("hermes-gateway");
    await waitFor(
      () =>
        expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
          expect.objectContaining({
            execution: expect.objectContaining({ status: "succeeded" }),
          }),
          "default",
        ),
      { timeout: 4_000 },
    );
  });

  it("hides the collaboration dashboard and restores it from a compact trigger", () => {
    render(
      <RuntimeChat
        runId="dashboard-visibility"
        runtime={hers2Runtime}
        profile="default"
        collaboration={{
          taskId: "dashboard-task",
          assignments: [
            {
              id: "lead",
              role: "项目负责人",
              runtimeId: "hermes-home2",
            },
          ],
        }}
        runtimeCatalog={{ "hermes-home2": hers2Runtime }}
      />,
    );

    expect(screen.getByLabelText("智能体协作看板")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "隐藏协作看板" }));
    expect(screen.queryByLabelText("智能体协作看板")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示协作看板" }));
    expect(screen.getByLabelText("智能体协作看板")).toBeInTheDocument();
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

    selectFullAccess();
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
              runtimeId: "hermes-gateway",
              workspaceAccess: "evidence_bundle",
            },
            { id: "test", role: "测试", runtimeId: "claude-local" },
          ],
        }}
        runtimeCatalog={{
          "hermes-gateway": gatewayRuntime,
          "claude-local": claudeRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    selectFullAccess();
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
                runtimeId: "hermes-gateway",
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
              runtimeId: "hermes-gateway",
              workspaceAccess: "evidence_bundle",
            },
          ],
        }}
        runtimeCatalog={{
          "hermes-gateway": gatewayRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    selectFullAccess();
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
                runtimeId: "hermes-gateway",
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
      "hermes-gateway",
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
              runtimeId: "hermes-gateway",
              workspaceAccess: "evidence_bundle",
            },
          ],
        }}
        runtimeCatalog={{
          "hermes-gateway": gatewayRuntime,
          "pi-local": piRuntime,
        }}
      />,
    );

    selectFullAccess();
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
                runtimeId: "hermes-gateway",
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
        "代码已经修改。\n[交付物]\n路径：D:\\worktrees\\feature\\src\\feature.ts\nSHA-256：aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n来源机器：本机工作区\n变更摘要：新增 feature 实现。",
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
              : "hermes-gateway",
      status: "succeeded",
      output: outputs[id],
      startedAt: Date.now(),
      completedAt: Date.now(),
      ...(id === "run-implement"
        ? {
            diffSummary: " src/feature.ts | 2 ++",
            artifacts: [
              {
                kind: "file",
                label: "feature.ts",
                path: "src/feature.ts",
                sha256: "a".repeat(64),
                sourceMachine: "本机工作区",
                changeSummary: "新增 feature 实现。",
              },
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
              runtimeId: "hermes-gateway",
              responsibility: "基于真实产物验收",
            },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
          "hermes-gateway": gatewayRuntime,
        }}
      />,
    );
    selectFullAccess();
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
                runtimeId: "hermes-gateway",
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
              path: "src/feature.ts",
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
              ? "hermes-gateway"
              : "pi-local",
      status: "succeeded",
      output:
        id === "run-implement"
          ? "完成实施。\n[交付物]\n路径：D:\\project\\output.txt\nSHA-256：bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n来源机器：本机工作区\n变更摘要：创建 output.txt。"
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
                kind: "file",
                label: "交付文件",
                path: "output.txt",
                sha256: "b".repeat(64),
                sourceMachine: "本机工作区",
                changeSummary: "创建 output.txt。",
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
            { id: "accept", role: "验收", runtimeId: "hermes-gateway" },
          ],
        }}
        runtimeCatalog={{
          "pi-local": piRuntime,
          "codex-local": codexRuntime,
          "claude-local": claudeRuntime,
          "hermes-gateway": gatewayRuntime,
        }}
      />,
    );
    selectFullAccess();
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
              { id: "accept", role: "验收", runtimeId: "hermes-gateway" },
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
      "hermes-gateway",
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
    selectFullAccess();
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
    selectFullAccess();
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

  it("pauses the active collaboration run when a role avatar opens directed dialogue", async () => {
    render(
      <RuntimeChat
        runId="collaboration-active-intervention"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          taskId: "collaboration-active-task",
          assignments: [
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "review", role: "复核", runtimeId: "claude-local" },
          ],
          execution: {
            status: "running",
            brief: "实现后复核",
            updatedAt: Date.now(),
            activeAssignmentId: "implement",
            roleRuns: [
              {
                assignmentId: "implement",
                role: "实施",
                runtimeId: "codex-local",
                runtimeRunId: "active-implement-run",
                status: "running",
              },
              {
                assignmentId: "review",
                role: "复核",
                runtimeId: "claude-local",
                status: "pending",
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

    fireEvent.click(
      screen.getByRole("button", { name: "与 Codex（实施）沟通" }),
    );

    await waitFor(() =>
      expect(window.agentsOneAPI.cancelAgentRuntimeTask).toHaveBeenCalledWith(
        "active-implement-run",
      ),
    );
    expect(
      screen.getByRole("complementary", { name: "角色人工介入" }),
    ).toBeInTheDocument();
  });

  it("reassigns the focused role without starting downstream work", async () => {
    render(
      <RuntimeChat
        runId="collaboration-role-reassign"
        runtime={piRuntime}
        profile="default"
        collaboration={{
          taskId: "collaboration-reassign-task",
          assignments: [
            { id: "implement", role: "实施", runtimeId: "codex-local" },
            { id: "review", role: "复核", runtimeId: "claude-local" },
          ],
          execution: {
            status: "waiting_for_user",
            brief: "实现后复核",
            updatedAt: Date.now(),
            activeAssignmentId: "implement",
            roleRuns: [
              {
                assignmentId: "implement",
                role: "实施",
                runtimeId: "codex-local",
                status: "waiting_for_user",
              },
              {
                assignmentId: "review",
                role: "复核",
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

    fireEvent.click(
      screen.getByRole("button", { name: "与 Codex（实施）沟通" }),
    );
    fireEvent.change(screen.getByLabelText("改派当前角色"), {
      target: { value: "pi-local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "改派当前角色" }));

    await waitFor(() =>
      expect(saveTaskCollaboration).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: "collaboration-reassign-task",
          assignments: expect.arrayContaining([
            expect.objectContaining({
              id: "implement",
              runtimeId: "pi-local",
            }),
          ]),
        }),
        "default",
      ),
    );
    expect(startAgentRuntimeTask).not.toHaveBeenCalled();
    expect(screen.getAllByText("Pi").length).toBeGreaterThan(0);
  });

  it("keeps avatar-directed role dialogue paused across turns and resumes downstream only on confirmation", async () => {
    let implementationAttempt = 0;
    startAgentRuntimeTask.mockImplementation(async (runtimeId: string) => ({
      id:
        runtimeId === "codex-local"
          ? `run-implement-dialogue-${++implementationAttempt}`
          : "run-test-after-dialogue",
      runtimeId,
      status: "running",
      output: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
    getAgentRuntimeRun.mockImplementation(async (id: string) => ({
      id,
      runtimeId: id.startsWith("run-implement-dialogue")
        ? "codex-local"
        : "claude-local",
      status: "succeeded",
      output:
        id === "run-implement-dialogue-1"
          ? "已按第一轮人工指令完成实施。"
          : id === "run-implement-dialogue-2"
            ? "已完成第二轮确认并重新验证。"
            : "测试通过。",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...(id.startsWith("run-implement-dialogue")
        ? { sessionId: "codex-dialogue-session" }
        : {}),
      ...(id.startsWith("run-implement-dialogue")
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

    fireEvent.click(
      screen.getByRole("button", { name: "与 Codex（实施）沟通" }),
    );
    fireEvent.change(screen.getByLabelText("给当前角色的人工指令"), {
      target: { value: "只修改 docs 目录，并说明改动文件。" },
    });
    fireEvent.change(screen.getByLabelText("本角色权限"), {
      target: { value: "full_access" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给此智能体" }));

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    expect(startAgentRuntimeTask.mock.calls[0][0]).toBe("codex-local");
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "【用户已同步给协作组】只修改 docs 目录",
    );
    expect(startAgentRuntimeTask.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        mode: "full_access",
        fullAccessConfirmed: true,
      }),
    );
    await waitFor(() =>
      expect(updateTaskCollaborationExecution).toHaveBeenLastCalledWith(
        expect.objectContaining({
          taskId: "collaboration-resume-task",
          execution: expect.objectContaining({
            status: "paused",
            interventions: expect.arrayContaining([
              expect.objectContaining({
                visibility: "shared",
                assignmentId: "implement",
                accessMode: "full_access",
                response: "已按第一轮人工指令完成实施。",
              }),
            ]),
          }),
        }),
        "default",
      ),
    );
    expect(
      screen.getAllByText("已按第一轮人工指令完成实施。").length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("给当前角色的人工指令"), {
      target: { value: "再确认一次测试结果。" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送给此智能体" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(2));
    expect(
      startAgentRuntimeTask.mock.calls.map(([runtimeId]) => runtimeId),
    ).toEqual(["codex-local", "codex-local"]);
    expect(startAgentRuntimeTask.mock.calls[1][1]).toEqual(
      expect.objectContaining({ sessionId: "codex-dialogue-session" }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "继续后续任务" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "继续后续任务" }));
    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(3));
    expect(startAgentRuntimeTask.mock.calls[2][0]).toBe("claude-local");
    expect(startAgentRuntimeTask.mock.calls[2][1].prompt).toContain(
      "只修改 docs 目录",
    );
    expect(startAgentRuntimeTask.mock.calls[2][1].prompt).toContain(
      "已完成第二轮确认并重新验证。",
    );
  });
});
