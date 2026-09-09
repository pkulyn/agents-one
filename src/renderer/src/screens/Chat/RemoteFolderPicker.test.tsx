import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => {
  const t = (key: string): string =>
      ({
        "chat.folderPicker.title": "选择工作目录",
        "chat.folderPicker.path": "工作目录路径",
        "chat.folderPicker.breadcrumbs": "当前路径",
        "chat.folderPicker.parent": "返回上级目录",
        "chat.folderPicker.open": "打开",
        "chat.folderPicker.select": "选择文件夹",
        "chat.folderPicker.empty": "此处没有文件夹",
        "chat.folderPicker.unavailable":
          "当前为远程 API 模式，无法浏览服务器目录。请输入服务器上的绝对路径，然后选择。",
        "chat.worktree.loading": "正在加载",
        "common.cancel": "取消",
      })[key] || key;
  return { useI18n: () => ({ t }) };
});

import { RemoteFolderPicker } from "./RemoteFolderPicker";

describe("RemoteFolderPicker", () => {
  const readDirectory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: { readDirectory },
    });
  });

  it("explains remote API limitations and still accepts an absolute path", async () => {
    readDirectory.mockResolvedValue(null);
    const onSelect = vi.fn();

    render(
      <RemoteFolderPicker
        initialPath={null}
        open
        onCancel={vi.fn()}
        onSelect={onSelect}
      />,
    );

    expect(await screen.findByText(/远程 API 模式/)).toBeInTheDocument();
    expect(readDirectory).toHaveBeenCalledWith("/");

    fireEvent.change(screen.getByLabelText("工作目录路径"), {
      target: { value: "/opt/data/project" },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("工作目录路径")).toHaveValue(
        "/opt/data/project",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "选择文件夹" }));

    expect(onSelect).toHaveBeenCalledWith("/opt/data/project");
  });

  it("leaves the picker usable when directory loading throws", async () => {
    readDirectory.mockRejectedValue(new Error("bridge unavailable"));

    render(
      <RemoteFolderPicker
        initialPath="/workspace"
        open
        onCancel={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/远程 API 模式/)).toBeInTheDocument();
    });
    expect(screen.getByLabelText("工作目录路径")).toHaveValue("/workspace");
    expect(screen.queryByText("正在加载")).not.toBeInTheDocument();
  });
});
