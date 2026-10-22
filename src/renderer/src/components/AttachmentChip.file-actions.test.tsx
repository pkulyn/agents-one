import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../shared/attachments";
import { AttachmentChip } from "./AttachmentChip";

vi.mock("./useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AttachmentChip local file actions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        openFileInEditor: vi.fn(async () => true),
        openAgentRuntimeArtifact: vi.fn(async () => true),
        showFileMenu: vi.fn(),
      },
    });
  });

  it("uses the same fixed attachment card structure for images and documents", () => {
    const image: Attachment = {
      id: "image-1",
      kind: "image",
      name: "diagram.png",
      mime: "image/png",
      size: 512,
      dataUrl: "data:image/png;base64,aW1hZ2U=",
    };
    const document: Attachment = {
      id: "document-1",
      kind: "path-ref",
      name: "notes.pdf",
      mime: "application/pdf",
      size: 1024,
    };
    const { container } = render(
      <>
        <AttachmentChip attachment={image} />
        <AttachmentChip attachment={document} />
      </>,
    );

    const cards = container.querySelectorAll(".attachment-chip");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveClass("attachment-chip-image");
    expect(cards[1]).toHaveClass("attachment-chip-path-ref");
    expect(
      Array.from(cards).every((card) =>
        card.querySelector(".attachment-chip-body"),
      ),
    ).toBe(true);
    expect(cards[0]?.querySelector(".attachment-chip-thumb")).toBeTruthy();
    expect(cards[1]?.querySelector(".attachment-chip-icon")).toBeTruthy();
  });

  it("opens a Runtime artifact through its opaque capability", () => {
    const attachment: Attachment = {
      id: "runtime-artifact-report-1",
      kind: "path-ref",
      name: "report.pdf",
      mime: "application/pdf",
      size: 433,
      runtimeArtifact: { runId: "run-1", artifactId: "report-1" },
    };
    render(<AttachmentChip attachment={attachment} />);

    fireEvent.click(screen.getByRole("button", { name: "report.pdf" }));
    expect(window.agentsOneAPI.openAgentRuntimeArtifact).toHaveBeenCalledWith(
      "run-1",
      "report-1",
    );
    expect(window.agentsOneAPI.openFileInEditor).not.toHaveBeenCalled();
  });

  it("renders a verified runtime artifact as an openable file link", () => {
    const attachment: Attachment = {
      id: "artifact-1",
      kind: "path-ref",
      name: "smoke-test.txt",
      mime: "text/plain",
      size: 433,
      path: "D:\\project\\smoke-test.txt",
    };
    const { container } = render(<AttachmentChip attachment={attachment} />);
    const link = screen.getByRole("button", { name: "smoke-test.txt" });

    expect(container.querySelector(".attachment-chip")).toHaveAttribute(
      "title",
      attachment.path,
    );
    fireEvent.click(link);
    expect(window.agentsOneAPI.openFileInEditor).toHaveBeenCalledWith(
      attachment.path,
    );

    fireEvent.contextMenu(link);
    expect(window.agentsOneAPI.showFileMenu).toHaveBeenCalledWith(
      attachment.path,
      {
        open: "chat.fileMenu.open",
        copyPath: "chat.fileMenu.copyPath",
        copyContent: "chat.fileMenu.copyContent",
        reveal: "chat.fileMenu.reveal",
      },
    );
  });
});
