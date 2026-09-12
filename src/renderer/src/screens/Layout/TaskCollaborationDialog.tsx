import { useEffect, useMemo, useState } from "react";
import { Bot, Folder, Plus, Send, Trash2, Users, X } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { TaskCollaborationAssignment } from "../../../../shared/task-collaboration";
import { buildTaskCollaborationGraph } from "../../../../shared/task-collaboration-graph";
import { t as translate, type AppLocale } from "../../../../shared/i18n";
import { useI18n } from "../../components/useI18n";

type Translate = (key: string, options?: Record<string, unknown>) => string;
const DEFAULT_ROLE_KEYS = ["coordinator", "implementer", "tester"] as const;

export interface CollaborationTaskDraft {
  runId?: string;
  taskId?: string;
  title: string;
  projectWorkspaceId?: string | null;
  projectName?: string | null;
  /** Legacy path used only while opening an old collaboration record. */
  projectFolder?: string | null;
  sourceRuntimeId?: string;
  assignments?: TaskCollaborationAssignment[];
  /** Optional brief prefilled from a runtime proposal, still editable by the user. */
  message?: string;
}

function projectName(
  path: string | null | undefined,
  fallback: string,
): string {
  return path?.split(/[\\/]/).filter(Boolean).at(-1) || fallback;
}

function defaultAssignments(
  draft: CollaborationTaskDraft,
  t: Translate,
): TaskCollaborationAssignment[] {
  if (draft.assignments?.length) {
    return draft.assignments.map((item) => ({
      ...item,
      id: item.id || crypto.randomUUID(),
    }));
  }
  return DEFAULT_ROLE_KEYS.map((key, index) => {
    const prefix = `collaboration.dialog.defaultRoles.${key}`;
    return {
      role: t(`${prefix}.role`),
      ...(index === 0 && draft.sourceRuntimeId
        ? {
            runtimeId: draft.sourceRuntimeId,
          }
        : {}),
      id: crypto.randomUUID(),
      responsibility: t(`${prefix}.responsibility`),
      context: t(`${prefix}.context`),
      workspaceAccess:
        index === 0 && (draft.projectWorkspaceId || draft.projectFolder)
          ? "evidence_bundle"
          : undefined,
    };
  });
}

function localizedDefaultAssignments(
  draft: CollaborationTaskDraft,
  locale: AppLocale,
): TaskCollaborationAssignment[] {
  return defaultAssignments(draft, (key, options) =>
    translate(key, locale, options),
  );
}

