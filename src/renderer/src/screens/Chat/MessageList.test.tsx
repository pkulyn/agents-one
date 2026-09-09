import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { MessageList } from "./MessageList";

describe("MessageList runtime identity and activity markers", () => {
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

    expect(screen.getByText("2026年8月27日（星期四）09:05")).toBeInTheDocument();
    expect(screen.getByText("· 用时 13 分 56 秒")).toBeInTheDocument();
    expect(screen.getByLabelText("从这条答复创建新对话分支")).toBeInTheDocument();
    expect(screen.getAllByLabelText("chat.copyMessage")).toHaveLength(1);
    fireEvent.click(screen.getByLabelText("从这条答复创建新对话分支"));
    expect(onBranchFromMessage).toHaveBeenCalledWith("reply");
    expect(screen.queryByText("2026年8月27日（星期四）09:06")).not.toBeInTheDocument();
  });
});
