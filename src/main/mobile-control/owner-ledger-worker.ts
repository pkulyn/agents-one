import { isAbsolute } from "node:path";
import { MobileOwnerLedger } from "./owner-ledger";
import {
  MOBILE_OWNER_LEDGER_RPC_METHODS,
  type MobileOwnerLedgerRpcMethod,
} from "./owner-ledger-port";

const parentPort = process.parentPort;
if (!parentPort) throw Error("mobile_ledger_parent_port_unavailable");

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const METHODS = new Set<string>(MOBILE_OWNER_LEDGER_RPC_METHODS);

interface WorkerRequest {
  id: number;
  method: MobileOwnerLedgerRpcMethod;
  args: unknown[];
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: { message: string; code?: string; status?: number; name?: string };
  dataEpoch?: string;
  changeSeq?: string;
  durationMs?: number;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function errorPayload(error: unknown): WorkerResponse["error"] {
  const value = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
    name?: unknown;
  };
  return {
    message:
      typeof value?.message === "string"
        ? value.message.slice(0, 512)
        : "mobile_ledger_unavailable",
    ...(typeof value?.code === "string" ? { code: value.code } : {}),
    ...(typeof value?.status === "number" && Number.isSafeInteger(value.status)
      ? { status: value.status }
      : {}),
    ...(typeof value?.name === "string"
      ? { name: value.name.slice(0, 80) }
      : {}),
  };
}

const READ_METHODS = new Set<MobileOwnerLedgerRpcMethod>([
  "operation",
  "operations",
  "execution",
  "executionEntries",
  "readPosition",
  "sourceEventKeys",
  "cursor",
  "parseCursor",
  "eventsAfter",
]);

function send(
  response: WorkerResponse,
  method?: MobileOwnerLedgerRpcMethod,
): void {
  let bytes: number;
  try {
    bytes = serializedBytes(response);
  } catch {
    bytes = MAX_RESPONSE_BYTES + 1;
  }
  if (bytes <= MAX_RESPONSE_BYTES) {
    parentPort.postMessage(response);
    return;
  }
  parentPort.postMessage({
    id: response.id,
    ok: false,
    error: READ_METHODS.has(method!)
      ? { message: "mobile_ledger_response_too_large", status: 413 }
      : {
          message: "mobile_ledger_response_outcome_unknown",
          code: "reconciliation_required",
          status: 503,
        },
    dataEpoch: response.dataEpoch,
    changeSeq: response.changeSeq,
  } satisfies WorkerResponse);
}

const [ledgerFile, ownerId, spaceId] = process.argv.slice(2);
let ledger: MobileOwnerLedger;
try {
  if (!ledgerFile || !ownerId || !spaceId || !isAbsolute(ledgerFile))
    throw Error("mobile_ledger_worker_arguments_invalid");
  ledger = new MobileOwnerLedger(ledgerFile, ownerId, spaceId);
  parentPort.postMessage({
    kind: "ready",
    dataEpoch: ledger.dataEpoch,
    changeSeq: ledger.changeSeq,
  });
} catch (error) {
  parentPort.postMessage({ kind: "startup_error", error: errorPayload(error) });
  process.exit(1);
}

let queue = Promise.resolve();
let closing = false;
parentPort.on("message", (event) => {
  const request = event.data as Partial<WorkerRequest>;
  queue = queue.then(() => {
    if (
      !request ||
      !Number.isSafeInteger(request.id) ||
      (request.id ?? 0) <= 0 ||
      typeof request.method !== "string" ||
      !METHODS.has(request.method) ||
      !Array.isArray(request.args)
    ) {
      if (Number.isSafeInteger(request?.id) && (request.id ?? 0) > 0)
        send({
          id: request.id!,
          ok: false,
          error: { message: "invalid_input", status: 400 },
        });
      return;
    }
    const message: WorkerRequest = request as WorkerRequest;
    if (closing) {
      send({
        id: message.id,
        ok: false,
        error: { message: "owner_unavailable", status: 503 },
      });
      return;
    }
    let requestBytes: number;
    try {
      requestBytes = serializedBytes(message);
    } catch {
      requestBytes = MAX_REQUEST_BYTES + 1;
    }
    if (requestBytes > MAX_REQUEST_BYTES) {
      send({
        id: message.id,
        ok: false,
        error: { message: "mobile_ledger_request_too_large", status: 413 },
      });
      return;
    }
    const started = performance.now();
    try {
      const method = ledger[message.method] as (...args: unknown[]) => unknown;
      const result = Reflect.apply(method, ledger, message.args);
      if (result instanceof Promise)
        throw Error("mobile_ledger_async_method_not_supported");
      const response: WorkerResponse = {
        id: message.id,
        ok: true,
        result,
        dataEpoch: ledger.dataEpoch,
        changeSeq: ledger.changeSeq,
        durationMs: performance.now() - started,
      };
      send(response, message.method);
      if (message.method === "close") {
        closing = true;
        setImmediate(() => process.exit(0));
      }
    } catch (error) {
      send({
        id: message.id,
        ok: false,
        error: errorPayload(error),
        dataEpoch: ledger.dataEpoch,
        changeSeq: ledger.changeSeq,
        durationMs: performance.now() - started,
      });
    }
  });
});
