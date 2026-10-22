import type { OwnerControlRequest } from "./owner-tunnel";
import type { Json } from "./conversation-projection";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";

function fail(code: string, status: number): never {
  throw Object.assign(Error(code), { code, status });
}
function active(request: OwnerControlRequest): void {
  if (request.signal.aborted) fail("revoked", 403);
  grantActive(request);
}
function grantActive(request: OwnerControlRequest): void {
  if (
    request.device.revoked ||
    !Number.isFinite(Date.parse(request.device.expiresAt)) ||
    Date.parse(request.device.expiresAt) <= Date.now()
  )
    fail("revoked", 403);
}
async function pause(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, 1000);
    timer.unref();
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Replay only authorized public events; reconnect never submits a business operation. */
export class MobileOwnerEventStream {
  constructor(
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly observe?: () => void,
    private readonly refresh?: () => Promise<void>,
    private readonly projectRun?: (run: Json) => Json | Promise<Json>,
  ) {}
  private async sequence(request: OwnerControlRequest): Promise<string> {
    const last = request.headers["last-event-id"];
    if (last !== undefined) {
      const prefix = `${this.ledger.dataEpoch}:`;
      if (
        !last.startsWith(prefix) ||
        !/^(0|[1-9][0-9]{0,63})$/.test(last.slice(prefix.length))
      )
        fail("cursor_expired", 410);
      return last.slice(prefix.length);
    }
    if (request.query.cursor)
      return String(
        (await this.ledger.parseCursor(
          request.query.cursor,
          request.device.deviceId,
          request.device.grantRevision,
        )).changeSeq,
      );
    return this.ledger.changeSeq;
  }
  private async project(
    event: Json,
    request: OwnerControlRequest,
  ): Promise<Json | undefined> {
    const scopes = request.device.scopes;
    const type = String(event.type);
    const needed =
      type === "resource.deleted"
        ? ["schedule", "schedule_execution"].includes(
            String((event.payload as Json).kind),
          )
          ? "schedule:read"
          : "conversation:read"
        : type.startsWith("conversation.") ||
            type === "message.upsert" ||
            type === "run.updated"
          ? "conversation:read"
          : type.startsWith("schedule.")
            ? "schedule:read"
            : type === "artifact.created"
              ? "artifact:read"
              : undefined;
    if (needed && !scopes.includes(needed)) return;
    const payload = structuredClone(event.payload) as Json;
    if (type === "message.upsert")
      await this.ledger.delivered(
        request.device.deviceId,
        String(payload.conversationId),
        [String(payload.messageSeq)],
      );
    if (
      type === "permission.changed" &&
      payload.deviceId !== request.device.deviceId
    )
      return;
    if (type === "conversation.updated") {
      payload.lastReadMessageSeq = await this.ledger.readPosition(
        request.device.deviceId,
        String(payload.id),
      );
      payload.allowedActions = (payload.allowedActions as string[]).filter(
        (action) =>
          action === "read" ||
          (action === "manage" && scopes.includes("conversation:manage")) ||
          (action === "advance" && scopes.includes("conversation:advance")),
      );
    }
    if (type === "schedule.updated") {
      payload.allowedActions = (payload.allowedActions as string[]).filter(
        (action) =>
          action === "read" ||
          (action === "trigger"
            ? scopes.includes("schedule:trigger")
            : action === "cancel"
              ? scopes.includes("schedule:cancel")
              : scopes.includes("schedule:manage")),
      );
    }
    if (
      type === "run.updated" &&
      !scopes.includes("conversation:advance") &&
      !scopes.includes("schedule:cancel")
    )
      payload.allowedActions = ["read"];
    if (type === "owner.status")
      payload.capabilities = (payload.capabilities as string[]).filter(
        (scope) => scopes.includes(scope),
      );
    if (type === "run.updated" && !scopes.includes("artifact:read"))
      payload.artifacts = [];
    return {
      ...event,
      payload:
        type === "run.updated" && this.projectRun
          ? await this.projectRun(payload)
          : payload,
    };
  }
  async open(request: OwnerControlRequest): Promise<AsyncIterable<Json>> {
    active(request);
    if (
      request.device.ownerId !== this.ledger.ownerId ||
      request.device.spaceId !== this.ledger.spaceId
    )
      fail("scope_denied", 403);
    this.observe?.();
    const sequence = await this.sequence(request);
    await this.ledger.eventsAfter(sequence); // 410 must be returned before SSE headers are committed.
    return this.replay(request, sequence);
  }
  private async *replay(
    request: OwnerControlRequest,
    sequence: string,
  ): AsyncIterable<Json> {
    while (!request.signal.aborted) {
      grantActive(request);
      await this.refresh?.();
      if (request.signal.aborted) return;
      grantActive(request);
      this.observe?.();
      for (const event of await this.ledger.eventsAfter(sequence)) {
        if (request.signal.aborted) return;
        grantActive(request);
        sequence = String(event.spaceChangeSeq);
        const projected = await this.project(event, request);
        if (projected) yield projected;
      }
      await pause(request.signal);
    }
  }
}
