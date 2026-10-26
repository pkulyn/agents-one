import { createHash, createPublicKey, verify, randomUUID } from "node:crypto";
import WebSocket from "ws";
import {
  assertMobileSchema,
  resolveMobileRoute,
  validateMobileBody,
  validateMobileMutationHeaders,
  validateMobileQuery,
  MobileContractError,
  MOBILE_ERROR_CODES,
} from "../../shared/mobile-control";

const PROTOCOL = "mobile-owner/1.0";
const PATH = "/agents-one/mobile/owner/v1/tunnel";
const AUTHORIZATION_LEASE_MS = 30_000;
// Bounded clock tolerance does not extend the thirty-second local lease.
const MAX_RELAY_CLOCK_LEAD_MS = 45_000;
type ObjectValue = Record<string, unknown>;
export interface OwnerTunnelBinding {
  endpoint: string;
  ownerId: string;
  spaceId: string;
  hostCredential: string;
  signingPublicKey: string;
}
interface DeviceGrant {
  deviceId: string;
  ownerId: string;
  spaceId: string;
  grantRevision: string;
  expiresAt: string;
  revoked: boolean;
  scopes: string[];
}
export interface OwnerControlRequest {
  requestId: string;
  method: string;
  path: string;
  operationId: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  device: DeviceGrant;
  signal: AbortSignal;
}
export interface OwnerControlResponse {
  status: number;
  body?: unknown;
  events?: AsyncIterable<unknown>;
  download?: { metadata: unknown; chunks: AsyncIterable<Uint8Array> };
}
export interface OwnerControlHandler {
  status(): unknown | Promise<unknown>;
  handle(request: OwnerControlRequest): Promise<OwnerControlResponse>;
}
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("protocol_incompatible");
  return value as ObjectValue;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as ObjectValue)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown): string =>
  createHash("sha256")
    .update(canonical(value ?? null))
    .digest("hex");
function fail(code: string, status = 403): never {
  throw Object.assign(Error(code), { code, status });
}

