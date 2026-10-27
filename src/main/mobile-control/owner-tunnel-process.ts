import { join } from "node:path";
import { utilityProcess } from "electron";
import type {
  OwnerControlHandler,
  OwnerControlRequest,
  OwnerControlResponse,
  OwnerTunnelBinding,
} from "./owner-tunnel";

type TunnelMessage = {
  kind?: string;
  id: number;
  active?: boolean;
  method?: string;
  request?: Partial<OwnerControlRequest>;
  sentAt?: number;
  streamId: number;
};

export interface TunnelPort {
  send(value: unknown): void;
  onMessage(listener: (value: unknown) => void): void;
}
const MAX_BYTES = 8 * 1024 * 1024;
const failure = (code = "owner_unavailable", status = 503): Error =>
  Object.assign(Error(code), { code, status });
function safeError(error: unknown): { code: string; status: number } {
  const e = error as { code?: string; status?: number };
  return {
    code: typeof e?.code === "string" ? e.code : "requires_owner_action",
    status: Number.isSafeInteger(e?.status) ? e.status! : 503,
  };
}
type Entry = {
  requestId?: string;
  operationId?: string;
  controller: AbortController;
  response?: OwnerControlResponse;
  iterator?: AsyncIterator<unknown>;
  pulling?: boolean;
};

/** Only verified DTOs and demand-driven stream pulls cross the transport boundary. */
export class OwnerTunnelMainBridge {
  private alive = true;
  private entries = new Map<number, Entry>();
  private probes = new Map<
    number,
    { resolve(value: boolean): void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private readonly port: TunnelPort,
    private readonly handler: OwnerControlHandler,
    private readonly diagnostic: (
      value: Record<string, unknown>,
    ) => void = () => {},
  ) {
    port.onMessage((value) => {
      void this.receive(value as TunnelMessage);
    });
  }
  close(): void {
    this.alive = false;
    for (const e of this.entries.values()) e.controller.abort();
    this.entries.clear();
    for (const p of this.probes.values()) {
      clearTimeout(p.timer);
      p.resolve(false);
    }
    this.probes.clear();
  }
  private send(value: unknown): void {
    if (!this.alive) return;
    if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES)
      throw failure("payload_too_large", 413);
    this.port.send(value);
  }
  private authorized(id: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.probes.delete(id);
        resolve(false);
      }, 10_000);
      timer.unref?.();
      this.probes.set(id, { resolve, timer });
      this.send({ kind: "probe", id });
    });
  }
  private async receive(m: TunnelMessage | undefined): Promise<void> {
    if (!this.alive || !m || !Number.isSafeInteger(m.id)) return;
    if (m.kind === "probe_result") {
      const p = this.probes.get(m.id);
      if (p) {
        clearTimeout(p.timer);
        this.probes.delete(m.id);
        p.resolve(m.active === true);
      }
      return;
    }
    if (m.kind === "cancel") {
      const e = this.entries.get(m.id);
      e?.controller.abort();
      this.entries.delete(m.id);
      return;
    }
    if (m.kind !== "call") return;
    try {
      if (Buffer.byteLength(JSON.stringify(m)) > MAX_BYTES)
        throw failure("payload_too_large", 413);
      let result: unknown;
      if (m.method === "status") result = await this.handler.status();
      else if (m.method === "handle") {
        if (this.entries.has(m.id) || this.entries.size >= 128)
          throw failure("rate_limited", 429);
        const entry: Entry = {
          controller: new AbortController(),
          requestId: m.request?.requestId,
          operationId: m.request?.operationId,
        };
        this.entries.set(m.id, entry);
        try {
          // Main may have been blocked while a grant was revoked in the child.
          if (
            !(await this.authorized(m.id)) ||
            entry.controller.signal.aborted ||
            !this.alive
          )
            throw failure("revoked", 401);
          const request = {
            ...m.request,
            signal: entry.controller.signal,
          } as OwnerControlRequest;
          this.diagnostic({
            event: "handler_dispatch",
            queueWaitMs: Math.max(
              0,
              Date.now() - Number(m.sentAt || Date.now()),
            ),
          });
          const response = await this.handler.handle(request);
          if (entry.controller.signal.aborted || !this.alive) throw failure();
          entry.response = response;
          entry.iterator =
            response.events?.[Symbol.asyncIterator]() ??
            response.download?.chunks[Symbol.asyncIterator]();
          result = {
            status: response.status,
            body: response.body,
            events: !!response.events,
            download: response.download
              ? { metadata: response.download.metadata }
              : undefined,
            streamId: m.id,
          };
          if (!entry.iterator) this.entries.delete(m.id);
        } catch (e) {
          this.entries.delete(m.id);
          throw e;
        }
      } else if (m.method === "next") {
        const entry = this.entries.get(m.streamId);
        if (!entry?.iterator || entry.controller.signal.aborted)
          throw failure();
        if (entry.pulling) throw failure("rate_limited", 429);
        entry.pulling = true;
        try {
          result = await entry.iterator.next();
          if ((result as IteratorResult<unknown>).done)
            this.entries.delete(m.streamId);
        } finally {
          entry.pulling = false;
        }
      } else throw failure("invalid_input", 422);
      this.send({ kind: "reply", id: m.id, ok: true, result });
    } catch (error) {
      const context =
        m.method === "handle" ? m.request : this.entries.get(m.streamId);
      const name = (error as { name?: string })?.name;
      this.diagnostic({
        event: "handler_failed",
        requestId: context?.requestId,
        operationId: context?.operationId,
        stage: m.method === "next" ? "stream" : "request",
        ...safeError(error),
        errorType: [
          "Error",
          "TypeError",
          "RangeError",
          "MobileContractError",
        ].includes(name ?? "")
          ? name
          : "Error",
      });
      if (m.method === "handle") {
        this.entries.get(m.id)?.controller.abort();
        this.entries.delete(m.id);
      }
      try {
        this.send({
          kind: "reply",
          id: m.id,
          ok: false,
          error: safeError(error),
        });
      } catch {
        /* Child deadline fails closed. */
      }
    }
  }
}

