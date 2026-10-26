import { join } from "node:path";
import { utilityProcess } from "electron";
import {
  MOBILE_OWNER_LEDGER_RPC_METHODS,
  type MobileOwnerLedgerPort,
  type MobileOwnerLedgerRpcMethod,
} from "./owner-ledger-port";
import type { OwnerExecutionEntry } from "./execution-types";

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_IN_FLIGHT_BYTES = 16 * 1024 * 1024;
const MAX_IN_FLIGHT_REQUESTS = 64;
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;
const METHODS = new Set<string>(MOBILE_OWNER_LEDGER_RPC_METHODS);

interface WorkerReply {
  kind?: string;
  id?: number;
  ok?: boolean;
  result?: unknown;
  dataEpoch?: string;
  changeSeq?: string;
  durationMs?: number;
  error?: {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    name?: unknown;
  };
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  bytes: number;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function remoteError(value: WorkerReply["error"]): Error {
  const message =
    typeof value?.message === "string"
      ? value.message.slice(0, 512)
      : "mobile_ledger_unavailable";
  const error = Object.assign(new Error(message), {
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    ...(typeof value?.status === "number" && Number.isSafeInteger(value.status)
      ? { status: value.status }
      : {}),
  });
  if (typeof value?.name === "string") error.name = value.name.slice(0, 80);
  return error;
}

/** Main-process proxy. The child is the only process that opens the SQLite ledger. */
export class MobileOwnerLedgerClient {
  readonly ownerId: string;
  readonly spaceId: string;
  private currentDataEpoch = "";
  private currentChangeSeq = "0";
  private readonly child: ReturnType<typeof utilityProcess.fork>;
  private readonly pending = new Map<number, PendingCall>();
  private resolveReady!: () => void;
  private rejectReady!: (error: Error) => void;
  private readonly ready: Promise<void>;
  private failure?: Error;
  private closing = false;
  private closePromise?: Promise<void>;
  private nextId = 1;
  private inFlightBytes = 0;
  private inFlightCount = 0;
  private totalCalls = 0;
  private totalBytes = 0;
  private lastRoundTripMs = 0;
  private lastWorkerDurationMs = 0;
  private executionSnapshot: OwnerExecutionEntry[] = [];

  constructor(file: string, ownerId: string, spaceId: string) {
    this.ownerId = ownerId;
    this.spaceId = spaceId;
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.ready.catch(() => undefined);
    const entry = join(__dirname, "mobile-owner-ledger-worker.cjs");
    this.child = utilityProcess.fork(entry, [file, ownerId, spaceId], {
      serviceName: "Agents One mobile ledger",
    });
    const startupTimer = setTimeout(() => {
      if (!this.failure && !this.currentDataEpoch)
        this.fail(Error("mobile_ledger_worker_start_timeout"));
    }, START_TIMEOUT_MS);
    startupTimer.unref?.();
    this.child.on("message", (message) => {
      const reply = message as WorkerReply;
      if (reply.kind === "ready") {
        if (
          typeof reply.dataEpoch !== "string" ||
          typeof reply.changeSeq !== "string"
        ) {
          this.fail(Error("mobile_ledger_worker_handshake_invalid"));
          return;
        }
        this.updateMetadata(reply);
        clearTimeout(startupTimer);
        this.resolveReady();
        return;
      }
      if (reply.kind === "startup_error") {
        clearTimeout(startupTimer);
        this.fail(remoteError(reply.error));
        return;
      }
      if (!Number.isSafeInteger(reply.id)) return;
      const call = this.pending.get(reply.id!);
      if (!call) return;
      this.pending.delete(reply.id!);
      clearTimeout(call.timer);
      this.release(call.bytes);
      this.updateMetadata(reply);
      this.lastWorkerDurationMs =
        typeof reply.durationMs === "number" &&
        Number.isFinite(reply.durationMs)
          ? reply.durationMs
          : 0;
      if (reply.ok) call.resolve(reply.result);
      else call.reject(remoteError(reply.error));
    });
    this.child.once("exit", (code) => {
      clearTimeout(startupTimer);
      if (!this.closing)
        this.fail(
          Object.assign(Error("mobile_ledger_worker_exited"), {
            code: "mobile_ledger_worker_exited",
            exitCode: code,
          }),
        );
    });
    this.child.on("error", () => {
      clearTimeout(startupTimer);
      if (!this.closing) this.fail(Error("mobile_ledger_worker_failed"));
    });

    return new Proxy(this, {
      get: (target, property, receiver) => {
        if (property === "close") return () => target.close();
        if (typeof property === "string" && METHODS.has(property))
          return (...args: unknown[]) =>
            target
              .invoke(property as MobileOwnerLedgerRpcMethod, args)
              .then((result) => {
                target.observeMethodResult(
                  property as MobileOwnerLedgerRpcMethod,
                  result,
                );
                return result;
              });
        return Reflect.get(target, property, receiver);
      },
    });
  }

