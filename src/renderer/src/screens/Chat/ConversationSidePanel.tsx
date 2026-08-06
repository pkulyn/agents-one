import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  FileText,
  FolderKanban,
  FolderOpen,
  GitCompareArrows,
  PackageOpen,
  PanelRightClose,
  RefreshCw,
  Users,
} from "lucide-react";
import type {
  AgentRuntimeArtifact,
  AgentRuntimeRun,
} from "../../../../shared/agent-runtimes";
import type { TaskCollaborationRecord } from "../../../../shared/task-collaboration";
import type { ProjectControlProject } from "../../../../shared/project-control";
import type { TaskCenterTask } from "../../../../shared/task-center";
import { summarizeTaskOutput } from "../TaskCenter/taskOutput";

interface ConversationSidePanelProps {
  agentName: string;
  conversationId?: string | null;
  runtimeId?: string | null;
  prompt?: string;
  workspace?: string;
  runtimeRun?: AgentRuntimeRun | null;
  conversationArtifacts?: AgentRuntimeArtifact[];
  onClose: () => void;
}

const STATUS_LABEL: Record<TaskCenterTask["status"], string> = {
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "已超时",
  review_required: "待验收",
};

const RUN_STATUS_LABEL: Record<AgentRuntimeRun["status"], string> = {
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  timed_out: "已超时",
};

const ARTIFACT_KIND_LABEL: Record<AgentRuntimeArtifact["kind"], string> = {
  final: "答复",
  diff: "代码差异",
  worktree: "工作树",
};

const COLLABORATION_ROLE_LABEL: Record<
  NonNullable<TaskCollaborationRecord["assignments"]>[number]["role"],
  string
> = {
  coordinator: "协调者",
  implementer: "实施",
  tester: "测试",
  reviewer: "复核",
};

interface PanelArtifact extends AgentRuntimeArtifact {
  id: string;
}

function artifactPreview(artifact: AgentRuntimeArtifact): string {
  const content = artifact.content?.trim() || "";
  if (!content) return "";
  if (artifact.kind !== "final") return content.slice(0, 20_000);
  const summary = summarizeTaskOutput(content);
  return (summary.finalText || content).slice(0, 20_000);
}

function artifactIcon(kind: AgentRuntimeArtifact["kind"]): React.JSX.Element {
  if (kind === "worktree") return <FolderOpen size={14} />;
  if (kind === "diff") return <GitCompareArrows size={14} />;
  return <FileText size={14} />;
}

/**
 * The collapsed-by-default side panel is the common task surface for every
 * conversation. It combines the current run with durable Task Center links.
 */
