import type { TaskCollaborationRecord } from "../shared/task-collaboration";

/**
 * Determine whether a remote role output may enter a shared workspace.
 * Unknown, mismatched, or ambiguous intervention state is always private.
 */
export function remoteCollaborationArtifactScope(
  record: TaskCollaborationRecord,
  assignmentId: string,
  interventionId?: string,
): "shared" | "private" {
  if (!record.execution) return "private";
  const pending = (record.execution.interventions || []).filter(
    (item) => item.assignmentId === assignmentId && !item.respondedAt,
  );
  if (!interventionId) return pending.length ? "private" : "shared";
  const target = pending.find((item) => item.id === interventionId);
  if (!target || pending.length !== 1 || target.visibility !== "shared")
    return "private";
  return "shared";
}
