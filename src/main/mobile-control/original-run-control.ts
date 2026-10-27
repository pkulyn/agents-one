import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import {
  assertMobileSchema,
  resolveMobileRoute,
  validateMobileMutationHeaders,
  validateMobileQuery,
} from "../../shared/mobile-control";
import type { OwnerControlRequest } from "./owner-tunnel";
import type { MobileRunReadRepository } from "./run-read";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";

export interface OriginalRunControlSource {
  guard(): void;
  scheduled(id: string): boolean;
  native(id: string): Promise<AgentRuntimeRun | null>;
  cancel(id: string): Promise<{
    accepted: boolean;
    run: AgentRuntimeRun | null;
    uncertain?: boolean;
  }>;
}
function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
/** Control the existing Main Run; acknowledgement never invents an execution outcome. */
export class OriginalMobileRunControl {
  private queue = Promise.resolve();
  constructor(
    private readonly reader: MobileRunReadRepository,
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly source: OriginalRunControlSource,
  ) {}
  scope(id: string): "conversation:advance" | "schedule:cancel" | undefined {
    this.source.guard();
    if (this.source.scheduled(id)) return "schedule:cancel";
    return this.reader.get(id) ? "conversation:advance" : undefined;
  }
  cancel(request: OwnerControlRequest): Promise<unknown> {
    const result = this.queue.then(() => this.apply(request));
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private guard(request: OwnerControlRequest): void {
    this.source.guard();
    if (
      request.signal.aborted ||
      request.device.revoked ||
      !Number.isFinite(Date.parse(request.device.expiresAt)) ||
      Date.parse(request.device.expiresAt) <= Date.now()
    )
      fail("revoked", 403);
    if (
      request.device.ownerId !== this.ledger.ownerId ||
      request.device.spaceId !== this.ledger.spaceId ||
      request.params.ownerId !== this.ledger.ownerId ||
      request.params.spaceId !== this.ledger.spaceId ||
      !request.device.scopes.includes("conversation:advance")
    )
      fail("scope_denied", 403);
    const route = resolveMobileRoute(request.method, request.path);
    if (
      !route ||
      route.route.operationId !== "cancelRun" ||
      request.operationId !== "cancelRun" ||
      JSON.stringify(route.params) !== JSON.stringify(request.params)
    )
      fail("scope_denied", 403);
    validateMobileMutationHeaders(route.route, request.headers, request.body);
    validateMobileQuery(route.route, request.query);
    if (this.source.scheduled(request.params.id)) fail("scope_denied", 403);
  }
  private async apply(request: OwnerControlRequest): Promise<unknown> {
    this.guard(request);
    assertMobileSchema("ActionInput", request.body);
    const run = this.reader.get(request.params.id);
    if (!run) fail("resource_not_found", 404);
    const replay = await this.ledger.operation(request);
    if (replay) return replay;
    const native = await this.source.native(request.params.id);
    this.guard(request);
    const current = this.reader.get(request.params.id);
    if (
      !current ||
      current.conversationId !== run.conversationId ||
      current.runtimeId !== run.runtimeId
    )
      fail("requires_owner_action");
    if (
      native &&
      (native.id !== request.params.id || native.runtimeId !== run.runtimeId)
    )
      fail("requires_owner_action");
    if (
      !native &&
      !["succeeded", "failed", "cancelled", "timed_out"].includes(
        String(run.status),
      )
    )
      fail("reconciliation_required");
    await this.ledger.accept(request, { type: "run", id: request.params.id });
    let attempted = false,
      knownRejected = false;
    try {
      if (native?.status === "running") {
        this.guard(request);
        attempted = true;
        const result = await this.source.cancel(request.params.id);
        this.source.guard();
        if (
          !result.run ||
          result.uncertain ||
          result.run.id !== request.params.id ||
          result.run.runtimeId !== run.runtimeId
        )
          fail("reconciliation_required");
        if (!result.accepted) {
          knownRejected = true;
          fail("requires_owner_action");
        }
      }
      return await this.ledger.complete(request, {
        runId: request.params.id,
        conversationId: run.conversationId,
      });
    } catch (error) {
      try {
        if (knownRejected || !attempted)
          await this.ledger.reject(request, error as { code?: string });
        else await this.ledger.uncertain(request);
      } catch {
        /* Keep the accepted record if persistence cannot complete. */
      }
      if (attempted && !knownRejected) fail("reconciliation_required");
      throw error;
    }
  }
}
