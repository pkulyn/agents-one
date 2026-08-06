import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Columns3,
  Copy,
  FileText,
  FolderOpen,
  List,
  Play,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { Attachment } from "../../../../shared/attachments";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCenterTask,
  TaskCenterWorktree,
} from "../../../../shared/task-center";
import { AttachmentChip } from "../../components/AttachmentChip";
import { processFiles } from "../Chat/attachmentUtils";
import { summarizeTaskOutput } from "./taskOutput";

const STATUS_LABEL: Record<TaskCenterTask["status"], string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "已超时",
  review_required: "待验收",
};
const MODE_LABEL: Record<TaskCenterTask["mode"], string> = {
  analysis: "分析",
  implementation: "实现",
};
const ACCEPTANCE_LABEL: Record<NonNullable<TaskCenterTask["acceptance"]>, string> = {
  pending: "待验收",
  accepted: "已通过",
  rejected: "已退回",
};

function taskStatusLabel(task: TaskCenterTask): string {
  if (task.status === "review_required" && task.acceptance) {
    return ACCEPTANCE_LABEL[task.acceptance];
  }
  return STATUS_LABEL[task.status];
}

function formatDate(value?: number): string {
  return value ? new Date(value).toLocaleString() : "-";
}

function artifactKey(task: TaskCenterTask, index: number): string {
  return `${task.id}-artifact-${index}`;
}

interface TaskCenterProps {
  /** Kept for callers during the navigation migration; scheduled tasks now have their own page. */
  initialTab?: "tasks" | "scheduled";
  profile?: string;
  initialTaskId?: string | null;
  initialTaskNonce?: number;
  /** Incremented by the global "新建任务" command. */
  initialCreateNonce?: number;
}

