import { Bot, ChevronDown, Users } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationExecution,
  TaskCollaborationRoleRunStatus,
} from "../../../shared/task-collaboration";
import { useI18n } from "./useI18n";

function agentFor(
  runtimes: Record<string, AgentRuntimeDefinition>,
  assignment: TaskCollaborationAssignment,
): AgentRuntimeDefinition | undefined {
  return assignment.runtimeId ? runtimes[assignment.runtimeId] : undefined;
}

export function TaskCollaborationRolePanel({
  assignments,
  runtimes,
  execution,
  onIntervene,
}: {
  assignments: TaskCollaborationAssignment[];
  runtimes: Record<string, AgentRuntimeDefinition>;
  execution?: TaskCollaborationExecution;
  onIntervene?: (
    assignment: TaskCollaborationAssignment,
    assignmentId: string,
  ) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const configured = assignments.filter((assignment) => assignment.runtimeId);
  if (!configured.length) return null;
  const runByAssignmentId = new Map(
    (execution?.roleRuns ?? []).map((run) => [run.assignmentId, run]),
  );
  const statusLabel: Record<TaskCollaborationRoleRunStatus, string> = {
    pending: t("collaboration.status.pending"),
    running: t("collaboration.status.running"),
    succeeded: t("collaboration.status.succeeded"),
    failed: t("collaboration.status.failed"),
    blocked: t("collaboration.status.blocked"),
    waiting_for_user: t("collaboration.status.waiting_for_user"),
    paused: t("collaboration.status.paused"),
    retrying: t("collaboration.status.retrying"),
    needs_review: t("collaboration.status.needs_review"),
    cancelled: t("collaboration.status.cancelled"),
  };
  const statusClass: Record<TaskCollaborationRoleRunStatus, string> = {
    pending: "pending",
    running: "running",
    succeeded: "succeeded",
    failed: "failed",
    blocked: "blocked",
    waiting_for_user: "waiting",
    paused: "paused",
    retrying: "running",
    needs_review: "review",
    cancelled: "blocked",
  };
  return (
    <details className="task-collaboration-inline-panel">
      <summary>
        <span>
          <Users size={15} /> {t("collaboration.title")}
        </span>
        <small>
          {execution?.status === "running"
            ? t("collaboration.handingOff")
            : t("collaboration.roleCount", { count: configured.length })}
        </small>
        <ChevronDown size={14} />
      </summary>
      <div className="task-collaboration-inline-roles">
        {configured.map((assignment, index) => {
          const runtime = agentFor(runtimes, assignment);
          const key = assignment.id || `legacy:${index}:${assignment.role}`;
          const run = runByAssignmentId.get(key);
          const avatar = runtime?.avatar ? (
            <img src={runtime.avatar} alt="" />
          ) : (
            <Bot size={14} />
          );
          return (
            <article
              key={
                assignment.id || `${assignment.role}:${assignment.runtimeId}`
              }
            >
              {onIntervene ? (
                <button
                  type="button"
                  className="task-collaboration-inline-avatar"
                  style={
                    runtime?.color ? { background: runtime.color } : undefined
                  }
                  onClick={() => onIntervene(assignment, key)}
                  aria-label={t("collaboration.communicateWithRole", {
                    agent:
                      runtime?.name || assignment.runtimeId || assignment.role,
                    role: assignment.role,
                  })}
                  title={t("collaboration.communicateWith", {
                    agent:
                      runtime?.name || assignment.runtimeId || assignment.role,
                  })}
                >
                  {avatar}
                </button>
              ) : (
                <span
                  className="task-collaboration-inline-avatar"
                  style={
                    runtime?.color ? { background: runtime.color } : undefined
                  }
                >
                  {avatar}
                </span>
              )}
              <div>
                <strong>{assignment.role}</strong>
                <span>{runtime?.name || assignment.runtimeId}</span>
                {assignment.responsibility ? (
                  <small>{assignment.responsibility}</small>
                ) : null}
              </div>
              {run ? (
                <b
                  className={`task-collaboration-role-status ${statusClass[run.status]}`}
                >
                  {statusLabel[run.status]}
                </b>
              ) : null}
              {onIntervene ? (
                <button
                  type="button"
                  className="task-collaboration-role-intervene"
                  onClick={() => onIntervene(assignment, key)}
                >
                  {t("collaboration.intervene")}
                </button>
              ) : null}
              {assignment.context ? <em>{assignment.context}</em> : null}
            </article>
          );
        })}
      </div>
    </details>
  );
}
