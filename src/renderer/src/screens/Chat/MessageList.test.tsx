import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./types";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
  }),
}));

import { MessageList } from "./MessageList";

describe("MessageList runtime identity and activity markers", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });

  it("keeps the configured avatar on thought rows without a separate platform activity logo", () => {
    const avatar = "data:image/png;base64,YXZhdGFy";
    const messages: ChatMessage[] = [
      { id: "user", role: "user", content: "生成图表" },
      {
        id: "reasoning",
        kind: "reasoning",
        role: "agent",
        text: "正在生成图表。",
      },
      {
        id: "tool",
        kind: "tool_call",
        role: "agent",
        callId: "call-1",
        name: "execute_code",
        args: "{}",
        status: "running",
      },
    ];

    const { container } = render(
      <MessageList
        messages={messages}
        isLoading
        toolProgress={null}
        agentName="Hers-2"
        agentAvatar={avatar}
        agentColor="#2288cc"
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
      />,
    );

    expect(screen.getByAltText("Hers-2").getAttribute("src")).toBe(avatar);
    expect(screen.getByText("Hers-2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Agents One")).not.toBeInTheDocument();

    const toolGroup = container.querySelector(".chat-tool-group");
    const toolRow = toolGroup?.closest(".chat-message-history");
    expect(toolRow?.firstElementChild?.className).toBe("chat-avatar");
    expect(
      toolRow?.firstElementChild?.classList.contains("chat-avatar-agents-one"),
    ).toBe(false);
  });

  it("shows the runtime avatar and name when a trace begins with a tool call", () => {
    const messages: ChatMessage[] = [
      {
        id: "tool-only",
        kind: "tool_call",
        role: "agent",
        callId: "call-tool-only",
        name: "read_file",
        args: "D:\\project\\report.md",
        status: "running",
        agentRuntimeId: "claude-local",
        agentName: "Claude Code",
        agentColor: "#cc8844",
      },
    ];

    render(
      <MessageList
        messages={messages}
        isLoading
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
      />,
    );

    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Claude Code")).toBeInTheDocument();
    expect(screen.getAllByText("Read File").length).toBeGreaterThan(0);
  });

  it("routes a collaboration avatar click with the stable assignment identity", () => {
    const onAgentAvatarClick = vi.fn();
    const messages: ChatMessage[] = [
      {
        id: "pi-reply",
        kind: "assistant",
        role: "agent",
        content: "正在修正。",
        agentRuntimeId: "pi-local",
        agentName: "Pi",
        collaborationRole: "实施",
        collaborationAssignmentId: "implement",
      },
    ];

    render(
      <MessageList
        messages={messages}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
        onAgentAvatarClick={onAgentAvatarClick}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "与 Pi 沟通" }));
    expect(onAgentAvatarClick).toHaveBeenCalledWith(
      expect.objectContaining({
        agentRuntimeId: "pi-local",
        collaborationAssignmentId: "implement",
      }),
    );
  });

  it("shows the agent identity on an answer after a trace-unavailable system card", () => {
    const avatar = "data:image/png;base64,Y2xhdWRl";
    const identity = {
      agentRuntimeId: "claude-local",
      agentName: "Claude Code",
      agentAvatar: avatar,
      collaborationRole: "复核",
      collaborationAssignmentId: "review",
    };
    const messages: ChatMessage[] = [
      {
        id: "trace-unavailable",
        kind: "system",
        role: "agent",
        title: "思考记录未上报",
        detail: "该运行服务未提供可展示的思考摘要。",
        ...identity,
      },
      {
        id: "claude-answer",
        kind: "assistant",
        role: "agent",
        content: "复核完成。",
        ...identity,
      },
    ];

    render(
      <MessageList
        messages={messages}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
      />,
    );

    expect(screen.getByText("思考记录未上报")).toBeInTheDocument();
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByAltText("Claude Code")).toHaveAttribute("src", avatar);
  });

  it("keeps copy, branch, and full time on real replies but not control notices", () => {
    const onBranchFromMessage = vi.fn();
    render(
      <MessageList
        messages={[
          {
            id: "reply",
            kind: "assistant",
            role: "agent",
            content: "任务完成。",
            timestamp: new Date(2026, 7, 27, 9, 5).getTime(),
            runtimeMeta: {
              durationMs: 836_000,
            },
          },
          {
            id: "control",
            kind: "assistant",
            role: "agent",
            content: "当前会话已切换到模型。",
            timestamp: new Date(2026, 7, 27, 9, 6).getTime(),
            isControlMessage: true,
          },
        ]}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
        onBranchFromMessage={onBranchFromMessage}
      />,
    );

    expect(
      screen.getByText("2026年8月27日（星期四）09:05"),
    ).toBeInTheDocument();
    expect(screen.getByText("· 用时 13 分 56 秒")).toBeInTheDocument();
    expect(
      screen.getByLabelText("从这条答复创建新对话分支"),
    ).toBeInTheDocument();
    expect(screen.getAllByLabelText("复制消息")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("从这条答复创建新对话分支"));
    expect(onBranchFromMessage).toHaveBeenCalledWith("reply");
    expect(
      screen.queryByText("2026年8月27日（星期四）09:06"),
    ).not.toBeInTheDocument();
  });

  it("localizes message metadata in English", () => {
    i18nTestState.locale = "en";
    render(
      <MessageList
        messages={[
          {
            id: "english-reply",
            kind: "assistant",
            role: "agent",
            content: "Done.",
            timestamp: new Date(2026, 7, 27, 9, 5).getTime(),
            runtimeMeta: { durationMs: 56_000 },
          },
        ]}
        isLoading={false}
        toolProgress={null}
        onApprove={vi.fn()}
        onDeny={vi.fn()}
        onClarifyResolved={vi.fn()}
        onBranchFromMessage={vi.fn()}
      />,
    );

    expect(screen.getByText("8/27/2026 (Thursday) 09:05")).toBeVisible();
    expect(screen.getByText("· 56 sec")).toBeVisible();
    expect(
      screen.getByLabelText(
        "Create a new conversation branch from this response",
      ),
    ).toBeVisible();
  });
});

