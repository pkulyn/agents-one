import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, Check, FileText, FolderOpen, LayoutDashboard, Link2, ListChecks, PackageOpen, Pause, Play, Plus, RefreshCw, Send, Square, UserRound, X } from "lucide-react";
import type { AgentRuntimeDefinition, AgentRuntimeProbe } from "../../../../shared/agent-runtimes";
import type {
  ProjectArtifactReference,
  ProjectContextPackage,
  ProjectCollaboratorAssignment,
  ProjectControlProject,
  ProjectControlTask,
  ProjectPlanDraft,
  ProjectRole,
} from "../../../../shared/project-control";
import type { RuntimeConversationSummary } from "../../../../shared/runtime-conversations";

const ROLES: ProjectRole[] = ["manager", "implementer", "tester", "reviewer", "acceptor"];
const ROLE_LABELS: Record<ProjectRole, string> = {
  manager: "项目经理",
  implementer: "实施",
  tester: "测试",
  reviewer: "复核",
  acceptor: "验收",
};
const PROJECT_STATUS_LABELS: Record<string, string> = {
  active: "进行中",
  paused: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
  ready: "待分配",
  blocked: "已阻塞",
  queued: "排队中",
  running: "执行中",
  review_required: "待验收",
  accepted: "已验收",
  rejected: "已退回",
  failed: "失败",
  timed_out: "已超时",
};

const PROJECT_EVENT_LABELS: Record<string, string> = {
  project_created: "创建项目",
  project_status_changed: "项目状态",
  project_scope_changed: "项目资源",
  collaborators_changed: "协作分工",
  coordinator_changed: "协调者",
  task_created: "创建任务",
  task_assigned: "分配任务",
  task_status_changed: "任务状态",
  progress: "执行进展",
  tool_call: "调用工具",
  tool_result: "工具结果",
  message: "智能体消息",
  error: "执行异常",
  question: "待确认问题",
  handoff: "任务交接",
  review: "复核记录",
  acceptance: "验收记录",
  artifact_published: "发布产物",
  context_requested: "生成上下文",
};

function labelForStatus(status: string): string {
  return PROJECT_STATUS_LABELS[status] || status;
}

function labelForEvent(type: string): string {
  return PROJECT_EVENT_LABELS[type] || "项目事件";
}

function displayEventSummary(summary: string): string {
  let match: RegExpMatchArray | null;
  if ((match = summary.match(/^Project created with (human|runtime) coordinator\.$/))) {
    return `项目已创建，协调者为${match[1] === "human" ? "人工" : "智能体"}。`;
  }
  if ((match = summary.match(/^Task created as ([a-z_]+)\.$/))) {
    return `项目任务已创建，状态：${labelForStatus(match[1])}。`;
  }
  if ((match = summary.match(/^Assigned to (.+)\.$/))) {
    return `任务已分配给 ${match[1]}。`;
  }
  if ((match = summary.match(/^Assigned (manager|implementer|tester|reviewer|acceptor) Runtime\.$/))) {
    return `已分配${ROLE_LABELS[match[1] as ProjectRole]}智能体。`;
  }
  if (summary === "Runtime task started.") return "智能体任务已开始执行。";
  if ((match = summary.match(/^Task Center status: ([a-z_]+)\.$/))) {
    return `任务中心状态已更新：${labelForStatus(match[1])}。`;
  }
  if ((match = summary.match(/^Artifact published: (.+)\.$/))) return `已发布产物：${match[1]}。`;
  if ((match = summary.match(/^Dispatched through Task Center to (.+)\.$/))) return `任务已通过任务中心派发给 ${match[1]}。`;
  if ((match = summary.match(/^Constrained coordinator plan requested from (.+)\.$/))) return `已向协调智能体 ${match[1]} 请求受控规划。`;
  if ((match = summary.match(/^Task created from coordinator plan: (.+)\.$/))) return `已根据协调者计划创建任务：${match[1]}。`;
  if ((match = summary.match(/^Created (\d+) task\(s\) from coordinator plan\.$/))) return `已根据协调者计划创建 ${match[1]} 个任务。`;
  if ((match = summary.match(/^Context package v(\d+) created\.$/))) return `已生成上下文包 v${match[1]}。`;
  return summary;
}

function time(value: number): string {
  return new Date(value).toLocaleString();
}

