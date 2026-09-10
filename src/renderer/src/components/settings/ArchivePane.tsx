import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  Folder,
  LoaderCircle,
  MessageSquare,
  Search,
  Trash2,
} from "lucide-react";
import type { RuntimeConversationSummary } from "../../../../shared/runtime-conversations";
import type {
  ArchivedItem,
  ArchiveItemKind,
} from "../../../../shared/archives";
import { useI18n } from "../useI18n";

interface ArchivedProjectTask {
  id: string;
  title: string;
  projectPath: string;
  updatedAt: number;
}

const TASK_PAGE_SIZE = 100;
const MAX_TASK_PAGES = 50;

function normalizedProjectPath(value?: string | null): string {
  return (value ?? "")
    .trim()
    .replace(/\//g, "\\")
    .replace(/\\+$/, "")
    .toLocaleLowerCase();
}

async function collectPages<T>(
  fetchPage: (limit: number, offset: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let pageIndex = 0; pageIndex < MAX_TASK_PAGES; pageIndex += 1) {
    const page = await fetchPage(TASK_PAGE_SIZE, rows.length);
    rows.push(...page);
    if (page.length < TASK_PAGE_SIZE) break;
  }
  return rows;
}

export default function ArchivePane({
  profile,
}: {
  profile?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | ArchiveItemKind>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<ArchivedProjectTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    () => new Set(),
  );

  const load = useCallback(() => {
    void window.agentsOneAPI.listArchivedItems(profile).then(setItems);
    setTasksLoading(true);
    void Promise.all([
      collectPages((limit, offset) =>
        window.agentsOneAPI.listCachedSessions(limit, offset),
      ),
      collectPages((limit, offset) =>
        window.agentsOneAPI.listRuntimeConversations(profile, limit, offset),
      ),
    ])
      .then(([nativeSessions, runtimeConversations]) => {
        const rows = new Map<string, ArchivedProjectTask>();
        for (const session of nativeSessions) {
          if (!session.contextFolder) continue;
          rows.set(session.id, {
            id: session.id,
            title: session.title,
            projectPath: session.contextFolder,
            updatedAt: session.startedAt,
          });
        }
        for (const conversation of runtimeConversations as RuntimeConversationSummary[]) {
          if (!conversation.workspace) continue;
          rows.set(conversation.id, {
            id: conversation.id,
            title: conversation.title,
            projectPath: conversation.workspace,
            updatedAt: conversation.updatedAt,
          });
        }
        setProjectTasks(
          Array.from(rows.values()).sort((a, b) => b.updatedAt - a.updatedAt),
        );
      })
      .catch(() => setProjectTasks([]))
      .finally(() => setTasksLoading(false));
  }, [profile]);
  useEffect(() => {
    load();
    window.addEventListener("agents-one:archives-changed", load);
    return () =>
      window.removeEventListener("agents-one:archives-changed", load);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (!needle ||
          `${item.title} ${item.projectPath || ""}`
            .toLocaleLowerCase()
            .includes(needle) ||
          (item.kind === "project" &&
            projectTasks.some(
              (task) =>
                normalizedProjectPath(task.projectPath) ===
                  normalizedProjectPath(item.targetId) &&
                task.title.toLocaleLowerCase().includes(needle),
            ))),
    );
  }, [items, kind, projectTasks, query]);

  const tasksForProject = useCallback(
    (item: ArchivedItem): ArchivedProjectTask[] => {
      const projectPath = normalizedProjectPath(item.targetId);
      return projectTasks.filter(
        (task) => normalizedProjectPath(task.projectPath) === projectPath,
      );
    },
    [projectTasks],
  );

  const toggleProject = (id: string): void => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const changed = (): void => {
    load();
    window.dispatchEvent(new Event("agents-one:archives-changed"));
  };
  const restore = async (item: ArchivedItem): Promise<void> => {
    setBusyId(item.id);
    try {
      await window.agentsOneAPI.restoreArchivedItem(item.id, profile);
      changed();
    } finally {
      setBusyId(null);
    }
  };
  const permanentlyDelete = async (item: ArchivedItem): Promise<void> => {
    const warning =
      item.kind === "project"
        ? t("settings.archives.deleteProjectConfirm")
        : t("settings.archives.deleteTaskConfirm");
    if (!window.confirm(warning)) return;
    setBusyId(item.id);
    try {
      await window.agentsOneAPI.deleteArchivedItem(item.id, profile);
      changed();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="settings-modal-pane settings-archive-pane">
      <div className="settings-section-intro settings-archive-intro">
        <strong>{t("settings.archives.title")}</strong>
        <span>{t("settings.archives.hint")}</span>
      </div>
      <div className="settings-archive-toolbar">
        <label>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("settings.archives.search")}
          />
        </label>
        <select
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as "all" | ArchiveItemKind)
          }
        >
          <option value="all">{t("settings.archives.all")}</option>
          <option value="task">{t("settings.archives.tasks")}</option>
          <option value="project">{t("settings.archives.projects")}</option>
        </select>
      </div>
      <div className="settings-archive-list">
        {filtered.length === 0 ? (
          <div className="settings-archive-empty">
            {t("settings.archives.empty")}
          </div>
        ) : (
          filtered.map((item) => {
            const projectOpen = expandedProjects.has(item.id);
            const childTasks =
              item.kind === "project" ? tasksForProject(item) : [];
            return (
              <article className="settings-archive-item" key={item.id}>
                <div className="settings-archive-item-main">
                  <span className="settings-archive-icon">
                    {item.kind === "project" ? (
                      <Folder size={18} />
                    ) : (
                      <MessageSquare size={18} />
                    )}
                  </span>
                  <div className="settings-archive-details">
                    <strong>{item.title}</strong>
                    <small title={item.projectPath}>
                      {item.projectPath ||
                        new Date(item.archivedAt).toLocaleString()}
                    </small>
                  </div>
                  <div className="settings-archive-actions">
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={busyId === item.id}
                      onClick={() => void restore(item)}
                    >
                      <ArchiveRestore size={14} />
                      {t("settings.archives.restore")}
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      disabled={busyId === item.id}
                      onClick={() => void permanentlyDelete(item)}
                    >
                      <Trash2 size={14} />
                      {t("settings.archives.delete")}
                    </button>
                  </div>
                </div>
                {item.kind === "project" ? (
                  <div className="settings-archive-project-tasks">
                    <button
                      type="button"
                      className="settings-archive-project-toggle"
                      aria-expanded={projectOpen}
                      onClick={() => toggleProject(item.id)}
                    >
                      {projectOpen ? (
                        <ChevronDown size={14} />
                      ) : (
                        <ChevronRight size={14} />
                      )}
                      <span>{t("settings.archives.taskConversations")}</span>
                      {!tasksLoading ? (
                        <small>{childTasks.length}</small>
                      ) : null}
                    </button>
                    {projectOpen ? (
                      <div className="settings-archive-project-task-list">
                        {tasksLoading ? (
                          <div className="settings-archive-project-task-empty">
                            <LoaderCircle className="settings-spin" size={14} />
                            {t("settings.archives.loadingTasks")}
                          </div>
                        ) : childTasks.length === 0 ? (
                          <div className="settings-archive-project-task-empty">
                            {t("settings.archives.noProjectTasks")}
                          </div>
                        ) : (
                          childTasks.map((task) => (
                            <div
                              className="settings-archive-project-task"
                              key={task.id}
                            >
                              <MessageSquare size={13} />
                              <span title={task.title}>{task.title}</span>
                              <time>
                                {new Date(task.updatedAt).toLocaleString()}
                              </time>
                            </div>
                          ))
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
