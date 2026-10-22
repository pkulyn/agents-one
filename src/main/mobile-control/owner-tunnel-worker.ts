import { monitorEventLoopDelay } from "node:perf_hooks";
import {
  MobileOwnerTunnel,
  type OwnerControlRequest,
  type OwnerControlResponse,
} from "./owner-tunnel";
const port = process.parentPort;
if (!port) throw Error("mobile_transport_parent_port_unavailable");
let tunnel: MobileOwnerTunnel | undefined;
let nextId = 1;
const pending = new Map<
  number,
  {
    resolve(value: any): void;
    reject(error: Error): void;
    timer?: ReturnType<typeof setTimeout>;
  }
>();
const requests = new Map<number, OwnerControlRequest>();
const send = (value: unknown): void => port.postMessage(value);
function call(
  method: string,
  args: Record<string, unknown> = {},
  request?: OwnerControlRequest,
  signal = request?.signal,
): Promise<any> {
  if (pending.size >= 256)
    return Promise.reject(
      Object.assign(Error("rate_limited"), {
        code: "rate_limited",
        status: 429,
      }),
    );
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const cancel = (): void => {
      send({ kind: "cancel", id });
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      pending.delete(id);
      requests.delete(id);
      reject(
        Object.assign(Error("owner_unavailable"), {
          code: "owner_unavailable",
          status: 503,
        }),
      );
    };
    const timer = method === "next" ? undefined : setTimeout(cancel, 30_000);
    timer?.unref();
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        requests.delete(id);
        reject(error);
      },
      timer,
    });
    if (request) {
      requests.set(id, request);
      signal?.addEventListener(
        "abort",
        () => {
          requests.delete(id);
          send({ kind: "cancel", id });
        },
        { once: true },
      );
    }
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) {
      cancel();
      return;
    }
    send({ kind: "call", id, method, sentAt: Date.now(), ...args });
  });
}
async function* stream(
  streamId: number,
  signal: AbortSignal,
): AsyncIterable<any> {
  try {
    while (!signal.aborted) {
      const result = await call("next", { streamId }, undefined, signal);
      if (result.done) return;
      yield result.value;
    }
  } finally {
    requests.delete(streamId);
    send({ kind: "cancel", id: streamId });
  }
}
const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();
const metrics = setInterval(() => {
  send({
    kind: "diagnostic",
    value: {
      event: "worker_loop",
      p95Ms: lag.percentile(95) / 1e6,
      maxMs: lag.max / 1e6,
      pendingCalls: pending.size,
    },
  });
  lag.reset();
}, 60_000);
metrics.unref();
port.on("message", ({ data: m }) => {
  if (m?.kind === "start" && !tunnel) {
    try {
      tunnel = new MobileOwnerTunnel(
        m.binding,
        {
          status: async () => {
            const r = await call("status");
            return r;
          },
          handle: async (request) => {
            const { signal, ...dto } = request;
            const r = await call("handle", { request: dto }, request);
            const response: OwnerControlResponse = {
              status: r.status,
              body: r.body,
            };
            if (r.events) response.events = stream(r.streamId, signal);
            else if (r.download)
              response.download = {
                metadata: r.download.metadata,
                chunks: stream(r.streamId, signal),
              };
            else requests.delete(r.streamId);
            return response;
          },
        },
        undefined,
        m.allowLoopbackForTests === true,
        (value) => send({ kind: "diagnostic", value }),
      );
      tunnel.start();
    } catch {
      send({ kind: "diagnostic", value: { event: "worker_start_failed" } });
      process.exit(1);
    }
    return;
  }
  if (m?.kind === "probe") {
    const request = requests.get(m.id);
    send({
      kind: "probe_result",
      id: m.id,
      active: !!request && tunnel?.isAuthorized(request) === true,
    });
    return;
  }
  if (m?.kind !== "reply") return;
  const entry = pending.get(m.id);
  if (!entry) return;
  pending.delete(m.id);
  if (m.ok) entry.resolve(m.result);
  else
    entry.reject(
      Object.assign(Error(m.error?.code || "requires_owner_action"), m.error),
    );
});
send({ kind: "ready" });
