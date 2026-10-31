import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationFiles } from "./ConversationFiles";
import { AgentMarkdown } from "./AgentMarkdown";
vi.mock("./useI18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
const path = "D:/Users/chenfl/Desktop/AI 周报(V1.0).md";
const delivery = { conversationId: "c", messageId: "m", artifacts: [] };
beforeEach(() => {
  Object.defineProperty(window, "agentsOneAPI", {
    configurable: true,
    value: {
      conversationFileInfo: vi.fn().mockResolvedValue({
        name: "AI 周报(V1.0).md",
        path,
        relativePath: "../Desktop/AI 周报(V1.0).md",
        size: 1234,
        image: false,
      }),
      conversationFileAction: vi.fn().mockResolvedValue(true),
    },
  });
});
describe("delivered documents", () => {
  it("keeps list structure, renders clickable filenames and cards, and routes the native menu to the same reply", async () => {
    const content = "1. 已完成文件：`" + path + "`\n2. 其他说明不变。";
    const { container } = render(
      <ConversationFiles delivery={delivery} content={content}>
        <AgentMarkdown>{content}</AgentMarkdown>
      </ConversationFiles>,
    );
    await waitFor(() =>
      expect(container.querySelector(".chat-document-link")).not.toBeNull(),
    );
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    const link = container.querySelector(".chat-document-link")!;
    expect(link.textContent).toBe("AI 周报(V1.0).md");
    expect(link.getAttribute("title")).toBe(path);
    fireEvent.click(link);
    expect(window.agentsOneAPI.conversationFileAction).toHaveBeenCalledWith(
      { conversationId: "c", messageId: "m", path },
      "open",
      expect.any(Object),
    );
    fireEvent.contextMenu(link);
    expect(window.agentsOneAPI.conversationFileAction).toHaveBeenCalledWith(
      expect.any(Object),
      "menu",
      expect.objectContaining({
        openWith: "chat.files.openWith",
        copyRelative: "chat.files.copyRelative",
      }),
    );
    expect(container.querySelectorAll(".chat-document-card")).toHaveLength(1);
  });
  it("renders a Markdown file link without navigating the browser", async () => {
    const content = "文件：[周报](<" + path + ">)";
    const { container } = render(
      <ConversationFiles delivery={delivery} content={content}>
        <AgentMarkdown>{content}</AgentMarkdown>
      </ConversationFiles>,
    );
    await waitFor(() =>
      expect(container.querySelector(".chat-document-link")?.textContent).toBe(
        "周报",
      ),
    );
  });
  it("retains unverified paths as text, and displays actual diff counts excluding headers", async () => {
    vi.mocked(window.agentsOneAPI.conversationFileInfo).mockResolvedValue(null);
    const content = "`" + path + "`";
    const diffs = {
      ...delivery,
      artifacts: [
        {
          kind: "diff" as const,
          label: "周报修订",
          content:
            "--- a/report.md\n+++ b/report.md\n@@ -1 +1,2 @@\n-old\n+new\n+detail",
        },
      ],
    };
    const { container } = render(
      <ConversationFiles delivery={diffs} content={content}>
        <AgentMarkdown>{content}</AgentMarkdown>
      </ConversationFiles>,
    );
    await waitFor(() =>
      expect(window.agentsOneAPI.conversationFileInfo).toHaveBeenCalled(),
    );
    expect(container.querySelector(".chat-document-link")).toBeNull();
    expect(screen.getByText("+2")).toBeTruthy();
    expect(screen.getByText("−1")).toBeTruthy();
    expect(container.querySelector("code")?.textContent).toBe(path);
  });
});
