import { existsSync, mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const startAgentRuntimeTaskMock = vi.hoisted(() => vi.fn());
const getAgentRuntimeRunMock = vi.hoisted(() => vi.fn());
const cancelAgentRuntimeTaskMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/agent-runtimes", () => ({
  startAgentRuntimeTask: startAgentRuntimeTaskMock,
  getAgentRuntimeRun: getAgentRuntimeRunMock,
  cancelAgentRuntimeTask: cancelAgentRuntimeTaskMock,
}));

let testHome: string;

async function loadTaskCenter(): Promise<typeof import("../src/main/task-center")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/task-center");
}

describe("Task Center", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-task-center-"));
    startAgentRuntimeTaskMock.mockReset();
    getAgentRuntimeRunMock.mockReset();
    cancelAgentRuntimeTaskMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("marks completed coordinator plans as review required and forwards plan context", async () => {
    const taskCenter = await loadTaskCenter();
    startAgentRuntimeTaskMock.mockResolvedValue({
      id: "run-1",
      runtimeId: "openclaw-remote",
      status: "succeeded",
      startedAt: Date.now(),
      output: "Plan summary",
      artifacts: [{ kind: "final", label: "Coordinator plan", content: "Plan summary" }],
    });

    const task = await taskCenter.createTaskCenterTask({
      title: "Coordinator plan",
      prompt: "Plan safely.",
      runtimeId: "openclaw-remote",
      mode: "analysis",
      coordinatorPlan: {
        projectId: "project-1",
        title: "Project",
        objective: "Objective",
        existingTasks: [],
      },
    });

    expect(startAgentRuntimeTaskMock).toHaveBeenCalledWith(
      "openclaw-remote",
      expect.objectContaining({
        prompt: "Plan safely.",
        coordinatorPlan: expect.objectContaining({ projectId: "project-1" }),
      }),
    );
    expect(task).toMatchObject({
      status: "review_required",
      acceptance: "pending",
      output: "Plan summary",
    });
  });

  it("redacts sensitive output and marks interrupted tasks as recoverable after restart", async () => {
    const taskCenter = await loadTaskCenter();
    startAgentRuntimeTaskMock.mockResolvedValue({
      id: "run-secret",
      runtimeId: "codex-local",
      status: "succeeded",
      startedAt: Date.now(),
      output: "Authorization: Bearer abcdefghijklmnop\napi_key=super-secret",
      artifacts: [{ kind: "diff", label: "Git diff", content: "token: diff-secret" }],
    });

    const completed = await taskCenter.createTaskCenterTask({
      prompt: "Secret handling",
      runtimeId: "codex-local",
      mode: "analysis",
    });
    expect(completed.output).toContain("Authorization: [redacted]");
    expect(completed.output).toContain("api_key=[redacted]");
    expect(JSON.stringify(completed.artifacts)).toContain("token: [redacted]");
    expect(JSON.stringify(completed)).not.toContain("super-secret");
    expect(JSON.stringify(completed)).not.toContain("diff-secret");
    expect(JSON.stringify(completed)).not.toContain("abcdefghijklmnop");

    startAgentRuntimeTaskMock.mockResolvedValueOnce({
      id: "run-restart",
      runtimeId: "codex-local",
      status: "running",
      startedAt: Date.now(),
      output: "partial",
    });
    const running = await taskCenter.createTaskCenterTask({
      prompt: "Interrupted",
      runtimeId: "codex-local",
      mode: "analysis",
    });
    getAgentRuntimeRunMock.mockResolvedValueOnce(null);
    const recovered = await taskCenter.listTaskCenterTasks();
    expect(recovered).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: running.id,
        status: "failed",
        recovery: expect.objectContaining({ reason: "desktop_restarted" }),
      }),
    ]));
  });

  it("lists managed worktrees and refuses cleanup while a task is active", async () => {
    const taskCenter = await loadTaskCenter();
    const activePath = join(testHome, "desktop", "worktrees", "codex", "task-active");
    const stalePath = join(testHome, "desktop", "worktrees", "claude-code", "task-stale");
    mkdirSync(activePath, { recursive: true });
    mkdirSync(stalePath, { recursive: true });
    startAgentRuntimeTaskMock.mockResolvedValueOnce({
      id: "run-active",
      runtimeId: "codex-local",
      status: "succeeded",
      startedAt: Date.now(),
      worktreePath: activePath,
      artifacts: [{ kind: "worktree", label: "Isolated worktree", path: activePath }],
    });
    const task = await taskCenter.createTaskCenterTask({
      title: "Review worktree",
      prompt: "Implementation",
      runtimeId: "codex-local",
      mode: "implementation",
    });
    expect(task.status).toBe("review_required");

    const worktrees = taskCenter.listTaskCenterWorktrees();
    expect(worktrees).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: activePath, runtimeKind: "codex", active: true, taskId: task.id }),
      expect.objectContaining({ path: stalePath, runtimeKind: "claude-code", active: false }),
    ]));
    expect(() => taskCenter.removeTaskCenterWorktree(activePath)).toThrow(/active or review-required/i);
    expect(taskCenter.removeTaskCenterWorktree(stalePath)).toBe(true);
    expect(existsSync(stalePath)).toBe(false);
    expect(() => taskCenter.removeTaskCenterWorktree(join(testHome, "outside"))).toThrow(/outside/i);
  });
});
