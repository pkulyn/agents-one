import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ArchivePane from "./ArchivePane";
import { I18nProvider } from "../I18nProvider";

describe("ArchivePane", () => {
  const listArchivedItems = vi.fn();
  const restoreArchivedItem = vi.fn().mockResolvedValue(true);
  const deleteArchivedItem = vi.fn().mockResolvedValue(true);
  const listCachedSessions = vi.fn();
  const listRuntimeConversations = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listArchivedItems.mockResolvedValue([
      {
        id: "task:t1",
        kind: "task",
        targetId: "t1",
        title: "归档任务",
        archivedAt: 2,
      },
      {
        id: "project:D:/work",
        kind: "project",
        targetId: "D:/work",
        title: "归档项目",
        projectPath: "D:/work",
        archivedAt: 1,
      },
    ]);
    listCachedSessions.mockResolvedValue([
      {
        id: "native-1",
        title: "原生项目任务",
        startedAt: 3,
        contextFolder: "D:\\work",
      },
      {
        id: "other",
        title: "其他任务",
        startedAt: 2,
        contextFolder: "D:\\other",
      },
    ]);
    listRuntimeConversations.mockResolvedValue([
      {
        id: "runtime-1",
        title: "Runtime 项目任务",
        updatedAt: 4,
        workspace: "D:/work",
      },
    ]);
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        listArchivedItems,
        listCachedSessions,
        listRuntimeConversations,
        restoreArchivedItem,
        deleteArchivedItem,
      },
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("restores and permanently deletes either archived kind", async () => {
    render(
      <I18nProvider>
        <ArchivePane profile="default" />
      </I18nProvider>,
    );
    await screen.findByText("归档任务");
    expect(screen.getByText("归档项目")).toBeInTheDocument();
    const restoreButtons = screen.getAllByRole("button", {
      name: /取消归档|Restore/,
    });
    expect(restoreButtons).toHaveLength(2);
    fireEvent.click(restoreButtons[0]);
    await waitFor(() =>
      expect(restoreArchivedItem).toHaveBeenCalledWith("task:t1", "default"),
    );
    const deleteButtons = screen.getAllByRole("button", {
      name: /^删除$|^Delete$/,
    });
    expect(deleteButtons).toHaveLength(2);
    const projectCard = screen.getByText("归档项目").closest("article");
    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard as HTMLElement).getByRole("button", {
        name: /^删除$|^Delete$/,
      }),
    );
    await waitFor(() =>
      expect(deleteArchivedItem).toHaveBeenCalledWith(
        "project:D:/work",
        "default",
      ),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringMatching(/磁盘|disk/i),
    );
  });

  it("keeps project task conversations collapsed until requested", async () => {
    render(
      <I18nProvider>
        <ArchivePane profile="default" />
      </I18nProvider>,
    );
    const toggle = await screen.findByRole("button", {
      name: /任务对话|Task conversations/,
    });
    await waitFor(() => expect(toggle).toHaveTextContent("2"));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("原生项目任务")).not.toBeInTheDocument();
    expect(screen.queryByText("Runtime 项目任务")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("原生项目任务")).toBeInTheDocument();
    expect(screen.getByText("Runtime 项目任务")).toBeInTheDocument();
    expect(screen.queryByText("其他任务")).not.toBeInTheDocument();
  });
});