function values(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

function projectCollaborators(project: ProjectControlProject | null): ProjectCollaboratorAssignment[] {
  return ROLES.map((role) => {
    const existing = project?.collaborators?.find((item) => item.role === role);
    if (existing) return existing;
    if (role === "manager" && project) {
      return {
        role,
        kind: project.coordinator.kind,
        ...(project.coordinator.runtimeId ? { runtimeId: project.coordinator.runtimeId } : {}),
        assignedAt: project.coordinator.assignedAt,
      };
    }
    return { role, kind: "human", assignedAt: Date.now() };
  });
}

interface ProjectCenterProps {
  visible?: boolean;
}

export default function ProjectCenter({ visible = true }: ProjectCenterProps): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectControlProject[]>([]);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [runtimeProbes, setRuntimeProbes] = useState<Record<string, AgentRuntimeProbe>>({});
  const [conversations, setConversations] = useState<RuntimeConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ProjectControlTask[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifactReference[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; type: string; summary: string; createdAt: number }>>([]);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [coordinatorKind, setCoordinatorKind] = useState<"human" | "runtime">("human");
  const [coordinatorRuntimeId, setCoordinatorRuntimeId] = useState("");
  const [newProjectWorkspace, setNewProjectWorkspace] = useState("");
  const [projectWorkspace, setProjectWorkspace] = useState("");
  const [linkedConversationIds, setLinkedConversationIds] = useState<string[]>([]);
  const [collaborators, setCollaborators] = useState<ProjectCollaboratorAssignment[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [role, setRole] = useState<ProjectRole>("implementer");
  const [mode, setMode] = useState<"analysis" | "implementation">("analysis");
  const [taskWorkspace, setTaskWorkspace] = useState("");
  const [reviewSummary, setReviewSummary] = useState("");
  const [context, setContext] = useState<ProjectContextPackage | null>(null);
  const [planDraft, setPlanDraft] = useState<ProjectPlanDraft | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [projectView, setProjectView] = useState<"overview" | "tasks" | "artifacts" | "activity">("overview");

  const selected = projects.find((project) => project.id === selectedId) || null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const enabledRuntimes = useMemo(() => runtimes.filter((runtime) => runtime.enabled), [runtimes]);
  const suggestedRuntimes = useMemo(
    () => selectedTask?.suggestedRuntimeKind
      ? enabledRuntimes.filter((runtime) => runtime.kind === selectedTask.suggestedRuntimeKind)
      : [],
    [enabledRuntimes, selectedTask?.suggestedRuntimeKind],
  );
  const alternateRuntimes = useMemo(
    () => selectedTask?.suggestedRuntimeKind
      ? enabledRuntimes.filter((runtime) => runtime.kind !== selectedTask.suggestedRuntimeKind)
      : enabledRuntimes,
    [enabledRuntimes, selectedTask?.suggestedRuntimeKind],
  );
  const coordinatorRuntime = selected?.coordinator.runtimeId
    ? runtimes.find((runtime) => runtime.id === selected.coordinator.runtimeId)
    : undefined;
  const coordinatorProbe = coordinatorRuntime ? runtimeProbes[coordinatorRuntime.id] : undefined;
  const suggestedCollaboratorRuntimeId = selectedTask
    ? selected?.collaborators?.find((item) => item.role === (selectedTask.suggestedRole || "implementer"))?.runtimeId
    : undefined;
  const constrainedPlanningAvailable = coordinatorRuntime?.location === "local" &&
    (coordinatorRuntime.kind === "codex" || coordinatorRuntime.kind === "claude-code") ||
    Boolean(
      coordinatorRuntime?.location === "remote" &&
      coordinatorProbe?.state === "healthy" &&
      coordinatorProbe.capabilities.orchestration &&
      coordinatorProbe.capabilities.readOnlyPlanning &&
      coordinatorProbe.capabilities.cancellation &&
      coordinatorProbe.capabilities.artifacts &&
      coordinatorProbe.capabilities.securityEvents,
    );

  const refresh = useCallback(async (projectId = selectedId): Promise<void> => {
    try {
      const [nextProjects, nextRuntimes, nextConversations] = await Promise.all([
        window.hermesAPI.listProjectControlProjects(),
        window.hermesAPI.listAgentRuntimes(),
        window.hermesAPI.listRuntimeConversations(undefined, 200, 0),
      ]);
      setProjects(nextProjects);
      setRuntimes(nextRuntimes);
      setConversations(nextConversations);
      const nextId = projectId && nextProjects.some((project) => project.id === projectId)
        ? projectId
        : nextProjects[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) {
        const [nextTasks, nextEvents, nextArtifacts] = await Promise.all([
          window.hermesAPI.listProjectControlTasks(nextId),
          window.hermesAPI.listProjectControlEvents(nextId),
          window.hermesAPI.listProjectControlArtifacts(nextId),
        ]);
        setTasks(nextTasks);
        setEvents(nextEvents);
        setArtifacts(nextArtifacts);
        setSelectedTaskId((current) => current && nextTasks.some((task) => task.id === current) ? current : nextTasks[0]?.id || null);
      } else {
        setTasks([]);
        setEvents([]);
        setArtifacts([]);
        setSelectedTaskId(null);
      }
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not load projects.");
    }
  }, [selectedId]);

  useEffect(() => {
    if (visible) void refresh();
  }, [visible, refresh]);

  useEffect(() => {
    const handleOpenProject = async (event: Event): Promise<void> => {
      const detail = (event as CustomEvent<unknown>).detail;
      const projectId = typeof detail === "string"
        ? detail
        : typeof detail === "object" && detail && "projectId" in detail && typeof detail.projectId === "string"
          ? detail.projectId
          : null;
      const taskId = typeof detail === "object" && detail && "taskId" in detail && typeof detail.taskId === "string"
        ? detail.taskId
        : null;
      if (projectId) {
        await refresh(projectId);
        if (taskId) {
          setProjectView("tasks");
          setSelectedTaskId(taskId);
        }
      }
    };
    const listener = (event: Event): void => {
      void handleOpenProject(event);
    };
    window.addEventListener("agents-one:open-project", listener);
    return () => {
      window.removeEventListener("agents-one:open-project", listener);
    };
  }, [refresh]);

  useEffect(() => {
    const handleCreateProject = (): void => {
      setShowCreateProject(true);
      setFlash(null);
    };
    window.addEventListener("agents-one:create-project", handleCreateProject);
    return () =>
      window.removeEventListener(
        "agents-one:create-project",
        handleCreateProject,
      );
  }, []);

  useEffect(() => {
    setProjectView("overview");
    setShowCreateTask(false);
  }, [selectedId]);

  useEffect(() => {
    if (!coordinatorRuntime || coordinatorRuntime.location !== "remote") return;
    let cancelled = false;
    void window.hermesAPI.probeAgentRuntime(coordinatorRuntime.id)
      .then((probe) => {
        if (!cancelled) {
          setRuntimeProbes((current) => ({ ...current, [coordinatorRuntime.id]: probe }));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [coordinatorRuntime?.id, coordinatorRuntime?.location]);

  useEffect(() => {
    setContext(null);
    setPlanDraft(null);
    setReviewSummary("");
    if (selectedTask?.assignment) {
      setAssigneeId(selectedTask.assignment.runtimeId);
      setRole(selectedTask.assignment.role);
      setMode(selectedTask.assignment.mode);
    } else if (selectedTask) {
      setAssigneeId(suggestedCollaboratorRuntimeId || suggestedRuntimes[0]?.id || enabledRuntimes[0]?.id || "");
      setRole(selectedTask.suggestedRole || "implementer");
      setMode(selectedTask.suggestedMode || "analysis");
    } else {
      setAssigneeId("");
      setRole("implementer");
      setMode("analysis");
    }
    setTaskWorkspace(selectedTask?.assignment?.workspace || selected?.workspace || "");
    setProjectWorkspace(selected?.workspace || "");
    setLinkedConversationIds(selected?.conversations?.map((conversation) => conversation.id) || []);
    setCollaborators(projectCollaborators(selected));
  }, [selectedTaskId, selectedId, selected?.workspace, selected?.conversations, selected?.collaborators, selected?.coordinator, suggestedCollaboratorRuntimeId, suggestedRuntimes, enabledRuntimes]);

  async function createProject(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const project = await window.hermesAPI.createProjectControlProject({
        title,
        objective,
        coordinator: coordinatorKind === "runtime"
          ? { kind: "runtime", runtimeId: coordinatorRuntimeId }
          : { kind: "human" },
        workspace: newProjectWorkspace.trim() || undefined,
      });
      setTitle("");
      setObjective("");
      setNewProjectWorkspace("");
      setShowCreateProject(false);
      setFlash("项目已创建。 ");
      await refresh(project.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法创建项目。 ");
    }
  }

  async function createTask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selected) return;
    try {
      const task = await window.hermesAPI.createProjectControlTask({
        projectId: selected.id,
        title: taskTitle,
        requirement,
        acceptanceCriteria: acceptance,
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(dependencies.length ? { dependencies } : {}),
      });
      setTaskTitle("");
      setRequirement("");
      setAcceptance("");
      setParentTaskId("");
      setDependencies([]);
      setShowCreateTask(false);
      setSelectedTaskId(task.id);
      setFlash("项目任务已创建。 ");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法创建项目任务。 ");
    }
  }

  async function assignTask(): Promise<void> {
    if (!selectedTask || !assigneeId) return;
    try {
      await window.hermesAPI.assignProjectControlTask({
        taskId: selectedTask.id,
        runtimeId: assigneeId,
        role,
        mode,
        workspace: taskWorkspace.trim() || undefined,
      });
      setFlash("任务已交给所选智能体。 ");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法分配项目任务。 ");
    }
  }

  async function chooseFolder(target: "new-project" | "project" | "task"): Promise<void> {
    const folder = await window.hermesAPI.selectFolder();
    if (!folder) return;
    if (target === "new-project") setNewProjectWorkspace(folder);
    else if (target === "project") setProjectWorkspace(folder);
    else setTaskWorkspace(folder);
  }

  async function saveProjectScope(): Promise<void> {
    if (!selected) return;
    try {
      await window.hermesAPI.updateProjectControlScope({
        projectId: selected.id,
        workspace: projectWorkspace.trim() || undefined,
        conversationIds: linkedConversationIds,
      });
      setFlash("项目目录与关联对话已保存。 ");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法保存项目资源。 ");
    }
  }

  function selectCollaborator(role: ProjectRole, runtimeId: string): void {
    setCollaborators((current) => current.map((collaborator) => collaborator.role === role
      ? {
        ...collaborator,
        kind: runtimeId ? "runtime" : "human",
        ...(runtimeId ? { runtimeId } : { runtimeId: undefined }),
      }
      : collaborator));
  }

  async function saveCollaborators(): Promise<void> {
    if (!selected) return;
    try {
      await window.hermesAPI.updateProjectControlCollaborators({
        projectId: selected.id,
        collaborators: collaborators.map((collaborator) => ({
          role: collaborator.role,
          kind: collaborator.kind,
          ...(collaborator.runtimeId ? { runtimeId: collaborator.runtimeId } : {}),
        })),
      });
      setFlash("项目协作组已保存；后续任务仍需手动分配和派发。");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法保存项目协作组。 ");
    }
  }

  function openConversation(conversationId: string): void {
    window.dispatchEvent(new CustomEvent("agents-one:open-runtime-conversation", {
      detail: conversationId,
    }));
  }

  async function createContext(): Promise<void> {
    if (!selectedTask) return;
    try {
      const nextContext = await window.hermesAPI.createProjectControlContext(selectedTask.id);
      setContext(nextContext);
      setFlash(`上下文包 v${nextContext.version} 已创建。`);
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法创建上下文包。 ");
    }
  }

  async function dispatchTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.dispatchProjectControlTask(selectedTask.id);
      setFlash("任务已派发到任务中心。 ");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法派发项目任务。 ");
    }
  }

  function openTaskCenter(): void {
    if (!selectedTask?.directTaskCenterTaskId) return;
    window.dispatchEvent(new CustomEvent("navigation:goto", {
      detail: {
        view: "tasks",
        taskId: selectedTask.directTaskCenterTaskId,
      },
    }));
  }

  async function planWithCoordinator(): Promise<void> {
    if (!selected) return;
    try {
      const task = await window.hermesAPI.startProjectCoordinatorPlan(selected.id);
      setSelectedTaskId(task.id);
      setFlash("协调者规划任务已派发，等待验收。 ");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法启动协调者规划。 ");
    }
  }

  async function changeProjectStatus(status: "active" | "paused" | "completed" | "cancelled"): Promise<void> {
    if (!selected) return;
    const label = status === "active" ? "已恢复" : labelForStatus(status);
    try {
      await window.hermesAPI.setProjectControlStatus(selected.id, status, `用户将项目设为：${label}。`);
      setFlash(`项目${label}。`);
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法更新项目状态。 ");
    }
  }

  async function reviewTask(decision: "accepted" | "rejected"): Promise<void> {
    if (!selectedTask || !reviewSummary.trim()) return;
    try {
      await window.hermesAPI.reviewProjectControlTask(selectedTask.id, decision, reviewSummary);
      setReviewSummary("");
      setFlash(decision === "accepted" ? "任务已验收通过。" : "任务已退回修改。 ");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法验收项目任务。 ");
    }
  }

  async function cancelTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.cancelProjectControlTask(selectedTask.id);
      setFlash("任务已取消。 ");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法取消项目任务。 ");
    }
  }

  async function retryTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.setProjectControlTaskStatus(selectedTask.id, "ready", "已退回待分配状态。 ");
      setFlash("任务已退回待分配状态。 ");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法重试项目任务。 ");
    }
  }

  async function previewPlanTasks(): Promise<void> {
    if (!selected || !selectedTask) return;
    setPlanBusy(true);
    try {
      const draft = await window.hermesAPI.previewProjectPlanTasks(selected.id, selectedTask.id);
      setPlanDraft(draft);
      setFlash(draft.tasks.length ? `已生成 ${draft.tasks.length} 条任务草案。` : "未生成任务草案。 ");
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法预览协调者计划。 ");
    } finally {
      setPlanBusy(false);
    }
  }

  async function createPlanTasks(): Promise<void> {
    if (!selected || !selectedTask || !planDraft?.tasks.length) return;
    setPlanBusy(true);
    try {
      const created = await window.hermesAPI.createProjectTasksFromPlan({
        projectId: selected.id,
        sourceTaskId: selectedTask.id,
        tasks: planDraft.tasks,
      });
      setPlanDraft(null);
      setSelectedTaskId(created[0]?.id || selectedTask.id);
      setFlash(`已从协调者计划创建 ${created.length} 个项目任务。`);
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "无法从计划创建项目任务。 ");
    } finally {
      setPlanBusy(false);
    }
  }

  return (
    <section className="task-center" aria-label="项目">
      <header className="task-center-header">
        <div><h1>项目</h1><p>规划、分派并验收多智能体协作成果。</p></div>
        <button className="icon-btn" type="button" onClick={() => void refresh()} title="刷新项目" aria-label="刷新项目"><RefreshCw size={17} /></button>
      </header>
      {flash && <p className="task-error" role="status">{flash}</p>}
      {(projects.length === 0 || showCreateProject) && (
        <section className="task-compose project-create-form">
          <div className="project-create-form-heading">
            <div>
              <h2>{projects.length === 0 ? "创建第一个项目" : "新建项目"}</h2>
              <p>{projects.length === 0 ? "项目用于集中目标、协作分工、任务、产物与验收。" : "可创建空项目，或将已有项目文件夹纳入管理。"}</p>
            </div>
            {projects.length > 0 && <button className="icon-btn" type="button" onClick={() => setShowCreateProject(false)} title="取消新建项目" aria-label="取消新建项目"><X size={16} /></button>}
          </div>
          <form onSubmit={(event) => void createProject(event)}>
            <div className="project-create-location-actions" aria-label="项目目录方式">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setNewProjectWorkspace("")}>
                <Plus size={15} />新建空项目
              </button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void chooseFolder("new-project")}>
                <FolderOpen size={15} />使用现有文件夹
              </button>
              <small>选择文件夹窗口中可直接新建一个文件夹。</small>
            </div>
            <div className="task-compose-grid">
              <label><span>项目名称</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
              <label><span>协调者</span><select value={coordinatorKind} onChange={(event) => setCoordinatorKind(event.target.value as "human" | "runtime")}><option value="human">人工</option><option value="runtime">智能体</option></select></label>
              {coordinatorKind === "runtime" && <label><span>协调智能体</span><select value={coordinatorRuntimeId} onChange={(event) => setCoordinatorRuntimeId(event.target.value)} required><option value="">选择智能体</option>{enabledRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label>}
              <label><span>项目文件夹</span><span className="task-workspace-field"><input value={newProjectWorkspace} onChange={(event) => setNewProjectWorkspace(event.target.value)} placeholder="可选；使用已有文件夹时选择" /><button className="icon-btn" type="button" onClick={() => void chooseFolder("new-project")} title="选择项目文件夹" aria-label="选择项目文件夹"><FolderOpen size={15} /></button></span></label>
            </div>
            <label className="task-prompt"><span>项目目标</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} required maxLength={20000} rows={3} /></label>
            <div className="task-compose-actions"><button className="primary-btn" type="submit" disabled={!title.trim() || !objective.trim() || (coordinatorKind === "runtime" && !coordinatorRuntimeId)}><Plus size={16} />创建项目</button></div>
          </form>
        </section>
      )}
      {projects.length > 0 && selected && (
        <section className="project-switcher" aria-label="项目切换">
          <label>
            <span>当前项目</span>
            <select
              aria-label="当前项目"
              value={selected.id}
              onChange={(event) => void refresh(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
          {!showCreateProject && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setShowCreateProject(true)}
            >
              <Plus size={15} />新建项目
            </button>
          )}
        </section>
      )}
      {projects.length > 0 && !selected && (
        <section className="project-list project-list--overview" aria-label="项目列表">
          <div className="project-list-heading">
            <h2>全部项目</h2>
            {!showCreateProject && <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowCreateProject(true)}><Plus size={15} />新建项目</button>}
          </div>
          <div className="project-list-grid">
            {projects.map((project) => <button key={project.id} type="button" className={`project-row ${project.id === selectedId ? "is-active" : ""}`} onClick={() => void refresh(project.id)}><span>{project.title}</span><small>{project.coordinator.kind === "human" ? <UserRound size={13} /> : <Bot size={13} />}{project.coordinator.runtimeId || "人工"}</small></button>)}
          </div>
        </section>
      )}
      {selected && (
        <section className="project-workspace-header">
          <div className="project-titlebar">
            <div><h2>{selected.title}</h2><p>{selected.objective}</p></div>
            <span>{labelForStatus(selected.status)}</span>
          </div>
          <div className="project-status-actions">
            {selected.status === "active" && <><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("paused")}><Pause size={15} />暂停</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("completed")}><Check size={15} />完成</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("cancelled")}><Square size={15} />取消</button></>}
            {selected.status === "paused" && <><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("active")}><Play size={15} />继续</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("cancelled")}><Square size={15} />取消</button></>}
          </div>
          <div className="project-view-tabs" role="tablist" aria-label="项目视图">
            <button type="button" role="tab" aria-selected={projectView === "overview"} className={projectView === "overview" ? "active" : ""} onClick={() => setProjectView("overview")}><LayoutDashboard size={15} />概览</button>
            <button type="button" role="tab" aria-selected={projectView === "tasks"} className={projectView === "tasks" ? "active" : ""} onClick={() => setProjectView("tasks")}><ListChecks size={15} />任务 <span>{tasks.length}</span></button>
            <button type="button" role="tab" aria-selected={projectView === "artifacts"} className={projectView === "artifacts" ? "active" : ""} onClick={() => setProjectView("artifacts")}><PackageOpen size={15} />产物 <span>{artifacts.length}</span></button>
            <button type="button" role="tab" aria-selected={projectView === "activity"} className={projectView === "activity" ? "active" : ""} onClick={() => setProjectView("activity")}><Activity size={15} />活动 <span>{events.length}</span></button>
          </div>
        </section>
      )}

      {selected && projectView === "overview" && (
        <section className="task-compose project-overview-panel">
          <div className="project-overview-metrics" aria-label="项目摘要">
            <div><strong>{tasks.length}</strong><span>任务</span></div>
            <div><strong>{tasks.filter((task) => task.status === "review_required").length}</strong><span>待验收</span></div>
            <div><strong>{artifacts.length}</strong><span>产物</span></div>
            <div><strong>{selected.coordinator.runtimeId || "人工"}</strong><span>项目经理</span></div>
          </div>
          <div className="project-scope" aria-label="项目资源">
            <div className="project-scope-heading"><h3>项目资源</h3><small>仅保存目录和对话引用；派发时再按任务授权。</small></div>
            <div className="task-compose-grid">
              <label><span>项目目录</span><span className="task-workspace-field"><input value={projectWorkspace} onChange={(event) => setProjectWorkspace(event.target.value)} placeholder="未选择项目目录" /><button className="icon-btn" type="button" onClick={() => void chooseFolder("project")} title="选择项目目录" aria-label="选择项目目录"><FolderOpen size={15} /></button></span></label>
              <label><span>关联对话</span><select multiple value={linkedConversationIds} onChange={(event) => setLinkedConversationIds(values(event))}>{conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.runtimeName} | {conversation.title}</option>)}</select></label>
            </div>
            <div className="task-compose-actions"><button className="btn btn-secondary" type="button" onClick={() => void saveProjectScope()}><Link2 size={15} />保存项目资源</button></div>
            {selected.conversations?.length ? <div className="project-linked-conversations">{selected.conversations.map((conversation) => <button key={conversation.id} className="btn btn-secondary" type="button" onClick={() => openConversation(conversation.id)} title={`打开 ${conversation.runtimeName} 对话`}>{conversation.runtimeName} | {conversation.title}</button>)}</div> : <small>尚未关联对话。</small>}
          </div>
          <div className="project-collaborators" aria-label="项目协作组">
            <div className="project-scope-heading"><h3>项目协作组</h3><small>指定角色默认协作者；不会自动派发或自动合并。</small></div>
            <div className="project-collaborator-grid">
              {collaborators.map((collaborator) => <label key={collaborator.role}><span>{ROLE_LABELS[collaborator.role]}</span><select aria-label={`${ROLE_LABELS[collaborator.role]}协作者`} value={collaborator.runtimeId || ""} onChange={(event) => selectCollaborator(collaborator.role, event.target.value)}><option value="">人工</option>{enabledRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label>)}
            </div>
            <div className="task-compose-actions"><button className="btn btn-secondary" type="button" onClick={() => void saveCollaborators()}><UserRound size={15} />保存协作组</button></div>
          </div>
        </section>
      )}

      {selected && projectView === "tasks" && <div className="project-center-grid project-center-grid--details">
        <section className="task-compose project-task-create">
          <div className="project-task-create-heading">
            <div>
              <h2>项目任务</h2>
              <p>{tasks.length > 0 ? `共 ${tasks.length} 个任务，选择任务后可在右侧分配和验收。` : "添加第一个任务，明确需求和验收标准。"}</p>
            </div>
            {tasks.length > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => setShowCreateTask((current) => !current)}
              >
                {showCreateTask ? <X size={15} /> : <Plus size={15} />}
                {showCreateTask ? "收起" : "添加任务"}
              </button>
            )}
          </div>
          {selected.coordinator.kind === "runtime" && selected.status === "active" && <div className="project-coordinator"><Bot size={15} /><span>{selected.coordinator.runtimeId}</span>{constrainedPlanningAvailable ? <button className="btn btn-secondary" type="button" onClick={() => void planWithCoordinator()}><Play size={15} />生成计划</button> : <small>当前协调者不支持受控规划</small>}</div>}
          {(showCreateTask || tasks.length === 0) && <form onSubmit={(event) => void createTask(event)}>
            <label><span>任务标题</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required maxLength={160} /></label>
            <label className="task-prompt"><span>需求</span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} required rows={3} /></label>
            <label className="task-prompt"><span>验收标准</span><textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} required rows={2} /></label>
            <div className="task-compose-grid project-dependency-grid">
              <label><span>父任务</span><select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}><option value="">无</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
              <label><span>前置任务</span><select multiple value={dependencies} onChange={(event) => setDependencies(values(event))}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}（{labelForStatus(task.status)}）</option>)}</select></label>
            </div>
            <div className="task-compose-actions"><button className="primary-btn" type="submit" disabled={selected.status !== "active"}><Plus size={16} />添加任务</button></div>
          </form>}
        </section>
        <section className="task-list project-list" aria-label="项目任务">
          {tasks.map((task) => <button key={task.id} type="button" className={`project-row ${task.id === selectedTaskId ? "is-active" : ""}`} onClick={() => setSelectedTaskId(task.id)}><span>{task.title}</span><small>{labelForStatus(task.status)}{task.assignment ? ` | ${task.assignment.runtimeId}` : task.suggestedRuntimeKind ? ` | 建议 ${task.suggestedRuntimeKind}` : ""}</small></button>)}
          {tasks.length === 0 && <div className="task-empty">暂无项目任务。</div>}
        </section>
        <section className="task-compose">
          <h2>任务调度</h2>
          {selectedTask ? <>
            <p>{selectedTask.requirement}</p>
            <div className="task-compose-grid"><label><span>执行智能体</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">选择智能体</option>{selectedTask.suggestedRuntimeKind ? <><optgroup label={`建议：${selectedTask.suggestedRuntimeKind}`}>{suggestedRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</optgroup>{alternateRuntimes.length > 0 && <optgroup label="其他智能体">{alternateRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</optgroup>}</> : enabledRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label><label><span>角色</span><select value={role} onChange={(event) => setRole(event.target.value as ProjectRole)}>{ROLES.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}</select></label><label><span>执行方式</span><select value={mode} onChange={(event) => setMode(event.target.value as "analysis" | "implementation")}><option value="analysis">分析</option><option value="implementation">实现</option></select></label><label><span>工作目录</span><span className="task-workspace-field"><input value={taskWorkspace} onChange={(event) => setTaskWorkspace(event.target.value)} placeholder={selected?.workspace || "使用智能体默认工作区"} /><button className="icon-btn" type="button" onClick={() => void chooseFolder("task")} title="选择任务工作目录" aria-label="选择任务工作目录"><FolderOpen size={15} /></button></span></label></div>
            <div className="task-compose-actions project-actions">
              <button className="primary-btn" type="button" disabled={!assigneeId || (selectedTask.status !== "ready" && selectedTask.status !== "blocked")} onClick={() => void assignTask()}><Send size={16} />分配</button>
              {selectedTask.status === "queued" && <button className="primary-btn" type="button" onClick={() => void dispatchTask()}><Send size={16} />派发</button>}
              {(["queued", "running", "review_required"] as string[]).includes(selectedTask.status) && <button className="btn btn-secondary" type="button" onClick={() => void cancelTask()}><Square size={15} />取消</button>}
              {(["rejected", "failed", "timed_out"] as string[]).includes(selectedTask.status) && <button className="btn btn-secondary" type="button" onClick={() => void retryTask()}><RefreshCw size={15} />重试</button>}
              <button className="btn btn-secondary" type="button" onClick={() => void createContext()}><FileText size={15} />{selectedTask.contextPackageId ? "更新上下文" : "生成上下文"}</button>
              {selectedTask.directTaskCenterTaskId && <button className="btn btn-secondary" type="button" onClick={openTaskCenter}><ListChecks size={15} />在任务中心查看</button>}
              {selectedTask.assignment?.role === "manager" && selectedTask.directTaskCenterTaskId && (["review_required", "accepted"] as string[]).includes(selectedTask.status) && <button className="btn btn-secondary" type="button" disabled={planBusy} onClick={() => void previewPlanTasks()}><FileText size={15} />预览子任务</button>}
            </div>
            {(selectedTask.suggestedRuntimeKind || selectedTask.suggestedRole || selectedTask.suggestedMode || selectedTask.contextPackageId) && <p className="project-task-suggestion">{selectedTask.suggestedRuntimeKind || selectedTask.suggestedRole || selectedTask.suggestedMode ? <>建议：{selectedTask.suggestedRuntimeKind || "任意智能体"} / {selectedTask.suggestedRole ? ROLE_LABELS[selectedTask.suggestedRole] : "复核"} / {selectedTask.suggestedMode === "implementation" ? "实现" : "分析"}{selectedTask.suggestedRuntimeKind && suggestedRuntimes.length === 0 ? " | 没有匹配的已启用智能体" : ""}</> : null}{selectedTask.contextPackageId ? <>{selectedTask.suggestedRuntimeKind || selectedTask.suggestedRole || selectedTask.suggestedMode ? " | " : ""}上下文包已就绪</> : null}</p>}
            {selectedTask.status === "review_required" && <div className="project-review"><label><span>验收记录</span><input value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} maxLength={2000} placeholder="填写验收决定和原因" /></label><div><button className="primary-btn" type="button" disabled={!reviewSummary.trim()} onClick={() => void reviewTask("accepted")}><Check size={15} />通过</button><button className="btn btn-secondary" type="button" disabled={!reviewSummary.trim()} onClick={() => void reviewTask("rejected")}><X size={15} />退回</button></div></div>}
            {planDraft && <div className="project-plan-preview" aria-label="协调者计划任务预览">
              <div className="project-plan-preview-head"><strong>任务草案</strong><span>{planDraft.tasks.length}</span></div>
              {planDraft.warnings.map((warning) => <p className="task-error" key={warning}>{warning}</p>)}
              {planDraft.tasks.map((draft, index) => <article key={`${draft.title}-${index}`} className="project-plan-draft"><strong>{draft.title}</strong><small>{draft.suggestedRuntimeKind || "任意智能体"} | {ROLE_LABELS[draft.role]} | {draft.mode === "implementation" ? "实现" : "分析"}</small><p>{draft.requirement}</p><em>{draft.acceptanceCriteria}</em></article>)}
              <div className="task-compose-actions"><button className="primary-btn" type="button" disabled={planBusy || planDraft.tasks.length === 0} onClick={() => void createPlanTasks()}><Plus size={15} />创建任务</button><button className="btn btn-secondary" type="button" disabled={planBusy} onClick={() => setPlanDraft(null)}><X size={15} />关闭</button></div>
            </div>}
          </> : <div className="task-empty">请选择一个项目任务。</div>}
        </section>
      </div>}

      {selected && projectView === "artifacts" && <div className="project-artifact-view">
        {context && <section className="project-context"><h2>上下文包 v{context.version}</h2><p>{context.projectSummary}</p><p>{context.requirement}</p><div>{context.artifacts.map((artifact) => <span key={artifact.id}>{artifact.label}</span>)}{context.artifacts.length === 0 && <span>没有可共享的上游产物。</span>}</div>{context.upstreamSummaries.map((summary, index) => <p key={`${summary.taskId}-${index}`}>{summary.summary}</p>)}</section>}
        <section className="project-artifacts"><h2>已发布产物</h2>{artifacts.map((artifact) => <div key={artifact.id}><strong>{artifact.label}</strong><span>{artifact.kind}{artifact.sourceRuntimeId ? ` | ${artifact.sourceRuntimeId}` : ""}</span>{artifact.path && <code>{artifact.path}</code>}</div>)}{artifacts.length === 0 && <p>尚未发布任务产物。</p>}</section>
      </div>}
      {selected && projectView === "activity" && <section className="task-list project-events"><h2>项目时间线</h2>{events.map((item) => <div className="project-event" key={item.id}><span>{labelForEvent(item.type)}</span><p>{displayEventSummary(item.summary)}</p><small>{time(item.createdAt)}</small></div>)}{events.length === 0 && <div className="task-empty">暂无项目活动。</div>}</section>}
    </section>
  );
}