export function ConversationSidePanel({
  agentName,
  conversationId,
  runtimeId,
  prompt,
  workspace,
  runtimeRun,
  conversationArtifacts = [],
  onClose,
}: ConversationSidePanelProps): React.JSX.Element {
  const [tasks, setTasks] = useState<TaskCenterTask[]>([]);
  const [availableTasks, setAvailableTasks] = useState<TaskCenterTask[]>([]);
  const [projects, setProjects] = useState<ProjectControlProject[]>([]);
  const [collaboration, setCollaboration] =
    useState<TaskCollaborationRecord | null>(null);
  const [runtimeNames, setRuntimeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [showAttachTask, setShowAttachTask] = useState(false);
  const [attachTaskId, setAttachTaskId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const runOutputSummary = runtimeRun?.output
    ? summarizeTaskOutput(runtimeRun.output)
    : null;
  const runSummary = runtimeRun
    ? runtimeRun.error ||
      runOutputSummary?.finalText ||
      (!runOutputSummary?.hasStructuredEvents
        ? runtimeRun.output?.trim()
        : runtimeRun.status === "running"
          ? "智能体正在执行，进展会持续更新。"
          : "本轮运行已结束，详细日志可在任务中心查看。")
    : "";
  const panelArtifacts = useMemo(() => {
    const result: PanelArtifact[] = [];
    const append = (artifact: AgentRuntimeArtifact, id: string): void => {
      result.push({ ...artifact, id });
    };
    const runtimeArtifacts = runtimeRun?.artifacts || [];
    conversationArtifacts.forEach((artifact, index) =>
      append(artifact, `conversation-artifact-${index}`),
    );
    runtimeArtifacts.forEach((artifact, index) =>
      append(artifact, `runtime-artifact-${index}`),
    );
    if (
      runtimeRun?.worktreePath &&
      !runtimeArtifacts.some((artifact) => artifact.kind === "worktree")
    ) {
      append(
        {
          kind: "worktree",
          label: "隔离工作树",
          path: runtimeRun.worktreePath,
        },
        "runtime-worktree",
      );
    }
    if (
      runtimeRun?.diffSummary &&
      !runtimeArtifacts.some((artifact) => artifact.kind === "diff")
    ) {
      append(
        {
          kind: "diff",
          label: "代码差异摘要",
          content: runtimeRun.diffSummary,
        },
        "runtime-diff",
      );
    }
    tasks.forEach((task) => {
      const taskArtifacts = task.artifacts || [];
      taskArtifacts.forEach((artifact, index) =>
        append(
          { ...artifact, label: `${task.title} · ${artifact.label}` },
          `${task.id}-artifact-${index}`,
        ),
      );
      if (
        task.worktreePath &&
        !taskArtifacts.some((artifact) => artifact.kind === "worktree")
      ) {
        append(
          {
            kind: "worktree",
            label: `${task.title} · 隔离工作树`,
            path: task.worktreePath,
          },
          `${task.id}-worktree`,
        );
      }
      if (
        task.diffSummary &&
        !taskArtifacts.some((artifact) => artifact.kind === "diff")
      ) {
        append(
          {
            kind: "diff",
            label: `${task.title} · 代码差异摘要`,
            content: task.diffSummary,
          },
          `${task.id}-diff`,
        );
      }
    });
    return result;
  }, [conversationArtifacts, runtimeRun, tasks]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!conversationId) {
      setTasks([]);
      setAvailableTasks([]);
      setProjects([]);
      setCollaboration(null);
      return;
    }
    setLoading(true);
    try {
      const [nextTasks, allProjects, allTasks, savedCollaboration, runtimes] = await Promise.all([
        window.hermesAPI.listConversationTasks(conversationId),
        window.hermesAPI.listProjectControlProjects(),
        window.hermesAPI.listTaskCenterTasks(),
        typeof window.hermesAPI.getTaskCollaboration === "function"
          ? window.hermesAPI.getTaskCollaboration(conversationId)
          : Promise.resolve(null),
        typeof window.hermesAPI.listAgentRuntimes === "function"
          ? window.hermesAPI.listAgentRuntimes()
          : Promise.resolve([]),
      ]);
      setTasks(nextTasks);
      setAvailableTasks(allTasks);
      setProjects(
        allProjects.filter((project) =>
          project.conversations?.some(
            (conversation) => conversation.id === conversationId,
          ),
        ),
      );
      setCollaboration(savedCollaboration);
      setRuntimeNames(
        Object.fromEntries(runtimes.map((runtime) => [runtime.id, runtime.name])),
      );
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法读取关联任务。");
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const refreshCollaboration = (): void => {
      void refresh();
    };
    window.addEventListener(
      "agents-one:task-collaboration-changed",
      refreshCollaboration,
    );
    return () =>
      window.removeEventListener(
        "agents-one:task-collaboration-changed",
        refreshCollaboration,
      );
  }, [refresh]);

  const canCreate = Boolean(conversationId && runtimeId && prompt?.trim());

  async function createFromConversation(): Promise<void> {
    if (!conversationId || !runtimeId || !prompt?.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const task = await window.hermesAPI.createTaskCenterTask({
        title: `${agentName} 对话任务`,
        prompt: prompt.trim(),
        runtimeId,
        mode: "analysis",
        workspace: workspace || undefined,
      });
      await window.hermesAPI.linkConversationTask(conversationId, task.id);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法从对话创建任务。");
    } finally {
      setCreating(false);
    }
  }

  async function attachToTask(): Promise<void> {
    if (!conversationId || !attachTaskId) return;
    setAttaching(true);
    setError(null);
    try {
      await window.hermesAPI.linkConversationTask(conversationId, attachTaskId);
      setShowAttachTask(false);
      setAttachTaskId("");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法关联到任务。");
    } finally {
      setAttaching(false);
    }
  }

  function openProject(projectId: string): void {
    window.dispatchEvent(
      new CustomEvent("navigation:goto", { detail: "projects" }),
    );
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("agents-one:open-project", { detail: projectId }),
      );
    }, 100);
  }

  return (
    <aside className="conversation-side-panel" aria-label="对话任务侧栏">
      <header className="conversation-side-panel-header">
        <div>
          <span>对话任务</span>
          <strong>{agentName}</strong>
        </div>
        <button
          className="icon-btn"
          type="button"
          title="隐藏对话任务"
          aria-label="隐藏对话任务"
          onClick={onClose}
        >
          <PanelRightClose size={16} />
        </button>
      </header>

      <section className="conversation-side-panel-section">
        <h3><FolderKanban size={15} /> 关联项目</h3>
        {projects.length ? (
          <ul className="conversation-side-project-list">
            {projects.map((project) => (
              <li key={project.id}>
                <button type="button" onClick={() => openProject(project.id)}>
                  <strong>{project.title}</strong>
                  <span>{project.objective}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{conversationId ? "这段对话尚未关联项目。" : "发送消息后，可在项目页关联这段对话。"}</p>
        )}
      </section>

      {collaboration ? (
        <section className="conversation-side-panel-section conversation-collaboration-summary">
          <h3><Users size={15} /> 协作分工</h3>
          {collaboration.assignments.some((assignment) => assignment.runtimeId) ? (
            <ul>
              {collaboration.assignments
                .filter((assignment) => assignment.runtimeId)
                .map((assignment) => (
                  <li key={assignment.role}>
                    <span>{COLLABORATION_ROLE_LABEL[assignment.role]}</span>
                    <strong>{runtimeNames[assignment.runtimeId!] || assignment.runtimeId}</strong>
                  </li>
                ))}
            </ul>
          ) : (
            <p>尚未指定执行智能体。</p>
          )}
          <p className="conversation-collaboration-note">分工已保存；任务仍由你确认后手动派发。</p>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("agents-one:open-task-collaboration", {
                  detail: collaboration.taskId,
                }),
              )
            }
          >
            打开协作看板
          </button>
        </section>
      ) : null}

      <section className="conversation-side-panel-section">
        <h3><ClipboardList size={15} /> 当前任务</h3>
        {runtimeRun ? (
          <div className="conversation-runtime-run">
            <span className={`conversation-side-task-status status-${runtimeRun.status}`}>
              本轮运行：{RUN_STATUS_LABEL[runtimeRun.status]}
            </span>
            {runSummary ? <p>{runSummary.slice(0, 480)}</p> : null}
            {runtimeRun.events?.length ? (
              <ol>
                {runtimeRun.events.slice(-4).map((event) => (
                  <li key={event.id}>{event.summary}</li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        {!conversationId ? (
          <p>先发送一条消息以建立可恢复的对话，再从这里创建或关联任务。</p>
        ) : loading ? (
          <p>正在读取关联任务…</p>
        ) : tasks.length ? (
          <ul className="conversation-side-task-list">
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("navigation:goto", { detail: "tasks" }),
                    )
                  }
                >
                  <strong>{task.title}</strong>
                  <span className={`conversation-side-task-status status-${task.status}`}>
                    {STATUS_LABEL[task.status]}
                  </span>
                </button>
                {task.acceptance ? (
                  <small>验收：{task.acceptance === "accepted" ? "已通过" : task.acceptance === "rejected" ? "已退回" : "待验收"}</small>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>这段对话尚未关联任务。创建任务后，这里会显示计划、进展和验收状态。</p>
        )}
        {error ? <p className="conversation-side-panel-error">{error}</p> : null}
        <div className="conversation-side-panel-actions">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            disabled={!canCreate || creating}
            title={
              canCreate
                ? "以最近一条用户请求创建分析任务"
                : "请先发送一条消息，并确认智能体接入配置可用"
            }
            onClick={() => void createFromConversation()}
          >
            {creating ? "正在创建…" : "从对话创建任务"}
          </button>
          <button
            className="icon-btn"
            type="button"
            title="刷新关联任务"
            aria-label="刷新关联任务"
            disabled={!conversationId || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {conversationId && (
          <>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setShowAttachTask((current) => !current)}
            >
              添加到任务
            </button>
            {showAttachTask && (
              <div className="conversation-attach-task">
                <select
                  aria-label="选择要关联的任务"
                  value={attachTaskId}
                  onChange={(event) => setAttachTaskId(event.target.value)}
                >
                  <option value="">选择任务</option>
                  {availableTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}（{STATUS_LABEL[task.status]}）
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  disabled={!attachTaskId || attaching}
                  onClick={() => void attachToTask()}
                >
                  {attaching ? "正在添加…" : "添加"}
                </button>
              </div>
            )}
          </>
        )}
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("navigation:goto", { detail: "tasks" }),
            )
          }
        >
          前往任务中心
        </button>
      </section>

      <section className="conversation-side-panel-section">
        <h3><PackageOpen size={15} /> 产物</h3>
        {panelArtifacts.length ? (
          <ul className="conversation-side-artifact-list">
            {panelArtifacts.map((artifact) => {
              const preview = artifactPreview(artifact);
              return (
                <li key={artifact.id}>
                  <details>
                    <summary>
                      {artifactIcon(artifact.kind)}
                      <strong>{artifact.label}</strong>
                      <small>{ARTIFACT_KIND_LABEL[artifact.kind]}</small>
                    </summary>
                    <div className="conversation-side-artifact-preview">
                      {preview ? <pre>{preview}</pre> : null}
                      {artifact.path ? <code>{artifact.path}</code> : null}
                      {!preview && !artifact.path ? <p>该产物没有可预览内容。</p> : null}
                    </div>
                  </details>
                  {artifact.kind === "worktree" && artifact.path ? (
                    <button
                      className="icon-btn"
                      type="button"
                      title="打开隔离工作树"
                      aria-label="打开隔离工作树"
                      onClick={() =>
                        void window.hermesAPI.openTaskCenterWorktree(artifact.path!)
                      }
                    >
                      <FolderOpen size={14} />
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p>任务完成后，报告、文件、链接、测试摘要和工作树引用会在这里集中展示。</p>
        )}
      </section>
    </aside>
  );
}
