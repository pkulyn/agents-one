import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskCollaborationExecution } from "../src/shared/task-collaboration";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeTaskInput,
} from "../src/shared/agent-runtimes";
const state = vi.hoisted(() => ({
  home: "",
  authorizedProject: "",
  record: {
    taskId: "task-a",
    taskMode: "collaboration",
    execution: undefined as TaskCollaborationExecution | undefined,
    projectFolder: undefined as string | undefined,
    projectWorkspaceId: undefined as string | undefined,
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
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: (id: string) =>
    id === "project-1" && state.authorizedProject
      ? state.authorizedProject
      : null,
  isAuthorizedWorkspaceRoot: (path: string) =>
    !!state.authorizedProject && path === state.authorizedProject,
}));
vi.mock("../src/main/task-collaboration-store", () => ({
  getTaskCollaboration: (id: string) =>
    id === state.record.taskId ? state.record : null,
}));
import {
  bindCollaborationWorkingDirectory,
  collaborationWorkingDirectory,
  remoteCollaborationStagingDirectory,
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
    state.authorizedProject = "";
    state.record.taskMode = "collaboration";
    state.record.execution = undefined;
    state.record.projectFolder = undefined;
    state.record.projectWorkspaceId = undefined;
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
  it("only stages remote output for the active assigned role with shared scope", () => {
    const options = {
      taskId: "task-a",
      assignmentId: "work",
      runtimeId: "opencode",
    };
    expect(remoteCollaborationStagingDirectory(options)).toBeUndefined();
    state.record.execution = {
      status: "running",
      roleRuns: [
        {
          assignmentId: "work",
          role: "实施",
          runtimeId: "opencode",
          status: "running",
        },
      ],
      activeAssignmentId: "work",
      updatedAt: Date.now(),
    };
    expect(remoteCollaborationStagingDirectory(options)).toBe(
      collaborationWorkingDirectory(bind("pi")),
    );
    state.record.execution.roleRuns[0].status = "succeeded";
    expect(remoteCollaborationStagingDirectory(options)).toBeUndefined();
    state.record.execution.roleRuns[0].status = "running";
    expect(
      remoteCollaborationStagingDirectory({ ...options, runtimeId: "pi" }),
    ).toBeUndefined();
    state.record.execution.interventions = [
      {
        id: "i",
        assignmentId: "work",
        content: "private",
        visibility: "role",
        createdAt: Date.now(),
      },
    ];
    expect(remoteCollaborationStagingDirectory(options)).toBeUndefined();
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeUndefined();
    state.record.execution.interventions[0].visibility = "shared";
    expect(remoteCollaborationStagingDirectory(options)).toBeUndefined();
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeTruthy();
    state.record.execution.activeAssignmentId = "lead";
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeUndefined();
    state.record.execution.activeAssignmentId = "work";
    state.record.projectFolder = "existing-project";
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeUndefined();
    const project = join(state.home, "selected-project");
    mkdirSync(project);
    state.authorizedProject = project;
    state.record.projectFolder = project;
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBe(project);
    state.record.projectFolder = undefined;
    state.record.projectWorkspaceId = "project-1";
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBe(project);
    state.record.execution.interventions[0].visibility = "role";
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeUndefined();
    state.record.execution.interventions[0].visibility = "shared";
    state.authorizedProject = "";
    expect(
      remoteCollaborationStagingDirectory({ ...options, interventionId: "i" }),
    ).toBeUndefined();
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
