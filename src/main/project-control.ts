import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";
import { listAgentRuntimes } from "./agent-runtimes";
import {
  cancelTaskCenterTask,
  createTaskCenterTask,
  listTaskCenterTasks,
  setTaskCenterAcceptance,
} from "./task-center";
import type { TaskCenterTask } from "../shared/task-center";
import type {
  AssignProjectTaskInput,
  CreateProjectInput,
  CreateProjectTaskInput,
  ProjectArtifactReference,
  ProjectContextPackage,
  ProjectControlProject,
  ProjectControlTask,
  ProjectTaskEvent,
  ProjectStatus,
  ProjectTaskStatus,
} from "../shared/project-control";

const VERSION = 1;
const MAX_PROJECTS = 100;
const MAX_TASKS = 1_000;
const MAX_EVENTS = 5_000;
const MAX_ARTIFACTS = 2_000;
const MAX_CONTEXT_PACKAGES = 2_000;

interface ProjectControlState {
  version: number;
  projects: ProjectControlProject[];
  tasks: ProjectControlTask[];
  events: ProjectTaskEvent[];
  artifacts: ProjectArtifactReference[];
  contextPackages: ProjectContextPackage[];
}

function storePath(): string {
  return join(profileHome(getActiveProfileNameSync()), "desktop", "project-control.json");
}

function emptyState(): ProjectControlState {
  return { version: VERSION, projects: [], tasks: [], events: [], artifacts: [], contextPackages: [] };
}

function records<T>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((item) => Boolean(item && typeof item === "object")) as T[] : [];
}

function readState(): ProjectControlState {
  try {
    const file = storePath();
    if (!existsSync(file)) return emptyState();
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<ProjectControlState>;
    return {
      version: VERSION,
      projects: records<ProjectControlProject>(raw.projects),
      tasks: records<ProjectControlTask>(raw.tasks),
      events: records<ProjectTaskEvent>(raw.events),
      artifacts: records<ProjectArtifactReference>(raw.artifacts),
      contextPackages: records<ProjectContextPackage>(raw.contextPackages),
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: ProjectControlState): void {
  safeWriteFile(storePath(), JSON.stringify({
    version: VERSION,
    projects: state.projects.slice(0, MAX_PROJECTS),
    tasks: state.tasks.slice(0, MAX_TASKS),
    events: state.events.slice(-MAX_EVENTS),
    artifacts: state.artifacts.slice(-MAX_ARTIFACTS),
    contextPackages: state.contextPackages.slice(-MAX_CONTEXT_PACKAGES),
  }));
}

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new Error(`${label} must be between 1 and ${maxLength} characters.`);
  }
  return value.trim();
}

function event(
  state: ProjectControlState,
  entry: Omit<ProjectTaskEvent, "id" | "createdAt">,
): void {
  state.events.push({ id: `event-${randomUUID()}`, createdAt: Date.now(), ...entry });
}

function getProject(state: ProjectControlState, id: string): ProjectControlProject {
  const project = state.projects.find((item) => item.id === id);
  if (!project) throw new Error("Project was not found.");
  return project;
}

function getTask(state: ProjectControlState, id: string): ProjectControlTask {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) throw new Error("Project task was not found.");
  return task;
}

function runtime(runtimeId: string) {
  const value = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!value || !value.enabled) throw new Error("Assigned Runtime is unavailable.");
  return value;
}

function dependenciesAccepted(state: ProjectControlState, task: ProjectControlTask): boolean {
  return task.dependencies.every((id) => getTask(state, id).status === "accepted");
}

