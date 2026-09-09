import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayMenuData } from "../../../../shared/tray-menu";
import TrayMenu from "./TrayMenu";

const data: TrayMenuData = {
  running: [],
  recent: [
    {
      id: "recent-1",
      title: "请帮我清理项目文件夹下的垃圾文件",
      projectName: "test",
      openTaskId: "recent-1",
    },
    {
      id: "recent-2",
      title: "介绍一下你能帮我做什么",
      projectName: "",
      openTaskId: "recent-2",
    },
  ],
  more: [
    {
      id: "older-1",
      title: "较早完成的任务",
      projectName: "Agents-One",
      openTaskId: "older-1",
    },
  ],
  runningCount: 0,
};

describe("TrayMenu", () => {
  const sendTrayMenuAction = vi.fn();
  const resizeTrayMenu = vi.fn();

  beforeEach(() => {
    sendTrayMenuAction.mockReset();
    resizeTrayMenu.mockReset();
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        getTrayMenuData: vi.fn().mockResolvedValue(data),
        onTrayMenuData: vi.fn().mockReturnValue(() => undefined),
        sendTrayMenuAction,
        resizeTrayMenu,
      },
    });
  });

  it("renders project names in a dedicated right-side column", async () => {
    render(<TrayMenu />);

    const project = await screen.findByText("test");
    expect(project).toHaveClass("tray-task-menu-project");
    expect(project.closest("button")).toHaveTextContent(
      "请帮我清理项目文件夹下的垃圾文件test",
    );
    const unassociatedRow = screen
      .getByText("介绍一下你能帮我做什么")
      .closest("button");
    expect(
      unassociatedRow?.querySelector(".tray-task-menu-project"),
    ).toBeEmptyDOMElement();
    expect(screen.queryByText("未关联项目")).not.toBeInTheDocument();
  });

  it("reveals older tasks in a left flyout when More is hovered", async () => {
    render(<TrayMenu />);
    await screen.findByText("test");

    fireEvent.mouseEnter(screen.getByRole("button", { name: "更多" }));

    expect(screen.getByText("较早完成的任务")).toBeInTheDocument();
    expect(screen.getByLabelText("更多已完成任务")).toHaveClass(
      "tray-task-menu-history-panel",
    );
    expect(screen.getByText("Agents-One")).toHaveClass(
      "tray-task-menu-project",
    );
  });
});
