import type {
  TaskSchedule,
  TaskScheduleRun,
} from "../../shared/task-schedules";
import { assertMobileSchema } from "../../shared/mobile-control";
import { listFullTaskSchedules, previewTaskSchedule } from "../task-schedules";
import { publicPlatformText, type Json } from "./conversation-projection";

export interface MobileScheduleReadRepository {
  list(): Json[];
  get(id: string): Json;
  executions(id: string): Json[];
  preview(
    expression: string,
    now: number,
  ): ReturnType<typeof previewTaskSchedule>;
}

function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
const iso = (value: number): string => {
  if (!Number.isFinite(value) || Math.abs(value) > 8.64e15)
    fail("requires_owner_action");
  return new Date(value).toISOString();
};

/** Whitelist projection. Reading a schedule never authorizes its execution. */
export class DesktopMobileScheduleReadRepository implements MobileScheduleReadRepository {
  constructor(
    private readonly profile: string,
    private readonly read: (profile: string) => TaskSchedule[] = (profile) =>
      listFullTaskSchedules(profile, true),
    private readonly timeZone: () => string = () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  ) {
    if (!profile.trim()) fail("requires_owner_action");
  }
  private sources(): TaskSchedule[] {
    const rows = this.read(this.profile);
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      fail("requires_owner_action");
    return rows;
  }
  private source(id: string): TaskSchedule {
    const row = this.sources().find((value) => value.id === id);
    if (!row) fail("resource_not_found", 404);
    return row;
  }
  private project(row: TaskSchedule, detail: boolean): Json {
    const result: Json = {
      id: row.id,
      name: row.name,
      runtimeId: row.runtimeId,
      projectId: row.workspaceId ?? null,
      executionPolicyId: row.mobileExecutionPolicyId ?? null,
      scheduleExpression: row.schedule,
      schedulerTimeZone: this.timeZone(),
      enabled: row.enabled,
      effectiveState: row.mobileRecoveryRequired
        ? "blocked"
        : row.activeRuntimeRunId
          ? "running"
          : row.enabled
            ? "enabled"
            : "paused",
      concurrencyPolicy: row.concurrencyPolicy,
      timeoutMs: row.timeoutMs,
      nextRunAt: row.nextRunAt === undefined ? null : iso(row.nextRunAt),
      recentExecution: { execution: this.latestExecution(row) },
      activeRunIds: row.activeRuntimeRunId ? [row.activeRuntimeRunId] : [],
      pendingCount: row.pendingRuns,
      revision: row.revision ?? "1",
      allowedActions: ["read"],
      restrictionReason: row.mobileRecoveryRequired
        ? "unknown_state"
        : "requires_owner_action",
      ...(detail ? { prompt: row.prompt } : {}),
    };
    try {
      assertMobileSchema(detail ? "Schedule" : "ScheduleSummary", result);
    } catch {
      fail("requires_owner_action");
    }
    return result;
  }
  list(): Json[] {
    return this.sources().map((row) => this.project(row, false));
  }
  get(id: string): Json {
    return this.project(this.source(id), true);
  }
  preview(
    expression: string,
    now: number,
  ): ReturnType<typeof previewTaskSchedule> {
    const result = previewTaskSchedule(expression, now);
    if (result.schedulerTimeZone !== this.timeZone())
      fail("requires_owner_action");
    return result;
  }
  executions(id: string): Json[] {
    const runs = this.source(id).runs;
    if (new Set(runs.map((run) => run.id)).size !== runs.length)
      fail("requires_owner_action");
    return runs
      .map((run) => this.projectExecution(id, run))
      .sort(
        (a, b) =>
          String(b.triggeredAt).localeCompare(String(a.triggeredAt)) ||
          String(a.id).localeCompare(String(b.id)),
      );
  }
  private latestExecution(row: TaskSchedule): Json | null {
    if (new Set(row.runs.map((run) => run.id)).size !== row.runs.length)
      fail("requires_owner_action");
    let latest: TaskScheduleRun | undefined;
    for (const run of row.runs) {
      iso(run.triggeredAt);
      if (
        !latest ||
        run.triggeredAt > latest.triggeredAt ||
        (run.triggeredAt === latest.triggeredAt &&
          run.id.localeCompare(latest.id) < 0)
      )
        latest = run;
    }
    return latest ? this.projectExecution(row.id, latest) : null;
  }
  private projectExecution(id: string, run: TaskScheduleRun): Json {
    const result: Json = {
      id: run.id,
      scheduleId: id,
      trigger: run.trigger,
      triggeredAt: iso(run.triggeredAt),
      status: run.status,
      ...(run.dueAt === undefined ? {} : { dueAt: iso(run.dueAt) }),
      ...(run.runtimeRunId ? { runtimeRunId: run.runtimeRunId } : {}),
      ...(run.conversationId ? { conversationId: run.conversationId } : {}),
      ...(run.completedAt === undefined
        ? {}
        : { completedAt: iso(run.completedAt) }),
      ...(typeof run.summary === "string"
        ? { summary: publicPlatformText(run.summary).slice(0, 1000) }
        : {}),
    };
    try {
      assertMobileSchema("ScheduleExecution", result);
    } catch {
      fail("requires_owner_action");
    }
    return result;
  }
}