function transition(
  state: ProjectControlState,
  task: ProjectControlTask,
  next: ProjectTaskStatus,
  summary: string,
): ProjectControlTask {
  const current = task.status;
  const allowed: Record<ProjectTaskStatus, ProjectTaskStatus[]> = {
    blocked: ["ready", "cancelled"],
    ready: ["queued", "cancelled"],
    queued: ["running", "cancelled", "failed", "timed_out"],
    running: ["review_required", "accepted", "failed", "cancelled", "timed_out"],
    review_required: ["accepted", "rejected", "cancelled"],
    rejected: ["ready", "cancelled"],
    accepted: [],
    failed: ["ready", "cancelled"],
    cancelled: [],
    timed_out: ["ready", "cancelled"],
  };
  if (!allowed[current].includes(next)) throw new Error(`Project task cannot transition from ${current} to ${next}.`);
  task.status = next;
  task.updatedAt = Date.now();
  if (["accepted", "failed", "cancelled", "timed_out"].includes(next)) task.completedAt = task.updatedAt;
  event(state, {
    projectId: task.projectId,
    taskId: task.id,
    type: "task_status_changed",
    actor: { kind: "control_plane" },
    summary,
  });
  return task;
}

export function listProjects(): ProjectControlProject[] {
  return readState().projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

function applyDirectTaskStatus(
  state: ProjectControlState,
  task: ProjectControlTask,
  direct: TaskCenterTask,
): boolean {
  const desired: ProjectTaskStatus =
    direct.status === "review_required"
      ? direct.acceptance === "accepted" ? "accepted" : direct.acceptance === "rejected" ? "rejected" : "review_required"
      : direct.status === "succeeded" ? "accepted"
      : direct.status;
  let changed = false;
  if (task.status === "queued" && desired !== "queued" && desired !== "cancelled") {
    transition(state, task, "running", "Runtime task started.");
    changed = true;
  }
  if (task.status !== desired) {
    transition(state, task, desired, `Task Center status: ${direct.status}.`);
    changed = true;
  }
  for (const artifact of direct.artifacts || []) {
    const id = `artifact-${direct.id}-${artifact.kind}-${artifact.label}`;
    if (state.artifacts.some((item) => item.id === id)) continue;
    state.artifacts.push({
      id,
      projectId: task.projectId,
      taskId: task.id,
      kind: artifact.kind,
      label: artifact.label,
      ...(artifact.path ? { path: artifact.path } : {}),
      sourceRuntimeId: direct.runtimeId,
      createdAt: Date.now(),
    });
    event(state, {
      projectId: task.projectId,
      taskId: task.id,
      type: "artifact_published",
      actor: { kind: "control_plane" },
      summary: `Artifact published: ${artifact.label}.`,
    });
    changed = true;
  }
  return changed;
}

export async function listProjectTasks(projectId: string): Promise<ProjectControlTask[]> {
  const state = readState();
  const directTasks = await listTaskCenterTasks();
  let changed = false;
  for (const task of state.tasks) {
    if (task.projectId !== projectId || !task.directTaskCenterTaskId) continue;
    const direct = directTasks.find((item) => item.id === task.directTaskCenterTaskId);
    if (direct) changed = applyDirectTaskStatus(state, task, direct) || changed;
  }
  if (changed) writeState(state);
  return state.tasks.filter((task) => task.projectId === projectId);
}

export function listProjectEvents(projectId: string): ProjectTaskEvent[] {
  return readState().events.filter((item) => item.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt);
}

export function listProjectArtifacts(projectId: string): ProjectArtifactReference[] {
  return readState().artifacts.filter((item) => item.projectId === projectId);
}

export function createProject(input: CreateProjectInput): ProjectControlProject {
  const state = readState();
  const title = requiredText(input?.title, "Project title", 120);
  const objective = requiredText(input?.objective, "Project objective", 20_000);
  const kind = input?.coordinator?.kind;
  if (kind !== "human" && kind !== "runtime") throw new Error("Project coordinator is invalid.");
  const runtimeId = kind === "runtime" ? requiredText(input.coordinator.runtimeId, "Coordinator Runtime ID", 64) : undefined;
  if (runtimeId) runtime(runtimeId);
  const now = Date.now();
  const project: ProjectControlProject = {
    id: `project-${randomUUID()}`,
    title,
    objective,
    status: "active",
    coordinator: { kind, ...(runtimeId ? { runtimeId } : {}), assignedBy: "user", assignedAt: now },
    createdAt: now,
    updatedAt: now,
  };
  state.projects.unshift(project);
  event(state, { projectId: project.id, type: "project_created", actor: { kind: "user" }, summary: `Project created with ${kind} coordinator.` });
  writeState(state);
  return project;
}

export function setProjectStatus(projectId: string, status: ProjectStatus, summary: string): ProjectControlProject {
  const state = readState();
  const project = getProject(state, requiredText(projectId, "Project ID", 80));
  const next = status;
  const allowed: Record<ProjectStatus, ProjectStatus[]> = {
    draft: ["active", "cancelled"],
    active: ["paused", "completed", "cancelled"],
    paused: ["active", "cancelled"],
    completed: [],
    cancelled: [],
  };
  if (!allowed[project.status].includes(next)) {
    throw new Error(`Project cannot transition from ${project.status} to ${next}.`);
  }
  project.status = next;
  project.updatedAt = Date.now();
  if (["completed", "cancelled"].includes(next)) project.completedAt = project.updatedAt;
  event(state, {
    projectId: project.id,
    type: "project_status_changed",
    actor: { kind: "user" },
    summary: requiredText(summary, "Project status summary", 2_000),
  });
  writeState(state);
  return project;
}

export function createProjectTask(input: CreateProjectTaskInput): ProjectControlTask {
  const state = readState();
  const project = getProject(state, requiredText(input?.projectId, "Project ID", 80));
  if (project.status !== "active") throw new Error("Tasks can be created only in an active project.");
  const dependencies = [...new Set((input.dependencies || []).map((id) => requiredText(id, "Dependency ID", 80)))];
  for (const id of dependencies) {
    const dependency = getTask(state, id);
    if (dependency.projectId !== project.id) throw new Error("Task dependencies must belong to the same project.");
  }
  if (input.parentTaskId) {
    const parent = getTask(state, requiredText(input.parentTaskId, "Parent task ID", 80));
    if (parent.projectId !== project.id) throw new Error("Parent task must belong to the same project.");
  }
  const now = Date.now();
  const task: ProjectControlTask = {
    id: `project-task-${randomUUID()}`,
    projectId: project.id,
    ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
    title: requiredText(input.title, "Task title", 160),
    requirement: requiredText(input.requirement, "Task requirement", 50_000),
    acceptanceCriteria: requiredText(input.acceptanceCriteria, "Acceptance criteria", 20_000),
    dependencies,
    status: dependencies.length ? "blocked" : "ready",
    createdAt: now,
    updatedAt: now,
  };
  state.tasks.push(task);
  project.updatedAt = now;
  event(state, { projectId: project.id, taskId: task.id, type: "task_created", actor: { kind: "user" }, summary: `Task created as ${task.status}.` });
  writeState(state);
  return task;
}

export function assignProjectTask(input: AssignProjectTaskInput): ProjectControlTask {
  const state = readState();
  const task = getTask(state, requiredText(input?.taskId, "Project task ID", 80));
  if (task.status === "blocked" && dependenciesAccepted(state, task)) transition(state, task, "ready", "Dependencies accepted.");
  if (task.status !== "ready") throw new Error("Only ready project tasks may be assigned.");
  const assigned = runtime(requiredText(input.runtimeId, "Runtime ID", 64));
  if (input.mode === "implementation" && assigned.kind !== "codex" && assigned.kind !== "claude-code") {
    throw new Error("Implementation tasks require Codex or Claude Code.");
  }
  task.assignment = {
    runtimeId: assigned.id,
    role: input.role,
    requestedBy: "user",
    assignedAt: Date.now(),
    ...(input.workspace?.trim() ? { workspace: input.workspace.trim() } : {}),
    mode: input.mode,
  };
  task.updatedAt = Date.now();
  transition(state, task, "queued", `Assigned to ${assigned.name}.`);
  event(state, { projectId: task.projectId, taskId: task.id, type: "task_assigned", actor: { kind: "user" }, summary: `Assigned ${input.role} Runtime.` });
  writeState(state);
  return task;
}

export async function dispatchProjectTask(taskId: string): Promise<ProjectControlTask> {
  const state = readState();
  const task = getTask(state, requiredText(taskId, "Project task ID", 80));
  if (task.status !== "queued" || !task.assignment) {
    throw new Error("Only a queued, assigned project task may be dispatched.");
  }
  const direct = await createTaskCenterTask({
    title: task.title,
    prompt: `${task.requirement}\n\nAcceptance criteria:\n${task.acceptanceCriteria}`,
    runtimeId: task.assignment.runtimeId,
    mode: task.assignment.mode,
    workspace: task.assignment.workspace,
  });
  task.directTaskCenterTaskId = direct.id;
  task.updatedAt = Date.now();
  applyDirectTaskStatus(state, task, direct);
  event(state, {
    projectId: task.projectId,
    taskId: task.id,
    type: "handoff",
    actor: { kind: "control_plane" },
    summary: `Dispatched through Task Center to ${task.assignment.runtimeId}.`,
  });
  writeState(state);
  return task;
}

/**
 * A project manager is an ordinary selected Runtime, never a privileged process.
 * Local CLI adapters use analysis mode; remote Hermes/OpenClaw adapters must
 * expose the constrained Bridge planning contract before the Runtime layer will
 * accept the run.
 */
export async function startCoordinatorPlanningTask(projectId: string): Promise<ProjectControlTask> {
  const state = readState();
  const project = getProject(state, requiredText(projectId, "Project ID", 80));
  if (project.status !== "active") throw new Error("Coordinator planning requires an active project.");
  if (project.coordinator.kind !== "runtime" || !project.coordinator.runtimeId) {
    throw new Error("Choose a Runtime coordinator before starting a planning task.");
  }
  const coordinator = runtime(project.coordinator.runtimeId);
  const localCoordinator = coordinator.location === "local" &&
    (coordinator.kind === "codex" || coordinator.kind === "claude-code");
  const remoteCoordinator = coordinator.location === "remote" &&
    (coordinator.kind === "hermes" || coordinator.kind === "openclaw");
  if (!localCoordinator && !remoteCoordinator) {
    throw new Error(
      "This Runtime has no enforceable read-only planning mode. Use manual coordination until its remote Bridge supports constrained planning.",
    );
  }
  const task = createProjectTask({
    projectId: project.id,
    title: `Coordinator plan: ${project.title}`,
    requirement: [
      "Act as the project coordinator. Analyse the project objective and propose a safe, staged plan.",
      "Return: task titles, dependencies, suggested Runtime and role, acceptance criteria, and risks.",
      "Do not execute changes, issue credentials, or assume authority to merge code.",
      "Project objective:",
      project.objective,
    ].join("\n\n"),
    acceptanceCriteria: "A reviewable project plan with explicit dependencies and assignment suggestions is available.",
  });
  assignProjectTask({
    taskId: task.id,
    runtimeId: coordinator.id,
    role: "manager",
    mode: "analysis",
  });
  if (localCoordinator) return dispatchProjectTask(task.id);

  const direct = await createTaskCenterTask({
    title: task.title,
    prompt: task.requirement,
    runtimeId: coordinator.id,
    mode: "analysis",
    coordinatorPlan: {
      projectId: project.id,
      title: project.title,
      objective: project.objective,
      existingTasks: state.tasks
        .filter((item) => item.projectId === project.id)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          ...(item.assignment?.runtimeId ? { runtimeId: item.assignment.runtimeId } : {}),
        })),
    },
  });
  const nextState = readState();
  const plannedTask = getTask(nextState, task.id);
  plannedTask.directTaskCenterTaskId = direct.id;
  plannedTask.updatedAt = Date.now();
  applyDirectTaskStatus(nextState, plannedTask, direct);
  event(nextState, {
    projectId: plannedTask.projectId,
    taskId: plannedTask.id,
    type: "handoff",
    actor: { kind: "control_plane" },
    summary: `Constrained coordinator plan requested from ${coordinator.id}.`,
  });
  writeState(nextState);
  return plannedTask;
}

