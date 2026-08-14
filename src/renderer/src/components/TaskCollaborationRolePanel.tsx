import { Bot, ChevronDown, Users } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationExecution,
  TaskCollaborationRoleRunStatus,
} from "../../../shared/task-collaboration";

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
  const configured = assignments.filter((assignment) => assignment.runtimeId);
  if (!configured.length) return null;
  const runByAssignmentId = new Map(
    (execution?.roleRuns ?? []).map((run) => [run.assignmentId, run]),
  );
  const statusLabel: Record<TaskCollaborationRoleRunStatus, string> = {
    pending: "待执行",
    running: "执行中",
    succeeded: "已交接",
    failed: "失败",
    blocked: "已阻塞",
    waiting_for_user: "等待人工处理",
    paused: "已暂停",
    retrying: "重试中",
    needs_review: "需要复核",
    cancelled: "已取消",
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
          <Users size={15} /> 协作分工
        </span>
        <small>
          {execution?.status === "running"
            ? "平台正在按角色交接"
            : `${configured.length} 个角色`}
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
                  aria-label={`与 ${runtime?.name || assignment.runtimeId || assignment.role}（${assignment.role}）沟通`}
                  title={`与 ${runtime?.name || assignment.runtimeId || assignment.role} 沟通`}
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
                  介入
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
