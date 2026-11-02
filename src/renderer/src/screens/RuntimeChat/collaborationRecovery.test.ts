import { describe, it, expect, vi } from "vitest";
import { recoverInterruptedCollaboration } from "./collaborationRecovery";
import type { TaskCollaborationExecution } from "../../../../shared/task-collaboration";
const execution: TaskCollaborationExecution = {
  status: "running",
  brief: "task",
  updatedAt: 1,
  roleRuns: [
    {
      assignmentId: "lead",
      role: "Lead",
      runtimeId: "pi",
      runtimeRunId: "gone",
      status: "running",
    },
  ],
};
describe("Interrupted collaboration", () => {
  it("pauses stale orchestration without deleting evidence or dispatching work", async () => {
    const result = await recoverInterruptedCollaboration(
      execution,
      vi.fn().mockResolvedValue(null),
    );
    expect(result.status).toBe("paused");
    expect(result.roleRuns[0]).toMatchObject({
      assignmentId: "lead",
      runtimeRunId: "gone",
      status: "paused",
    });
  });
  it("keeps a live run locked and never guesses on lookup failure", async () => {
    expect(
      await recoverInterruptedCollaboration(
        execution,
        vi.fn().mockResolvedValue({ status: "running" }),
      ),
    ).toBe(execution);
    await expect(
      recoverInterruptedCollaboration(
        execution,
        vi.fn().mockRejectedValue(new Error("offline")),
      ),
    ).rejects.toThrow("offline");
  });
});