export async function reviewProjectTask(
  taskId: string,
  acceptance: "accepted" | "rejected",
  summary: string,
): Promise<ProjectControlTask> {
  const cleanSummary = requiredText(summary, "Review summary", 2_000);
  let state = readState();
  let task = getTask(state, requiredText(taskId, "Project task ID", 80));
  if (task.status !== "review_required") throw new Error("Only tasks awaiting review may be accepted or rejected.");

  if (task.directTaskCenterTaskId) {
    await setTaskCenterAcceptance(task.directTaskCenterTaskId, acceptance);
    const direct = (await listTaskCenterTasks()).find((item) => item.id === task.directTaskCenterTaskId);
    state = readState();
    task = getTask(state, task.id);
    if (direct) applyDirectTaskStatus(state, task, direct);
  }
  if (task.status === "review_required") transition(state, task, acceptance, cleanSummary);
  event(state, {
    projectId: task.projectId,
    taskId: task.id,
    type: acceptance === "accepted" ? "acceptance" : "review",
    actor: { kind: "user" },
    summary: cleanSummary,
  });
  writeState(state);
  return task;
}

export async function cancelProjectTask(taskId: string): Promise<ProjectControlTask> {
  let state = readState();
  let task = getTask(state, requiredText(taskId, "Project task ID", 80));
  if (task.directTaskCenterTaskId) {
    await cancelTaskCenterTask(task.directTaskCenterTaskId);
    const direct = (await listTaskCenterTasks()).find((item) => item.id === task.directTaskCenterTaskId);
    state = readState();
    task = getTask(state, task.id);
    if (direct) applyDirectTaskStatus(state, task, direct);
  }
  if (!["accepted", "cancelled", "failed", "timed_out"].includes(task.status)) {
    transition(state, task, "cancelled", "Cancelled by user.");
    writeState(state);
  }
  return task;
}

