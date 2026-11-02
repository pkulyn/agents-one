import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Loader, Users } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationExecution,
} from "../../../../shared/task-collaboration";

export function CollaborationProgress({
  enabled,
  execution,
  assignments,
  runtimes,
  onIntervene,
  children,
}: {
  enabled: boolean;
  execution?: TaskCollaborationExecution;
  assignments: TaskCollaborationAssignment[];
  runtimes: Record<string, AgentRuntimeDefinition>;
  onIntervene: (assignment: TaskCollaborationAssignment, id: string) => void;
  children?: ReactNode;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (
    !enabled ||
    !execution ||
    execution.status === "succeeded" ||
    execution.status === "cancelled"
  )
    return null;
  const complete = execution.roleRuns.filter(
    (item) => item.status === "succeeded",
  ).length;
  const status = (value: string): string =>
    t(`runtimeChat.collaborationProgress.status.${value}`);
  return (
    <section
      className="collaboration-progress"
      aria-label={t("runtimeChat.collaborationProgress.title")}
    >
      <button
        type="button"
        className="collaboration-progress-summary"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Users size={14} />
        <strong>{t("runtimeChat.collaborationProgress.title")}</strong>
        <span>
          {t("runtimeChat.collaborationProgress.completed", {
            done: complete,
            total: execution.roleRuns.length,
          })}
        </span>
        <ChevronDown
          size={14}
          className={open ? "collaboration-progress-chevron--open" : ""}
        />
      </button>
      <div className="collaboration-progress-agents">
        {execution.roleRuns.map((item) => {
          const runtime = runtimes[item.runtimeId || ""];
          return (
            <button
              type="button"
              aria-label={t("collaboration.communicateWithRole", {
                agent: runtime?.name || item.runtimeId,
                role: item.role,
              })}
              onClick={() => {
                const assignment = assignments.find(
                  (entry, index) =>
                    (entry.id || `legacy:${index}:${entry.role}`) ===
                    item.assignmentId,
                );
                if (assignment) {
                  setOpen(false);
                  onIntervene(assignment, item.assignmentId);
                }
              }}
              key={item.assignmentId}
              className={`collaboration-progress-agent collaboration-progress-agent--${item.status}`}
            >
              {item.status === "succeeded" ? (
                <Check size={12} />
              ) : item.status === "running" || item.status === "retrying" ? (
                <Loader size={12} className="collaboration-progress-spinner" />
              ) : null}
              <span>
                {runtime?.name || item.runtimeId} ·{" "}
                <span>{status(item.status)}</span>
              </span>
            </button>
          );
        })}
      </div>
      {open && (
        <div className="collaboration-progress-details">
          {execution.roleRuns.map((item) => {
            const assignment =
              assignments.find(
                (entry, index) =>
                  (entry.id || `legacy:${index}:${entry.role}`) ===
                  item.assignmentId,
              ) ||
              assignments.find(
                (entry) =>
                  entry.runtimeId === item.runtimeId &&
                  entry.role === item.role,
              );
            const runtime = runtimes[item.runtimeId || ""];
            return (
              <div
                key={item.assignmentId}
                className="collaboration-progress-role"
              >
                <div>
                  <strong>{runtime?.name || item.runtimeId}</strong>
                  <span>
                    {item.role} · {status(item.status)}
                  </span>
                  <p>{assignment?.responsibility}</p>
                  <p>
                    {
                      execution.timeline
                        ?.filter(
                          (event) => event.assignmentId === item.assignmentId,
                        )
                        .at(-1)?.label
                    }
                  </p>
                  {item.error && (
                    <p className="collaboration-progress-error">{item.error}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!assignment}
                  onClick={() => {
                    if (assignment) {
                      setOpen(false);
                      onIntervene(assignment, item.assignmentId);
                    }
                  }}
                >
                  {t("runtimeChat.collaborationProgress.view")}
                </button>
              </div>
            );
          })}
          {children && (
            <details className="collaboration-progress-advanced">
              <summary>
                {t("runtimeChat.collaborationProgress.details")}
              </summary>
              {children}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
