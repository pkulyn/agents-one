import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;

async function loadStore(): Promise<typeof import("../src/main/task-collaboration-store")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/task-collaboration-store");
}

describe("task collaboration store", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-collaboration-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("keeps configured roles when a late session update has no assignments", async () => {
    const store = await loadStore();
    store.saveTaskCollaboration({
      taskId: "task-1",
      title: "协作测试",
      status: "active",
      assignments: [
        { id: "lead", role: "协调", runtimeId: "pi" },
        { id: "implement", role: "实施", runtimeId: "codex" },
      ],
    });

    const updated = store.saveTaskCollaboration({
      taskId: "task-1",
      title: "协作测试",
      assignments: [],
    });

    expect(updated.assignments).toEqual([
      { id: "lead", role: "协调", runtimeId: "pi" },
      { id: "implement", role: "实施", runtimeId: "codex" },
    ]);
    expect(updated.status).toBe("active");
  });

  it("uses one parent record for task, conversation, and session links", async () => {
    const store = await loadStore();
    store.saveTaskCollaboration({
      taskId: "task-2",
      title: "唯一父任务",
      assignments: [{ id: "lead", role: "协调", runtimeId: "pi" }],
    });

    store.linkTaskCollaboration({
      taskId: "task-2",
      conversationId: "conversation-2",
      sourceSessionId: "session-2",
    });
    store.updateTaskCollaborationExecution({
      taskId: "task-2",
      execution: {
        status: "running",
        updatedAt: 100,
        roleRuns: [
          { assignmentId: "lead", role: "协调", runtimeId: "pi", status: "running" },
        ],
      },
    });

    expect(store.listTaskCollaborations()).toHaveLength(1);
    expect(store.getTaskCollaboration("conversation-2")).toMatchObject({
      taskId: "task-2",
      sourceSessionId: "session-2",
      execution: { status: "running" },
    });
  });

  it("rejects an active collaboration with no assigned runtime", async () => {
    const store = await loadStore();
    expect(() =>
      store.saveTaskCollaboration({
        taskId: "task-empty",
        title: "空协作",
        status: "active",
        assignments: [],
      }),
    ).toThrow("至少要为一个角色选择智能体");
  });

  it("persists only concrete collaboration artifacts and linked acceptance evidence", async () => {
    const store = await loadStore();
    store.saveTaskCollaboration({
      taskId: "task-evidence",
      title: "真实产物验收",
      assignments: [
        { id: "implement", role: "实施", runtimeId: "codex" },
        { id: "accept", role: "验收", runtimeId: "claude" },
      ],
    });
    const updated = store.updateTaskCollaborationExecution({
      taskId: "task-evidence",
      execution: {
        status: "needs_review",
        updatedAt: 200,
        roleRuns: [
          { assignmentId: "implement", role: "实施", runtimeId: "codex", status: "succeeded" },
          { assignmentId: "accept", role: "验收", runtimeId: "claude", status: "needs_review" },
        ],
        artifacts: [
          {
            id: "diff-1",
            assignmentId: "implement",
            role: "错误名称会以配置为准",
            kind: "code_diff",
            label: "Git diff",
            summary: " src/main.ts | 1 +",
            source: "runtime_artifact",
            createdAt: 200,
          },
          {
            id: "ignored-final",
            assignmentId: "implement",
            role: "实施",
            kind: "final" as never,
            label: "普通回复",
            source: "runtime_artifact",
            createdAt: 200,
          },
        ],
        acceptance: {
          assignmentId: "accept",
          status: "needs_review",
          conclusion: "缺少可验证的测试证据。",
          reviewedArtifactIds: ["diff-1", "missing"],
          createdAt: 200,
        },
      },
    });

    expect(updated.execution).toMatchObject({
      status: "needs_review",
      artifacts: [expect.objectContaining({ id: "diff-1", role: "实施" })],
      acceptance: {
        status: "needs_review",
        reviewedArtifactIds: ["diff-1"],
      },
    });
    const reloaded = await loadStore();
    expect(reloaded.getTaskCollaboration("task-evidence")?.execution).toMatchObject({
      artifacts: [expect.objectContaining({ id: "diff-1", role: "实施" })],
      acceptance: expect.objectContaining({ reviewedArtifactIds: ["diff-1"] }),
    });
  });
});
