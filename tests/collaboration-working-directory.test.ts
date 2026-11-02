import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeTaskInput,
} from "../src/shared/agent-runtimes";
const state = vi.hoisted(() => ({
  home: "",
  record: {
    taskId: "task-a",
    taskMode: "collaboration",
    assignments: [
      { id: "lead", runtimeId: "pi" },
      { id: "work", runtimeId: "opencode" },
    ],
  },
}));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "default",
  agentsOneProfileHome: (profile?: string) =>
    join(state.home, profile || "default"),
}));
vi.mock("../src/main/task-collaboration-store", () => ({
  getTaskCollaboration: (id: string) =>
    id === state.record.taskId ? state.record : null,
}));
import {
  bindCollaborationWorkingDirectory,
  collaborationWorkingDirectory,
} from "../src/main/collaboration-working-directory";
const runtime = (id: string): AgentRuntimeDefinition => ({
  id,
  name: id,
  kind: id === "pi" ? "pi" : "opencode",
  location: "local",
  enabled: true,
  config: {},
});
const bind = (runtimeId: string, profile = "default"): AgentRuntimeTaskInput =>
  bindCollaborationWorkingDirectory(
    { prompt: "Task", profile },
    { taskId: "task-a", assignmentId: runtimeId === "pi" ? "lead" : "work" },
    runtime(runtimeId),
  );
describe("Main-owned collaboration directory", () => {
  beforeEach(() => {
    state.home = mkdtempSync(join(tmpdir(), "collab-cwd-"));
    state.record.taskMode = "collaboration";
  });
  afterEach(() => rmSync(state.home, { recursive: true, force: true }));
  it("shares only the same task/profile across roles and survives object spread", () => {
    const pi = bind("pi"),
      opencode = bind("opencode");
    expect(collaborationWorkingDirectory(pi)).toBe(
      collaborationWorkingDirectory(opencode),
    );
    expect(collaborationWorkingDirectory({ ...pi })).toBe(
      collaborationWorkingDirectory(pi),
    );
    expect(collaborationWorkingDirectory(bind("pi", "other"))).not.toBe(
      collaborationWorkingDirectory(pi),
    );
    expect(
      collaborationWorkingDirectory({
        prompt: "untrusted",
        collaborationContext: { taskId: "task-a", assignmentId: "lead" },
      }),
    ).toBeUndefined();
  });
  it("rejects unknown assignments, wrong agents and ordinary tasks", () => {
    expect(() =>
      bindCollaborationWorkingDirectory(
        { prompt: "x" },
        { taskId: "task-a", assignmentId: "work" },
        runtime("pi"),
      ),
    ).toThrow("collaboration_assignment_unavailable");
    state.record.taskMode = "single";
    expect(() => bind("pi")).toThrow("collaboration_assignment_unavailable");
  });
  it("preserves explicitly selected workspaces", () => {
    const input = { prompt: "x", workspace: state.home };
    expect(
      bindCollaborationWorkingDirectory(
        input,
        { taskId: "task-a", assignmentId: "lead" },
        runtime("pi"),
      ),
    ).toBe(input);
    expect(collaborationWorkingDirectory(input)).toBeUndefined();
  });
  it("rejects physical aliases before another role starts", () => {
    const first = bind("pi");
    const directory = collaborationWorkingDirectory(first)!;
    rmSync(directory, { recursive: true });
    const outside = join(state.home, "outside");
    mkdirSync(outside);
    symlinkSync(
      outside,
      directory,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => bind("opencode")).toThrow("collaboration_workspace_alias");
    rmSync(dirname(directory), { recursive: true, force: true });
  });
});
