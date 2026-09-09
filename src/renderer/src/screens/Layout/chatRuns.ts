import type { ChatMessage } from "../Chat/Chat";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeKind,
} from "../../../../shared/agent-runtimes";
import type { RuntimeConversationMessage } from "../../../../shared/runtime-conversations";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationRecord,
  TaskCollaborationStatus,
} from "../../../../shared/task-collaboration";

/**
 * One concurrently-running (or open) conversation. Several runs coexist so the
 * user can background a session — or a whole agent/profile — and return to it
 * live. `runId` is minted in the renderer and threaded through the main process
 * so streaming events route back to the right run.
 */
export interface ChatRun {
  runId: string;
  /** Immutable: the profile/agent this run was started under. */
  profile: string;
  /** Runtime conversations use the Runtime Adapter instead of Hermes profile chat. */
  runtimeId?: string;
  runtimeName?: string;
  runtimeKind?: AgentRuntimeKind;
  runtimeConversationId?: string;
  runtimeActiveRunId?: string;
  runtimeSeed?: RuntimeConversationMessage[];
  runtimeWorkspace?: string;
  runtimeWorkspaceId?: string;
  runtimeAccessMode?: "auto" | "analysis" | "full_access";
  /** Gateway session id, known once the first turn reports it. */
  sessionId: string | null;
  /** True while the agent is generating for this run. */
  loading: boolean;
  /** Best-effort title (first user message) for the active-sessions bar. */
  title?: string;
  /** Seed transcript when the run was opened from history. */
  seed?: ChatMessage[];
  /** Chosen project folder for a new task conversation. */
  contextFolder?: string;
  /** Saved once the first message gives this draft a durable conversation id. */
  collaboration?: {
    assignments: TaskCollaborationAssignment[];
    projectWorkspaceId?: string;
    projectName?: string;
    projectFolder?: string;
    persistedTaskId?: string;
    status?: TaskCollaborationStatus;
  };
}

/**
 * Only the legacy built-in Hermes shell uses the old profile chat. Every
 * configured runtime, including a custom remote Hermes, must retain its own
 * runtime id so dispatch and persistence cannot fall back to another agent.
 */
export function usesLegacyHermesChat(runtime: AgentRuntimeDefinition): boolean {
  return runtime.kind === "hermes" && runtime.managed === "builtin";
}

/** A blank chat that can be reassigned to another profile without losing work. */
export function isScratchRun(r: ChatRun): boolean {
  return !r.runtimeId && !r.sessionId && !r.loading && !r.title;
}

/** A task tab with no conversation, transcript, or in-flight work yet. */
export function isBlankTaskRun(r: ChatRun): boolean {
  return (
    !r.sessionId &&
    !r.runtimeConversationId &&
    !r.loading &&
    !r.title &&
    !r.seed &&
    !r.runtimeSeed
  );
}

/** Mint a fresh, empty run under the given profile. */
export function mintRun(
  profile: string,
  seed?: ChatMessage[],
  contextFolder?: string,
): ChatRun {
  return {
    runId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `run-${crypto.randomUUID()}`
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profile,
    sessionId: null,
    loading: false,
    seed,
    contextFolder,
  };
}

export function mintRuntimeRun(input: {
  profile: string;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeKind;
  /** Persisted first-user-message title when resuming a Runtime conversation. */
  title?: string;
  runtimeConversationId?: string;
  runtimeActiveRunId?: string;
  runtimeSeed?: RuntimeConversationMessage[];
  runtimeWorkspace?: string;
  runtimeWorkspaceId?: string;
  runtimeAccessMode?: "auto" | "analysis" | "full_access";
  sessionId?: string | null;
}): ChatRun {
  return {
    runId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `run-${crypto.randomUUID()}`
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    profile: input.profile,
    runtimeId: input.runtimeId,
    runtimeName: input.runtimeName,
    runtimeKind: input.runtimeKind,
    title: input.title,
    runtimeConversationId: input.runtimeConversationId,
    runtimeActiveRunId: input.runtimeActiveRunId,
    runtimeSeed: input.runtimeSeed,
    runtimeWorkspace: input.runtimeWorkspace,
    runtimeWorkspaceId: input.runtimeWorkspaceId,
    runtimeAccessMode: input.runtimeAccessMode,
    sessionId: input.sessionId ?? null,
    loading: false,
  };
}

/** Immutably patch one run's fields by id. */
export function patchRun(
  runs: ChatRun[],
  runId: string,
  patch: Partial<ChatRun>,
): ChatRun[] {
  return runs.map((r) => (r.runId === runId ? { ...r, ...patch } : r));
}

/**
 * Keep the selected shell profile and the visible chat run in sync.
 *
 * Existing conversations remain under the profile they started with; switching
 * profiles activates a scratch run for the new profile instead of showing a
 * stale conversation from the previous one.
 */
