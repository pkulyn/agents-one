import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, FileText, FolderOpen, Play, RefreshCw, Square, Trash2, X } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { TaskCenterTask, TaskCenterWorktree } from "../../../../shared/task-center";
import { summarizeTaskOutput } from "./taskOutput";

const STATUS_LABEL: Record<TaskCenterTask["status"], string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  timed_out: "Timed out",
  review_required: "Review required",
};

function formatDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function artifactKey(task: TaskCenterTask, index: number): string {
  return `${task.id}-artifact-${index}`;
}

export default function TaskCenter(): React.JSX.Element {
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [tasks, setTasks] = useState<TaskCenterTask[]>([]);
  const [worktrees, setWorktrees] = useState<TaskCenterWorktree[]>([]);
  const [runtimeId, setRuntimeId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [mode, setMode] = useState<"analysis" | "implementation">("analysis");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.enabled && (runtime.kind === "hermes" || runtime.kind === "codex" || runtime.kind === "claude-code" || runtime.kind === "openclaw")),
    [runtimes],
  );

  const refresh = useCallback(async () => {
    try {
      const [nextRuntimes, nextTasks] = await Promise.all([
        window.hermesAPI.listAgentRuntimes(),
        window.hermesAPI.listTaskCenterTasks(),
      ]);
      setRuntimes(nextRuntimes);
      setTasks(nextTasks);
      setWorktrees(await window.hermesAPI.listTaskCenterWorktrees());
      setRuntimeId((current) => current || nextRuntimes.find((runtime) => runtime.enabled && runtime.kind === "hermes")?.id || nextRuntimes.find((runtime) => runtime.enabled)?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Task Center.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedRuntime = availableRuntimes.find((runtime) => runtime.id === runtimeId);
  const implementationAllowed = selectedRuntime?.kind === "codex" || selectedRuntime?.kind === "claude-code";

  function renderTaskOutput(task: TaskCenterTask): React.JSX.Element | null {
    if (!task.output) return null;
    const summary = summarizeTaskOutput(task.output);
    return (
      <>
        {summary.finalText && <div className="task-final-output"><span>Final response</span><p>{summary.finalText}</p></div>}
        {(summary.transportNote || summary.usage) && <div className="task-output-meta">{summary.transportNote}{summary.transportNote && summary.usage ? " · " : ""}{summary.usage}</div>}
        <details className="task-output">
          <summary>{summary.hasStructuredEvents ? "Runtime log" : "Run output"}</summary>
          <pre>{task.output}</pre>
        </details>
      </>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!runtimeId || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await window.hermesAPI.createTaskCenterTask({
        title: title.trim() || undefined,
        prompt: prompt.trim(),
        runtimeId,
        mode,
        workspace: workspace.trim() || undefined,
      });
      setTitle("");
      setPrompt("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create task.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(task: TaskCenterTask): Promise<void> {
    await window.hermesAPI.cancelTaskCenterTask(task.id);
    await refresh();
  }

  async function accept(task: TaskCenterTask, acceptance: "accepted" | "rejected"): Promise<void> {
    await window.hermesAPI.setTaskCenterAcceptance(task.id, acceptance);
    await refresh();
  }

  async function copyText(value: string): Promise<void> {
    await navigator.clipboard?.writeText(value);
  }

  async function removeWorktree(worktree: TaskCenterWorktree): Promise<void> {
    if (worktree.active) return;
    const confirmed = window.confirm(`Remove this isolated worktree?\n\n${worktree.path}`);
    if (!confirmed) return;
    await window.hermesAPI.removeTaskCenterWorktree(worktree.path);
    await refresh();
  }

  function renderArtifacts(task: TaskCenterTask): React.JSX.Element | null {
    if (!task.artifacts?.length && !task.worktreePath && !task.diffSummary) return null;
    const diffArtifacts = task.artifacts?.filter((artifact) => artifact.kind === "diff" && artifact.content) || [];
    const finalArtifacts = task.artifacts?.filter((artifact) => artifact.kind === "final" && artifact.content) || [];
    return (
      <section className="task-review-panel" aria-label={`${task.title} review artifacts`}>
        <div className="task-review-heading">
          <FileText size={15} />
          <span>Review artifacts</span>
          {task.acceptance && <small>{task.acceptance}</small>}
        </div>
        {task.worktreePath && (
          <div className="task-artifact-row">
            <div>
              <strong>Isolated worktree</strong>
              <code>{task.worktreePath}</code>
            </div>
            <button className="icon-btn" type="button" title="Open isolated worktree" aria-label="Open isolated worktree" onClick={() => void window.hermesAPI.openTaskCenterWorktree(task.worktreePath!)}>
              <FolderOpen size={16} />
            </button>
          </div>
        )}
        {task.diffSummary && <pre className="task-result">{task.diffSummary}</pre>}
        {diffArtifacts.map((artifact, index) => (
          <details className="task-artifact-diff" key={artifactKey(task, index)} open>
            <summary>
              <span>{artifact.label || "Git diff"}</span>
              <button className="icon-btn" type="button" title="Copy diff" aria-label="Copy diff" onClick={(event) => { event.preventDefault(); void copyText(artifact.content || ""); }}>
                <Copy size={14} />
              </button>
            </summary>
            <pre>{artifact.content}</pre>
          </details>
        ))}
        {finalArtifacts.map((artifact, index) => (
          <details className="task-output" key={`${artifactKey(task, index)}-final`}>
            <summary>{artifact.label || "Final artifact"}</summary>
            <pre>{artifact.content}</pre>
          </details>
        ))}
      </section>
    );
  }

  return (
    <section className="task-center" aria-label="Task Center">
      <header className="task-center-header">
        <div>
          <h1>Task Center</h1>
          <p>Dispatch, supervise, and review isolated agent work.</p>
        </div>
        <button className="icon-btn" type="button" onClick={() => void refresh()} title="Refresh tasks" aria-label="Refresh tasks">
          <RefreshCw size={17} />
        </button>
      </header>

      <form className="task-compose" onSubmit={(event) => void submit(event)}>
        <div className="task-compose-grid">
          <label>
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional task title" maxLength={120} />
          </label>
          <label>
            <span>Runtime</span>
            <select value={runtimeId} onChange={(event) => setRuntimeId(event.target.value)}>
              {availableRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name} ({runtime.kind})</option>)}
            </select>
          </label>
          <label>
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as "analysis" | "implementation")}>
              <option value="analysis">Analysis</option>
              <option value="implementation" disabled={!implementationAllowed}>Implementation (isolated worktree)</option>
            </select>
          </label>
          <label>
            <span>Workspace</span>
            <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder={selectedRuntime?.config.workspace || "Runtime default"} />
          </label>
        </div>
        <label className="task-prompt">
          <span>Task</span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the work and its acceptance criteria." required maxLength={100000} rows={5} />
        </label>
        <div className="task-compose-actions">
          {error && <p className="task-error" role="alert">{error}</p>}
          <button className="primary-btn" type="submit" disabled={submitting || !runtimeId || !prompt.trim()}>
            <Play size={16} />
            {submitting ? "Starting" : "Run task"}
          </button>
        </div>
      </form>

      <div className="task-list">
        {tasks.map((task) => (
          <article className="task-row" key={task.id}>
            <div className="task-row-main">
              <div className="task-row-heading">
                <h2>{task.title}</h2>
                <span className={`task-status task-status--${task.status}`}>{STATUS_LABEL[task.status]}</span>
              </div>
              <p>{task.prompt}</p>
              <div className="task-row-meta">
                <span>{task.runtimeId}</span><span>{task.mode}</span><span>{formatDate(task.startedAt || task.createdAt)}</span>
              </div>
              {task.recovery && <p className="task-recovery">{task.recovery.message}</p>}
              {task.error && <pre className="task-result">{task.error}</pre>}
              {renderArtifacts(task)}
              {renderTaskOutput(task)}
            </div>
            <div className="task-row-actions">
              {task.status === "running" && <button className="icon-btn" type="button" title="Cancel task" aria-label="Cancel task" onClick={() => void cancel(task)}><Square size={15} /></button>}
              {task.status === "review_required" && <button className="icon-btn" type="button" title="Accept reviewed result" aria-label="Accept reviewed result" onClick={() => void accept(task, "accepted")}><Check size={16} /></button>}
              {task.status === "review_required" && <button className="icon-btn" type="button" title="Reject reviewed result" aria-label="Reject reviewed result" onClick={() => void accept(task, "rejected")}><X size={16} /></button>}
            </div>
          </article>
        ))}
        {tasks.length === 0 && <div className="task-empty">No tasks have been dispatched.</div>}
      </div>
      <section className="task-worktrees" aria-label="Managed worktrees">
        <div className="task-worktrees-heading">
          <h2>Managed worktrees</h2>
          <button className="icon-btn" type="button" onClick={() => void refresh()} title="Refresh worktrees" aria-label="Refresh worktrees"><RefreshCw size={15} /></button>
        </div>
        {worktrees.map((worktree) => (
          <div className="task-worktree-row" key={worktree.path}>
            <div>
              <strong>{worktree.runtimeKind}</strong>
              <code>{worktree.path}</code>
              <small>{worktree.taskTitle || "Unlinked worktree"}{worktree.taskStatus ? ` | ${worktree.taskStatus}` : ""}</small>
            </div>
            <button className="icon-btn" type="button" title="Open worktree" aria-label={`Open worktree ${worktree.path}`} onClick={() => void window.hermesAPI.openTaskCenterWorktree(worktree.path)}><FolderOpen size={15} /></button>
            <button className="icon-btn" type="button" title={worktree.active ? "Worktree is still active" : "Remove worktree"} aria-label={`Remove worktree ${worktree.path}`} disabled={worktree.active} onClick={() => void removeWorktree(worktree)}><Trash2 size={15} /></button>
          </div>
        ))}
        {worktrees.length === 0 && <div className="task-empty">No managed worktrees found.</div>}
      </section>
    </section>
  );
}