/** Fixed management-plane trust, expiring grants and single-use signed requests. */
export class OwnerAuthorization {
  private readonly key;
  private devices = new Map<string, DeviceGrant>();
  private nonces = new Map<string, number>();
  private authorizationUpdates = new Map<string, number>();
  private updateId = "";
  private lease = 0;
  constructor(
    private readonly binding: OwnerTunnelBinding,
    private readonly now: () => number = Date.now,
  ) {
    this.key = createPublicKey({
      key: Buffer.from(binding.signingPublicKey, "base64"),
      type: "spki",
      format: "der",
    });
    if (this.key.asymmetricKeyType !== "ed25519") fail("protocol_incompatible");
  }
  private signed(frame: ObjectValue): ObjectValue {
    const payload = object(frame.payload);
    // Relay clocks can lead the desktop slightly. Only a verified signature
    // gets this bounded future allowance; already expired frames still fail.
    const now = this.now();
    if (
      typeof frame.signature !== "string" ||
      !verify(
        null,
        Buffer.from(canonical(payload)),
        this.key,
        Buffer.from(frame.signature, "base64"),
      )
    )
      fail("scope_denied");
    if (
      payload.protocolVersion !== PROTOCOL ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= now ||
      payload.expiresAt > now + AUTHORIZATION_LEASE_MS + MAX_RELAY_CLOCK_LEAD_MS
    )
      fail("scope_denied");
    return payload;
  }
  update(frame: ObjectValue): { updateId: string; revokedDeviceIds: string[] } {
    const payload = this.signed(frame);
    if (
      payload.ownerId !== this.binding.ownerId ||
      payload.spaceId !== this.binding.spaceId ||
      typeof payload.updateId !== "string"
    )
      fail("scope_denied");
    for (const [key, expiry] of this.authorizationUpdates)
      if (expiry <= this.now()) this.authorizationUpdates.delete(key);
    if (this.authorizationUpdates.has(payload.updateId))
      fail("idempotency_conflict", 409);
    if (this.authorizationUpdates.size >= 4096) fail("rate_limited", 429);
    const grants = object(payload.grants);
    if (
      typeof grants.enabled !== "boolean" ||
      !Array.isArray(grants.devices) ||
      grants.devices.length > 200
    )
      fail("protocol_incompatible");
    const next = new Map<string, DeviceGrant>();
    for (const value of grants.devices) {
      assertMobileSchema("DeviceGrant", value);
      const device = value as DeviceGrant;
      if (
        device.ownerId !== this.binding.ownerId ||
        device.spaceId !== this.binding.spaceId ||
        next.has(device.deviceId)
      )
        fail("scope_denied");
      if (grants.enabled && !device.revoked) next.set(device.deviceId, device);
    }
    const revokedDeviceIds = [...this.devices.values()]
      .filter(
        (old) => next.get(old.deviceId)?.grantRevision !== old.grantRevision,
      )
      .map((old) => old.deviceId);
    this.devices = next;
    this.updateId = payload.updateId;
    // Clock tolerance must not turn a thirty-second authorization into a
    // longer local lease. Keep replay IDs for the complete signed window.
    this.lease = Math.min(
      payload.expiresAt as number,
      this.now() + AUTHORIZATION_LEASE_MS,
    );
    this.authorizationUpdates.set(this.updateId, payload.expiresAt as number);
    return { updateId: this.updateId, revokedDeviceIds };
  }
  /** Remaining signed local lease; never greater than the original thirty seconds. */
  remainingLeaseMs(): number {
    return Math.max(
      0,
      Math.min(AUTHORIZATION_LEASE_MS, this.lease - this.now()),
    );
  }
  active(deviceId: string, revision: string): boolean {
    const device = this.devices.get(deviceId);
    return (
      this.lease > this.now() &&
      !!device &&
      device.grantRevision === revision &&
      Date.parse(device.expiresAt) > this.now()
    );
  }
  request(frame: ObjectValue, signal: AbortSignal): OwnerControlRequest {
    const payload = this.signed(frame);
    if (
      payload.audience !== this.binding.ownerId ||
      payload.spaceId !== this.binding.spaceId ||
      payload.authorizationId !== this.updateId ||
      payload.requestId !== frame.requestId ||
      this.lease <= this.now()
    )
      fail("scope_denied");
    const device = this.devices.get(String(payload.deviceId));
    if (!device || !this.active(device.deviceId, String(payload.grantRevision)))
      fail("revoked", 401);
    if (
      typeof payload.method !== "string" ||
      typeof payload.path !== "string" ||
      digest(frame.body) !== payload.bodyHash ||
      typeof payload.nonce !== "string"
    )
      fail("scope_denied");
    const resolved = resolveMobileRoute(payload.method, payload.path);
    if (
      !resolved ||
      resolved.params.ownerId !== this.binding.ownerId ||
      resolved.params.spaceId !== this.binding.spaceId
    )
      fail("resource_not_found", 404);
    const { route, params } = resolved;
    if (route.scope && !device.scopes.includes(route.scope))
      fail("scope_denied");
    if (
      route.operationId === "cancelRun" &&
      !device.scopes.some(
        (s) => s === "conversation:advance" || s === "schedule:cancel",
      )
    )
      fail("scope_denied");
    const headers = object(payload.headers);
    if (
      Object.entries(headers).some(
        ([key, value]) =>
          ![
            "if-match",
            "idempotency-key",
            "x-client-mutation-id",
            "last-event-id",
          ].includes(key) ||
          typeof value !== "string" ||
          value.length > 4096,
      )
    )
      fail("invalid_input", 422);
    const query = object(payload.query);
    if (
      Object.values(query).some(
        (value) => typeof value !== "string" || value.length > 4096,
      )
    )
      fail("invalid_input", 422);
    validateMobileQuery(route, query as Record<string, string>);
    if (route.body) validateMobileBody(route.body, frame.body);
    else if (frame.body !== null && frame.body !== undefined)
      fail("invalid_input", 422);
    validateMobileMutationHeaders(
      route,
      headers as Record<string, string>,
      frame.body,
    );
    for (const [nonce, expiresAt] of this.nonces)
      if (expiresAt <= this.now()) this.nonces.delete(nonce);
    if (this.nonces.has(payload.nonce)) fail("idempotency_conflict", 409);
    if (this.nonces.size >= 4096) fail("rate_limited", 429);
    this.nonces.set(payload.nonce, payload.expiresAt as number);
    return {
      requestId: String(frame.requestId),
      method: payload.method,
      path: payload.path,
      operationId: route.operationId,
      params,
      query: query as Record<string, string>,
      headers: headers as Record<string, string>,
      body: frame.body,
      device,
      signal,
    };
  }
  clear(): void {
    this.devices.clear();
    this.lease = 0;
    this.updateId = "";
  }
}

