import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./types";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { MessageList } from "./MessageList";

describe("MessageList runtime identity and activity markers", () => {
  it("keeps the configured avatar on thought rows and the Agents One mark below tool history", () => {
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
    expect(screen.getAllByLabelText("Agents One")).toHaveLength(1);

    const toolGroup = container.querySelector(".chat-tool-group");
    expect(toolGroup?.previousElementSibling?.className).toBe("chat-avatar");
    expect(
      toolGroup?.previousElementSibling?.classList.contains(
        "chat-avatar-agents-one",
      ),
    ).toBe(false);
  });
});
