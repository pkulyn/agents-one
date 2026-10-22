import { randomUUID } from "node:crypto";
import {
  assertMobileSchema,
  resolveMobileRoute,
  validateMobileBody,
  validateMobileMutationHeaders,
  validateMobileQuery,
} from "../../shared/mobile-control";
import type {
  AgentRuntimeRun,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import type { RuntimeConversationMessage } from "../../shared/runtime-conversations";
import { summarizeTaskOutput } from "../../shared/runtime-output";
import { publicPlatformText, type Json } from "./conversation-projection";
import type { OwnerControlRequest } from "./owner-tunnel";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import type { MobileArtifactRepository } from "./artifact-repository";
import type {
  ApprovedExecution,
  ExecutionCheckpoint,
  OwnerExecutionBackend,
  OwnerExecutionStore,
} from "./execution-types";

function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
const iso = (time: number): string => new Date(time).toISOString();
/** Accepted turns belong to Main; transport aborts never own their execution lifetime. */
export class MobileExecutionCoordinator {
  private readonly background = new Set<Promise<void>>();
  private stopped = false;
  constructor(
    private readonly store: OwnerExecutionStore,
    private readonly backend: OwnerExecutionBackend,
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly delay: () => Promise<void> = () =>
      new Promise((resolve) => setTimeout(resolve, 700)),
    private readonly now: () => number = Date.now,
    private readonly artifacts?: MobileArtifactRepository,
  ) {}
  private validate(
    request: OwnerControlRequest,
    action: string,
    scope = "conversation:advance",
  ): Json {
    if (this.stopped) fail("requires_owner_action", 503);
    if (
      request.signal.aborted ||
      request.device.revoked ||
      !Number.isFinite(Date.parse(request.device.expiresAt)) ||
      Date.parse(request.device.expiresAt) <= this.now()
    )
      fail("revoked", 403);
    if (
      request.device.ownerId !== this.ledger.ownerId ||
      request.device.spaceId !== this.ledger.spaceId ||
      request.params.ownerId !== this.ledger.ownerId ||
      request.params.spaceId !== this.ledger.spaceId ||
      !request.device.scopes.includes(scope)
    )
      fail("scope_denied", 403);
    const route = resolveMobileRoute(request.method, request.path);
    if (
      !route ||
      route.route.operationId !== action ||
      request.operationId !== action ||
      JSON.stringify(route.params) !== JSON.stringify(request.params)
    )
      fail("scope_denied", 403);
    if (route.route.body) validateMobileBody(route.route.body, request.body);
    validateMobileMutationHeaders(route.route, request.headers, request.body);
    validateMobileQuery(route.route, request.query);
    return request.body as Json;
  }
  private checkApproval(
    value: ApprovedExecution,
    runtimeId: string,
    projectId: string | undefined,
    policyId: string,
  ): void {
    const desktopTaskPolicy = policyId.startsWith("desktop-task-");
    const mode = value.task.mode;
    if (
      value.policyId !== policyId ||
      value.runtime.id !== runtimeId ||
      value.projectId !== projectId ||
      !(mode === "analysis" || mode === "safe_write" || mode === "full_access") ||
      value.task.workspaceId !== projectId ||
      (mode === "safe_write" && !projectId && !desktopTaskPolicy) ||
      (mode === "full_access" &&
        (!desktopTaskPolicy || value.task.fullAccessConfirmed !== true))
    )
      fail("unverified_policy", 403);
  }
  async createTurn(
    request: OwnerControlRequest,
  ): Promise<NonNullable<Awaited<ReturnType<MobileOwnerLedgerPort["operation"]>>>> {
    const input = this.validate(request, "createTurn");
    const replay = await this.ledger.operation(request);
    if (replay) return replay;
    const source = this.store.get(request.params.id);
    if (!source) fail("resource_not_found", 404);
    const revision = request.headers["if-match"].slice(1, -1);
    if ((source.revision ?? "1") !== revision) fail("revision_conflict");
    if (
      source.activeRuntimeRunId ||
      (await this.ledger
        .executionEntries())
        .some(
          (entry) =>
            entry.run.conversationId === source.id &&
            entry.phase !== "terminal",
        )
    )
      fail("run_active");
    if (source.messages.length && !source.runtimeSessionId)
      fail("requires_owner_action", 403);
    const projectId = this.store.projectId(source);
    if (source.workspace && !projectId) fail("project_binding_conflict");
    if (
      Object.hasOwn(input, "projectId") &&
      (input.projectId ?? undefined) !== projectId
    )
      fail("project_binding_conflict");
    const policyId = String(input.executionPolicyId);
    const approved = this.backend.authorize(
      policyId,
      source.runtimeId,
      projectId,
    );
    this.checkApproval(approved, source.runtimeId, projectId, policyId);
    const task: AgentRuntimeTaskInput = {
      mode: approved.task.mode,
      fullAccessConfirmed: approved.task.fullAccessConfirmed,
      workspaceId: approved.task.workspaceId,
      workspaceRef: approved.task.workspaceRef,
      timeoutMs: approved.task.timeoutMs,
      prompt: String(input.text),
      conversation: true,
      ...(source.runtimeSessionId
        ? { sessionId: source.runtimeSessionId }
        : {}),
    };
    const turnId = `turn-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      let nativeId = "";
      let originalSaved = false;
      let accepted = false;
      const work = (async () => {
        try {
          const native = await this.backend.start(source.runtimeId, task, {
            ...approved.dispatchOptions,
            persistBeforeDispatch: async (prepared) => {
              this.validate(request, "createTurn");
              if (prepared.runtimeId !== source.runtimeId)
                fail("reconciliation_required");
              // Recheck the Owner policy after Main validation and before writing acceptance.
              const current = this.backend.authorize(
                policyId,
                source.runtimeId,
                projectId,
              );
              this.checkApproval(
                current,
                source.runtimeId,
                projectId,
                policyId,
              );
              if (
                ["mode", "workspaceId", "workspaceRef", "timeoutMs"].some(
                  (key) =>
                    current.task[key as keyof typeof current.task] !==
                    approved.task[key as keyof typeof approved.task],
                )
              )
                fail("policy_revoked", 403);
              nativeId = prepared.id;
              const message: RuntimeConversationMessage = {
                id: `${prepared.id}-user`,
                role: "user",
                content: String(input.text),
                createdAt: prepared.startedAt,
                meta: {
                  audience: ["model", "user", "audit"],
                  origin: "user",
                  persistence: "durable",
                },
              };
              await this.ledger.stageExecution(request, {
                turnId,
                conversationId: source.id,
                runtimeId: source.runtimeId,
                runId: prepared.id,
                messageId: message.id,
                policyId,
                expectedRevision: revision,
                createdAt: prepared.startedAt,
              });
              this.store.begin(source.id, revision, prepared.id, message);
              originalSaved = true;
              await this.ledger.executionPrepared(prepared.id);
              accepted = true;
              resolve((await this.ledger.operation(request))!);
            },
          });
          if (
            !accepted ||
            native.id !== nativeId ||
            native.runtimeId !== source.runtimeId
          )
            fail("reconciliation_required");
          await this.observe(nativeId, native, true);
          if (
            source.runtimeSessionId &&
            native.sessionId &&
            native.sessionId !== source.runtimeSessionId
          )
            fail("reconciliation_required");
          let current: AgentRuntimeRun | null = native;
          while (!this.stopped) {
            if (current && current.status !== "running") {
              let checkpoint: ExecutionCheckpoint | undefined;
              while (!this.stopped) {
                try {
                  checkpoint ??= await this.checkpoint(
                    current,
                    request.requestId,
                  );
                  if (this.stopped) return;
                  await this.ledger.stageExecutionFinal(nativeId, checkpoint);
                  await this.flushFinal(nativeId);
                  return;
                } catch (error) {
                  const code = (error as { code?: string }).code;
                  if (
                    code === "reconciliation_required" ||
                    code === "resource_not_found"
                  ) {
                    await this.ledger.executionUncertain(nativeId);
                    return;
                  }
                  // Keep this actual final reply until durable storage succeeds; never dispatch again.
                  await this.delay();
                }
              }
              return;
            }
            await this.delay();
            if (this.stopped) return;
            try {
              current = await this.backend.get(nativeId);
            } catch {
              continue;
            } // Observation failure is not a terminal outcome.
            if (!current) {
              await this.ledger.executionUncertain(nativeId);
              return;
            }
            await this.observe(nativeId, current);
            if (
              source.runtimeSessionId &&
              current.sessionId &&
              current.sessionId !== source.runtimeSessionId
            )
              fail("reconciliation_required");
          }
        } catch (error) {
          if (nativeId && (await this.ledger.execution(nativeId))) {
            try {
              if (originalSaved) await this.ledger.executionUncertain(nativeId);
              else
                await this.ledger.executionRejected(
                  nativeId,
                  error as { code?: string },
                );
            } catch {
              /* Retain unresolved durable intent when storage itself is unavailable. */
            }
          }
          if (!accepted) reject(error);
        }
      })();
      this.background.add(work);
      void work.finally(() => this.background.delete(work));
    });
  }
  private async observe(
    id: string,
    native: AgentRuntimeRun,
    dispatched = false,
  ): Promise<void> {
    while (!this.stopped) {
      try {
        await this.ledger.executionObserved(id, native, dispatched);
        return;
      } catch (error) {
        if ((error as { code?: string }).code === "reconciliation_required")
          throw error;
        await this.delay();
      }
    }
  }
  private async checkpoint(
    native: AgentRuntimeRun,
    requestId: string,
  ): Promise<ExecutionCheckpoint> {
    const entry = await this.ledger.execution(native.id);
    if (!entry) fail("resource_not_found", 404);
    const summary = summarizeTaskOutput(native.output ?? "");
    const final =
      summary.finalText ||
      (!summary.hasStructuredEvents ? native.output?.trim() : "");
    const hasReply = Boolean(final);
    const body = hasReply
      ? final!
      : native.status === "succeeded"
        ? "任务已完成，但 Runtime 未返回正文。"
        : publicPlatformText(
            native.error?.trim() || `任务未成功完成（${native.status}）。`,
          );
    const message: RuntimeConversationMessage = {
      id: `${native.id}-result`,
      role: hasReply ? "agent" : "system",
      content: body,
      createdAt: native.completedAt ?? this.now(),
      meta: {
        audience: ["model", "user", "audit"],
        origin: hasReply ? "runtime" : "platform",
        persistence: "durable",
      },
      execution: {
        runId: native.id,
        events: native.events ?? [],
        startedAt: native.startedAt,
        completedAt: native.completedAt,
        ...(native.artifacts?.length ? { artifacts: native.artifacts } : {}),
        ...(native.actualModel ? { actualModel: native.actualModel } : {}),
        ...(native.model ? { model: native.model } : {}),
        ...(native.usage ? { usage: native.usage } : {}),
        ...(native.isolation ? { isolation: native.isolation } : {}),
      },
    };
    const terminalRun: Json = {
      ...entry.run,
      status: native.status,
      startedAt: iso(native.startedAt),
      completedAt: iso(native.completedAt ?? this.now()),
      allowedActions: ["read"],
      artifacts: this.artifacts
        ? await this.artifacts.capture(native, String(entry.run.conversationId))
        : entry.run.artifacts,
      error: native.error
        ? {
            code: "requires_owner_action",
            message: "requires_owner_action",
            requestId,
            retryable: false,
          }
        : null,
    };
    assertMobileSchema("Run", terminalRun);
    return {
      message,
      ...(native.sessionId ? { sessionId: native.sessionId } : {}),
      terminalRun,
    };
  }
  private async flushFinal(runId: string): Promise<void> {
    const entry = await this.ledger.execution(runId);
    if (!entry?.checkpoint) return;
    this.store.finish(
      String(entry.run.conversationId),
      runId,
      entry.checkpoint,
    );
    await this.ledger.executionFinalCommitted(runId);
  }
  /** Restart recovery replays only proven final-message commits, never an external task. */
  async retryPendingFinals(): Promise<void> {
    const failures: unknown[] = [];
    for (const entry of await this.ledger.executionEntries())
      if (entry.checkpoint) {
        try {
          await this.flushFinal(String(entry.run.runId));
        } catch (error) {
          failures.push(error);
        }
      }
    if (failures.length)
      throw new AggregateError(failures, "pending_final_commits");
  }
  async getRun(request: OwnerControlRequest): Promise<Json> {
    this.validate(request, "getRun", "conversation:read");
    const entry = await this.ledger.execution(request.params.id);
    if (!entry || !this.store.get(String(entry.run.conversationId)))
      fail("resource_not_found", 404);
    return {
      ...entry.run,
      allowedActions:
        request.device.scopes.includes("conversation:advance") &&
        ["dispatching", "running"].includes(entry.phase)
          ? ["read", "cancel"]
          : ["read"],
    };
  }
  async cancelRun(
    request: OwnerControlRequest,
  ): Promise<NonNullable<Awaited<ReturnType<MobileOwnerLedgerPort["operation"]>>>> {
    this.validate(request, "cancelRun");
    const replay = await this.ledger.operation(request);
    if (replay) return replay;
    const entry = await this.ledger.execution(request.params.id);
    if (!entry || !this.store.get(String(entry.run.conversationId)))
      fail("resource_not_found", 404);
    if (entry.phase === "reconciliation_required")
      fail("reconciliation_required");
    await this.ledger.accept(request, { type: "run", id: request.params.id });
    let cancellationAttempted = false;
    let acknowledgementReceived = false;
    try {
      if (!["terminal", "persisting"].includes(entry.phase)) {
        cancellationAttempted = true;
        const result = await this.backend.cancel(request.params.id);
        acknowledgementReceived = Boolean(result.run) && !result.uncertain;
        if (result.uncertain) fail("reconciliation_required");
        if (!result.accepted)
          fail(
            result.run ? "requires_owner_action" : "reconciliation_required",
          );
        await this.ledger.executionCancelling(request.params.id);
      }
      return await this.ledger.complete(request, {
        runId: request.params.id,
        conversationId: String(entry.run.conversationId),
      });
    } catch (error) {
      if (cancellationAttempted && !acknowledgementReceived)
        await this.ledger.uncertain(request);
      else await this.ledger.reject(request, error as { code?: string });
      throw error;
    }
  }
  async waitForIdle(): Promise<void> {
    await Promise.all([...this.background]);
  }
  /** Application teardown only; disabling a transport must keep accepted task observers alive. */
  dispose(): void {
    this.stopped = true;
  }
}
