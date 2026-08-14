import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Agents One feature-slimming boundaries", () => {
  it("removes the legacy management surfaces from the application layout", () => {
    const layout = source("src/renderer/src/screens/Layout/Layout.tsx");

    expect(layout).not.toContain("../TaskCenter/TaskCenter");
    expect(layout).not.toContain("../ProjectCenter/ProjectCenter");
    expect(layout).not.toMatch(/\|\s*"(?:tasks|projects)"/);
  });

  it("removes the Hermes Kanban surface and desktop command", () => {
    const layout = source("src/renderer/src/screens/Layout/Layout.tsx");
    const commands = source(
      "src/renderer/src/screens/Chat/slash/desktopCommands.ts",
    );
    const ipc = source("src/main/ipc/register.ts");

    expect(layout).not.toContain("../Kanban/Kanban");
    expect(layout).not.toMatch(/\|\s*"kanban"/);
    expect(commands).not.toContain('["kanban"');
    expect(ipc).not.toContain('"kanban-list-boards"');
  });

  it("keeps task-dialog collaboration wired through renderer and main process", () => {
    const layout = source("src/renderer/src/screens/Layout/Layout.tsx");
    const runtimeChat = source(
      "src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx",
    );
    const ipc = source("src/main/ipc/register.ts");

    expect(layout).toContain("TaskCollaborationDialog");
    expect(layout).toContain("TaskCollaborationWorkspace");
    expect(runtimeChat).toContain("task-collaboration");
    expect(ipc).toContain('"save-task-collaboration"');
    expect(ipc).toContain('"list-task-collaborations"');
  });

  it("keeps schedules on the direct Runtime path with Task Center retired", () => {
    const schedules = source("src/main/task-schedules.ts");

    expect(schedules).toContain("startAgentRuntimeTask");
    expect(schedules).toContain("getAgentRuntimeRun");
    expect(schedules).toContain("cancelAgentRuntimeTask");
    expect(schedules).not.toContain('from "./task-center"');
    expect(schedules).not.toContain("listTaskCenterTasks");
    expect(schedules).not.toContain("cancelTaskCenterTask");
    expect(existsSync(resolve(process.cwd(), "src/main/task-center.ts"))).toBe(
      false,
    );
    expect(
      existsSync(resolve(process.cwd(), "src/shared/task-center.ts")),
    ).toBe(false);
  });
});
