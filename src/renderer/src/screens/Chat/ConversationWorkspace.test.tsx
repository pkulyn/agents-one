import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConversationWorkspace } from "./ConversationWorkspace";

describe("ConversationWorkspace", () => {
  it("keeps messages and composer in one column beside the task panel", () => {
    const { container, rerender } = render(
      <ConversationWorkspace
        panelOpen={false}
        composer={<div data-testid="composer">composer</div>}
      >
        <div data-testid="messages">messages</div>
      </ConversationWorkspace>,
    );

    expect(
      screen.queryByRole("button", { name: "显示对话任务" }),
    ).not.toBeInTheDocument();

    rerender(
      <ConversationWorkspace
        panelOpen
        composer={<div data-testid="composer">composer</div>}
        panel={<aside data-testid="panel">panel</aside>}
      >
        <div data-testid="messages">messages</div>
      </ConversationWorkspace>,
    );

    const workspace = container.querySelector(".conversation-workspace");
    const main = container.querySelector(".conversation-main");
    expect(workspace).toHaveClass("conversation-workspace--panel-open");
    expect(main).toContainElement(screen.getByTestId("messages"));
    expect(main).toContainElement(screen.getByTestId("composer"));
    expect(workspace?.lastElementChild).toBe(screen.getByTestId("panel"));
  });
});
