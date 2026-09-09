import { describe, expect, it } from "vitest";
import { groupSessionsByWorkspace } from "./SidebarRecentSessions";

describe("sidebar project grouping", () => {
  it("merges legacy path sessions with opaque workspace sessions", () => {
    const grouped = groupSessionsByWorkspace(
      [
        {
          id: "legacy-task",
          title: "旧任务",
          contextFolder: "D:\\pkulyn_vault",
          updatedAt: 1,
        },
        {
          id: "scheduled-task",
          title: "定时任务：知识库整理",
          contextWorkspaceId: "project-pkulyn",
          updatedAt: 2,
        },
      ],
      [{ id: "project-pkulyn", name: "pkulyn_vault", updatedAt: 3 }],
      [
        {
          id: "project-pkulyn",
          path: "D:\\pkulyn_vault",
          name: "pkulyn_vault",
          createdAt: 1,
          updatedAt: 3,
        },
      ],
    );

    expect(grouped.chats).toEqual([]);
    expect(grouped.projectGroups).toEqual([
      expect.objectContaining({
        workspaceId: "project-pkulyn",
        name: "pkulyn_vault",
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: "legacy-task" }),
          expect.objectContaining({ id: "scheduled-task" }),
        ]),
      }),
    ]);
  });
});