export default function TaskCenter({
  initialTab: _initialTab = "tasks",
  profile: _profile,
  initialTaskId = null,
  initialTaskNonce = 0,
  initialCreateNonce = 0,
}: TaskCenterProps): React.JSX.Element {
  const [taskView, setTaskView] = useState<"list" | "board">("list");
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [tasks, setTasks] = useState<TaskCenterTask[]>([]);
  const [worktrees, setWorktrees] = useState<TaskCenterWorktree[]>([]);
  const [runtimeId, setRuntimeId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [workspaceRef, setWorkspaceRef] = useState("");
  const [mode, setMode] = useState<"analysis" | "implementation">("analysis");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const availableRuntimes = useMemo(
    () =>
      runtimes.filter(
        (runtime) =>
          runtime.enabled &&
          (runtime.kind === "hermes" ||
            runtime.kind === "codex" ||
            runtime.kind === "claude-code" ||
            runtime.kind === "pi" ||
            runtime.kind === "openclaw"),
      ),
    [runtimes],
  );

  useEffect(() => {
    if (!initialTaskId) return;
    setTaskView("list");
    setShowCreateTask(false);
    setSelectedTaskId(initialTaskId);
  }, [initialTaskId, initialTaskNonce]);

  useEffect(() => {
    if (!initialCreateNonce) return;
    setTaskView("list");
    setSelectedTaskId(null);
    setShowCreateTask(true);
  }, [initialCreateNonce]);

  const refresh = useCallback(async () => {
    try {
      const [nextRuntimes, nextTasks] = await Promise.all([
        window.hermesAPI.listAgentRuntimes(),
        window.hermesAPI.listTaskCenterTasks(),
      ]);
      setRuntimes(nextRuntimes);
      setTasks(nextTasks);
      setSelectedTaskId((current) =>
        current && nextTasks.some((task) => task.id === current)
          ? current
          : null,
      );
      setWorktrees(await window.hermesAPI.listTaskCenterWorktrees());
      setRuntimeId(
        (current) =>
          current ||
          nextRuntimes.find(
            (runtime) => runtime.enabled && runtime.kind === "hermes",
          )?.id ||
          nextRuntimes.find((runtime) => runtime.enabled)?.id ||
          "",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "无法加载任务中心。",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedRuntime = availableRuntimes.find(
    (runtime) => runtime.id === runtimeId,
  );
  const implementationAllowed =
    selectedRuntime?.kind === "codex" ||
    selectedRuntime?.kind === "claude-code" ||
    selectedRuntime?.kind === "pi";
  const remoteWorkspaceRef = selectedRuntime?.kind === "openclaw";
  const attachmentsAllowed =
    selectedRuntime?.kind === "codex" ||
    selectedRuntime?.kind === "claude-code" ||
    selectedRuntime?.kind === "pi" ||
    selectedRuntime?.kind === "openclaw";
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;

  function renderTaskOutput(task: TaskCenterTask): React.JSX.Element | null {
    if (!task.output) return null;
    const summary = summarizeTaskOutput(task.output);
    return (
      <>
        {summary.finalText && (
          <div className="task-final-output">
            <span>最终结果</span>
            <p>{summary.finalText}</p>
          </div>
        )}
        {(summary.transportNote || summary.usage) && (
          <div className="task-output-meta">
            {summary.transportNote}
            {summary.transportNote && summary.usage ? " · " : ""}
            {summary.usage}
          </div>
        )}
        <details className="task-output">
          <summary>
            {summary.hasStructuredEvents ? "运行日志" : "运行输出"}
          </summary>
          <pre>{task.output}</pre>
        </details>
      </>
    );
  }

  async function submit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
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
        workspace: remoteWorkspaceRef ? undefined : workspace.trim() || undefined,
        workspaceRef: workspaceRef.trim() || undefined,
        attachments,
      });
      setTitle("");
      setPrompt("");
      setAttachments([]);
      setWorkspaceRef("");
      setShowCreateTask(false);
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "无法创建任务。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(task: TaskCenterTask): Promise<void> {
    await window.hermesAPI.cancelTaskCenterTask(task.id);
    await refresh();
  }

  async function retry(task: TaskCenterTask): Promise<void> {
    try {
      setError(null);
      await window.hermesAPI.retryTaskCenterTask(task.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法重新执行任务。");
    }
  }

  async function accept(
    task: TaskCenterTask,
    acceptance: "accepted" | "rejected",
  ): Promise<void> {
    await window.hermesAPI.setTaskCenterAcceptance(task.id, acceptance);
    await refresh();
  }

  async function copyText(value: string): Promise<void> {
    await navigator.clipboard?.writeText(value);
  }

  async function removeWorktree(worktree: TaskCenterWorktree): Promise<void> {
    if (worktree.active) return;
    const confirmed = window.confirm(
      `删除这个隔离工作树？\n\n${worktree.path}`,
    );
    if (!confirmed) return;
    await window.hermesAPI.removeTaskCenterWorktree(worktree.path);
    await refresh();
  }

  async function selectWorkspace(): Promise<void> {
    const selected = await window.hermesAPI.selectFolder();
    if (selected) setWorkspace(selected);
  }

  async function addAttachments(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    if (!attachmentsAllowed) {
      setError("当前智能体尚未提供受控文件输入能力。");
      return;
    }
    const result = await processFiles(files, attachments.length, {
      sessionId: "task-center",
      remoteMode: false,
    });
    if (result.attachments.length) {
      setAttachments((current) => [...current, ...result.attachments]);
    }
    if (result.errors.length) {
      setError(`无法添加 ${result.errors[0].filename}。`);
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function renderArtifacts(task: TaskCenterTask): React.JSX.Element | null {
    if (!task.artifacts?.length && !task.worktreePath && !task.diffSummary)
      return null;
    const diffArtifacts =
      task.artifacts?.filter(
        (artifact) => artifact.kind === "diff" && artifact.content,
      ) || [];
    const finalArtifacts =
      task.artifacts?.filter(
        (artifact) => artifact.kind === "final" && artifact.content,
      ) || [];
    return (
      <section
        className="task-review-panel"
        aria-label={`${task.title} 验收产物`}
      >
        <div className="task-review-heading">
          <FileText size={15} />
          <span>验收产物</span>
          {task.acceptance && <small>{ACCEPTANCE_LABEL[task.acceptance]}</small>}
        </div>
        {task.worktreePath && (
          <div className="task-artifact-row">
            <div>
              <strong>隔离工作树</strong>
              <code>{task.worktreePath}</code>
            </div>
            <button
              className="icon-btn"
              type="button"
              title="打开隔离工作树"
              aria-label="打开隔离工作树"
              onClick={() =>
                void window.hermesAPI.openTaskCenterWorktree(task.worktreePath!)
              }
            >
              <FolderOpen size={16} />
            </button>
          </div>
        )}
        {task.diffSummary && (
          <pre className="task-result">{task.diffSummary}</pre>
        )}
        {diffArtifacts.map((artifact, index) => (
          <details
            className="task-artifact-diff"
            key={artifactKey(task, index)}
            open
          >
            <summary>
              <span>{artifact.label || "Git 差异"}</span>
              <button
                className="icon-btn"
                type="button"
                title="复制差异"
                aria-label="复制差异"
                onClick={(event) => {
                  event.preventDefault();
                  void copyText(artifact.content || "");
                }}
              >
                <Copy size={14} />
              </button>
            </summary>
            <pre>{artifact.content}</pre>
          </details>
        ))}
        {finalArtifacts.map((artifact, index) => (
          <details
            className="task-output"
            key={`${artifactKey(task, index)}-final`}
          >
            <summary>{artifact.label || "最终产物"}</summary>
            <pre>{artifact.content}</pre>
          </details>
        ))}
      </section>
    );
  }

  function renderInputs(task: TaskCenterTask): React.JSX.Element | null {
    if (!task.inputArtifacts?.length) return null;
    return (
      <section className="task-input-artifacts" aria-label={`${task.title} 输入文件`}>
        <div className="task-review-heading">
          <Paperclip size={15} />
          <span>输入文件</span>
        </div>
        {task.inputArtifacts.map((artifact) => (
          <div className="task-input-artifact" key={artifact.id}>
            <strong>{artifact.name}</strong>
            <small>{artifact.kind} · {Math.ceil(artifact.size / 1024)} KB</small>
          </div>
        ))}
      </section>
    );
  }

  function renderRunTimeline(task: TaskCenterTask): React.JSX.Element | null {
    const runs = task.runs || [];
    if (!runs.length) return null;
    return (
      <details className="task-run-timeline">
        <summary>执行记录（{runs.length}）</summary>
        <ol>
          {runs.slice().reverse().map((run, index) => (
            <li key={run.id}>
              <div>
                <strong>第 {runs.length - index} 次</strong>
                <span className={`task-status task-status--${run.status}`}>
                  {STATUS_LABEL[run.status]}
                </span>
              </div>
              <small>{formatDate(run.startedAt)}</small>
              {run.events?.length ? (
                <ul>
                  {run.events.slice(-8).map((event) => (
                    <li key={event.id}>
                      <span>{event.summary}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </details>
    );
  }

  function renderTaskDetail(task: TaskCenterTask): React.JSX.Element {
    return (
      <aside className="task-detail-panel" aria-label={`${task.title} 任务详情`}>
        <header className="task-detail-panel-header">
          <div>
            <h2>{task.title}</h2>
            <span className={`task-status task-status--${task.status}`}>
              {taskStatusLabel(task)}
            </span>
          </div>
          <button
            className="icon-btn"
            type="button"
            title="关闭任务详情"
            aria-label="关闭任务详情"
            onClick={() => setSelectedTaskId(null)}
          >
            <X size={16} />
          </button>
        </header>
        <p className="task-detail-prompt">{task.prompt}</p>
        <div className="task-row-meta">
          <span>{task.runtimeId}</span>
          <span>{MODE_LABEL[task.mode]}</span>
          <span>{formatDate(task.startedAt || task.createdAt)}</span>
        </div>
        {task.recovery && <p className="task-recovery">{task.recovery.message}</p>}
        {task.error && <pre className="task-result">{task.error}</pre>}
        {renderInputs(task)}
        {renderRunTimeline(task)}
        {renderArtifacts(task)}
        {renderTaskOutput(task)}
      </aside>
    );
  }

  function taskCard(task: TaskCenterTask): React.JSX.Element {
    return (
      <article className={`task-row ${task.id === selectedTaskId ? "is-selected" : ""}`} key={task.id}>
        <button
          className="task-row-main task-row-main--selectable"
          type="button"
          onClick={() => setSelectedTaskId(task.id)}
          title={`查看 ${task.title} 的任务详情`}
        >
          <div className="task-row-heading">
            <h2>{task.title}</h2>
            <span className={`task-status task-status--${task.status}`}>
              {taskStatusLabel(task)}
            </span>
          </div>
          <p>{task.prompt}</p>
          <div className="task-row-meta">
            <span>{task.runtimeId}</span>
            <span>{MODE_LABEL[task.mode]}</span>
            <span>{formatDate(task.startedAt || task.createdAt)}</span>
          </div>
          {task.recovery && (
            <p className="task-recovery">{task.recovery.message}</p>
          )}
        </button>
        <div className="task-row-actions">
          {task.status === "running" && (
            <button
              className="icon-btn"
              type="button"
              title="取消任务"
              aria-label="取消任务"
              onClick={() => void cancel(task)}
            >
              <Square size={15} />
            </button>
          )}
          {[
            "failed",
            "cancelled",
            "timed_out",
          ].includes(task.status) ||
          (task.status === "review_required" &&
            task.acceptance === "rejected") ? (
            <button
              className="icon-btn"
              type="button"
              title="重新执行任务"
              aria-label="重新执行任务"
              onClick={() => void retry(task)}
            >
              <RotateCcw size={15} />
            </button>
          ) : null}
          {task.status === "review_required" && task.acceptance !== "accepted" && task.acceptance !== "rejected" && (
            <button
              className="icon-btn"
              type="button"
              title="验收通过"
              aria-label="验收通过"
              onClick={() => void accept(task, "accepted")}
            >
              <Check size={16} />
            </button>
          )}
          {task.status === "review_required" && task.acceptance !== "accepted" && task.acceptance !== "rejected" && (
            <button
              className="icon-btn"
              type="button"
              title="退回修改"
              aria-label="退回修改"
              onClick={() => void accept(task, "rejected")}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </article>
    );
  }

  function renderTaskBoard(): React.JSX.Element {
    const columns: Array<{
      id: string;
      title: string;
      statuses: TaskCenterTask["status"][];
    }> = [
      { id: "queued", title: "待执行", statuses: ["queued"] },
      { id: "running", title: "执行中", statuses: ["running"] },
      { id: "review", title: "待验收", statuses: ["review_required"] },
      { id: "done", title: "已完成", statuses: ["succeeded"] },
      { id: "exception", title: "异常", statuses: ["failed", "cancelled", "timed_out"] },
    ];
    const belongsToColumn = (task: TaskCenterTask, column: (typeof columns)[number]): boolean => {
      if (task.status === "review_required" && task.acceptance === "accepted") {
        return column.id === "done";
      }
      if (task.status === "review_required" && task.acceptance === "rejected") {
        return column.id === "exception";
      }
      return column.statuses.includes(task.status);
    };
    return (
      <div className="task-board" aria-label="任务看板">
        {columns.map((column) => {
          const cards = tasks.filter((task) => belongsToColumn(task, column));
          return (
            <section className="task-board-column" key={column.id}>
              <header>
                <h2>{column.title}</h2>
                <span>{cards.length}</span>
              </header>
              <div className="task-board-cards">
                {cards.map((task) => (
                  <button
                    className={`task-board-card ${task.id === selectedTaskId ? "is-selected" : ""}`}
                    key={task.id}
                    type="button"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <div className="task-row-heading">
                      <h3>{task.title}</h3>
                      <span className={`task-status task-status--${task.status}`}>
                        {taskStatusLabel(task)}
                      </span>
                    </div>
                    <p>{task.prompt}</p>
                    <div className="task-row-meta">
                      <span>{task.runtimeId}</span>
                      <span>{MODE_LABEL[task.mode]}</span>
                    </div>
                  </button>
                ))}
                {cards.length === 0 ? <p>暂无任务</p> : null}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <section className="task-center" aria-label="任务">
      <header className="task-center-header">
        <div>
          <h1>任务</h1>
          <p>创建、执行、验收并沉淀智能体工作成果。</p>
        </div>
        <div className="task-center-header-actions">
          {!showCreateTask && tasks.length > 0 && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setShowCreateTask(true)}
            >
              <Play size={15} />新建任务
            </button>
          )}
          <button
            className="icon-btn"
            type="button"
            onClick={() => void refresh()}
            title="刷新任务"
            aria-label="刷新任务"
          >
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <>
          {(tasks.length === 0 || showCreateTask) && <form
            className="task-compose"
            onSubmit={(event) => void submit(event)}
          >
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void addAttachments(event.target.files)}
            />
            <div className="task-compose-grid">
              <label>
                <span>任务标题</span>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="可选，便于识别"
                  maxLength={120}
                />
              </label>
              <label>
                <span>执行智能体</span>
                <select
                  value={runtimeId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    const next = availableRuntimes.find(
                      (runtime) => runtime.id === nextId,
                    );
                    setRuntimeId(nextId);
                    if (
                      next?.kind !== "codex" &&
                      next?.kind !== "claude-code" &&
                      next?.kind !== "pi" &&
                      next?.kind !== "openclaw"
                    ) {
                      setAttachments([]);
                    }
                  }}
                >
                  {availableRuntimes.map((runtime) => (
                    <option key={runtime.id} value={runtime.id}>
                      {runtime.name} ({runtime.kind})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>执行方式</span>
                <select
                  value={mode}
                  onChange={(event) =>
                    setMode(event.target.value as "analysis" | "implementation")
                  }
                >
                  <option value="analysis">分析</option>
                  <option
                    value="implementation"
                    disabled={!implementationAllowed}
                  >
                    实现（隔离工作树）
                  </option>
                </select>
              </label>
              <label>
                <span>{remoteWorkspaceRef ? "远端项目引用" : "工作区"}</span>
                {remoteWorkspaceRef ? (
                  <input
                    value={workspaceRef}
                    onChange={(event) => setWorkspaceRef(event.target.value)}
                    placeholder="可选，例如 git:https://...#main"
                    maxLength={4096}
                  />
                ) : (
                  <span className="task-workspace-field">
                    <input
                      value={workspace}
                      onChange={(event) => setWorkspace(event.target.value)}
                      placeholder={
                        selectedRuntime?.config.workspace || "使用智能体默认工作区"
                      }
                    />
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={() => void selectWorkspace()}
                      title="选择项目目录"
                      aria-label="选择项目目录"
                    >
                      <FolderOpen size={15} />
                    </button>
                  </span>
                )}
              </label>
            </div>
            <label className="task-prompt">
              <span>任务说明</span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述要完成的工作与验收标准。"
                required
                maxLength={100000}
                rows={5}
              />
            </label>
            {attachments.length > 0 && (
              <div className="task-attachment-strip">
                {attachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    onRemove={() =>
                      setAttachments((current) =>
                        current.filter((item) => item.id !== attachment.id),
                      )
                    }
                  />
                ))}
              </div>
            )}
            <div className="task-compose-actions">
              {error && (
                <p className="task-error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="icon-btn"
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={!attachmentsAllowed}
                title={
                  attachmentsAllowed
                    ? "添加输入文件"
                    : "当前智能体暂不支持文件输入"
                }
                aria-label="添加输入文件"
              >
                <Paperclip size={16} />
              </button>
              <button
                className="primary-btn"
                type="submit"
                disabled={submitting || !runtimeId || !prompt.trim()}
              >
                <Play size={16} />
                {submitting ? "正在启动" : "派发任务"}
              </button>
              {tasks.length > 0 && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => setShowCreateTask(false)}
                >
                  取消
                </button>
              )}
            </div>
          </form>}

          <div className="task-view-switch" role="group" aria-label="任务视图">
            <button
              type="button"
              className={taskView === "list" ? "active" : ""}
              onClick={() => setTaskView("list")}
              title="列表视图"
              aria-label="列表视图"
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={taskView === "board" ? "active" : ""}
              onClick={() => setTaskView("board")}
              title="看板视图"
              aria-label="看板视图"
            >
              <Columns3 size={16} />
            </button>
          </div>

          <div className={`task-workbench ${selectedTask ? "task-workbench--detail-open" : ""}`}>
            <div className="task-workbench-list">
              {taskView === "board" ? renderTaskBoard() : (
                <div className="task-list">
                  {tasks.map((task) => taskCard(task))}
                  {tasks.length === 0 && (
                    <div className="task-empty">尚未派发任务。</div>
                  )}
                </div>
              )}
            </div>
            {selectedTask ? renderTaskDetail(selectedTask) : null}
          </div>
          <section className="task-worktrees" aria-label="隔离工作树">
            <div className="task-worktrees-heading">
              <h2>隔离工作树</h2>
              <button
                className="icon-btn"
                type="button"
                onClick={() => void refresh()}
                title="刷新工作树"
                aria-label="刷新工作树"
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {worktrees.map((worktree) => (
              <div className="task-worktree-row" key={worktree.path}>
                <div>
                  <strong>{worktree.runtimeKind}</strong>
                  <code>{worktree.path}</code>
                  <small>
                    {worktree.taskTitle || "未关联任务的工作树"}
                    {worktree.taskStatus
                      ? ` | ${STATUS_LABEL[worktree.taskStatus]}`
                      : ""}
                  </small>
                </div>
                <button
                  className="icon-btn"
                  type="button"
                  title="打开工作树"
                  aria-label={`打开工作树 ${worktree.path}`}
                  onClick={() =>
                    void window.hermesAPI.openTaskCenterWorktree(worktree.path)
                  }
                >
                  <FolderOpen size={15} />
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  title={
                    worktree.active
                      ? "工作树仍在使用中"
                      : "删除工作树"
                  }
                  aria-label={`删除工作树 ${worktree.path}`}
                  disabled={worktree.active}
                  onClick={() => void removeWorktree(worktree)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            {worktrees.length === 0 && (
              <div className="task-empty">暂无隔离工作树。</div>
            )}
          </section>
      </>
    </section>
  );
}