/** Transport/authorization has an independent event loop; task dispatch stays Main-owned. */
export class MobileOwnerTunnelProcess {
  private stopped = true;
  private child?: ReturnType<typeof utilityProcess.fork>;
  private bridge?: OwnerTunnelMainBridge;
  private retry?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  constructor(
    private readonly binding: OwnerTunnelBinding,
    private readonly handler: OwnerControlHandler,
    private readonly diagnostic: (
      value: Record<string, unknown>,
    ) => void = () => {},
    private readonly allowLoopbackForTests = false,
  ) {}
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.launch();
  }
  stop(): void {
    this.stopped = true;
    clearTimeout(this.retry);
    this.bridge?.close();
    this.bridge = undefined;
    const child = this.child;
    this.child = undefined;
    child?.kill();
  }
  private launch(): void {
    if (this.stopped) return;
    const child = utilityProcess.fork(
      join(__dirname, "mobile-owner-tunnel-worker.cjs"),
      [],
      { serviceName: "Agents One mobile transport" },
    );
    this.child = child;
    const listeners: ((value: unknown) => void)[] = [];
    this.bridge = new OwnerTunnelMainBridge(
      {
        send: (value) => child.postMessage(value),
        onMessage: (fn) => listeners.push(fn),
      },
      this.handler,
      this.diagnostic,
    );
    const timer = setTimeout(() => child.kill(), 15_000);
    timer.unref?.();
    child.on("message", (m) => {
      if (this.child !== child || this.stopped) return;
      if (m?.kind === "ready") {
        clearTimeout(timer);
        child.postMessage({
          kind: "start",
          binding: this.binding,
          allowLoopbackForTests: this.allowLoopbackForTests,
        });
        return;
      }
      if (m?.kind === "diagnostic") {
        this.diagnostic(m.value);
        if (m.value?.event === "authorized") this.attempts = 0;
        return;
      }
      for (const fn of listeners) fn(m);
    });
    const exited = (): void => {
      clearTimeout(timer);
      if (this.child !== child) return;
      this.bridge?.close();
      this.bridge = undefined;
      this.child = undefined;
      if (this.stopped) return;
      const delay =
        Math.min(30_000, 1000 * 2 ** this.attempts++) +
        Math.floor(Math.random() * 250);
      this.diagnostic({ event: "worker_exit", reconnectDelayMs: delay });
      this.retry = setTimeout(() => this.launch(), delay);
      this.retry.unref?.();
    };
    child.once("exit", exited);
    child.on("error", () => {
      child.kill();
      exited();
    });
  }
}
