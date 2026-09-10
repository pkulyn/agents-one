import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SidebarProjectMenu from "./SidebarProjectMenu";
import { I18nProvider } from "../../components/I18nProvider";

describe("SidebarProjectMenu", () => {
  it("matches task-menu actions and closes with Escape", async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <SidebarProjectMenu
          target={{
            workspaceId: "project-test",
            name: "work",
            pinned: false,
            x: 20,
            y: 20,
          }}
          onClose={onClose}
          onTogglePin={() => {}}
          onReveal={() => {}}
          onRename={() => {}}
          onArchive={() => {}}
          onRemove={() => {}}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("menuitem", { name: /置顶项目|Pin project/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /资源管理器|File Explorer/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /重命名项目|Rename project/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /归档项目|Archive project/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /移除|Remove/ }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