export function setProjectTaskStatus(taskId: string, status: ProjectTaskStatus, summary: string): ProjectControlTask {
  const state = readState();
  const task = getTask(state, requiredText(taskId, "Project task ID", 80));
  const next = transition(state, task, status, requiredText(summary, "Status summary", 2_000));
  writeState(state);
  return next;
}

export function createProjectContextPackage(taskId: string): ProjectContextPackage {
  const state = readState();
  const task = getTask(state, requiredText(taskId, "Project task ID", 80));
  const project = getProject(state, task.projectId);
  const previous = state.contextPackages.filter((item) => item.taskId === task.id);
  const artifacts = state.artifacts.filter((item) => item.projectId === task.projectId && (!item.taskId || task.dependencies.includes(item.taskId)));
  const upstreamSummaries = state.events
    .filter((item) => item.projectId === task.projectId && item.taskId && task.dependencies.includes(item.taskId))
    .slice(-20)
    .map((item) => ({ taskId: item.taskId!, summary: item.summary }));
  const pack: ProjectContextPackage = {
    id: `context-${randomUUID()}`,
    projectId: task.projectId,
    taskId: task.id,
    version: previous.length + 1,
    requirement: task.requirement,
    acceptanceCriteria: task.acceptanceCriteria,
    projectSummary: project.objective,
    ...(task.assignment?.workspace ? { workspace: { reference: task.assignment.workspace, kind: "repository" as const } } : {}),
    artifacts,
    upstreamSummaries,
    createdAt: Date.now(),
  };
  state.contextPackages.push(pack);
  task.contextPackageId = pack.id;
  task.updatedAt = Date.now();
  event(state, { projectId: task.projectId, taskId: task.id, type: "context_requested", actor: { kind: "control_plane" }, summary: `Context package v${pack.version} created.` });
  writeState(state);
  return pack;
}
