import {
  controlMobileTaskSchedule,
  writeMobileTaskSchedule,
  cancelMobileTaskScheduleRun,
  TaskScheduleCancellationRejectedError,
  type MobileTaskScheduleControl,
} from "../task-schedules";
import { getActiveProfileNameSync, agentsOneProfileHome } from "../utils";
import { isAgentsOneRestoreWriteLocked } from "../restore-write-lock";
import { isMobileConnectionChanging } from "../mobile-connection";
import type { OwnerControlRequest } from "./owner-tunnel";
import type { Json } from "./conversation-projection";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import { DesktopMobileScheduleReadRepository } from "./schedule-read";
import { validateMobileSchedulePreview } from "./schedule-preview";
import type { MobileScheduleAuthority } from "./schedule-execution";
import { assertMobileSchema } from "../../shared/mobile-control";

export interface MobileScheduleControl {
  actions(schedule: Json): string[];
  handle(request: OwnerControlRequest): Promise<unknown>;
  cancelRun?(request: OwnerControlRequest): Promise<unknown>;
  triggerAvailable?(): boolean;
}
function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
/** Original schedule transactions with Owner authority for all execution-related writes. */
export class DesktopMobileScheduleControl implements MobileScheduleControl {
  private readonly home: string;
  private queue = Promise.resolve();
  constructor(
    private readonly profile: string,
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly authority?: MobileScheduleAuthority,
    private readonly now: () => number = Date.now,
  ) {
    this.home = agentsOneProfileHome(profile);
  }
  actions(schedule: Json): string[] {
    let executable = false;
    if (
      this.authority &&
      schedule.executionPolicyId &&
      schedule.restrictionReason !== "unknown_state"
    ) {
      try {
        this.authority.authorize(schedule);
        executable = true;
      } catch {
        /* Restricted plans remain readable and pausable. */
      }
    }
    return [
      "pause",
      ...((schedule.activeRunIds as unknown[]).length ? ["cancel"] : []),
      ...(this.authority?.available() &&
      !(schedule.activeRunIds as unknown[]).length
        ? ["edit"]
        : []),
      ...(executable
        ? ["trigger", ...(!schedule.enabled ? ["resume"] : [])]
        : []),
      ...(!schedule.enabled ? ["discard_pending"] : []),
      ...(!schedule.enabled &&
      !(schedule.activeRunIds as unknown[]).length &&
      !schedule.pendingCount
        ? ["delete"]
        : []),
    ];
  }
  triggerAvailable(): boolean {
    return this.authority?.available() ?? false;
  }
  private guard(request: OwnerControlRequest): void {
    if (
      request.signal.aborted ||
      request.device.revoked ||
      !Number.isFinite(Date.parse(request.device.expiresAt)) ||
      Date.parse(request.device.expiresAt) <= Date.now()
    )
      fail("revoked", 403);
    if (
      !request.device.scopes.includes(
        request.operationId === "cancelRun"
          ? "schedule:cancel"
          : request.operationId === "triggerSchedule"
            ? "schedule:trigger"
            : "schedule:manage",
      ) ||
      request.device.ownerId !== this.ledger.ownerId ||
      request.device.spaceId !== this.ledger.spaceId
    )
      fail("scope_denied", 403);
    if (
      getActiveProfileNameSync() !== this.profile ||
      agentsOneProfileHome(this.profile) !== this.home
    )
      fail("profile_inactive", 403);
    if (isAgentsOneRestoreWriteLocked() || isMobileConnectionChanging())
      fail("owner_unavailable", 503);
  }
  handle(request: OwnerControlRequest): Promise<unknown> {
    const result = this.queue.then(() => this.apply(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  cancelRun(request: OwnerControlRequest): Promise<unknown> {
    if (request.operationId !== "cancelRun")
      return Promise.reject(
        Object.assign(Error("invalid_input"), {
          code: "invalid_input",
          status: 422,
        }),
      );
    const result = this.queue.then(() => this.cancel(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async cancel(request: OwnerControlRequest): Promise<unknown> {
    this.guard(request);
    assertMobileSchema("ActionInput", request.body);
    const replay = await this.ledger.operation(request);
    if (replay) return replay;
    let accepted = false;
    try {
      const result = await cancelMobileTaskScheduleRun(
        request.params.id,
        this.profile,
        () => this.guard(request),
        async () => {
          await this.ledger.accept(request, {
            type: "run",
            id: request.params.id,
          });
          accepted = true;
        },
      );
      return await this.ledger.complete(request, result);
    } catch (error) {
      if (accepted) {
        const knownRejection =
          error instanceof TaskScheduleCancellationRejectedError;
        try {
          if (knownRejection)
            await this.ledger.reject(request, error as { code?: string });
          else await this.ledger.uncertain(request);
        } catch {
          /* Original accepted intent is retained for reconciliation. */
        }
        if (!knownRejection) fail("reconciliation_required");
      }
      throw error;
    }
  }
  private async apply(request: OwnerControlRequest): Promise<unknown> {
    this.guard(request);
    const replay = await this.ledger.operation(request);
    if (replay) return replay;
    if (
      !this.authority &&
      (request.operationId === "resumeSchedule" ||
        request.operationId === "triggerSchedule")
    )
      fail("requires_owner_action", 403);
    if (
      request.operationId === "createSchedule" ||
      request.operationId === "patchSchedule"
    )
      return this.write(request);
    const action: MobileTaskScheduleControl =
      request.operationId === "pauseSchedule"
        ? "pause"
        : request.operationId === "discard_pendingSchedule"
          ? "discard-pending"
          : request.operationId === "deleteSchedule"
            ? "delete"
            : request.operationId === "resumeSchedule"
              ? "resume"
              : request.operationId === "triggerSchedule"
                ? "trigger"
                : fail("requires_owner_action", 403);
    const revision = request.headers["if-match"]?.match(
      /^"(0|[1-9][0-9]{0,63})"$/,
    )?.[1];
    if (!revision) fail("revision_required", 428);
    let accepted = false;
    try {
      const result = await controlMobileTaskSchedule(
        request.params.id,
        action,
        this.profile,
        revision,
        () => this.guard(request),
        async () => {
          await this.ledger.accept(request, {
            type: "schedule",
            id: request.params.id,
          });
          accepted = true;
        },
        (schedule) => {
          if (
            !this.authority ||
            !schedule.mobileExecutionPolicyId ||
            schedule.workspace
          )
            fail("unverified_policy", 403);
          const mode = this.authority.authorize({
            executionPolicyId: schedule.mobileExecutionPolicyId,
            runtimeId: schedule.runtimeId,
            projectId: schedule.workspaceId ?? null,
          });
          if (mode !== schedule.mode) fail("unverified_policy", 403);
        },
      );
      return await this.ledger.complete(request, result);
    } catch (error) {
      if (accepted) {
        try {
          await this.ledger.uncertain(request);
        } catch {
          /* Original durable intent remains for reconciliation. */
        }
        fail("reconciliation_required");
      }
      throw error;
    }
  }
  private async write(request: OwnerControlRequest): Promise<unknown> {
    if (!this.authority) fail("requires_owner_action", 403);
    const create = request.operationId === "createSchedule";
    assertMobileSchema(
      create ? "CreateScheduleInput" : "PatchScheduleInput",
      request.body,
    );
    const revision = request.headers["if-match"]?.match(
      /^"(0|[1-9][0-9]{0,63})"$/,
    )?.[1];
    if (!create && !revision) fail("revision_required", 428);
    let accepted = false;
    let draft: Json | undefined;
    const authorize = (): "analysis" | "auto" => {
      this.guard(request);
      if (!draft) fail("invalid_input", 422);
      return this.authority!.authorize(draft);
    };
    try {
      const result = await writeMobileTaskSchedule(
        create ? "create" : "edit",
        create ? undefined : request.params.id,
        this.profile,
        revision,
        async (original) => {
          const body = request.body as Json;
          const effective = create
            ? body
            : {
                name: original!.name,
                prompt: original!.prompt,
                runtimeId: original!.runtimeId,
                projectId: original!.workspaceId ?? null,
                executionPolicyId: original!.mobileExecutionPolicyId,
                scheduleExpression: original!.schedule,
                timeoutMs: original!.timeoutMs,
                concurrencyPolicy: original!.concurrencyPolicy,
                ...body,
              };
          draft = await validateMobileSchedulePreview(
            effective,
            request,
            this.ledger,
            new DesktopMobileScheduleReadRepository(this.profile),
            this.now(),
          );
          const mode = authorize();
          return {
            policyId: String(draft.executionPolicyId),
            input: {
              name: String(draft.name),
              prompt: String(draft.prompt),
              runtimeId: String(draft.runtimeId),
              schedule: String(draft.scheduleExpression),
              mode,
              ...(draft.projectId == null
                ? {}
                : { workspaceId: String(draft.projectId) }),
              ...(draft.timeoutMs === undefined
                ? {}
                : { timeoutMs: Number(draft.timeoutMs) }),
              ...(draft.concurrencyPolicy === undefined
                ? {}
                : {
                    concurrencyPolicy: draft.concurrencyPolicy as
                      | "skip"
                      | "queue"
                      | "replace",
                  }),
            },
          };
        },
        () => {
          this.guard(request);
          if (draft) authorize();
        },
        async (id) => {
          await this.ledger.accept(request, { type: "schedule", id });
          accepted = true;
        },
      );
      return await this.ledger.complete(request, result);
    } catch (error) {
      if (accepted) {
        try {
          await this.ledger.uncertain(request);
        } catch {
          /* Original accepted intent remains. */
        }
        fail("reconciliation_required");
      }
      throw error;
    }
  }
}
