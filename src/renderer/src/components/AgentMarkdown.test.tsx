import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "common.copied": "Copied",
        "common.showMore": "Show more",
        "common.showLess": "Show less",
      })[key] ?? key,
  }),
}));

vi.mock("./MediaImage", () => ({
  MediaImage: () => <div data-testid="media-image" />,
  DownloadChip: () => <div data-testid="download-chip" />,
}));

describe("AgentMarkdown", () => {
  it("renders Unicode box-drawing code blocks as plain text", () => {
    const markdown = [
      "```text",
      "project",
      "├── src",
      "│   └── main.ts",
      "└── README.md",
      "```",
    ].join("\n");

    const { container } = render(<AgentMarkdown>{markdown}</AgentMarkdown>);
    const plain = container.querySelector(".chat-code-plain");

    expect(plain).not.toBeNull();
    expect(plain?.textContent).toContain("├── src");
    expect(plain?.textContent).toContain("│   └── main.ts");
    expect(plain?.textContent).toContain("└── README.md");
    expect(container.querySelector(".token")).toBeNull();
  });
});
