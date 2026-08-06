import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  type SaveTaskCollaborationInput,
  type TaskCollaborationAssignment,
  type TaskCollaborationExecution,
  type TaskCollaborationExecutionStatus,
  type TaskCollaborationAcceptance,
  type TaskCollaborationArtifact,
  type TaskCollaborationIntervention,
  type TaskCollaborationRecord,
  type TaskCollaborationRoleRun,
  type TaskCollaborationRoleRunStatus,
  type TaskCollaborationStatus,
  type LinkTaskCollaborationInput,
  type UpdateTaskCollaborationExecutionInput,
} from "../shared/task-collaboration";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

interface CollaborationStore {
  version: 1;
  records: TaskCollaborationRecord[];
}

const MAX_RECORDS = 500;
const STATUSES = new Set<TaskCollaborationStatus>(["configured", "active"]);
const EXECUTION_STATUSES = new Set<TaskCollaborationExecutionStatus>([
  "pending",
  "running",
  "succeeded",
  "failed",
  "waiting_for_user",
  "paused",
  "needs_review",
  "cancelled",
]);
const ROLE_RUN_STATUSES = new Set<TaskCollaborationRoleRunStatus>([
  "pending",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "waiting_for_user",
  "paused",
  "retrying",
  "needs_review",
  "cancelled",
]);

function storePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "desktop",
    "task-collaborations.json",
  );
}

function text(value: unknown, max = 4096): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().slice(0, max);
  return cleaned || undefined;
}

