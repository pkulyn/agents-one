import { useEffect, useMemo, useState } from "react";
import {
  FileText,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import type {
  AgentRuntimeConfig,
  AgentRuntimeDefinition,
} from "../../../../shared/agent-runtimes";
import type { ProjectWorkspaceCapability } from "../../../../shared/project-folders";
import { useI18n } from "../useI18n";

interface OneMemoryPaneProps {
  runtime: AgentRuntimeDefinition;
  onChanged: () => void;
}

interface MemoryEntry {
  id: string;
  kind: "personal" | "project";
  name: string;
  tag: string;
  workspaceId?: string;
  content: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function sizeLabel(value: string): string {
  return `${(byteLength(value) / 1024).toFixed(1)} KB`;
}

export default function OneMemoryPane({
  runtime,
  onChanged,
}: OneMemoryPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentRuntimeConfig>(runtime.config);
  const [projects, setProjects] = useState<ProjectWorkspaceCapability[]>([]);
  const [personal, setPersonal] = useState("");
  const [projectMemories, setProjectMemories] = useState<
    Record<string, string>
  >({});
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "personal" | "project">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let alive = true;
    setState("loading");
    void (async () => {
      try {
        const [list, personalMemory] = await Promise.all([
          window.agentsOneAPI.listProjectWorkspaces(),
          window.agentsOneAPI.getOneRuntimeMemory(runtime.id),
        ]);
        if (!alive) return;
        setProjects(list);
        setPersonal(personalMemory);
        const memories = await Promise.all(
          list.map(async (project) => {
            try {
              return [
                project.id,
                await window.agentsOneAPI.getOneProjectMemory(
                  runtime.id,
                  project.id,
                ),
              ] as const;
            } catch {
              return [project.id, ""] as const;
            }
          }),
        );
        if (!alive) return;
        setProjectMemories(Object.fromEntries(memories));
        setState("ready");
      } catch {
        if (alive) setState("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [runtime.id, refresh]);

  useEffect(() => {
    setConfig(runtime.config);
  }, [runtime.id, runtime.config]);

  const entries = useMemo<MemoryEntry[]>(() => {
    const list: MemoryEntry[] = [
      {
        id: "personal",
        kind: "personal",
        name: "MEMORY.md",
        tag: t("agents.configMemoryPersonalTag"),
        content: personal,
      },
    ];
    for (const project of projects) {
      const content = projectMemories[project.id] ?? "";
      if (!content.trim()) continue;
      list.push({
        id: `project:${project.id}`,
        kind: "project",
        name: `${project.name}.md`,
        tag: t("agents.configMemoryProjectTag", { name: project.name }),
        workspaceId: project.id,
        content,
      });
    }
    return list;
  }, [personal, projects, projectMemories, t]);

  const visibleEntries = entries.filter((entry) => {
    if (scope !== "all" && entry.kind !== scope) return false;
    const search = query.trim().toLowerCase();
    if (!search) return true;
    return (
      entry.name.toLowerCase().includes(search) ||
      entry.content.toLowerCase().includes(search)
    );
  });

  const enabled = config.oneMemoryEnabled === true;

  async function setEnabled(next: boolean): Promise<void> {
    const previous = config.oneMemoryEnabled;
    setConfig((current) => ({ ...current, oneMemoryEnabled: next }));
    setBusy("toggle");
    setNotice(null);
    try {
      const latest = await window.agentsOneAPI.listAgentRuntimes();
      const current =
        latest.find((item) => item.id === runtime.id)?.config || runtime.config;
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: { ...current, oneMemoryEnabled: next },
      });
      setConfig(saved.config);
      setNotice(t("agents.configMemorySettingSaved"));
      onChanged();
    } catch (error) {
      setConfig((current) => ({ ...current, oneMemoryEnabled: previous }));
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  function startEdit(entry: MemoryEntry): void {
    setEditingId(entry.id);
    setDraft(entry.content);
    setNotice(null);
  }

  async function saveEdit(entry: MemoryEntry): Promise<void> {
    setBusy(`edit:${entry.id}`);
    setNotice(null);
    try {
      if (entry.kind === "personal") {
        await window.agentsOneAPI.saveOneRuntimeMemory(runtime.id, draft);
        setPersonal(draft);
      } else if (entry.workspaceId) {
        await window.agentsOneAPI.saveOneProjectMemory(
          runtime.id,
          entry.workspaceId,
          draft,
        );
        setProjectMemories((current) => ({
          ...current,
          [entry.workspaceId as string]: draft,
        }));
      }
      setEditingId(null);
      setNotice(t("agents.configMemorySaved"));
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function clearEntry(entry: MemoryEntry): Promise<void> {
    if (!window.confirm(t("agents.configMemoryClearConfirm"))) return;
    setBusy(`clear:${entry.id}`);
    setNotice(null);
    try {
      if (entry.kind === "personal") {
        await window.agentsOneAPI.saveOneRuntimeMemory(runtime.id, "");
        setPersonal("");
      } else if (entry.workspaceId) {
        await window.agentsOneAPI.saveOneProjectMemory(
          runtime.id,
          entry.workspaceId,
          "",
        );
        setProjectMemories((current) => ({
          ...current,
          [entry.workspaceId as string]: "",
        }));
      }
      setEditingId((current) => (current === entry.id ? null : current));
      setNotice(t("agents.configMemoryCleared"));
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="agent-one-config-panel agent-one-config-panel--simple">
      <header className="agent-one-config-panel-head">
        <div>
          <h3>{t("agents.configMemory")}</h3>
          <p>{t("agents.configMemoryDescription")}</p>
        </div>
      </header>
      <div className="agent-one-config-panel-body">
        <div className="agent-one-memory-card">
          <div>
            <strong>{t("agents.configMemoryEnabled")}</strong>
            <p>{t("agents.configMemoryEnabledHint")}</p>
          </div>
          <input
            className="agent-one-switch"
            type="checkbox"
            checked={enabled}
            aria-label={t("agents.configMemoryEnabled")}
            disabled={busy !== null}
            onChange={(event) => void setEnabled(event.target.checked)}
          />
        </div>

        <div className="agent-one-memory-toolbar">
          <label className="agent-one-memory-scope">
            <FileText size={14} aria-hidden="true" />
            <select
              value={scope}
              aria-label={t("agents.configMemoryScope")}
              onChange={(event) =>
                setScope(event.target.value as "all" | "personal" | "project")
              }
            >
              <option value="all">{t("agents.configMemoryAll")}</option>
              <option value="personal">
                {t("agents.configMemoryPersonalFilter")}
              </option>
              <option value="project">
                {t("agents.configMemoryProjectFilter")}
              </option>
            </select>
          </label>
          <span className="agent-one-memory-count">
            {t("agents.configMemoryCount", { count: entries.length })}
          </span>
          <label className="agent-one-memory-search">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              placeholder={t("agents.configMemorySearchPlaceholder")}
              aria-label={t("agents.configMemorySearchPlaceholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>

        <div className="agent-one-memory-list-head">
          <strong>{t("agents.configMemoryListTitle")}</strong>
          <button
            type="button"
            className="agent-one-model-icon"
            aria-label={t("agents.configMemoryRefresh")}
            onClick={() => setRefresh((current) => current + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {state === "loading" ? (
          <div className="agent-one-config-state">
            <Loader2 size={18} className="settings-spin" />
            {t("agents.configMemoryLoading")}
          </div>
        ) : state === "error" ? (
          <div className="agent-one-config-state" role="alert">
            {t("agents.configMemoryLoadError")}
          </div>
        ) : visibleEntries.length ? (
          <ul className="agent-one-memory-rows">
            {visibleEntries.map((entry) => (
              <li key={entry.id} className="agent-one-memory-item">
                <div className="agent-one-memory-row">
                  <span className="agent-one-memory-icon" aria-hidden="true">
                    MD
                  </span>
                  <div className="agent-one-memory-copy">
                    <div className="agent-one-memory-name">
                      {entry.name}
                      <span className="agent-one-memory-tag">{entry.tag}</span>
                    </div>
                    <span className="agent-one-memory-meta">
                      {sizeLabel(entry.content)}
                    </span>
                  </div>
                  <div className="agent-one-memory-actions">
                    <button
                      type="button"
                      className="agent-one-memory-edit"
                      onClick={() => startEdit(entry)}
                    >
                      {t("agents.configMemoryEdit")}
                    </button>
                    <button
                      type="button"
                      className="agent-one-model-icon"
                      aria-label={t("agents.configMemoryClear")}
                      disabled={busy !== null}
                      onClick={() => void clearEntry(entry)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {editingId === entry.id && (
                  <div className="agent-one-memory-editor">
                    <textarea
                      className="input agent-one-memory-textarea"
                      aria-label={t("agents.configMemoryEditTitle", {
                        name: entry.name,
                      })}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="agent-one-memory-editor-actions">
                      <span className="agent-one-memory-size">
                        {sizeLabel(draft)}
                      </span>
                      <span className="agent-one-config-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          disabled={busy !== null}
                          onClick={() => setEditingId(null)}
                        >
                          {t("common.cancel")}
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busy !== null}
                          onClick={() => void saveEdit(entry)}
                        >
                          {busy === `edit:${entry.id}` ? (
                            <Loader2 size={14} className="settings-spin" />
                          ) : (
                            <Save size={14} />
                          )}
                          {t("common.save")}
                        </button>
                      </span>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="agent-one-config-state">
            {t("agents.configMemoryEmpty")}
          </div>
        )}

        {notice && (
          <div className="agent-one-config-notice" role="status">
            {notice}
          </div>
        )}
      </div>
    </section>
  );
}
