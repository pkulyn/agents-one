import { createHash } from "node:crypto";
import type { OwnerControlHandler, OwnerTunnelBinding } from "./owner-tunnel";

export interface MobileOwnerScope {
  profile: string;
  home: string;
  dataGeneration?: string;
}
interface Transport {
  start(): void;
  stop(): void;
}
export interface MobileOwnerLifecycleOptions {
  scope(): MobileOwnerScope;
  locked(): boolean;
  binding(scope: MobileOwnerScope): Promise<OwnerTunnelBinding | undefined>;
  handler(
    scope: MobileOwnerScope,
    binding: OwnerTunnelBinding,
  ): OwnerControlHandler | Promise<OwnerControlHandler>;
  transport(
    binding: OwnerTunnelBinding,
    handler: OwnerControlHandler,
  ): Transport;
  onUnavailable?(): void;
}
const key = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function unavailable(): never {
  throw Object.assign(Error("owner_unavailable"), {
    code: "owner_unavailable",
    status: 503,
  });
}

async function* scopedStream<T>(
  source: AsyncIterable<T>,
  guard: () => void,
): AsyncIterable<T> {
  guard();
  for await (const value of source) {
    guard();
    yield value;
    guard();
  }
}

/** Main owns handlers; restarting transport never replays operations or cancels Runs. */
export class MobileOwnerLifecycle {
  private running = false;
  private generation = 0;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private dirty = false;
  private scopeKey?: string;
  private bindingKey?: string;
  private transportLease = 0;
  private transport?: Transport;
  private bundle?: { key: string; handler: OwnerControlHandler };
  private lastRefresh = 0;
  constructor(private readonly options: MobileOwnerLifecycleOptions) {}
  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
    this.timer = setInterval(() => {
      let current: string | undefined;
      try {
        current = this.options.locked() ? undefined : key(this.options.scope());
      } catch {
        /* Invalid profile fails closed. */
      }
      if (current !== this.scopeKey) this.invalidate();
      else if (Date.now() - this.lastRefresh >= 15000) void this.refresh();
    }, 1000);
    this.timer.unref();
  }
  stop(): void {
    this.running = false;
    clearInterval(this.timer);
    this.timer = undefined;
    this.generation++;
    this.disconnect();
    void this.disposeBundle();
  }
  invalidate(): void {
    this.generation++;
    this.disconnect();
    this.dirty = true;
    if (this.running) void this.refresh();
  }
  private disconnect(): void {
    this.transportLease++;
    this.transport?.stop();
    this.transport = undefined;
    this.bindingKey = undefined;
  }
  private async disposeBundle(): Promise<void> {
    const handler = this.bundle?.handler as
      | (OwnerControlHandler & { dispose?: () => void | Promise<void> })
      | undefined;
    this.bundle = undefined;
    if (!handler?.dispose) return;
    try {
      await handler.dispose.call(handler);
    } catch {
      this.options.onUnavailable?.();
    }
  }
  refresh(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.pending) return this.pending;
    this.dirty = false;
    this.pending = this.reconcile().finally(() => {
      this.pending = undefined;
      if (this.dirty && this.running) void this.refresh();
    });
    return this.pending;
  }
  private async reconcile(): Promise<void> {
    const generation = this.generation;
    this.lastRefresh = Date.now();
    try {
      if (this.options.locked()) {
        this.disconnect();
        return;
      }
      const scope = this.options.scope();
      const scopeKey = key(scope);
      if (scopeKey !== this.scopeKey) {
        this.disconnect();
        await this.disposeBundle();
        this.scopeKey = scopeKey;
      }
      const current = (): boolean =>
        this.running &&
        generation === this.generation &&
        !this.options.locked() &&
        key(this.options.scope()) === scopeKey;
      const binding = await this.options.binding(scope);
      if (!current()) return;
      if (!binding) {
        this.disconnect();
        return;
      }
      const bindingKey = key(binding);
      if (bindingKey === this.bindingKey) return;
      this.disconnect();
      const lease = this.transportLease;
      const bundleKey = key([scope, binding.ownerId, binding.spaceId]);
      if (this.bundle?.key !== bundleKey) {
        await this.disposeBundle();
        const delegate = await this.options.handler(scope, binding);
        if (!current()) {
          const dispose = (
            delegate as OwnerControlHandler & {
              dispose?: () => void | Promise<void>;
            }
          ).dispose;
          if (dispose) await dispose.call(delegate);
          return;
        }
        this.bundle = { key: bundleKey, handler: delegate };
      }
      const delegate = this.bundle.handler;
      const guard = (): void => {
        if (
          !current() ||
          this.bindingKey !== bindingKey ||
          this.transportLease !== lease
        )
          unavailable();
      };
      const handler: OwnerControlHandler = {
        status: async () => {
          guard();
          const result = await delegate.status();
          guard();
          return result;
        },
        handle: async (request) => {
          guard();
          const result = await delegate.handle(request);
          guard();
          return {
            ...result,
            ...(result.events
              ? { events: scopedStream(result.events, guard) }
              : {}),
            ...(result.download
              ? {
                  download: {
                    ...result.download,
                    chunks: scopedStream(result.download.chunks, guard),
                  },
                }
              : {}),
          };
        },
      };
      if (!current()) unavailable();
      const transport = this.options.transport(binding, handler);
      this.transport = transport;
      this.bindingKey = bindingKey;
      transport.start();
    } catch (error) {
      if (generation !== this.generation || !this.running) return;
      // The management HTTP plane can fail while the authenticated WebSocket
      // remains healthy. Its signed grants still expire independently; do not
      // turn an HTTP timeout into a deliberate disconnect every fifteen seconds.
      if (
        (error as Error)?.message === "service_unavailable" &&
        this.transport &&
        !this.options.locked() &&
        key(this.options.scope()) === this.scopeKey
      ) {
        this.options.onUnavailable?.();
        return;
      }
      this.disconnect();
      this.options.onUnavailable?.();
    }
  }
}
