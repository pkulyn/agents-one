import { useEffect, useMemo, useState } from "react";
import { Folder, Plus, Send, Trash2, Users, X } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { TaskCollaborationAssignment } from "../../../../shared/task-collaboration";
import { buildTaskCollaborationGraph } from "../../../../shared/task-collaboration-graph";
import { t as translate, type AppLocale } from "../../../../shared/i18n";
import { useI18n } from "../../components/useI18n";

import CollaborationAgentPicker from "./CollaborationAgentPicker";
import {
  COLLABORATION_ROLE_PRESETS,
  findCollaborationRolePreset,
  COLLABORATION_CONTEXT_SOURCES,
} from "../../../../shared/task-collaboration-presets";

type Translate = (key: string, options?: Record<string, unknown>) => string;
const DEFAULT_ROLE_KEYS = ["coordinator", "implementer", "tester"] as const;

export interface CollaborationTaskDraft {
  configureOnly?: boolean;
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
  const team = DEFAULT_ROLE_KEYS.map((key, index) => {
    const prefix = `collaboration.dialog.defaultRoles.${key}`;
    return {
      role: t(`${prefix}.role`),
      ...(index === 0 && draft.sourceRuntimeId
        ? {
            runtimeId: draft.sourceRuntimeId,
          }
        : {}),
      id: crypto.randomUUID(),
      responsibility: t(`collaboration.dialog.presets.${key}.responsibility`),
      context: [
        t("collaboration.dialog.sources.task"),
        ...COLLABORATION_CONTEXT_SOURCES.map((source) =>
          t(`collaboration.dialog.sources.${source}`),
        ),
      ].join("、"),
      contextSources: [
        ...COLLABORATION_ROLE_PRESETS.find((preset) => preset.key === key)!
          .contextSources,
      ],
    };
  });
  return team.map((assignment, index) => ({
    ...assignment,
    dependsOn: index ? [team[index - 1].id] : [],
  }));
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
  const defaultTeam = useMemo(
    () => localizedDefaultAssignments(draft, locale),
    [draft, locale],
  );
  const [assignments, setAssignments] =
    useState<TaskCollaborationAssignment[]>(defaultTeam);
  const [message, setMessage] = useState(() => draft.message || "");
  const orchestrationError = useMemo(() => {
    const configured = assignments.filter(
      (item) => item.role.trim() && item.runtimeId,
    );
    if (
      draft.configureOnly &&
      (configured.length !== assignments.length ||
        new Set(configured.map((item) => item.runtimeId)).size < 2 ||
        configured.some((item) => !item.responsibility?.trim()))
    )
      return t("collaboration.dialog.completeTeam");
    if (
      configured.some(
        (item) => !available.some((agent) => agent.id === item.runtimeId),
      )
    )
      return t("collaboration.dialog.currentUnavailable");
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
  }, [assignments, available, draft.configureOnly, t]);

