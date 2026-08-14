import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;

async function loadStore(): Promise<
  typeof import("../src/main/task-collaboration-store")
> {
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

  it("persists DAG dependencies and parallel active roles", async () => {
    const store = await loadStore();
    store.saveTaskCollaboration({
      taskId: "task-dag",
      title: "DAG",
      assignments: [
        { id: "a", role: "A", runtimeId: "pi", dependsOn: [] },
        { id: "b", role: "B", runtimeId: "codex", dependsOn: ["a"] },
      ],
    });
    store.updateTaskCollaborationExecution({
      taskId: "task-dag",
      execution: {
        status: "running",
        updatedAt: 10,
        activeAssignmentIds: ["a", "b", "unknown"],
        roleRuns: [
          { assignmentId: "a", role: "A", runtimeId: "pi", status: "running" },
          { assignmentId: "b", role: "B", runtimeId: "codex", status: "pending" },
        ],
      },
    });
    expect(store.getTaskCollaboration("task-dag")).toMatchObject({
      assignments: [
        { id: "a", dependsOn: [] },
        { id: "b", dependsOn: ["a"] },
      ],
      execution: { activeAssignmentIds: ["a", "b"] },
    });
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
          {
            assignmentId: "lead",
            role: "协调",
            runtimeId: "pi",
            status: "running",
          },
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
          {
            assignmentId: "implement",
            role: "实施",
            runtimeId: "codex",
            status: "succeeded",
            attempt: 2,
          },
          {
            assignmentId: "accept",
            role: "验收",
            runtimeId: "claude",
            status: "needs_review",
          },
        ],
        artifacts: [
          {
            id: "diff-1",
            assignmentId: "implement",
            role: "错误名称会以配置为准",
            kind: "code_diff",
            label: "Git diff",
            summary: " src/main.ts | 1 +",
            sourceMachine: "本机工作区",
            changeSummary: "更新实现。",
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
        timeline: [
          {
            id: "timeline-1",
            type: "artifact",
            label: "实施已发布交付证据",
            assignmentId: "implement",
            artifactId: "diff-1",
            createdAt: 200,
          },
        ],
      },
    });

    expect(updated.execution).toMatchObject({
      status: "needs_review",
      roleRuns: expect.arrayContaining([
        expect.objectContaining({ assignmentId: "implement", attempt: 2 }),
      ]),
      artifacts: [
        expect.objectContaining({
          id: "diff-1",
          role: "实施",
          sourceMachine: "本机工作区",
          changeSummary: "更新实现。",
        }),
      ],
      timeline: [
        expect.objectContaining({ id: "timeline-1", artifactId: "diff-1" }),
      ],
      acceptance: {
        status: "needs_review",
        reviewedArtifactIds: ["diff-1"],
      },
    });
    const reloaded = await loadStore();
    expect(
      reloaded.getTaskCollaboration("task-evidence")?.execution,
    ).toMatchObject({
      roleRuns: expect.arrayContaining([
        expect.objectContaining({ assignmentId: "implement", attempt: 2 }),
      ]),
      artifacts: [
        expect.objectContaining({ id: "diff-1", sourceMachine: "本机工作区" }),
      ],
      timeline: [expect.objectContaining({ id: "timeline-1" })],
      acceptance: expect.objectContaining({ reviewedArtifactIds: ["diff-1"] }),
    });
  });

  it("persists bounded role replies with shared intervention turns", async () => {
    const store = await loadStore();
    store.saveTaskCollaboration({
      taskId: "task-intervention-dialogue",
      title: "人工定向沟通",
      assignments: [
        { id: "implement", role: "实施", runtimeId: "pi" },
        { id: "review", role: "复核", runtimeId: "claude" },
      ],
    });

    store.updateTaskCollaborationExecution({
      taskId: "task-intervention-dialogue",
      execution: {
        status: "paused",
        updatedAt: 300,
        activeAssignmentId: "implement",
        roleRuns: [
          {
            assignmentId: "implement",
            role: "实施",
            runtimeId: "pi",
            status: "succeeded",
            runtimeSessionId: "pi-guided-session",
          },
          {
            assignmentId: "review",
            role: "复核",
            runtimeId: "claude",
            status: "blocked",
          },
        ],
        interventions: [
          {
            id: "turn-1",
            assignmentId: "implement",
            content: "请修正输出路径。",
            response: "已修正并重新验证。",
            respondedAt: 301,
            visibility: "shared",
            createdAt: 300,
          },
        ],
      },
    });

    const reloaded = await loadStore();
    expect(
      reloaded.getTaskCollaboration("task-intervention-dialogue")?.execution
        ?.interventions,
    ).toEqual([
      expect.objectContaining({
        id: "turn-1",
        visibility: "shared",
        response: "已修正并重新验证。",
        respondedAt: 301,
      }),
    ]);
    expect(
      reloaded.getTaskCollaboration("task-intervention-dialogue")?.execution
        ?.roleRuns[0],
    ).toEqual(
      expect.objectContaining({ runtimeSessionId: "pi-guided-session" }),
    );
  });
});
