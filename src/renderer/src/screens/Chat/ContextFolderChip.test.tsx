import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextFolderChip } from "./ContextFolderChip";
import { I18nProvider } from "../../components/I18nProvider";
describe("ContextFolderChip file explorer toggle", () => {
  // @lat: [[context-folder#File browser toolbar control]]
  it("opens and closes the file panel independently of folder selection and clearing", () => {
    const toggle = vi.fn(),
      clear = vi.fn(),
      pick = vi.fn();
    const props = {
      contextFolder: "D:/work",
      show: true,
      worktreeVisible: false,
      onPickFolder: pick,
      onClearFolder: clear,
      onToggleWorktree: toggle,
    };
    const view = render(
      <I18nProvider>
        <ContextFolderChip {...props} />
      </I18nProvider>,
    );
    const button = screen.getByRole("button", {
      name: /显示文件浏览器|Show file explorer/,
    });
    expect(button).toHaveClass("chat-tool-btn");
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
    expect(pick).not.toHaveBeenCalled();
    view.rerender(
      <I18nProvider>
        <ContextFolderChip {...props} worktreeVisible />
      </I18nProvider>,
    );
    const close = screen.getByRole("button", {
      name: /隐藏文件浏览器|Hide file explorer/,
    });
    expect(close).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(close);
    expect(toggle).toHaveBeenCalledTimes(2);
    view.rerender(
      <I18nProvider>
        <ContextFolderChip {...props} contextFolder={null} />
      </I18nProvider>,
    );
    expect(
      screen.queryByRole("button", { name: /文件浏览器|file explorer/ }),
    ).toBeNull();
  });
});
