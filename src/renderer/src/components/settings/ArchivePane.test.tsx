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
  const listAgentRuntimes = vi.fn();
  const listArchivedItems = vi.fn();
  const restoreArchivedItem = vi.fn().mockResolvedValue(true);
  const deleteArchivedItem = vi.fn().mockResolvedValue(true);
  const listCachedSessions = vi.fn();
  const listRuntimeConversations = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listAgentRuntimes.mockResolvedValue([]);
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
        listAgentRuntimes,
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
  // @lat: [[sidebar-navigation#Archive task identity]]
  it("shows registered avatars, deleted-runtime snapshots and native Hermes identity without a project", async () => {
    listAgentRuntimes.mockResolvedValue([
      {
        id: "pi",
        name: "Pi",
        kind: "pi",
        avatar: "data:image/png;base64,cGk=",
      },
      {
        id: "hers",
        name: "Hers",
        kind: "hermes",
        avatar: "data:image/png;base64,aGVycw==",
      },
    ]);
    listArchivedItems.mockResolvedValue([
      {
        id: "task:pi-task",
        kind: "task",
        targetId: "pi-task",
        title: "Pi 归档",
        runtimeId: "pi",
        archivedAt: 1,
      },
      {
        id: "task:old-task",
        kind: "task",
        targetId: "old-task",
        title: "历史归档",
        runtimeId: "removed",
        archivedAt: 1,
      },
      {
        id: "task:native",
        kind: "task",
        targetId: "native",
        title: "原生归档",
        archivedAt: 1,
      },
    ]);
    listRuntimeConversations.mockResolvedValue([
      {
        id: "old-task",
        title: "历史归档",
        runtimeId: "removed",
        runtimeName: "Old Agent",
        runtimeKind: "codex",
        runtimeAvatar: "data:image/png;base64,b2xk",
        updatedAt: 1,
      },
    ]);
    listCachedSessions.mockResolvedValue([
      { id: "native", title: "原生归档", startedAt: 1 },
    ]);
    render(
      <I18nProvider>
        <ArchivePane profile="default" />
      </I18nProvider>,
    );
    expect(await screen.findByRole("img", { name: "Pi" })).toHaveAttribute(
      "src",
      "data:image/png;base64,cGk=",
    );
    expect(
      await screen.findByRole("img", { name: "Old Agent" }),
    ).toHaveAttribute("src", "data:image/png;base64,b2xk");
    expect(await screen.findByRole("img", { name: "Hers" })).toHaveAttribute(
      "src",
      "data:image/png;base64,aGVycw==",
    );
  });
  it("retains snapshot avatars on registry failure, including project child tasks", async () => {
    listAgentRuntimes.mockRejectedValue(new Error("temporarily unavailable"));
    listRuntimeConversations.mockResolvedValue([
      {
        id: "runtime-1",
        title: "Runtime 项目任务",
        runtimeId: "removed",
        runtimeName: "Snapshot",
        runtimeAvatar: "data:image/png;base64,c25hcA==",
        updatedAt: 4,
        workspace: "D:/work",
      },
    ]);
    render(
      <I18nProvider>
        <ArchivePane profile="default" />
      </I18nProvider>,
    );
    const toggle = await screen.findByRole("button", {
      name: /任务对话|Task conversations/,
    });
    await waitFor(() => expect(toggle).toHaveTextContent("2"));
    fireEvent.click(toggle);
    expect(screen.getByRole("img", { name: "Snapshot" })).toHaveAttribute(
      "src",
      "data:image/png;base64,c25hcA==",
    );
    const fallback = screen
      .getByText("原生项目任务")
      .closest(".settings-archive-project-task");
    expect(
      fallback?.querySelector(".settings-archive-avatar svg"),
    ).toBeTruthy();
  });
});
