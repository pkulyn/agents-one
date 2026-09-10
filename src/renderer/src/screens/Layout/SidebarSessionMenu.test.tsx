import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../components/I18nProvider";
import SidebarSessionMenu from "./SidebarSessionMenu";

describe("SidebarSessionMenu", () => {
  it("copies the conversation id, reveals its folder, and closes with Escape", async () => {
    const onCopySessionId = vi.fn();
    const onReveal = vi.fn();
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <SidebarSessionMenu
          target={{
            id: "session-1",
            title: "任务",
            contextFolder: "D:\\work",
            x: 20,
            y: 20,
          }}
          isPinned={false}
          projects={[]}
          onClose={onClose}
          onTogglePin={() => {}}
          onRename={() => {}}
          onMoveToProject={() => {}}
          onPickNewFolder={() => {}}
          onCopySessionId={onCopySessionId}
          onReveal={onReveal}
          onArchive={() => {}}
          onDelete={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.click(
      screen.getByRole("menuitem", {
        name: /复制会话 ID|Copy conversation ID/,
      }),
    );
    expect(onCopySessionId).toHaveBeenCalled();

    // Remount because selecting an action closes the menu.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    onClose.mockClear();
    render(
      <I18nProvider>
        <SidebarSessionMenu
          target={{
            id: "session-1",
            title: "任务",
            contextFolder: "D:\\work",
            x: 20,
            y: 20,
          }}
          isPinned={false}
          projects={[]}
          onClose={onClose}
          onTogglePin={() => {}}
          onRename={() => {}}
          onMoveToProject={() => {}}
          onPickNewFolder={() => {}}
          onCopySessionId={() => {}}
          onReveal={onReveal}
          onArchive={() => {}}
          onDelete={() => {}}
        />
      </I18nProvider>,
    );
    fireEvent.click(
      screen
        .getAllByRole("menuitem", { name: /资源管理器|File Explorer/ })
        .at(-1)!,
    );
    expect(onReveal).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
  });
});