  useEffect(() => {
    setAssignments(defaultTeam);
    setMessage(draft.message || "");
  }, [defaultTeam, draft.message]);

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
      ...current.map((item, index) => ({
        ...item,
        dependsOn: current.some(
          (assignment) => assignment.dependsOn !== undefined,
        )
          ? item.dependsOn || []
          : index
            ? [current[index - 1].id!]
            : [],
      })),
      {
        id: crypto.randomUUID(),
        role: t("collaboration.dialog.newRole"),
        responsibility: "",
        context: t("collaboration.dialog.taskContext"),
        dependsOn: current.length ? [current.at(-1)!.id!] : [],
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

  const presetFor = (role: string): string =>
    findCollaborationRolePreset(role)?.key || "custom";
  const choosePreset = (id: string | undefined, key: string): void => {
    const preset = COLLABORATION_ROLE_PRESETS.find((item) => item.key === key);
    if (!preset) {
      updateAssignment(id, {
        role: t("collaboration.dialog.newRole"),
        responsibility: "",
      });
      return;
    }
    const contextSources = [...preset.contextSources];
    updateAssignment(id, {
      role: t("collaboration.dialog.presets." + key + ".role"),
      responsibility: t(
        "collaboration.dialog.presets." + key + ".responsibility",
      ),
      contextSources,
      context: [
        t("collaboration.dialog.sources.task"),
        ...contextSources.map((source) =>
          t("collaboration.dialog.sources." + source),
        ),
      ].join(" · "),
    });
  };
  const toggleDependency = (
    id: string | undefined,
    dependency: string,
  ): void => {
    setAssignments((current) => {
      const explicit = current.some((item) => item.dependsOn !== undefined);
      return current.map((item, index) => {
        const dependencies = explicit
          ? item.dependsOn || []
          : index
            ? [current[index - 1].id!]
            : [];
        return {
          ...item,
          dependsOn:
            item.id === id
              ? dependencies.includes(dependency)
                ? dependencies.filter((value) => value !== dependency)
                : [...dependencies, dependency]
              : dependencies,
        };
      });
    });
  };

  const start = (): void => {
    const trimmed = message.trim();
    if (!trimmed && !draft.configureOnly) return;
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

          <p className="collaboration-setup-hint">
            {t("collaboration.dialog.setupHint")}
          </p>
          <section
            className="collaboration-setup-roles"
            aria-label={t("collaboration.dialog.roleSettings")}
          >
            {assignments.map((assignment) => {
              const preset = presetFor(assignment.role);
              const role =
                assignment.role || t("collaboration.dialog.roleFallback");
              return (
                <article
                  className="collaboration-setup-role"
                  key={assignment.id}
                >
                  <div className="collaboration-setup-main">
                    <label>
                      <span>{t("collaboration.dialog.columns.role")}</span>
                      <select
                        aria-label={t("collaboration.dialog.role")}
                        value={preset}
                        onChange={(event) =>
                          choosePreset(assignment.id, event.target.value)
                        }
                      >
                        {COLLABORATION_ROLE_PRESETS.map((item) => (
                          <option key={item.key} value={item.key}>
                            {t(
                              "collaboration.dialog.presets." +
                                item.key +
                                ".role",
                            )}
                          </option>
                        ))}
                        <option value="custom">
                          {t("collaboration.dialog.customRole")}
                        </option>
                      </select>
                    </label>
                    <label>
                      <span>{t("collaboration.dialog.columns.agent")}</span>
                      <CollaborationAgentPicker
                        label={t("collaboration.dialog.agentLabel", { role })}
                        value={assignment.runtimeId}
                        runtimes={runtimes}
                        placeholder={t("collaboration.dialog.leaveUnassigned")}
                        onChange={(runtimeId) =>
                          updateAssignment(assignment.id, {
                            runtimeId,
                            ...(runtimeId !== assignment.runtimeId
                              ? {
                                  workspaceAccess: undefined,
                                  workspaceRef: undefined,
                                }
                              : {}),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="icon-btn task-collaboration-remove-role"
                      aria-label={t("collaboration.dialog.removeRole")}
                      title={t("collaboration.dialog.removeRole")}
                      onClick={() => removeRole(assignment.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  {preset === "custom" ? (
                    <input
                      aria-label={t("collaboration.dialog.role")}
                      value={assignment.role}
                      onChange={(event) =>
                        updateAssignment(assignment.id, {
                          role: event.target.value,
                        })
                      }
                    />
                  ) : null}
                  <dl className="collaboration-setup-description">
                    <div>
                      <dt>
                        {t("collaboration.dialog.columns.responsibility")}
                      </dt>
                      <dd>{assignment.responsibility || "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("collaboration.dialog.columns.context")}</dt>
                      <dd>
                        {assignment.context ||
                          t("collaboration.dialog.taskContext")}
                      </dd>
                    </div>
                  </dl>
                  <details className="collaboration-setup-customize">
                    <summary>{t("collaboration.dialog.editDetails")}</summary>
                    <label>
                      {t("collaboration.dialog.columns.responsibility")}
                      <textarea
                        aria-label={t(
                          "collaboration.dialog.responsibilityLabel",
                          { role },
                        )}
                        value={assignment.responsibility || ""}
                        onChange={(event) =>
                          updateAssignment(assignment.id, {
                            responsibility: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("collaboration.dialog.columns.context")}
                      <input
                        aria-label={t("collaboration.dialog.contextLabel", {
                          role,
                        })}
                        value={assignment.context || ""}
                        onChange={(event) =>
                          updateAssignment(assignment.id, {
                            context: event.target.value,
                          })
                        }
                      />
                    </label>
                    <div className="collaboration-setup-context-options">
                      {COLLABORATION_CONTEXT_SOURCES.map((source) => (
                        <label key={source}>
                          <input
                            type="checkbox"
                            checked={
                              !assignment.contextSources ||
                              assignment.contextSources.includes(source)
                            }
                            onChange={(event) => {
                              const sources =
                                assignment.contextSources ||
                                COLLABORATION_CONTEXT_SOURCES;
                              const contextSources = event.target.checked
                                ? [...sources, source]
                                : sources.filter((item) => item !== source);
                              updateAssignment(assignment.id, {
                                contextSources,
                                context: [
                                  t("collaboration.dialog.sources.task"),
                                  ...contextSources.map((item) =>
                                    t("collaboration.dialog.sources." + item),
                                  ),
                                ].join(" · "),
                              });
                            }}
                          />
                          {t("collaboration.dialog.sources." + source)}
                        </label>
                      ))}
                    </div>
                    <small>{t("collaboration.dialog.contextHint")}</small>
                    {preset !== "custom" ? (
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={() => choosePreset(assignment.id, preset)}
                      >
                        {t("collaboration.dialog.resetPreset")}
                      </button>
                    ) : null}
                  </details>
                </article>
              );
            })}
          </section>
          <details className="collaboration-setup-advanced">
            <summary>{t("collaboration.dialog.advanced")}</summary>
            <p>{t("collaboration.dialog.orderHint")}</p>
            {assignments.map((assignment, index) => {
              const selected = runtimes.find(
                (item) => item.id === assignment.runtimeId,
              );
              const role =
                assignment.role || t("collaboration.dialog.roleFallback");
              const explicit = assignments.some(
                (item) => item.dependsOn !== undefined,
              );
              const dependencies = explicit
                ? assignment.dependsOn || []
                : index
                  ? [assignments[index - 1].id!]
                  : [];
              return (
                <div
                  className="collaboration-setup-advanced-row"
                  key={assignment.id}
                >
                  <strong>{role}</strong>
                  <fieldset>
                    <legend>
                      {t("collaboration.dialog.columns.dependencies")}
                    </legend>
                    {assignments
                      .filter((item) => item.id !== assignment.id)
                      .map((candidate) => (
                        <label key={candidate.id}>
                          <input
                            type="checkbox"
                            checked={dependencies.includes(candidate.id!)}
                            onChange={() =>
                              toggleDependency(assignment.id, candidate.id!)
                            }
                          />
                          {candidate.role}
                        </label>
                      ))}
                  </fieldset>
                  <label>
                    {t("collaboration.dialog.accessSummary")}
                    <select
                      aria-label={t("collaboration.dialog.workspaceLabel", {
                        role,
                      })}
                      value={assignment.workspaceAccess || ""}
                      onChange={(event) =>
                        updateAssignment(assignment.id, {
                          workspaceAccess: (event.target.value ||
                            undefined) as TaskCollaborationAssignment["workspaceAccess"],
                          workspaceRef:
                            event.target.value === "remote_mapping"
                              ? assignment.workspaceRef
                              : undefined,
                        })
                      }
                    >
                      <option value="">
                        {t("collaboration.dialog.autoAccess")}
                      </option>
                      {selected?.location !== "remote" ? (
                        <option value="local_direct">
                          {t("collaboration.dialog.localDirect")}
                        </option>
                      ) : (
                        <>
                          <option value="remote_mapping">
                            {t("collaboration.dialog.remoteMapping")}
                          </option>
                          <option value="evidence_bundle">
                            {t("collaboration.dialog.evidenceBundle")}
                          </option>
                        </>
                      )}
                      {selected?.location !== "remote" &&
                      assignment.workspaceAccess === "evidence_bundle" ? (
                        <option value="evidence_bundle">
                          {t("collaboration.dialog.evidenceBundle")}
                        </option>
                      ) : null}
                    </select>
                  </label>
                  {assignment.workspaceAccess === "remote_mapping" ? (
                    <input
                      aria-label={t("collaboration.dialog.remoteMappingLabel", {
                        role,
                      })}
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
              );
            })}
            <p>{t("collaboration.dialog.accessHint")}</p>
          </details>
          {orchestrationError ? (
            <p
              className={
                orchestrationError === t("collaboration.dialog.completeTeam")
                  ? "collaboration-setup-hint"
                  : "task-collaboration-dag-error"
              }
              role={
                orchestrationError === t("collaboration.dialog.completeTeam")
                  ? "status"
                  : "alert"
              }
            >
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
          {!draft.configureOnly && (
            <>
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
            </>
          )}
          <div className="task-collaboration-composer-tools">
            <span>{t("collaboration.dialog.startHint")}</span>
            <button
              type="button"
              className="primary-btn"
              onClick={start}
              disabled={
                (!draft.configureOnly && !message.trim()) ||
                Boolean(orchestrationError)
              }
            >
              <Send size={16} />{" "}
              {t(
                draft.configureOnly
                  ? "collaboration.dialog.enable"
                  : "collaboration.dialog.sendAndStart",
              )}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
