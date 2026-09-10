import { describe, expect, it } from "vitest";
import {
  groupTrayTasks,
  trayProjectName,
  trayTaskDisplay,
  type TrayTaskItem,
} from "./tray-task-list";

function task(id: string, updatedAt: number, running = false): TrayTaskItem {
  return {
    id,
    title: `任务 ${id}`,
    projectName: `项目 ${id}`,
    updatedAt,
    running,
    openTaskId: id,
  };
}

describe("tray task list", () => {
  it("shows active tasks separately and keeps only three newest completed tasks", () => {
    const groups = groupTrayTasks([
      task("old", 1),
      task("running", 6, true),
      task("third", 3),
      task("newest", 5),
      task("second", 4),
      task("duplicate", 2),
      task("duplicate", 0, true),
    ]);

    expect(groups.running.map((item) => item.id)).toEqual([
      "running",
      "duplicate",
    ]);
    expect(groups.recent.map((item) => item.id)).toEqual([
      "newest",
      "second",
      "third",
    ]);
    expect(groups.more.map((item) => item.id)).toEqual(["old"]);
  });

  it("keeps only the folder name and returns a separate right-side column", () => {
    expect(trayProjectName("C:\\workspace\\Agents-One\\")).toBe(
      "Agents-One",
    );
    expect(
      trayTaskDisplay({
        id: "task-1",
        title: "修复 Gateway 证书信任问题",
        projectName: "Agent Console",
        updatedAt: 1,
        running: false,
      }),
    ).toEqual({
      title: "修复 Gateway 证书信任问题",
      projectName: "Agent Console",
    });
    expect(trayProjectName(undefined)).toBe("");
    expect(trayProjectName("  ")).toBe("");
  });
});
