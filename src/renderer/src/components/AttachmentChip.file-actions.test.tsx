import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../../../shared/attachments";
import { AttachmentChip } from "./AttachmentChip";

vi.mock("./useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

describe("AttachmentChip local file actions", () => {
  beforeEach(() => {
    Object.defineProperty(window, "hermesAPI", {
      configurable: true,
      value: {
        openFileInEditor: vi.fn(async () => true),
        showFileMenu: vi.fn(),
      },
    });
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
    expect(window.hermesAPI.openFileInEditor).toHaveBeenCalledWith(
      attachment.path,
    );

    fireEvent.contextMenu(link);
    expect(window.hermesAPI.showFileMenu).toHaveBeenCalledWith(
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