  get dataEpoch(): string {
    return this.currentDataEpoch;
  }

  get changeSeq(): string {
    return this.currentChangeSeq;
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  getDiagnostics(): {
    totalCalls: number;
    totalBytes: number;
    inFlightCalls: number;
    inFlightBytes: number;
    lastRoundTripMs: number;
    lastWorkerDurationMs: number;
  } {
    return {
      totalCalls: this.totalCalls,
      totalBytes: this.totalBytes,
      inFlightCalls: this.inFlightCount,
      inFlightBytes: this.inFlightBytes,
      lastRoundTripMs: this.lastRoundTripMs,
      lastWorkerDurationMs: this.lastWorkerDurationMs,
    };
  }

  snapshotExecutionEntries(): OwnerExecutionEntry[] {
    return structuredClone(this.executionSnapshot);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.failure) {
      this.closing = true;
      this.child.kill();
      return Promise.resolve();
    }
    this.closing = true;
    this.closePromise = this.invoke("close", [], true).then(
      () => undefined,
      (error: Error) => {
        this.child.kill();
        throw error;
      },
    );
    return this.closePromise;
  }

  private updateMetadata(reply: WorkerReply): void {
    if (typeof reply.dataEpoch === "string")
      this.currentDataEpoch = reply.dataEpoch;
    if (typeof reply.changeSeq === "string")
      this.currentChangeSeq = reply.changeSeq;
  }

  private observeMethodResult(
    method: MobileOwnerLedgerRpcMethod,
    result: unknown,
  ): void {
    if (method === "executionEntries" && Array.isArray(result)) {
      this.executionSnapshot = structuredClone(result as OwnerExecutionEntry[]);
    } else if (
      method === "stageExecution" &&
      result &&
      typeof result === "object"
    ) {
      const entry = result as OwnerExecutionEntry;
      this.executionSnapshot = [
        ...this.executionSnapshot.filter(
          (current) => current.run.runId !== entry.run.runId,
        ),
        structuredClone(entry),
      ];
    } else if (method === "execution" && result && typeof result === "object") {
      const entry = result as OwnerExecutionEntry;
      this.executionSnapshot = [
        ...this.executionSnapshot.filter(
          (current) => current.run.runId !== entry.run.runId,
        ),
        structuredClone(entry),
      ];
    }
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.rejectReady(error);
    for (const [id, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(error);
      this.pending.delete(id);
    }
    this.inFlightBytes = 0;
    this.inFlightCount = 0;
  }

  private async invoke(
    method: MobileOwnerLedgerRpcMethod,
    args: unknown[],
    allowClosing = false,
  ): Promise<unknown> {
    if (this.failure) throw this.failure;
    if (this.closing && !allowClosing) throw Error("owner_unavailable");
    if (this.inFlightCount >= MAX_IN_FLIGHT_REQUESTS)
      throw Object.assign(Error("mobile_ledger_busy"), {
        code: "rate_limited",
        status: 429,
      });
    let message: { id: number; method: string; args: unknown[] };
    let bytes: number;
    try {
      message = { id: this.allocateId(), method, args };
      bytes = byteLength(message);
    } catch {
      throw Object.assign(Error("mobile_ledger_request_invalid"), {
        code: "invalid_input",
        status: 400,
      });
    }
    if (bytes > MAX_REQUEST_BYTES)
      throw Object.assign(Error("mobile_ledger_request_too_large"), {
        code: "invalid_input",
        status: 413,
      });
    if (this.inFlightBytes + bytes > MAX_IN_FLIGHT_BYTES)
      throw Object.assign(Error("mobile_ledger_busy"), {
        code: "rate_limited",
        status: 429,
      });
    this.inFlightCount++;
    this.inFlightBytes += bytes;
    this.totalCalls++;
    this.totalBytes += bytes;
    const started = performance.now();
    let transferred = false;
    try {
      await this.ready;
      if (this.failure) throw this.failure;
      return await new Promise<unknown>((resolve, reject) => {
        const id = message.id;
        const timer = setTimeout(() => {
          const error = Object.assign(Error("mobile_ledger_request_timeout"), {
            code: "reconciliation_required",
            status: 503,
          });
          this.fail(error);
          this.child.kill();
        }, REQUEST_TIMEOUT_MS);
        this.pending.set(id, { resolve, reject, timer, bytes });
        transferred = true;
        try {
          this.child.postMessage(message);
        } catch {
          this.pending.delete(id);
          clearTimeout(timer);
          transferred = false;
          reject(Error("mobile_ledger_worker_unavailable"));
        }
      });
    } finally {
      this.lastRoundTripMs = performance.now() - started;
      if (!transferred) this.release(bytes);
    }
  }

  private release(bytes: number): void {
    this.inFlightBytes = Math.max(0, this.inFlightBytes - bytes);
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
  }

  private allocateId(): number {
    const id = this.nextId;
    this.nextId = id >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
    return id;
  }
}

export interface MobileOwnerLedgerClient extends MobileOwnerLedgerPort {}
