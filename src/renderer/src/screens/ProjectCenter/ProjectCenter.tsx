import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, FileText, Pause, Play, Plus, RefreshCw, Send, Square, UserRound, X } from "lucide-react";
import type { AgentRuntimeDefinition, AgentRuntimeProbe } from "../../../../shared/agent-runtimes";
import type {
  ProjectArtifactReference,
  ProjectContextPackage,
  ProjectControlProject,
  ProjectControlTask,
  ProjectRole,
} from "../../../../shared/project-control";

const ROLES: ProjectRole[] = ["manager", "implementer", "tester", "reviewer", "acceptor"];

function time(value: number): string {
  return new Date(value).toLocaleString();
}

function values(event: React.ChangeEvent<HTMLSelectElement>): string[] {
  return Array.from(event.target.selectedOptions).map((option) => option.value);
}

export default function ProjectCenter(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectControlProject[]>([]);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [runtimeProbes, setRuntimeProbes] = useState<Record<string, AgentRuntimeProbe>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<ProjectControlTask[]>([]);
  const [artifacts, setArtifacts] = useState<ProjectArtifactReference[]>([]);
  const [events, setEvents] = useState<Array<{ id: string; type: string; summary: string; createdAt: number }>>([]);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [coordinatorKind, setCoordinatorKind] = useState<"human" | "runtime">("human");
  const [coordinatorRuntimeId, setCoordinatorRuntimeId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [acceptance, setAcceptance] = useState("");
  const [parentTaskId, setParentTaskId] = useState("");
  const [dependencies, setDependencies] = useState<string[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [role, setRole] = useState<ProjectRole>("implementer");
  const [mode, setMode] = useState<"analysis" | "implementation">("analysis");
  const [reviewSummary, setReviewSummary] = useState("");
  const [context, setContext] = useState<ProjectContextPackage | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const selected = projects.find((project) => project.id === selectedId) || null;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const enabledRuntimes = useMemo(() => runtimes.filter((runtime) => runtime.enabled), [runtimes]);
  const coordinatorRuntime = selected?.coordinator.runtimeId
    ? runtimes.find((runtime) => runtime.id === selected.coordinator.runtimeId)
    : undefined;
  const coordinatorProbe = coordinatorRuntime ? runtimeProbes[coordinatorRuntime.id] : undefined;
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
      const [nextProjects, nextRuntimes] = await Promise.all([
        window.hermesAPI.listProjectControlProjects(),
        window.hermesAPI.listAgentRuntimes(),
      ]);
      setProjects(nextProjects);
      setRuntimes(nextRuntimes);
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

  useEffect(() => { void refresh(); }, []);

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
    setReviewSummary("");
    if (selectedTask?.assignment) {
      setAssigneeId(selectedTask.assignment.runtimeId);
      setRole(selectedTask.assignment.role);
      setMode(selectedTask.assignment.mode);
    }
  }, [selectedTaskId]);

  async function createProject(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    try {
      const project = await window.hermesAPI.createProjectControlProject({
        title,
        objective,
        coordinator: coordinatorKind === "runtime"
          ? { kind: "runtime", runtimeId: coordinatorRuntimeId }
          : { kind: "human" },
      });
      setTitle("");
      setObjective("");
      setFlash("Project created.");
      await refresh(project.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not create project.");
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
      setSelectedTaskId(task.id);
      setFlash("Project task created.");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not create project task.");
    }
  }

  async function assignTask(): Promise<void> {
    if (!selectedTask || !assigneeId) return;
    try {
      await window.hermesAPI.assignProjectControlTask({ taskId: selectedTask.id, runtimeId: assigneeId, role, mode });
      setFlash("Task queued for its assigned Runtime.");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not assign project task.");
    }
  }

  async function createContext(): Promise<void> {
    if (!selectedTask) return;
    try {
      const nextContext = await window.hermesAPI.createProjectControlContext(selectedTask.id);
      setContext(nextContext);
      setFlash(`Context package v${nextContext.version} created.`);
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not create context package.");
    }
  }

  async function dispatchTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.dispatchProjectControlTask(selectedTask.id);
      setFlash("Task dispatched through Task Center.");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not dispatch project task.");
    }
  }

  async function planWithCoordinator(): Promise<void> {
    if (!selected) return;
    try {
      const task = await window.hermesAPI.startProjectCoordinatorPlan(selected.id);
      setSelectedTaskId(task.id);
      setFlash("Coordinator planning task dispatched for review.");
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not start coordinator planning.");
    }
  }

  async function changeProjectStatus(status: "active" | "paused" | "completed" | "cancelled"): Promise<void> {
    if (!selected) return;
    const label = status === "active" ? "resumed" : status;
    try {
      await window.hermesAPI.setProjectControlStatus(selected.id, status, `Project ${label} by user.`);
      setFlash(`Project ${label}.`);
      await refresh(selected.id);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not update project status.");
    }
  }

  async function reviewTask(decision: "accepted" | "rejected"): Promise<void> {
    if (!selectedTask || !reviewSummary.trim()) return;
    try {
      await window.hermesAPI.reviewProjectControlTask(selectedTask.id, decision, reviewSummary);
      setReviewSummary("");
      setFlash(decision === "accepted" ? "Task accepted." : "Task returned for revision.");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not review project task.");
    }
  }

  async function cancelTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.cancelProjectControlTask(selectedTask.id);
      setFlash("Task cancelled.");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not cancel project task.");
    }
  }

  async function retryTask(): Promise<void> {
    if (!selectedTask) return;
    try {
      await window.hermesAPI.setProjectControlTaskStatus(selectedTask.id, "ready", "Returned to ready for a new assignment.");
      setFlash("Task returned to ready.");
      await refresh(selectedId);
    } catch (error) {
      setFlash(error instanceof Error ? error.message : "Could not retry project task.");
    }
  }

  return (
    <section className="task-center" aria-label="Projects">
      <header className="task-center-header">
        <div><h1>Projects</h1><p>Plan, delegate, and audit controlled multi-agent work.</p></div>
        <button className="icon-btn" type="button" onClick={() => void refresh()} title="Refresh projects" aria-label="Refresh projects"><RefreshCw size={17} /></button>
      </header>
      {flash && <p className="task-error" role="status">{flash}</p>}
      <div className="project-center-grid">
        <section className="task-compose">
          <form onSubmit={(event) => void createProject(event)}>
            <div className="task-compose-grid">
              <label><span>Project</span><input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} /></label>
              <label><span>Coordinator</span><select value={coordinatorKind} onChange={(event) => setCoordinatorKind(event.target.value as "human" | "runtime")}><option value="human">Human</option><option value="runtime">Runtime</option></select></label>
              {coordinatorKind === "runtime" && <label><span>Manager Runtime</span><select value={coordinatorRuntimeId} onChange={(event) => setCoordinatorRuntimeId(event.target.value)} required><option value="">Select Runtime</option>{enabledRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label>}
            </div>
            <label className="task-prompt"><span>Objective</span><textarea value={objective} onChange={(event) => setObjective(event.target.value)} required maxLength={20000} rows={3} /></label>
            <div className="task-compose-actions"><button className="primary-btn" type="submit" disabled={!title.trim() || !objective.trim() || (coordinatorKind === "runtime" && !coordinatorRuntimeId)}><Plus size={16} />Create project</button></div>
          </form>
        </section>
        <section className="task-list project-list" aria-label="Project list">
          {projects.map((project) => <button key={project.id} type="button" className={`project-row ${project.id === selectedId ? "is-active" : ""}`} onClick={() => void refresh(project.id)}><span>{project.title}</span><small>{project.coordinator.kind === "human" ? <UserRound size={13} /> : <Bot size={13} />}{project.coordinator.runtimeId || "Human"}</small></button>)}
          {projects.length === 0 && <div className="task-empty">No projects have been created.</div>}
        </section>
      </div>
      {selected && <div className="project-center-grid project-center-grid--details">
        <section className="task-compose">
          <div className="project-titlebar"><h2>{selected.title}</h2><span>{selected.status}</span></div><p>{selected.objective}</p>
          <div className="project-status-actions">
            {selected.status === "active" && <><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("paused")}><Pause size={15} />Pause</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("completed")}><Check size={15} />Complete</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("cancelled")}><Square size={15} />Cancel</button></>}
            {selected.status === "paused" && <><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("active")}><Play size={15} />Resume</button><button className="btn btn-secondary" type="button" onClick={() => void changeProjectStatus("cancelled")}><Square size={15} />Cancel</button></>}
          </div>
          {selected.coordinator.kind === "runtime" && selected.status === "active" && <div className="project-coordinator"><Bot size={15} /><span>{selected.coordinator.runtimeId}</span>{constrainedPlanningAvailable ? <button className="btn btn-secondary" type="button" onClick={() => void planWithCoordinator()}><Play size={15} />Plan</button> : <small>Manual planning required</small>}</div>}
          <form onSubmit={(event) => void createTask(event)}>
            <label><span>Task title</span><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} required maxLength={160} /></label>
            <label className="task-prompt"><span>Requirement</span><textarea value={requirement} onChange={(event) => setRequirement(event.target.value)} required rows={3} /></label>
            <label className="task-prompt"><span>Acceptance</span><textarea value={acceptance} onChange={(event) => setAcceptance(event.target.value)} required rows={2} /></label>
            <div className="task-compose-grid project-dependency-grid">
              <label><span>Parent task</span><select value={parentTaskId} onChange={(event) => setParentTaskId(event.target.value)}><option value="">None</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
              <label><span>Prerequisites</span><select multiple value={dependencies} onChange={(event) => setDependencies(values(event))}>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title} ({task.status})</option>)}</select></label>
            </div>
            <div className="task-compose-actions"><button className="primary-btn" type="submit" disabled={selected.status !== "active"}><Plus size={16} />Add task</button></div>
          </form>
        </section>
        <section className="task-list project-list" aria-label="Project tasks">
          {tasks.map((task) => <button key={task.id} type="button" className={`project-row ${task.id === selectedTaskId ? "is-active" : ""}`} onClick={() => setSelectedTaskId(task.id)}><span>{task.title}</span><small>{task.status}{task.assignment ? ` | ${task.assignment.runtimeId}` : ""}</small></button>)}
          {tasks.length === 0 && <div className="task-empty">No project tasks yet.</div>}
        </section>
        <section className="task-compose">
          <h2>Task control</h2>
          {selectedTask ? <>
            <p>{selectedTask.requirement}</p>
            <div className="task-compose-grid"><label><span>Runtime</span><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Select Runtime</option>{enabledRuntimes.map((runtime) => <option key={runtime.id} value={runtime.id}>{runtime.name}</option>)}</select></label><label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value as ProjectRole)}>{ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value as "analysis" | "implementation")}><option value="analysis">Analysis</option><option value="implementation">Implementation</option></select></label></div>
            <div className="task-compose-actions project-actions">
              <button className="primary-btn" type="button" disabled={!assigneeId || (selectedTask.status !== "ready" && selectedTask.status !== "blocked")} onClick={() => void assignTask()}><Send size={16} />Assign</button>
              {selectedTask.status === "queued" && <button className="primary-btn" type="button" onClick={() => void dispatchTask()}><Send size={16} />Dispatch</button>}
              {(["queued", "running", "review_required"] as string[]).includes(selectedTask.status) && <button className="btn btn-secondary" type="button" onClick={() => void cancelTask()}><Square size={15} />Cancel</button>}
              {(["rejected", "failed", "timed_out"] as string[]).includes(selectedTask.status) && <button className="btn btn-secondary" type="button" onClick={() => void retryTask()}><RefreshCw size={15} />Retry</button>}
              <button className="btn btn-secondary" type="button" onClick={() => void createContext()}><FileText size={15} />Context</button>
            </div>
            {selectedTask.status === "review_required" && <div className="project-review"><label><span>Review record</span><input value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} maxLength={2000} placeholder="Acceptance decision and reason" /></label><div><button className="primary-btn" type="button" disabled={!reviewSummary.trim()} onClick={() => void reviewTask("accepted")}><Check size={15} />Accept</button><button className="btn btn-secondary" type="button" disabled={!reviewSummary.trim()} onClick={() => void reviewTask("rejected")}><X size={15} />Reject</button></div></div>}
          </> : <div className="task-empty">Select a project task.</div>}
        </section>
      </div>}
      {context && <section className="project-context"><h2>Context package v{context.version}</h2><p>{context.projectSummary}</p><p>{context.requirement}</p><div>{context.artifacts.map((artifact) => <span key={artifact.id}>{artifact.label}</span>)}{context.artifacts.length === 0 && <span>No upstream artifacts were shared.</span>}</div>{context.upstreamSummaries.map((summary, index) => <p key={`${summary.taskId}-${index}`}>{summary.summary}</p>)}</section>}
      {selected && <section className="project-artifacts"><h2>Published artifacts</h2>{artifacts.map((artifact) => <div key={artifact.id}><strong>{artifact.label}</strong><span>{artifact.kind}{artifact.sourceRuntimeId ? ` | ${artifact.sourceRuntimeId}` : ""}</span>{artifact.path && <code>{artifact.path}</code>}</div>)}{artifacts.length === 0 && <p>No task artifacts have been published.</p>}</section>}
      {selected && <section className="task-list project-events"><h2>Project timeline</h2>{events.map((item) => <div className="project-event" key={item.id}><span>{item.type}</span><p>{item.summary}</p><small>{time(item.createdAt)}</small></div>)}</section>}
    </section>
  );
}
