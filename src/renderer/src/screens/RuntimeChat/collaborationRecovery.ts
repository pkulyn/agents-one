import type { AgentRuntimeRun } from "../../../../shared/agent-runtimes";
import type { TaskCollaborationExecution } from "../../../../shared/task-collaboration";
/** Reopened Renderer-owned orchestration cannot keep advancing without its scheduler. */
export async function recoverInterruptedCollaboration(
  execution: TaskCollaborationExecution,
  getRun: (id: string) => Promise<AgentRuntimeRun | null>,
): Promise<TaskCollaborationExecution> {
  if (execution.status !== "running") return execution;
  const active = execution.roleRuns.filter(
    (role) => role.status === "running" || role.status === "retrying",
  );
  const runs = await Promise.all(
    active.map((role) =>
      role.runtimeRunId ? getRun(role.runtimeRunId) : Promise.resolve(null),
    ),
  );
  if (runs.some((run) => run?.status === "running")) return execution;
  return {
    ...execution,
    status: "paused",
    activeAssignmentId: undefined,
    activeAssignmentIds: undefined,
    updatedAt: Date.now(),
    roleRuns: execution.roleRuns.map((role) =>
      role.status === "running" || role.status === "retrying"
        ? { ...role, status: "paused" }
        : role,
    ),
  };
}
