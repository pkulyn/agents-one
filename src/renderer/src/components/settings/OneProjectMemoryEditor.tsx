import { useEffect, useState } from "react";
import type { ProjectWorkspaceCapability } from "../../../../shared/project-folders";
import { useI18n } from "../useI18n";

interface OneProjectMemoryEditorProps {
  runtimeId: string;
}

export default function OneProjectMemoryEditor({
  runtimeId,
}: OneProjectMemoryEditorProps): React.JSX.Element {
  const { t } = useI18n();
  const [projects, setProjects] = useState<ProjectWorkspaceCapability[]>([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectState, setProjectState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [memory, setMemory] = useState("");
  const [savedMemory, setSavedMemory] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const selectedProject = projects.find(
    (project) => project.id === workspaceId,
  );
  const memoryKey = workspaceId ? `${runtimeId}:${workspaceId}` : "";

  useEffect(() => {
    let active = true;
    setProjectState("loading");
    setProjects([]);
    setWorkspaceId("");
    void window.agentsOneAPI
      .listProjectWorkspaces()
      .then((items) => {
        if (!active) return;
        setProjects(items);
        setWorkspaceId(items[0]?.id || "");
        setProjectState("ready");
      })
      .catch(() => {
        if (active) setProjectState("error");
      });
    return () => {
      active = false;
    };
  }, [runtimeId, refresh]);

  useEffect(() => {
    let active = true;
    setLoadedFor(null);
    setMemory("");
    setSavedMemory("");
    setError(null);
    if (!workspaceId) return;
    void window.agentsOneAPI
      .getOneProjectMemory(runtimeId, workspaceId)
      .then((value) => {
        if (!active) return;
        setMemory(value);
        setSavedMemory(value);
        setLoadedFor(memoryKey);
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [memoryKey, runtimeId, workspaceId]);

  async function save(): Promise<void> {
    if (!workspaceId || loadedFor !== memoryKey) return;
    try {
      await window.agentsOneAPI.saveOneProjectMemory(
        runtimeId,
        workspaceId,
        memory,
      );
      setSavedMemory(memory);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function clear(): Promise<void> {
    if (!workspaceId || loadedFor !== memoryKey || !savedMemory) return;
    if (!window.confirm(t("settings.runtimeManager.oneProjectMemoryConfirm")))
      return;
    try {
      await window.agentsOneAPI.saveOneProjectMemory(
        runtimeId,
        workspaceId,
        "",
      );
      setMemory("");
      setSavedMemory("");
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="settings-field">
      <strong className="settings-field-label">
        {t("settings.runtimeManager.oneProjectMemoryHeading")}
      </strong>
      <span className="settings-field-hint">
        {t("settings.runtimeManager.oneProjectMemoryHint")}
      </span>
      {projectState === "loading" && (
        <span className="settings-field-hint">
          {t("settings.runtimeManager.oneProjectMemoryLoading")}
        </span>
      )}
      {projectState === "error" && (
        <span role="alert">
          {t("settings.runtimeManager.oneProjectMemoryLoadError")}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("common.retry")}
          </button>
        </span>
      )}
      {projectState === "ready" && projects.length === 0 && (
        <span className="settings-field-hint">
          {t("settings.runtimeManager.oneProjectMemoryNoProjects")}
        </span>
      )}
      {projectState === "ready" && projects.length > 0 && (
        <>
          <label className="settings-field">
            {t("settings.runtimeManager.oneProjectMemoryProject")}
            <select
              className="input"
              aria-label={t("settings.runtimeManager.oneProjectMemoryProject")}
              value={workspaceId}
              onChange={(event) => {
                if (
                  memory !== savedMemory &&
                  !window.confirm(
                    t("settings.runtimeManager.oneProjectMemoryDiscardConfirm"),
                  )
                )
                  return;
                setWorkspaceId(event.target.value);
              }}
            >
              {projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <textarea
            className="input"
            rows={4}
            aria-label={t("settings.runtimeManager.oneProjectMemory")}
            value={memory}
            maxLength={100000}
            disabled={!selectedProject || loadedFor !== memoryKey}
            onChange={(event) => setMemory(event.target.value)}
          />
          <div className="settings-card-actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadedFor !== memoryKey || memory === savedMemory}
              onClick={() => void save()}
            >
              {t("settings.runtimeManager.oneSaveProjectMemory")}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loadedFor !== memoryKey || !savedMemory}
              onClick={() => void clear()}
            >
              {t("settings.runtimeManager.oneClearProjectMemory")}
            </button>
          </div>
          {error && (
            <span role="alert">
              {error}
              {loadedFor !== memoryKey && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  {t("common.retry")}
                </button>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}