const foldTrace: ChatMessage[] = [
  { id: "u-fold", role: "user", content: "Run a task" },
  { id: "r-fold", kind: "reasoning", role: "agent", text: "Initial plan" },
  {
    id: "t-fold",
    kind: "tool_call",
    role: "agent",
    callId: "call-fold",
    name: "read",
    args: "brief.md",
  },
  {
    id: "o-fold",
    kind: "tool_result",
    role: "agent",
    callId: "call-fold",
    name: "read",
    content: "Read result",
  },
  {
    id: "a-fold",
    role: "agent",
    content: "Final answer",
    runtimeMeta: { durationMs: 669000 },
  },
];
function foldProps(
  messages = foldTrace,
  isLoading = false,
): React.ComponentProps<typeof MessageList> {
  return {
    messages,
    isLoading,
    toolProgress: null,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
    onClarifyResolved: vi.fn(),
  };
}
describe("Completed execution trace grouping", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });
  // @lat: [[runtime-chat#Runtime Chat Rendering#Completed execution process fold]]
  it("folds reasoning and paired tools behind one row with the chevron after duration", () => {
    const { container, rerender } = render(<MessageList {...foldProps()} />);
    const summary = screen.getByRole("button", { name: /执行过程/ });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("1 段思考")).toBeVisible();
    expect(screen.getByText("1 次工具调用")).toBeVisible();
    expect(screen.getByText("Final answer")).toBeVisible();
    expect(
      container.querySelector(".chat-execution-trace-items"),
    ).not.toBeVisible();
    expect(summary.lastElementChild).toHaveClass(
      "chat-execution-trace-chevron",
    );
    expect(summary.lastElementChild?.previousElementSibling).toHaveTextContent(
      "11 分 9 秒",
    );
    expect(summary).not.toHaveTextContent(/展开|收起/);
    fireEvent.click(summary);
    expect(
      container.querySelector(".chat-execution-trace-items"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "思考" }));
    expect(screen.getByText("Initial plan")).toBeVisible();
    rerender(<MessageList {...foldProps([...foldTrace])} />);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });
  it("keeps active process rows live and folds them when execution ends", () => {
    const active = foldTrace.slice(0, -1);
    const { rerender } = render(<MessageList {...foldProps(active, true)} />);
    expect(
      screen.queryByRole("button", { name: /执行过程/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "思考" })).toBeVisible();
    rerender(<MessageList {...foldProps()} />);
    expect(screen.getByRole("button", { name: /执行过程/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
  it("keeps completed earlier turns folded while the next turn streams", () => {
    render(
      <MessageList
        {...foldProps(
          [
            ...foldTrace,
            { id: "u-next", role: "user", content: "Continue" },
            {
              id: "r-next",
              kind: "reasoning",
              role: "agent",
              text: "Next thought",
            },
          ],
          true,
        )}
      />,
    );
    expect(screen.getAllByRole("button", { name: /执行过程/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "思考中…" })).toBeVisible();
  });
  it("keeps runtime identities separate and confirmation outside the process", () => {
    const withIdentity = (
      runtimeId: string,
      name: string,
      suffix: string,
    ): ChatMessage[] =>
      foldTrace.slice(1, 4).map((m) => ({
        ...m,
        id: m.id + suffix,
        agentRuntimeId: runtimeId,
        agentName: name,
      }));
    render(
      <MessageList
        {...foldProps([
          ...withIdentity("pi", "Pi", "1"),
          ...withIdentity("opencode", "OpenCode", "2"),
          {
            id: "clarify-fold",
            kind: "clarify",
            role: "agent",
            requestId: "question-fold",
            question: "Choose a scope",
            choices: ["Current folder"],
          },
          { id: "final-fold", role: "agent", content: "Needs confirmation" },
        ])}
      />,
    );
    expect(screen.getAllByRole("button", { name: /执行过程/ })).toHaveLength(2);
    expect(screen.getByText("Pi")).toBeVisible();
    expect(screen.getByText("OpenCode")).toBeVisible();
    expect(screen.getByText("Choose a scope")).toBeVisible();
    expect(screen.getByText("Needs confirmation")).toBeVisible();
  });
  it("localizes the summary and counts in English", () => {
    i18nTestState.locale = "en";
    render(<MessageList {...foldProps()} />);
    const summary = screen.getByRole("button", { name: /Execution details/ });
    expect(summary).toHaveTextContent("1 thought");
    expect(summary).toHaveTextContent("1 tool call");
    expect(summary).not.toHaveTextContent(/执行过程|展开|收起|Expand|Collapse/);
  });
});
