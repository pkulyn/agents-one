import { mkdtempSync, rmSync } from "fs";
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
});
