import { describe, expect, it } from "vitest";
import { setLocale, t } from "../../../../shared/i18n";
import { groupSessionsByWorkspace } from "./SidebarRecentSessions";
import {
  assignSidebarProjectColors,
  parseSidebarProjectColors,
  sidebarProjectColorKey,
} from "./sidebarProjectColors";

describe("sidebar project grouping", () => {
  it("merges legacy path sessions with opaque workspace sessions", () => {
    const grouped = groupSessionsByWorkspace(
      [
        {
          id: "legacy-task",
          title: "旧任务",
          contextFolder: "D:\\workspace\\vault",
          updatedAt: 1,
        },
        {
          id: "scheduled-task",
          title: "定时任务：知识库整理",
          contextWorkspaceId: "project-notes",
          updatedAt: 2,
        },
      ],
      [{ id: "project-notes", name: "sample-notes", updatedAt: 3 }],
      [
        {
          id: "project-notes",
          path: "D:\\workspace\\vault",
          name: "sample-notes",
          createdAt: 1,
          updatedAt: 3,
        },
      ],
    );

    expect(grouped.chats).toEqual([]);
    expect(grouped.projectGroups).toEqual([
      expect.objectContaining({
        workspaceId: "project-notes",
        name: "sample-notes",
        sessions: expect.arrayContaining([
          expect.objectContaining({ id: "legacy-task" }),
          expect.objectContaining({ id: "scheduled-task" }),
        ]),
      }),
    ]);
  });
});

describe("sidebar i18n", () => {
  it("renders project and task controls in English", () => {
    setLocale("en");
    expect(t("navigation.sidebar.newProject")).toBe("New project");
    expect(
      t("navigation.sidebar.newTaskInProject", "en", { project: "alpha" }),
    ).toBe("New task in alpha");
    expect(
      t("navigation.sidebar.projectActionsFor", "en", { project: "alpha" }),
    ).toBe("Project actions for alpha");
    setLocale("zh-CN");
  });
});

describe("sidebar project colors", () => {
  it("reserves a different color for each of the first twelve projects", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `project-${index}`);
    const assignments = assignSidebarProjectColors(keys, new Map());

    expect(new Set(assignments.values()).size).toBe(12);
    expect([...assignments.values()].slice(0, 3)).toEqual([0, 6, 3]);
    expect(assignSidebarProjectColors([...keys].reverse(), assignments)).toBe(
      assignments,
    );
  });

  it("keeps saved colors and skips a neighboring color when the palette is full", () => {
    const keys = Array.from({ length: 12 }, (_, index) => `project-${index}`);
    const assignments = assignSidebarProjectColors(keys, new Map());
    const restored = parseSidebarProjectColors(
      JSON.stringify([...assignments, ["invalid-project", 12]]),
    );
    const last = keys[11];
    const next = assignSidebarProjectColors([last, "new-project"], restored);

    expect(restored).toEqual(assignments);
    expect(next.get("new-project")).not.toBe(restored.get(last));
    expect(new Map([...next].filter(([key]) => key !== "new-project"))).toEqual(
      assignments,
    );
  });

  it("prefers the neighboring project's opposite color when both are available", () => {
    const saved = new Map([["first", 0]]);
    expect(
      assignSidebarProjectColors(["first", "second"], saved).get("second"),
    ).toBe(6);
  });

  it("uses a stable key without storing unregistered folder paths", () => {
    expect(sidebarProjectColorKey("project-id")).toBe("project-id");
    const folder = "D:\\workspace\\vault";
    expect(sidebarProjectColorKey(folder)).not.toContain(folder);
    expect(sidebarProjectColorKey(folder)).toBe(sidebarProjectColorKey(folder));
  });
});