export default function TaskCollaborationDialog({
  draft,
  runtimes,
  onClose,
  onStart,
}: {
  draft: CollaborationTaskDraft;
  runtimes: AgentRuntimeDefinition[];
  onClose: () => void;
  /** Starts the existing task dialogue after the user explicitly sends the brief. */
  onStart: (
    assignments: TaskCollaborationAssignment[],
    message: string,
  ) => void;
}): React.JSX.Element {
  const { locale, t } = useI18n();
  const available = useMemo(
    () => runtimes.filter((runtime) => runtime.enabled),
    [runtimes],
  );
  const [assignments, setAssignments] = useState<TaskCollaborationAssignment[]>(
    () => localizedDefaultAssignments(draft, locale),
  );
  const [message, setMessage] = useState(() => draft.message || "");
  const orchestrationError = useMemo(() => {
    const configured = assignments.filter(
      (item) => item.role.trim() && item.runtimeId,
    );
    if (configured.length === 0)
      return t("collaboration.dialog.assignAgentError");
    try {
      buildTaskCollaborationGraph(configured);
      return "";
    } catch (error) {
      return error instanceof Error
        ? error.message
        : t("collaboration.dialog.invalidDependencies");
    }
  }, [assignments, t]);

  useEffect(() => {
    setAssignments(localizedDefaultAssignments(draft, locale));
    setMessage(draft.message || "");
  }, [draft, locale]);

  const updateAssignment = (
    id: string | undefined,
    patch: Partial<TaskCollaborationAssignment>,
  ): void => {
    setAssignments((current) =>
      current.map((item, index) =>
        (id ? item.id === id : index === 0) ? { ...item, ...patch } : item,
      ),
    );
  };

  const addRole = (): void => {
    setAssignments((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        role: t("collaboration.dialog.newRole"),
        responsibility: "",
        context: t("collaboration.dialog.taskContext"),
      },
    ]);
  };

  const removeRole = (id: string | undefined): void => {
    setAssignments((current) =>
      current
        .filter((item) => (id ? item.id !== id : false))
        .map((item) => ({
          ...item,
          ...(item.dependsOn
            ? {
                dependsOn: item.dependsOn.filter(
                  (dependency) => dependency !== id,
                ),
              }
            : {}),
        })),
    );
  };

  const workspaceAccessFor = (
    assignment: TaskCollaborationAssignment,
  ): "" | "local_direct" | "remote_mapping" | "evidence_bundle" => {
    if (assignment.workspaceAccess) return assignment.workspaceAccess;
    const selected = available.find((item) => item.id === assignment.runtimeId);
    if (selected?.location !== "remote") return "local_direct";
    return draft.projectFolder ? "evidence_bundle" : "";
  };

  const start = (): void => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const configured = assignments
      .map((item) => ({ ...item, role: item.role.trim() }))
      .filter((item) => item.role && item.runtimeId);
    if (!configured.length || orchestrationError) return;
    onStart(configured, trimmed);
  };

  return (
    <div
      className="task-collaboration-overlay"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="task-collaboration-dialog task-collaboration-setup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-collaboration-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="task-collaboration-title">
              <Users size={20} /> {t("collaboration.dialog.title")}
            </h2>
            <p>{draft.title || t("collaboration.dialog.planFallback")}</p>
          </div>
          <button
            type="button"
            className="icon-btn"
            title={t("collaboration.dialog.close")}
            aria-label={t("collaboration.dialog.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="task-collaboration-body">
          <div className="task-collaboration-project">
            <span>
              <Folder size={15} /> {t("collaboration.dialog.linkedProject")}
            </span>
            <strong
              title={draft.projectName || draft.projectFolder || undefined}
            >
              {draft.projectName ||
                projectName(
                  draft.projectFolder,
                  t("collaboration.dialog.noProject"),
                )}
            </strong>
          </div>

          <section
            className="task-collaboration-role-table"
            aria-label={t("collaboration.dialog.roleSettings")}
          >
            <div className="task-collaboration-role-head" aria-hidden="true">
              <span>{t("collaboration.dialog.columns.role")}</span>
              <span>{t("collaboration.dialog.columns.agent")}</span>
              <span>{t("collaboration.dialog.columns.responsibility")}</span>
              <span>{t("collaboration.dialog.columns.context")}</span>
              <span>{t("collaboration.dialog.columns.dependencies")}</span>
              <span>{t("collaboration.dialog.columns.workspace")}</span>
              <span />
            </div>
            {assignments.map((assignment) => {
              const selectedRuntime = available.find(
                (item) => item.id === assignment.runtimeId,
              );
              return (
                <div
                  className="task-collaboration-role-row"
                  key={assignment.id || assignment.role}
                >
                  <input
                    aria-label={t("collaboration.dialog.role")}
                    value={assignment.role}
                    onChange={(event) =>
                      updateAssignment(assignment.id, {
                        role: event.target.value,
                      })
                    }
                  />
                  <label className="task-collaboration-agent-picker">
                    <span
                      className="task-collaboration-agent-avatar"
                      style={
                        selectedRuntime?.color
                          ? { background: selectedRuntime.color }
                          : undefined
                      }
                    >
                      {selectedRuntime?.avatar ? (
                        <img src={selectedRuntime.avatar} alt="" />
                      ) : (
                        <Bot size={15} />
                      )}
                    </span>
                    <select
                      aria-label={t("collaboration.dialog.agentLabel", {
                        role:
                          assignment.role ||
                          t("collaboration.dialog.roleFallback"),
                      })}
                      value={assignment.runtimeId || ""}
                      onChange={(event) =>
                        updateAssignment(assignment.id, {
                          runtimeId: event.target.value || undefined,
                        })
                      }
                    >
                      <option value="">
                        {t("collaboration.dialog.leaveUnassigned")}
                      </option>
                      {available.map((runtime) => (
                        <option value={runtime.id} key={runtime.id}>
                          {runtime.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    aria-label={t("collaboration.dialog.responsibilityLabel", {
                      role:
                        assignment.role ||
                        t("collaboration.dialog.roleFallback"),
                    })}
                    value={assignment.responsibility || ""}
                    onChange={(event) =>
                      updateAssignment(assignment.id, {
                        responsibility: event.target.value,
                      })
                    }
                  />
                  <input
                    aria-label={t("collaboration.dialog.contextLabel", {
                      role:
                        assignment.role ||
                        t("collaboration.dialog.roleFallback"),
                    })}
                    value={assignment.context || ""}
                    onChange={(event) =>
                      updateAssignment(assignment.id, {
                        context: event.target.value,
                      })
                    }
                  />
                  <select
                    multiple
                    className="task-collaboration-dependency-picker"
                    aria-label={t("collaboration.dialog.dependenciesLabel", {
                      role:
                        assignment.role ||
                        t("collaboration.dialog.roleFallback"),
                    })}
                    title={t("collaboration.dialog.dependenciesTitle")}
                    value={assignment.dependsOn || []}
                    onChange={(event) =>
                      updateAssignment(assignment.id, {
                        dependsOn: Array.from(
                          event.currentTarget.selectedOptions,
                        ).map((option) => option.value),
                      })
                    }
                  >
                    {assignments
                      .filter((candidate) => candidate.id !== assignment.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.role ||
                            t("collaboration.dialog.unnamedRole")}
                        </option>
                      ))}
                  </select>
                  <div className="task-collaboration-workspace-access">
                    <select
                      aria-label={t("collaboration.dialog.workspaceLabel", {
                        role:
                          assignment.role ||
                          t("collaboration.dialog.roleFallback"),
                      })}
                      value={workspaceAccessFor(assignment)}
                      onChange={(event) =>
                        updateAssignment(assignment.id, {
                          workspaceAccess: (event.target.value ||
                            undefined) as TaskCollaborationAssignment["workspaceAccess"],
                          ...(event.target.value !== "remote_mapping"
                            ? { workspaceRef: undefined }
                            : {}),
                        })
                      }
                    >
                      {selectedRuntime?.location !== "remote" ? (
                        <option value="local_direct">
                          {t("collaboration.dialog.localDirect")}
                        </option>
                      ) : null}
                      {selectedRuntime?.location === "remote" ? (
                        <option value="">
                          {t("collaboration.dialog.runtimeDevice")}
                        </option>
                      ) : null}
                      {selectedRuntime?.location === "remote" ? (
                        <option value="remote_mapping">
                          {t("collaboration.dialog.remoteMapping")}
                        </option>
                      ) : null}
                      <option value="evidence_bundle">
                        {t("collaboration.dialog.evidenceBundle")}
                      </option>
                    </select>
                    {workspaceAccessFor(assignment) === "remote_mapping" ? (
                      <input
                        aria-label={t(
                          "collaboration.dialog.remoteMappingLabel",
                          {
                            role:
                              assignment.role ||
                              t("collaboration.dialog.roleFallback"),
                          },
                        )}
                        placeholder={t(
                          "collaboration.dialog.remoteMappingPlaceholder",
                        )}
                        value={assignment.workspaceRef || ""}
                        onChange={(event) =>
                          updateAssignment(assignment.id, {
                            workspaceRef: event.target.value,
                          })
                        }
                      />
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="icon-btn task-collaboration-remove-role"
                    title={t("collaboration.dialog.removeRole")}
                    aria-label={t("collaboration.dialog.removeRole")}
                    onClick={() => removeRole(assignment.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              );
            })}
          </section>
          <p className="task-collaboration-dag-hint">
            {t("collaboration.dialog.dagHint")}
          </p>
          {orchestrationError ? (
            <p className="task-collaboration-dag-error" role="alert">
              {orchestrationError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm task-collaboration-add-role"
            onClick={addRole}
          >
            <Plus size={15} /> {t("collaboration.dialog.addRole")}
          </button>
        </div>

        <footer className="task-collaboration-composer">
          <textarea
            autoFocus
            aria-label={t("collaboration.dialog.taskBrief")}
            placeholder={t("collaboration.dialog.taskBriefPlaceholder")}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                start();
              }
            }}
          />
          <div className="task-collaboration-composer-tools">
            <span
              title={
                draft.projectName ||
                draft.projectFolder ||
                t("collaboration.dialog.noProject")
              }
            >
              <Folder size={16} />{" "}
              {draft.projectName ||
                projectName(
                  draft.projectFolder,
                  t("collaboration.dialog.noProject"),
                )}
            </span>
            <span>{t("collaboration.dialog.startHint")}</span>
            <button
              type="button"
              className="primary-btn"
              onClick={start}
              disabled={!message.trim() || Boolean(orchestrationError)}
            >
              <Send size={16} /> {t("collaboration.dialog.sendAndStart")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
