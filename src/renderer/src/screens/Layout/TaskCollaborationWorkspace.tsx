import {
  CheckCircle2,
  CircleDotDashed,
  Play,
  Settings2,
  Users,
  X,
} from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationRole,
  TaskCollaborationStatus,
} from "../../../../shared/task-collaboration";
import type { CollaborationTaskDraft } from "./TaskCollaborationDialog";
import { useI18n } from "../../components/useI18n";

const ROLES: Array<{ role: TaskCollaborationRole; labelKey: string }> = [
  { role: "coordinator", labelKey: "coordinator" },
  { role: "implementer", labelKey: "implementer" },
  { role: "tester", labelKey: "tester" },
  { role: "reviewer", labelKey: "reviewer" },
];

export interface CollaborationWorkspaceState extends CollaborationTaskDraft {
  assignments: TaskCollaborationAssignment[];
  status: "draft" | TaskCollaborationStatus;
}

function projectName(
  path: string | null | undefined,
  fallback: string,
): string {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

export default function TaskCollaborationWorkspace({
  state,
  runtimes,
  onClose,
  onConfigure,
  onStart,
  onOpenTask,
}: {
  state: CollaborationWorkspaceState;
  runtimes: AgentRuntimeDefinition[];
  onClose: () => void;
  onConfigure: () => void;
  onStart: () => void;
  onOpenTask: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const runtimeNames = new Map(
    runtimes.map((runtime) => [runtime.id, runtime.name]),
  );
  const assignments = new Map(
    state.assignments.map((item) => [item.role, item.runtimeId]),
  );
  const isDraft = state.status === "draft";
  const isActive = state.status === "active";

  return (
    <div
      className="task-collaboration-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="task-collaboration-workspace"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-collaboration-workspace-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="task-collaboration-workspace-header">
          <div>
            <span className="task-collaboration-eyebrow">
              <Users size={15} /> {t("collaboration.workspace.eyebrow")}
            </span>
            <h2 id="task-collaboration-workspace-title">
              {state.title || t("collaboration.workspace.taskFallback")}
            </h2>
            <p>
              {state.projectName ||
                projectName(
                  state.projectFolder,
                  t("collaboration.workspace.noProject"),
                )}
            </p>
          </div>
          <div className="task-collaboration-workspace-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onConfigure}
            >
              <Settings2 size={15} /> {t("collaboration.workspace.configure")}
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t("collaboration.workspace.close")}
              aria-label={t("collaboration.workspace.close")}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="task-collaboration-workspace-body">
          <section
            className="task-collaboration-roles-board"
            aria-label={t("collaboration.workspace.roles")}
          >
            <div className="task-collaboration-section-heading">
              <h3>{t("collaboration.workspace.roles")}</h3>
              <span>
                {isDraft
                  ? t("collaboration.workspace.waitingCreate")
                  : isActive
                    ? t("collaboration.workspace.active")
                    : t("collaboration.workspace.waitingStart")}
              </span>
            </div>
            <div className="task-collaboration-role-grid">
              {ROLES.map(({ role, labelKey }) => {
                const runtimeId = assignments.get(role);
                const isCoordinator = role === "coordinator";
                const status = !runtimeId
                  ? t("collaboration.workspace.unassignedStatus")
                  : isDraft
                    ? t("collaboration.workspace.pendingCreate")
                    : isCoordinator
                      ? t("collaboration.workspace.waitingBrief")
                      : t("collaboration.workspace.waitingCoordinator");
                return (
                  <article key={role}>
                    <span>
                      {t(`collaboration.workspace.roleLabels.${labelKey}`)}
                    </span>
                    <strong>
                      {runtimeId
                        ? runtimeNames.get(runtimeId) || runtimeId
                        : t("collaboration.workspace.leaveUnassigned")}
                    </strong>
                    <small>{status}</small>
                  </article>
                );
              })}
            </div>
          </section>

          <section
            className="task-collaboration-progress-board"
            aria-label={t("collaboration.workspace.progress")}
          >
            <div className="task-collaboration-section-heading">
              <h3>{t("collaboration.workspace.progress")}</h3>
            </div>
            <ol>
              <li className="done">
                <CheckCircle2 size={16} />
                <span>{t("collaboration.workspace.rolesSaved")}</span>
              </li>
              <li className={isDraft ? "current" : "done"}>
                {isDraft ? (
                  <CircleDotDashed size={16} />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>
                  {isDraft
                    ? t("collaboration.workspace.sendFirstBrief")
                    : t("collaboration.workspace.userStarted")}
                </span>
              </li>
              <li className={isActive ? "current" : ""}>
                <CircleDotDashed size={16} />
                <span>{t("collaboration.workspace.coordinatorPlans")}</span>
              </li>
              <li>
                <CircleDotDashed size={16} />
                <span>{t("collaboration.workspace.executionFlow")}</span>
              </li>
            </ol>
          </section>
        </div>

        <footer className="task-collaboration-workspace-footer">
          <p>
            {isDraft
              ? t("collaboration.workspace.draftHint")
              : t("collaboration.workspace.activeHint")}
          </p>
          <div>
            {!isDraft && !isActive ? (
              <button type="button" className="primary-btn" onClick={onStart}>
                <Play size={16} /> {t("collaboration.workspace.start")}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onOpenTask}
            >
              {isDraft
                ? t("collaboration.workspace.openCoordinatorTask")
                : t("collaboration.workspace.openTask")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