export function selectProfileRunTransition(
  runs: ChatRun[],
  activeRunId: string,
  profile: string,
): { activeRunId: string; runs: ChatRun[] } {
  const active = runs.find((r) => r.runId === activeRunId);
  if (!active || active.profile === profile) {
    return { activeRunId, runs };
  }

  if (isScratchRun(active)) {
    return {
      activeRunId,
      runs: runs.map((r) => (r.runId === activeRunId ? { ...r, profile } : r)),
    };
  }

  const scratch = runs.find((r) => r.profile === profile && isScratchRun(r));
  if (scratch) {
    return { activeRunId: scratch.runId, runs };
  }

  const next = mintRun(profile);
  return { activeRunId: next.runId, runs: [...runs, next] };
}

/**
 * Open a persisted session without leaving behind the active blank placeholder.
 *
 * Profile switching may create a scratch run so the visible chat matches the
 * selected profile. If the next action is opening a saved session for that same
 * profile, the saved session should occupy that placeholder tab.
 */
export function openSessionRunTransition(
  runs: ChatRun[],
  activeRunId: string,
  run: ChatRun,
): { activeRunId: string; runs: ChatRun[] } {
  const active = runs.find((r) => r.runId === activeRunId);
  if (active && active.profile === run.profile && isScratchRun(active)) {
    return {
      activeRunId: run.runId,
      runs: runs.map((r) => (r.runId === activeRunId ? run : r)),
    };
  }

  return { activeRunId: run.runId, runs: [...runs, run] };
}

/**
 * Open a new task without retaining an unused placeholder for another agent.
 *
 * Layout starts with a legacy Hermes placeholder before the Runtime catalogue
 * resolves. When the configured default is another Runtime, that new task must
 * replace the blank placeholder instead of producing two "New conversation"
 * tabs. Tabs with content or active work are always preserved.
 */
export function openNewTaskRunTransition(
  runs: ChatRun[],
  activeRunId: string,
  run: ChatRun,
): { activeRunId: string; runs: ChatRun[] } {
  const active = runs.find((item) => item.runId === activeRunId);
  if (active && isBlankTaskRun(active)) {
    return {
      activeRunId: run.runId,
      runs: runs.map((item) => (item.runId === activeRunId ? run : item)),
    };
  }

  return { activeRunId: run.runId, runs: [...runs, run] };
}

/**
 * Chrome-style tab cycling: the run `delta` steps away from the active one,
 * wrapping at both ends. Returns null when there is nothing to switch to.
 */
export function cycleRunId(
  runs: ChatRun[],
  activeRunId: string,
  delta: 1 | -1,
): string | null {
  if (runs.length < 2) return null;
  const idx = runs.findIndex((r) => r.runId === activeRunId);
  if (idx === -1) return runs[0].runId;
  return runs[(idx + delta + runs.length) % runs.length].runId;
}

/**
 * Chrome-style ordinal jump: Cmd/Ctrl+1..8 select the Nth tab, 9 selects the
 * last tab regardless of count. Returns null when the ordinal has no tab.
 */
export function runIdAtOrdinal(
  runs: ChatRun[],
  ordinal: number,
): string | null {
  if (runs.length === 0) return null;
  if (ordinal === 9) return runs[runs.length - 1].runId;
  const idx = ordinal - 1;
  return idx >= 0 && idx < runs.length ? runs[idx].runId : null;
}

/** The first live run already bound to a given gateway session id, if any. */
export function findRunBySession(
  runs: ChatRun[],
  sessionId: string,
): ChatRun | undefined {
  return runs.find(
    (r) => r.sessionId === sessionId || r.runtimeConversationId === sessionId,
  );
}

/** Resolve the collaboration metadata owned by a persisted conversation. */
export function findTaskCollaborationForConversation(
  records: TaskCollaborationRecord[],
  conversationId: string,
  messages: RuntimeConversationMessage[] = [],
): TaskCollaborationRecord | undefined {
  const direct =
    records.find((record) => record.conversationId === conversationId) ||
    records.find((record) => record.taskId === conversationId);
  if (direct) return direct;

  // Recover collaborations created during the narrow interval before the
  // conversation id was linked. Runtime run ids are unique, durable evidence
  // shared by the transcript and the collaboration execution record.
  const runtimeRunIds = new Set(
    messages
      .map((message) => message.execution?.runId)
      .filter((runId): runId is string => Boolean(runId)),
  );
  if (!runtimeRunIds.size) return undefined;
  return records.find((record) =>
    record.execution?.roleRuns.some(
      (roleRun) =>
        Boolean(roleRun.runtimeRunId) &&
        runtimeRunIds.has(roleRun.runtimeRunId as string),
    ),
  );
}

/** Session ids of every currently-loading run (for sidebar spinners). */
export function loadingSessionIds(runs: ChatRun[]): Set<string> {
  const ids = new Set<string>();
  for (const r of runs) {
    if (r.loading && r.sessionId) ids.add(r.sessionId);
    if (r.loading && r.runtimeConversationId) ids.add(r.runtimeConversationId);
  }
  return ids;
}