/** A phone disconnect cancels transport only; accepted execution belongs to Owner. */
export class MobileOwnerTunnel {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private guard?: ReturnType<typeof setInterval>;
  private stopped = true;
  private attempts = 0;
  private authorizationDeadline?: number;
  private readonly auth: OwnerAuthorization;
  private pending = new Map<
    string,
    { controller: AbortController; deviceId: string; revision: string }
  >();
  constructor(
    private readonly binding: OwnerTunnelBinding,
    private readonly handler: OwnerControlHandler,
    private readonly socketFactory = (url: string) =>
      new WebSocket(url, { maxPayload: 1024 * 1024, followRedirects: false }),
    allowLoopbackForTests = false,
    private readonly diagnostic: (
      value: Record<string, unknown>,
    ) => void = () => {},
  ) {
    const url = new URL(binding.endpoint);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      (url.protocol !== "https:" &&
        !(
          allowLoopbackForTests &&
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(url.hostname)
        ))
    )
      fail("invalid_input", 422);
    this.auth = new OwnerAuthorization(binding);
  }
  isAuthorized(request: OwnerControlRequest): boolean {
    return (
      !request.signal.aborted &&
      this.auth.active(request.device.deviceId, request.device.grantRevision)
    );
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.guard = setInterval(() => {
      const socket = this.socket;
      if (
        socket?.readyState === WebSocket.OPEN &&
        this.authorizationDeadline !== undefined &&
        performance.now() >= this.authorizationDeadline
      ) {
        this.diagnostic({ event: "authorization_lease_expired" });
        this.reset();
        socket.terminate();
      }
      for (const entry of this.pending.values())
        if (!this.auth.active(entry.deviceId, entry.revision))
          entry.controller.abort();
    }, 1000);
    this.guard.unref();
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    clearInterval(this.guard);
    this.reset();
    this.socket?.terminate();
    this.socket = undefined;
  }
  private reset(): void {
    this.authorizationDeadline = undefined;
    this.auth.clear();
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
  }
  private send(socket: WebSocket, value: unknown): void {
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 2 * 1024 * 1024) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(value));
  }
  private async sendData(socket: WebSocket, value: unknown): Promise<void> {
    if (socket !== this.socket || socket.readyState !== WebSocket.OPEN)
      throw Error("owner_offline");
    await new Promise<void>((resolve, reject) =>
      socket.send(JSON.stringify(value), (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  private connect(): void {
    if (this.stopped) return;
    const url = new URL(this.binding.endpoint);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = PATH;
    const socket = this.socketFactory(url.toString());
    this.socket = socket;
    const timeout = setTimeout(() => socket.terminate(), 10_000);
    timeout.unref();
    socket.on("open", () =>
      this.send(socket, {
        type: "hello",
        role: "owner",
        protocolVersion: PROTOCOL,
        ownerId: this.binding.ownerId,
        spaceId: this.binding.spaceId,
        hostCredential: this.binding.hostCredential,
      }),
    );
    socket.on("message", (raw) => {
      if (socket !== this.socket) return;
      try {
        const text =
          typeof raw === "string"
            ? raw
            : Buffer.isBuffer(raw)
              ? raw.toString("utf8")
              : Buffer.from(raw as ArrayBuffer).toString("utf8");
        const frame = object(JSON.parse(text));
        if (frame.type === "hello_ack") {
          if (frame.protocolVersion !== PROTOCOL) fail("protocol_incompatible");
          return;
        }
        if (frame.type === "authorization") {
          const update = this.auth.update(frame);
          this.authorizationDeadline =
            performance.now() + this.auth.remainingLeaseMs();
          for (const entry of this.pending.values())
            if (update.revokedDeviceIds.includes(entry.deviceId))
              entry.controller.abort();
          this.send(socket, {
            type: "authorization_ack",
            updateId: update.updateId,
          });
          clearTimeout(timeout);
          this.attempts = 0;
          void this.publishStatus(socket);
          return;
        }
        if (frame.type === "cancel_request") {
          this.pending.get(String(frame.requestId))?.controller.abort();
          return;
        }
        if (frame.type !== "request") fail("protocol_incompatible");
        const controller = new AbortController();
        const request = this.auth.request(frame, controller.signal);
        if (this.pending.size >= 128 || this.pending.has(request.requestId))
          fail("rate_limited", 429);
        this.pending.set(request.requestId, {
          controller,
          deviceId: request.device.deviceId,
          revision: request.device.grantRevision,
        });
        void this.dispatch(socket, request);
      } catch {
        socket.close(4000, "invalid owner request");
        this.reset();
      }
    });
    socket.on("error", () => {});
    socket.on("close", (code) => {
      clearTimeout(timeout);
      if (socket !== this.socket) return;
      this.reset();
      this.socket = undefined;
      if (!this.stopped && code !== 4001 && code !== 4002) {
        const delay =
          Math.min(30_000, 1000 * 2 ** this.attempts++) +
          Math.floor(Math.random() * 250);
        this.retry = setTimeout(() => this.connect(), delay);
        this.retry.unref();
      }
    });
  }
  private async publishStatus(socket: WebSocket): Promise<void> {
    try {
      const owner = await this.handler.status();
      assertMobileSchema("OwnerSpace", owner);
      const value = object(owner);
      if (
        value.ownerId !== this.binding.ownerId ||
        value.spaceId !== this.binding.spaceId
      )
        fail("scope_denied");
      this.send(socket, { type: "owner_status", owner });
    } catch {
      socket.close(4000, "owner status unavailable");
    }
  }
  private async dispatch(
    socket: WebSocket,
    request: OwnerControlRequest,
  ): Promise<void> {
    try {
      const response = await this.handler.handle(request);
      if (
        request.signal.aborted ||
        !this.auth.active(request.device.deviceId, request.device.grantRevision)
      )
        return;
      this.send(socket, {
        type: "response",
        requestId: request.requestId,
        status: response.status,
        body: response.body,
        ...(response.download ? { download: response.download.metadata } : {}),
      });
      if (response.download) {
        assertMobileSchema("Artifact", response.download.metadata);
        let offset = 0;
        for await (const chunk of response.download.chunks) {
          for (let start = 0; start < chunk.length; start += 65536) {
            if (
              request.signal.aborted ||
              !this.auth.active(
                request.device.deviceId,
                request.device.grantRevision,
              )
            )
              return;
            const bytes = chunk.subarray(start, start + 65536);
            await this.sendData(socket, {
              type: "chunk",
              requestId: request.requestId,
              offset,
              data: Buffer.from(bytes).toString("base64"),
            });
            offset += bytes.length;
          }
        }
        this.send(socket, { type: "end", requestId: request.requestId });
      }
      if (response.events) {
        for await (const event of response.events) {
          if (
            request.signal.aborted ||
            !this.auth.active(
              request.device.deviceId,
              request.device.grantRevision,
            )
          )
            break;
          assertMobileSchema("Event", event);
          await this.sendData(socket, {
            type: "event",
            requestId: request.requestId,
            event,
          });
        }
        this.send(socket, { type: "end", requestId: request.requestId });
      }
    } catch (error) {
      if (request.signal.aborted) return;
      const candidate = error as { code?: string; status?: number };
      const code =
        candidate.code &&
        (MOBILE_ERROR_CODES as readonly string[]).includes(candidate.code)
          ? candidate.code
          : "requires_owner_action";
      const status =
        error instanceof MobileContractError
          ? error.status
          : candidate.status || 503;
      this.send(socket, {
        type: "response",
        requestId: request.requestId,
        status,
        body: {
          error: {
            code,
            message: code,
            retryable: false,
            requestId: randomUUID(),
          },
        },
      });
    } finally {
      this.pending.delete(request.requestId);
    }
  }
}
