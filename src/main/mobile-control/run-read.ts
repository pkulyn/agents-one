import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import type { RuntimeConversation } from "../../shared/runtime-conversations";
import type { TaskSchedule } from "../../shared/task-schedules";
import { assertMobileSchema } from "../../shared/mobile-control";
import {
  projectRuntimeConversation,
  type Json,
  type SourceConversation,
} from "./conversation-projection";
import type {
  ArtifactOriginalRun,
  MobileArtifactRepository,
} from "./artifact-repository";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import { projectMobileRunActivity } from "./run-activity";

function fail(): never {
  throw Object.assign(Error("requires_owner_action"), {
    code: "requires_owner_action",
    status: 409,
  });
}
/** Original visible history establishes identities, including inherited records in explicit branches. */
export function originalRunReferences(
  rows: SourceConversation[],
): ArtifactOriginalRun[] {
  const candidates = new Map<
    string,
    Array<
      ArtifactOriginalRun & { row: SourceConversation; messages: Set<string> }
    >
  >();
  for (const row of rows) {
    if (row.sourceKind !== "runtime_conversation") continue;
    const local = new Map<
      string,
      { runtimeId: string; messages: Set<string> }
    >();
    for (const id of row.activeRunIds)
      local.set(id, { runtimeId: row.runtimeId, messages: new Set() });
    for (const message of row.messages)
      if (message.runId) {
        const runtimeId = message.runtimeId ?? row.runtimeId,
          previous = local.get(message.runId);
        if (previous && previous.runtimeId !== runtimeId) fail();
        const reference = previous ?? {
          runtimeId,
          messages: new Set<string>(),
        };
        reference.messages.add(message.id);
        local.set(message.runId, reference);
      }
    for (const [runId, reference] of local) {
      const list = candidates.get(runId) ?? [];
      list.push({
        runId,
        runtimeId: reference.runtimeId,
        conversationId: row.id,
        row,
        messages: reference.messages,
      });
      candidates.set(runId, list);
    }
  }
  return [...candidates.values()].map((list) => {
    if (new Set(list.map((item) => item.runtimeId)).size !== 1) fail();
    const roots = list.filter(
      (item) =>
        !list.some(
          (parent) => parent.conversationId === item.row.parentConversationId,
        ),
    );
    if (roots.length !== 1) fail();
    const root = roots[0];
    for (const item of list) {
      let child = item;
      const seen = new Set<string>();
      while (child !== root) {
        if (seen.has(child.conversationId)) fail();
        seen.add(child.conversationId);
        const parent = list.find(
          (candidate) =>
            candidate.conversationId === child.row.parentConversationId,
        );
        if (
          !parent ||
          ![...child.messages].some((id) => parent.messages.has(id))
        )
          fail();
        child = parent;
      }
    }
    return {
      runId: root.runId,
      runtimeId: root.runtimeId,
      conversationId: root.conversationId,
    };
  });
}
export interface MobileRunReadRepository {
  sync(): Promise<void>;
  list(): Json[];
  get(id: string): Json | undefined;
}
export interface OriginalRunReadSource {
  conversations(): RuntimeConversation[];
  schedules(): TaskSchedule[];
  native(id: string): Promise<AgentRuntimeRun | null>;
  guard(): void;
}
const terminal = ["succeeded", "failed", "cancelled", "timed_out"];
function time(value: number | undefined): string | null {
  if (value === undefined) return null;
  if (!Number.isFinite(value) || Math.abs(value) > 8640000000000000) fail();
  return new Date(value).toISOString();
}
/** Read-only original runs use native/history evidence; a normal reply never proves success. */
export class OriginalMobileRunRepository implements MobileRunReadRepository {
  private rows = new Map<string, Json>();
  private managedRunIds = new Set<string>();
  private refreshing?: Promise<void>;
  constructor(
    private readonly source: OriginalRunReadSource,
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly artifacts?: MobileArtifactRepository,
    private readonly controlAvailable: () => boolean = () => false,
  ) {}
  sync(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const work = this.refresh();
    this.refreshing = work;
    void work
      .finally(() => {
        if (this.refreshing === work) this.refreshing = undefined;
      })
      .catch(() => {});
    return work;
  }
  private async refresh(): Promise<void> {
    this.source.guard();
    const conversations = this.source.conversations(),
      visible = conversations.map((row) => projectRuntimeConversation(row));
    const schedules = this.source.schedules();
    const managedRunIds = new Set(
      (await this.ledger.executionEntries()).map((entry) =>
        String(entry.run.runId),
      ),
    );
    const next = new Map<string, Json>();
    for (const reference of originalRunReferences(visible)) {
      if (managedRunIds.has(reference.runId)) continue;
      this.source.guard();
      const native = await this.source.native(reference.runId);
      this.source.guard();
      if (
        native &&
        (native.id !== reference.runId ||
          native.runtimeId !== reference.runtimeId)
      )
        fail();
      const row = conversations.find(
        (item) => item.id === reference.conversationId,
      )!;
      const visibleIds = new Set(
        visible
          .find((item) => item.id === row.id)!
          .messages.map((message) => message.id),
      );
      const executions = row.messages.filter(
        (message) =>
          visibleIds.has(message.id) &&
          message.role !== "user" &&
          message.execution?.runId === reference.runId,
      );
      const execution = executions.at(-1)?.execution;
      // Main may append artifact publication after its terminal marker. An intermediate
      // error followed by progress is not terminal evidence.
      const lastTerminal = execution?.events
        ?.filter((event) => event.type !== "artifact_published")
        .at(-1);
      const historyStatus =
        lastTerminal?.type === "completed"
          ? "succeeded"
          : lastTerminal?.type === "cancelled"
            ? "cancelled"
            : lastTerminal?.type === "timed_out"
              ? "timed_out"
              : lastTerminal?.type === "error" && executions.length
                ? "failed"
                : undefined;
      const scheduleRuns = schedules.flatMap((schedule) =>
        schedule.runtimeId === reference.runtimeId
          ? schedule.runs.filter(
              (run) =>
                run.runtimeRunId === reference.runId &&
                run.conversationId === reference.conversationId,
            )
          : [],
      );
      if (scheduleRuns.length > 1) fail();
      const scheduled = scheduleRuns[0],
        scheduleStatus =
          scheduled && terminal.includes(scheduled.status)
            ? scheduled.status
            : undefined;
      if (
        !native &&
        historyStatus &&
        scheduleStatus &&
        historyStatus !== scheduleStatus
      )
        fail();
      const status = native
        ? native.userActionRequired && native.status === "running"
          ? "review_required"
          : native.status
        : (scheduleStatus ?? historyStatus ?? "reconciliation_required");
      const value: Json = {
        ...reference,
        status,
        startedAt: time(native?.startedAt ?? execution?.startedAt),
        completedAt: time(
          native?.status === "running"
            ? undefined
            : (native?.completedAt ??
                scheduled?.completedAt ??
                execution?.completedAt),
        ),
        error:
          status === "reconciliation_required"
            ? {
                code: "reconciliation_required",
                message: "reconciliation_required",
                requestId: "original-run-read",
                retryable: false,
              }
            : null,
        artifacts: (await this.artifacts?.list(reference.runId)) ?? [],
        activity: projectMobileRunActivity(native?.events ?? execution?.events),
        allowedActions:
          native?.status === "running" && this.controlAvailable()
            ? ["read", "cancel"]
            : ["read"],
        lastRunEventSeq: "0",
      };
      assertMobileSchema("Run", value);
      const { lastRunEventSeq: _sequence, ...observed } = value;
      void _sequence;
      value.lastRunEventSeq = await this.ledger.observeReadonlySource(
        JSON.stringify(["original-run", reference.runId]),
        observed,
      );
      next.set(reference.runId, value);
    }
    this.source.guard();
    this.rows = next;
    this.managedRunIds = managedRunIds;
  }
  list(): Json[] {
    this.source.guard();
    const current = new Map(
      originalRunReferences(
        this.source
          .conversations()
          .map((row) => projectRuntimeConversation(row)),
      ).map((row) => [row.runId, row]),
    );
    return [...this.rows.values()]
      .filter((row) => {
        const reference = current.get(String(row.runId));
        return (
          !this.managedRunIds.has(String(row.runId)) &&
          reference !== undefined &&
          reference.runtimeId === row.runtimeId &&
          reference.conversationId === row.conversationId
        );
      })
      .map((row) => structuredClone(row));
  }
  get(id: string): Json | undefined {
    return this.list().find((row) => row.runId === id);
  }
}
