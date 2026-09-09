import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadChip, MediaImage } from "./MediaImage";
import type { MediaToken } from "../screens/Chat/mediaUtils";

vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

const token: MediaToken = {
  src: "data:image/png;base64,iVBORw0KGgo=",
  isUrl: true,
  isImage: true,
  name: "pic.png",
};

function openLightbox(): ReturnType<typeof render> {
  const view = render(<MediaImage token={token} />);
  fireEvent.click(view.getByAltText("pic.png"));
  return view;
}

describe("MediaImage lightbox", () => {
  beforeEach(() => {
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        saveMediaFile: vi.fn(async () => true),
        showMediaMenu: vi.fn(),
        showFileMenu: vi.fn(),
        openFileInEditor: vi.fn(async () => true),
        openAgentRuntimeArtifact: vi.fn(async () => true),
        readAgentRuntimeArtifactImage: vi.fn(async () => null),
        saveAgentRuntimeArtifact: vi.fn(async () => true),
      },
    });
  });

  it("opens Runtime artifact files without exposing an absolute path", () => {
    const artifactToken: MediaToken = {
      src: "agents-one-artifact://runtime/run-1/report-1/report.pdf",
      isUrl: true,
      isImage: false,
      name: "report.pdf",
      runtimeArtifact: { runId: "run-1", artifactId: "report-1" },
    };
    render(<DownloadChip token={artifactToken} />);
    const link = document.querySelector(".chat-artifact-file");
    expect(link).toHaveAttribute("title", "report.pdf");
    fireEvent.click(link!);
    expect(window.agentsOneAPI.openAgentRuntimeArtifact).toHaveBeenCalledWith(
      "run-1",
      "report-1",
    );
  });

  it("portals the lightbox to document.body so paint containment cannot clip it", () => {
    // Regression for the content-visibility clipping bug: `.chat-message` rows
    // imply paint containment (#748), which traps an inline fixed backdrop
    // inside the row. Rendering under <body> is the escape hatch — this pins
    // the backdrop's DOM location, not just its presence.
    const { container } = openLightbox();
    const backdrop = document.querySelector(".chat-image-preview-backdrop");
    expect(backdrop).not.toBeNull();
    expect(backdrop?.parentElement).toBe(document.body);
    expect(container.querySelector(".chat-image-preview-backdrop")).toBeNull();
  });

  it("closes on Escape and consumes the key before bubble-phase listeners", () => {
    // FileViewer binds an unguarded document-level (bubble) Escape listener.
    // The lightbox is the topmost modal, so one keypress must close only it —
    // capture + stopPropagation keeps the panel behind it open.
    const panelListener = vi.fn();
    document.addEventListener("keydown", panelListener);
    try {
      openLightbox();
      fireEvent.keyDown(document.body, { key: "Escape" });
      expect(document.querySelector(".chat-image-preview-backdrop")).toBeNull();
      expect(panelListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", panelListener);
    }
  });

  it("closes on backdrop click but not on clicks inside the action bar", () => {
    openLightbox();
    const actions = document.querySelector(".chat-image-preview-actions");
    expect(actions).not.toBeNull();
    fireEvent.click(actions!);
    expect(
      document.querySelector(".chat-image-preview-backdrop"),
    ).not.toBeNull();

    fireEvent.click(document.querySelector(".chat-image-preview-backdrop")!);
    expect(document.querySelector(".chat-image-preview-backdrop")).toBeNull();
  });

  it("opens local delivery files on click and exposes the native file menu", () => {
    const fileToken: MediaToken = {
      src: "D:\\project\\smoke-test.txt",
      isUrl: false,
      isImage: false,
      name: "smoke-test.txt",
    };
    render(<DownloadChip token={fileToken} />);

    const link = document.querySelector(".chat-artifact-file");
    expect(link).toHaveAttribute("title", fileToken.src);
    fireEvent.click(link!);
    expect(window.agentsOneAPI.openFileInEditor).toHaveBeenCalledWith(
      fileToken.src,
    );

    fireEvent.contextMenu(link!);
    expect(window.agentsOneAPI.showFileMenu).toHaveBeenCalledWith(fileToken.src, {
      open: "chat.fileMenu.open",
      copyPath: "chat.fileMenu.copyPath",
      copyContent: "chat.fileMenu.copyContent",
      reveal: "chat.fileMenu.reveal",
    });
    expect(window.agentsOneAPI.saveMediaFile).not.toHaveBeenCalled();
  });
});