function assignments(value: unknown): TaskCollaborationAssignment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: TaskCollaborationAssignment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const role = text((item as { role?: unknown }).role, 80);
    if (!role) continue;
    const id = text((item as { id?: unknown }).id, 120);
    // New records use a generated row id. Legacy records retain the old
    // one-role-per-name protection when no id is available.
    const identity = id || `legacy:${role}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const runtimeId = text((item as { runtimeId?: unknown }).runtimeId, 160);
    const responsibility = text(
      (item as { responsibility?: unknown }).responsibility,
      240,
    );
    const context = text((item as { context?: unknown }).context, 240);
    result.push({
      ...(id ? { id } : {}),
      role,
      ...(runtimeId ? { runtimeId } : {}),
      ...(responsibility ? { responsibility } : {}),
      ...(context ? { context } : {}),
    });
  }
  return result;
}

function assignmentIdentity(
  assignment: TaskCollaborationAssignment,
  index: number,
): string {
  return assignment.id || `legacy:${index}:${assignment.role}`;
}

function roleRuns(
  value: unknown,
  configuredAssignments: TaskCollaborationAssignment[],
): TaskCollaborationRoleRun[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Map(
    configuredAssignments.map((assignment, index) => [
      assignmentIdentity(assignment, index),
      assignment,
    ]),
  );
  const seen = new Set<string>();
  const result: TaskCollaborationRoleRun[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<TaskCollaborationRoleRun>;
    const assignmentId = text(raw.assignmentId, 160);
    const assignment = assignmentId ? allowed.get(assignmentId) : undefined;
    if (!assignment || seen.has(assignmentId as string)) continue;
    const status =
      typeof raw.status === "string" && ROLE_RUN_STATUSES.has(raw.status as TaskCollaborationRoleRunStatus)
        ? (raw.status as TaskCollaborationRoleRunStatus)
        : "pending";
    seen.add(assignmentId as string);
    const runtimeRunId = text(raw.runtimeRunId, 200);
    const handoff = text(raw.handoff, 6_000);
    const error = text(raw.error, 1_000);
    result.push({
      assignmentId: assignmentId as string,
      role: assignment.role,
      ...(assignment.runtimeId ? { runtimeId: assignment.runtimeId } : {}),
      status,
      ...(runtimeRunId ? { runtimeRunId } : {}),
      ...(typeof raw.startedAt === "number" ? { startedAt: raw.startedAt } : {}),
      ...(typeof raw.completedAt === "number" ? { completedAt: raw.completedAt } : {}),
      ...(handoff ? { handoff } : {}),
      ...(error ? { error } : {}),
    });
  }
  return result;
}

function interventions(
  value: unknown,
  configuredAssignments: TaskCollaborationAssignment[],
): TaskCollaborationIntervention[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(
    configuredAssignments.map((assignment, index) => assignmentIdentity(assignment, index)),
  );
  const seen = new Set<string>();
  const result: TaskCollaborationIntervention[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<TaskCollaborationIntervention>;
    const id = text(raw.id, 160);
    const assignmentId = text(raw.assignmentId, 160);
    const content = text(raw.content, 4_000);
    const visibility = raw.visibility === "shared" ? "shared" : "role";
    if (!id || !assignmentId || !content || !allowed.has(assignmentId) || seen.has(id)) continue;
    seen.add(id);
    result.push({
      id,
      assignmentId,
      content,
      visibility,
      ...(raw.accessMode === "analysis" || raw.accessMode === "full_access"
        ? { accessMode: raw.accessMode }
        : {}),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    });
  }
  return result.slice(-100);
}

function artifacts(
  value: unknown,
  configuredAssignments: TaskCollaborationAssignment[],
): TaskCollaborationArtifact[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Map(
    configuredAssignments.map((assignment, index) => [
      assignmentIdentity(assignment, index),
      assignment,
    ]),
  );
  const seen = new Set<string>();
  const result: TaskCollaborationArtifact[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<TaskCollaborationArtifact>;
    const id = text(raw.id, 200);
    const assignmentId = text(raw.assignmentId, 160);
    const assignment = assignmentId ? allowed.get(assignmentId) : undefined;
    const kind = raw.kind;
    const source = raw.source;
    const label = text(raw.label, 240);
    if (
      !id || !assignmentId || !assignment || !label || seen.has(id) ||
      (kind !== "file" && kind !== "code_diff" && kind !== "test_result") ||
      (source !== "runtime_artifact" && source !== "runtime_event")
    ) continue;
    seen.add(id);
    const path = text(raw.path, 1_000);
    const summary = text(raw.summary, 12_000);
    const runtimeId = text(raw.runtimeId, 160);
    const sourceRunId = text(raw.sourceRunId, 200);
    result.push({
      id,
      assignmentId,
      role: assignment.role,
      ...(runtimeId ? { runtimeId } : assignment.runtimeId ? { runtimeId: assignment.runtimeId } : {}),
      kind,
      label,
      ...(path ? { path } : {}),
      ...(summary ? { summary } : {}),
      source,
      ...(sourceRunId ? { sourceRunId } : {}),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    });
  }
  return result.slice(-200);
}

function acceptance(
  value: unknown,
  configuredAssignments: TaskCollaborationAssignment[],
  artifacts: TaskCollaborationArtifact[],
): TaskCollaborationAcceptance | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<TaskCollaborationAcceptance>;
  const status = raw.status;
  const conclusion = text(raw.conclusion, 6_000);
  if (!conclusion || (status !== "passed" && status !== "failed" && status !== "needs_review")) {
    return undefined;
  }
  const allowedAssignments = new Set(
    configuredAssignments.map((assignment, index) => assignmentIdentity(assignment, index)),
  );
  const assignmentId = text(raw.assignmentId, 160);
  const knownArtifactIds = new Set(artifacts.map((artifact) => artifact.id));
  const reviewedArtifactIds = Array.isArray(raw.reviewedArtifactIds)
    ? [...new Set(raw.reviewedArtifactIds.filter((id): id is string => typeof id === "string" && knownArtifactIds.has(id)))].slice(0, 200)
    : [];
  return {
    ...(assignmentId && allowedAssignments.has(assignmentId) ? { assignmentId } : {}),
    status,
    conclusion,
    reviewedArtifactIds,
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
  };
}

function execution(
  value: unknown,
  configuredAssignments: TaskCollaborationAssignment[],
): TaskCollaborationExecution | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<TaskCollaborationExecution>;
  if (typeof raw.status !== "string" || !EXECUTION_STATUSES.has(raw.status as TaskCollaborationExecutionStatus)) {
    return undefined;
  }
  const normalizedRoleRuns = roleRuns(raw.roleRuns, configuredAssignments);
  const normalizedInterventions = interventions(raw.interventions, configuredAssignments);
  const normalizedArtifacts = artifacts(raw.artifacts, configuredAssignments);
  const normalizedAcceptance = acceptance(raw.acceptance, configuredAssignments, normalizedArtifacts);
  const brief = text(raw.brief, 12_000);
  const activeAssignmentId = text(raw.activeAssignmentId, 160);
  const validActiveAssignmentId = activeAssignmentId && configuredAssignments.some(
    (assignment, index) => assignmentIdentity(assignment, index) === activeAssignmentId,
  );
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now();
  return {
    status: raw.status as TaskCollaborationExecutionStatus,
    roleRuns: normalizedRoleRuns,
    ...(brief ? { brief } : {}),
    ...(normalizedInterventions.length ? { interventions: normalizedInterventions } : {}),
    ...(normalizedArtifacts.length ? { artifacts: normalizedArtifacts } : {}),
    ...(normalizedAcceptance ? { acceptance: normalizedAcceptance } : {}),
    ...(validActiveAssignmentId ? { activeAssignmentId } : {}),
    updatedAt,
    ...(typeof raw.completedAt === "number" ? { completedAt: raw.completedAt } : {}),
  };
}

function normalize(value: unknown): TaskCollaborationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<TaskCollaborationRecord>;
  const taskId = text(record.taskId, 200);
  const title = text(record.title, 240);
  if (!taskId || !title) return null;
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : createdAt;
  const projectFolder = text(record.projectFolder);
  const sourceRuntimeId = text(record.sourceRuntimeId, 160);
  const conversationId = text(record.conversationId, 200);
  const sourceSessionId = text(record.sourceSessionId, 200);
  const status =
    typeof record.status === "string" && STATUSES.has(record.status as TaskCollaborationStatus)
      ? (record.status as TaskCollaborationStatus)
      : "configured";
  const startedAt = typeof record.startedAt === "number" ? record.startedAt : undefined;
  const normalizedAssignments = assignments(record.assignments);
  const normalizedExecution = execution(record.execution, normalizedAssignments);
  return {
    taskId,
    title,
    ...(projectFolder ? { projectFolder } : {}),
    ...(sourceRuntimeId ? { sourceRuntimeId } : {}),
    assignments: normalizedAssignments,
    status,
    createdAt,
    updatedAt,
    ...(startedAt ? { startedAt } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    ...(normalizedExecution ? { execution: normalizedExecution } : {}),
  };
}

function readStore(profile?: string): CollaborationStore {
  try {
    const file = storePath(profile);
    if (!existsSync(file)) return { version: 1, records: [] };
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { records?: unknown };
    return {
      version: 1,
      records: Array.isArray(parsed.records)
        ? parsed.records
            .map(normalize)
            .filter((item): item is TaskCollaborationRecord => Boolean(item))
        : [],
    };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeStore(profile: string | undefined, records: TaskCollaborationRecord[]): void {
  safeWriteFile(
    storePath(profile),
    JSON.stringify({ version: 1, records: records.slice(0, MAX_RECORDS) } satisfies CollaborationStore),
  );
}

export function saveTaskCollaboration(
  input: SaveTaskCollaborationInput,
  profile?: string,
): TaskCollaborationRecord {
  const taskId = text(input.taskId, 200);
  const title = text(input.title, 240);
  if (!taskId || !title) throw new Error("协作任务必须包含任务标识和标题。");
  const now = Date.now();
  const store = readStore(profile);
  const previous = store.records.find((item) => item.taskId === taskId);
  const projectFolder = text(input.projectFolder);
  const sourceRuntimeId = text(input.sourceRuntimeId, 160);
  const status = input.status && STATUSES.has(input.status) ? input.status : previous?.status ?? "configured";
  const startedAt =
    status === "active" ? previous?.startedAt ?? now : undefined;
  const requestedAssignments = assignments(input.assignments);
  // A late UI/session update must never erase the configured team.  Empty
  // assignments are only acceptable for a brand-new configured draft.
  const nextAssignments =
    requestedAssignments.length > 0
      ? requestedAssignments
      : previous?.assignments ?? [];
  if (status === "active" && nextAssignments.length === 0) {
    throw new Error("启动协作前至少要为一个角色选择智能体。");
  }
  const next: TaskCollaborationRecord = {
    taskId,
    title,
    ...(projectFolder ? { projectFolder } : {}),
    ...(sourceRuntimeId ? { sourceRuntimeId } : {}),
    assignments: nextAssignments,
    status,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(startedAt ? { startedAt } : {}),
    ...(previous?.conversationId ? { conversationId: previous.conversationId } : {}),
    ...(previous?.sourceSessionId ? { sourceSessionId: previous.sourceSessionId } : {}),
    ...(previous?.execution ? { execution: previous.execution } : {}),
  };
  writeStore(profile, [next, ...store.records.filter((item) => item.taskId !== taskId)]);
  return next;
}

export function getTaskCollaboration(
  taskId: string,
  profile?: string,
): TaskCollaborationRecord | null {
  const normalized = text(taskId, 200);
  if (!normalized) return null;
  return (
    readStore(profile).records.find(
      (item) =>
        item.taskId === normalized ||
        item.conversationId === normalized ||
        item.sourceSessionId === normalized,
    ) ?? null
  );
}

export function listTaskCollaborations(
  profile?: string,
): TaskCollaborationRecord[] {
  return readStore(profile).records;
}

export function linkTaskCollaboration(
  input: LinkTaskCollaborationInput,
  profile?: string,
): TaskCollaborationRecord {
  const taskId = text(input.taskId, 200);
  if (!taskId) throw new Error("协作任务标识无效。");
  const store = readStore(profile);
  const previous = store.records.find((item) => item.taskId === taskId);
  if (!previous) throw new Error("协作任务不存在，无法关联会话。");
  const conversationId = text(input.conversationId, 200);
  const sourceSessionId = text(input.sourceSessionId, 200);
  if (!conversationId && !sourceSessionId) return previous;
  const next: TaskCollaborationRecord = {
    ...previous,
    ...(conversationId ? { conversationId } : {}),
    ...(sourceSessionId ? { sourceSessionId } : {}),
    updatedAt: Date.now(),
  };
  writeStore(profile, [next, ...store.records.filter((item) => item.taskId !== taskId)]);
  return next;
}

export function updateTaskCollaborationExecution(
  input: UpdateTaskCollaborationExecutionInput,
  profile?: string,
): TaskCollaborationRecord {
  const taskId = text(input.taskId, 200);
  if (!taskId) throw new Error("协作任务标识无效。");
  const store = readStore(profile);
  const previous = store.records.find((item) => item.taskId === taskId);
  if (!previous) throw new Error("协作任务不存在，无法更新执行状态。");
  const nextExecution = execution(input.execution, previous.assignments);
  if (!nextExecution) throw new Error("协作执行状态无效。");
  const next: TaskCollaborationRecord = {
    ...previous,
    execution: nextExecution,
    updatedAt: Date.now(),
  };
  writeStore(profile, [next, ...store.records.filter((item) => item.taskId !== taskId)]);
  return next;
}
