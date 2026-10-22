import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  assertMobileSchema,
  MOBILE_ERROR_CODES,
} from "../../shared/mobile-control";
import type { OwnerControlRequest } from "./owner-tunnel";
import type {
  ExecutionCheckpoint,
  OwnerExecutionEntry,
  OwnerExecutionPreparation,
} from "./execution-types";
import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import { projectMobileRunActivity } from "./run-activity";

type Json = Record<string, unknown>;
interface Operation {
  operationId: string;
  clientMutationId: string;
  deviceId: string;
  action: string;
  status:
    | "accepted"
    | "applying"
    | "applied"
    | "rejected"
    | "reconciliation_required";
  resourceRef?: { type: string; id: string };
  resultRef?: Json;
  error?: Json;
  createdAt: string;
  updatedAt: string;
}
interface Entry {
  hash: string;
  receipt: Operation;
}
interface MessageIndex {
  nextSeq: string;
  entries: Record<string, { seq: string; revision: string; hash: string }>;
}
interface State {
  version: 1;
  ownerId: string;
  spaceId: string;
  dataEpoch: string;
  cursorKey: string;
  changeSeq: string;
  operations: Record<string, Entry>;
  messages: Record<string, MessageIndex>;
  readPositions: Record<string, Record<string, string>>;
  deliveredPositions: Record<string, Record<string, string[]>>;
  events: Json[];
  sourceVersions?: Record<string, { hash: string; revision: string }>;
  sourceEvents?: Record<string, { hash: string; deletion: Json }>;
  executions?: Record<string, OwnerExecutionEntry>;
  [key: string]: unknown;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Json)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
const hash = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
function fail(code: string, status = 409): never {
  throw Object.assign(Error(code), { code, status });
}
const decimal = (value: unknown): value is string =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,63})$/.test(value);
function dictionary(value: unknown): asserts value is Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("mobile_ledger_invalid");
  Object.setPrototypeOf(value, null);
}
function increment(value: string): string {
  const next = String(BigInt(value) + 1n);
  if (!decimal(next)) fail("requires_owner_action");
  return next;
}
function validateCheckpoint(
  id: string,
  entry: OwnerExecutionEntry,
  checkpoint: ExecutionCheckpoint,
): void {
  const message = checkpoint.message;
  if (
    !message ||
    !["agent", "system"].includes(message.role) ||
    message.id !== `${id}-result` ||
    typeof message.content !== "string" ||
    !message.content.trim() ||
    !Number.isFinite(message.createdAt) ||
    message.execution?.runId !== id ||
    (checkpoint.sessionId !== undefined &&
      (typeof checkpoint.sessionId !== "string" ||
        !checkpoint.sessionId.trim())) ||
    checkpoint.terminalRun.runId !== id ||
    checkpoint.terminalRun.turnId !== entry.turn.turnId ||
    checkpoint.terminalRun.conversationId !== entry.run.conversationId ||
    checkpoint.terminalRun.runtimeId !== entry.run.runtimeId ||
    !["succeeded", "failed", "cancelled", "timed_out"].includes(
      String(checkpoint.terminalRun.status),
    )
  )
    fail("invalid_input", 422);
  assertMobileSchema("Run", checkpoint.terminalRun);
}

/** Owner-only durable control evidence; phone and Relay never receive this file. */
export class MobileOwnerLedger {
  /** The ledger owns no external handles; the method closes the worker RPC contract. */
  close(): void {}
  private state: State;
  constructor(
    private readonly file: string,
    readonly ownerId: string,
    readonly spaceId: string,
    private readonly now: () => number = Date.now,
  ) {
    if (existsSync(file)) {
      try {
        const value = JSON.parse(readFileSync(file, "utf8")) as State;
        if (
          value.version !== 1 ||
          value.ownerId !== ownerId ||
          value.spaceId !== spaceId ||
          typeof value.dataEpoch !== "string" ||
          !/^[a-f0-9]{64}$/.test(value.cursorKey) ||
          !decimal(value.changeSeq) ||
          !value.operations ||
          !value.messages ||
          !value.readPositions ||
          !value.deliveredPositions ||
          !Array.isArray(value.events)
        )
          throw Error();
        for (const map of [
          value.operations,
          value.messages,
          value.readPositions,
          value.deliveredPositions,
        ])
          dictionary(map);
        for (const entry of Object.values(value.operations)) {
          if (!/^[a-f0-9]{64}$/.test(entry.hash)) throw Error();
          assertMobileSchema("OperationReceipt", entry.receipt);
        }
        if (value.executions) {
          dictionary(value.executions);
          for (const [id, entry] of Object.entries(value.executions)) {
            assertMobileSchema("Turn", entry.turn);
            assertMobileSchema("Run", entry.run);
            if (
              entry.run.runId !== id ||
              entry.turn.runId !== id ||
              entry.turn.conversationId !== entry.run.conversationId ||
              entry.turn.turnId !== entry.run.turnId ||
              !value.operations[entry.operationKey] ||
              value.operations[entry.operationKey].receipt.deviceId !==
                entry.deviceId ||
              !decimal(entry.expectedRevision) ||
              !Array.isArray(entry.seenEventIds) ||
              entry.seenEventIds.some((id) => typeof id !== "string") ||
              ![
                "preparing",
                "dispatching",
                "running",
                "persisting",
                "terminal",
                "reconciliation_required",
              ].includes(entry.phase)
            )
              throw Error();
            if (entry.checkpoint) {
              if (
                !["persisting", "reconciliation_required"].includes(entry.phase)
              )
                throw Error();
              validateCheckpoint(id, entry, entry.checkpoint);
            } else if (entry.phase === "persisting") throw Error();
          }
        }
        for (const index of Object.values(value.messages)) {
          if (
            !decimal(index.nextSeq) ||
            !index.entries ||
            Array.isArray(index.entries)
          )
            throw Error();
          dictionary(index.entries);
          const sequences = new Set<string>();
          for (const entry of Object.values(index.entries)) {
            if (
              !decimal(entry.seq) ||
              !decimal(entry.revision) ||
              entry.seq === "0" ||
              entry.revision === "0" ||
              BigInt(entry.seq) > BigInt(index.nextSeq) ||
              sequences.has(entry.seq) ||
              !/^[a-f0-9]{64}$/.test(entry.hash)
            )
              throw Error();
            sequences.add(entry.seq);
          }
        }
        for (const positions of Object.values(value.readPositions)) {
          dictionary(positions);
          for (const seq of Object.values(positions))
            if (!decimal(seq)) throw Error();
        }
        if (value.sourceVersions) {
          dictionary(value.sourceVersions);
          for (const version of Object.values(value.sourceVersions))
            if (
              !decimal(version.revision) ||
              !/^[a-f0-9]{64}$/.test(version.hash)
            )
              throw Error();
        }
        for (const positions of Object.values(value.deliveredPositions)) {
          dictionary(positions);
          for (const sequences of Object.values(positions))
            if (
              !Array.isArray(sequences) ||
              sequences.some((seq) => !decimal(seq))
            )
              throw Error();
        }
        let prior = 0n;
        if (value.sourceEvents !== undefined) {
          dictionary(value.sourceEvents);
          for (const entry of Object.values(value.sourceEvents)) {
            if (
              !entry ||
              !/^[a-f0-9]{64}$/.test(entry.hash) ||
              entry.deletion?.type !== "resource.deleted" ||
              !decimal(entry.deletion.resourceRevision)
            )
              throw Error();
            assertMobileSchema("ResourceRef", entry.deletion.resourceRef);
            assertMobileSchema("ResourceDeletion", entry.deletion.payload);
            assertMobileSchema("Event", {
              ...entry.deletion,
              eventId: `${value.dataEpoch}:${value.changeSeq}`,
              spaceChangeSeq: value.changeSeq,
              dataEpoch: value.dataEpoch,
              createdAt: new Date(this.now()).toISOString(),
            });
          }
        }
        for (const event of value.events) {
          assertMobileSchema("Event", event);
          const sequence = BigInt(String(event.spaceChangeSeq));
          if (
            event.dataEpoch !== value.dataEpoch ||
            sequence <= prior ||
            sequence > BigInt(value.changeSeq) ||
            event.eventId !== `${value.dataEpoch}:${sequence}`
          )
            throw Error();
          prior = sequence;
        }
        this.state = value;
      } catch {
        throw Error("mobile_ledger_invalid");
      }
    } else {
      this.state = {
        version: 1,
        ownerId,
        spaceId,
        dataEpoch: randomUUID(),
        cursorKey: randomBytes(32).toString("hex"),
        changeSeq: "0",
        operations: {},
        messages: {},
        readPositions: {},
        deliveredPositions: {},
        events: [],
      };
      this.persist();
    }
    this.prepareDictionaries();
    let changed = false;
    for (const entry of Object.values(this.state.operations)) {
      if (["accepted", "applying"].includes(entry.receipt.status)) {
        entry.receipt.status = "reconciliation_required";
        entry.receipt.updatedAt = new Date(now()).toISOString();
        changed = true;
      }
    }
    for (const entry of Object.values(this.state.executions ?? {})) {
      if (
        entry.phase === "terminal" ||
        entry.phase === "reconciliation_required" ||
        entry.checkpoint
      )
        continue;
      entry.phase = "reconciliation_required";
      entry.turn.state = "reconciliation_required";
      entry.run.status = "reconciliation_required";
      this.executionChanged(entry);
      changed = true;
    }
    if (changed) this.persist();
  }
  get dataEpoch(): string {
    return this.state.dataEpoch;
  }
  get changeSeq(): string {
    return this.state.changeSeq;
  }
  private prepareDictionaries(): void {
    for (const map of [
      this.state.messages,
      this.state.readPositions,
      this.state.deliveredPositions,
      this.state.operations,
    ])
      dictionary(map);
    for (const map of Object.values(this.state.readPositions)) dictionary(map);
    for (const map of Object.values(this.state.deliveredPositions))
      dictionary(map);
    for (const index of Object.values(this.state.messages))
      dictionary(index.entries);
    if (this.state.sourceVersions) dictionary(this.state.sourceVersions);
    if (this.state.sourceEvents) dictionary(this.state.sourceEvents);
    if (this.state.executions) dictionary(this.state.executions);
  }
  /** Observation version for legacy read-only sources; never used to authorize a source write. */
  observeReadonlySource(key: string, value: unknown): string {
    const fingerprint = hash(value);
    const versions = (this.state.sourceVersions ??= Object.create(
      null,
    ) as NonNullable<State["sourceVersions"]>);
    dictionary(versions);
    const previous = versions[key];
    if (previous?.hash === fingerprint) return previous.revision;
    return this.commit(() => {
      const revision = previous ? increment(previous.revision) : "1";
      versions[key] = { hash: fingerprint, revision };
      return revision;
    });
  }
  private persist(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(this.state));
      fsyncSync(descriptor);
    } catch (error) {
      closeSync(descriptor);
      rmSync(temporary, { force: true });
      throw error;
    }
    closeSync(descriptor);
    try {
      renameSync(temporary, this.file);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }
  private commit<T>(fn: () => T): T {
    const previous = structuredClone(this.state);
    try {
      const result = fn();
      this.persist();
      return structuredClone(result);
    } catch (error) {
      this.state = previous;
      this.prepareDictionaries();
      throw error;
    }
  }
  private operationKey(request: OwnerControlRequest): string {
    return canonical([
      request.device.deviceId,
      request.operationId,
      request.headers["idempotency-key"],
    ]);
  }
  private requestHash(request: OwnerControlRequest): string {
    return hash({
      method: request.method,
      path: request.path,
      body: request.body,
      revision: request.headers["if-match"] ?? null,
      mutationId: request.headers["idempotency-key"],
    });
  }
  /** Lookup precedes comparing today's resource revision, so a successful old request remains replayable. */
  operation(request: OwnerControlRequest): Operation | null {
    const entry = this.state.operations[this.operationKey(request)];
    if (!entry) return null;
    if (entry.hash !== this.requestHash(request)) fail("idempotency_conflict");
    return structuredClone(entry.receipt);
  }
  accept(
    request: OwnerControlRequest,
    resourceRef?: Operation["resourceRef"],
  ): Operation {
    const replay = this.operation(request);
    if (replay) return replay;
    const timestamp = new Date(this.now()).toISOString();
    const receipt: Operation = {
      operationId: randomUUID(),
      clientMutationId: request.headers["idempotency-key"],
      deviceId: request.device.deviceId,
      action: request.operationId,
      status: "accepted",
      ...(resourceRef ? { resourceRef } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    assertMobileSchema("OperationReceipt", receipt);
    return this.commit(() => {
      this.state.operations[this.operationKey(request)] = {
        hash: this.requestHash(request),
        receipt,
      };
      return receipt;
    });
  }
  complete(request: OwnerControlRequest, resultRef?: Json): Operation {
    return this.commit(() => {
      const entry = this.state.operations[this.operationKey(request)];
      if (!entry || entry.hash !== this.requestHash(request))
        fail("idempotency_conflict");
      if (entry.receipt.status === "reconciliation_required")
        fail("reconciliation_required");
      if (entry.receipt.status === "rejected") fail("idempotency_conflict");
      if (entry.receipt.status === "applied") return entry.receipt;
      entry.receipt.status = "applied";
      entry.receipt.updatedAt = new Date(this.now()).toISOString();
      if (resultRef) entry.receipt.resultRef = resultRef;
      assertMobileSchema("OperationReceipt", entry.receipt);
      return entry.receipt;
    });
  }
  reject(
    request: OwnerControlRequest,
    error: { code?: string; status?: number },
  ): Operation {
    return this.commit(() => {
      const entry = this.state.operations[this.operationKey(request)];
      if (!entry) fail("resource_not_found", 404);
      if (entry.hash !== this.requestHash(request))
        fail("idempotency_conflict");
      if (entry.receipt.status === "reconciliation_required")
        fail("reconciliation_required");
      if (entry.receipt.status === "applied") fail("idempotency_conflict");
      if (entry.receipt.status === "rejected") return entry.receipt;
      const code =
        error.code &&
        (MOBILE_ERROR_CODES as readonly string[]).includes(error.code)
          ? error.code
          : "requires_owner_action";
      entry.receipt.status = "rejected";
      entry.receipt.updatedAt = new Date(this.now()).toISOString();
      entry.receipt.error = {
        code,
        message: code,
        requestId: request.requestId,
        retryable: false,
      };
      assertMobileSchema("OperationReceipt", entry.receipt);
      return entry.receipt;
    });
  }
  /** A dispatched control with no reliable acknowledgement must not become a rejection or retry. */
  uncertain(request: OwnerControlRequest): Operation {
    return this.commit(() => {
      const entry = this.state.operations[this.operationKey(request)];
      if (!entry || entry.hash !== this.requestHash(request))
        fail("idempotency_conflict");
      if (["applied", "rejected"].includes(entry.receipt.status))
        fail("idempotency_conflict");
      entry.receipt.status = "reconciliation_required";
      entry.receipt.updatedAt = new Date(this.now()).toISOString();
      return entry.receipt;
    });
  }
  operations(deviceId: string): Operation[] {
    return Object.values(this.state.operations)
      .map((entry) => entry.receipt)
      .filter((receipt) => receipt.deviceId === deviceId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) ||
          b.operationId.localeCompare(a.operationId),
      )
      .map((receipt) => structuredClone(receipt));
  }

  /** Intent, receipt and native identity share one durable commit before original-message admission. */
  stageExecution(
    request: OwnerControlRequest,
    input: OwnerExecutionPreparation,
  ): OwnerExecutionEntry {
    if (this.operation(request)) fail("idempotency_conflict");
    if (
      this.executionEntries().some(
        (entry) =>
          entry.run.conversationId === input.conversationId &&
          entry.phase !== "terminal",
      )
    )
      fail("run_active");
    const createdAt = new Date(input.createdAt).toISOString();
    const operationKey = this.operationKey(request);
    const entry: OwnerExecutionEntry = {
      operationKey,
      requestId: request.requestId,
      deviceId: request.device.deviceId,
      expectedRevision: input.expectedRevision,
      messageId: input.messageId,
      phase: "preparing",
      seenEventIds: [],
      turn: {
        turnId: input.turnId,
        conversationId: input.conversationId,
        clientMutationId: request.headers["idempotency-key"],
        runId: input.runId,
        state: "accepted",
        revision: "1",
        requestedPolicyId: input.policyId,
        createdAt,
      },
      run: {
        runId: input.runId,
        turnId: input.turnId,
        conversationId: input.conversationId,
        runtimeId: input.runtimeId,
        status: "queued",
        startedAt: null,
        completedAt: null,
        lastRunEventSeq: "0",
        error: null,
        artifacts: [],
        allowedActions: ["read", "cancel"],
      },
    };
    const receipt: Operation = {
      operationId: randomUUID(),
      clientMutationId: request.headers["idempotency-key"],
      deviceId: request.device.deviceId,
      action: request.operationId,
      resourceRef: { type: "turn", id: input.turnId },
      status: "accepted",
      resultRef: {
        turnId: input.turnId,
        conversationId: input.conversationId,
        runId: input.runId,
        messageId: input.messageId,
      },
      createdAt,
      updatedAt: createdAt,
    };
    assertMobileSchema("Turn", entry.turn);
    assertMobileSchema("Run", entry.run);
    assertMobileSchema("OperationReceipt", receipt);
    return this.commit(() => {
      const executions = (this.state.executions ??= Object.create(
        null,
      ) as Record<string, OwnerExecutionEntry>);
      dictionary(executions);
      if (executions[input.runId]) fail("idempotency_conflict");
      executions[input.runId] = entry;
      this.state.operations[operationKey] = {
        hash: this.requestHash(request),
        receipt,
      };
      return entry;
    });
  }
  execution(id: string): OwnerExecutionEntry | null {
    return this.state.executions?.[id]
      ? structuredClone(this.state.executions[id])
      : null;
  }
  executionEntries(): OwnerExecutionEntry[] {
    return Object.values(this.state.executions ?? {}).map((entry) =>
      structuredClone(entry),
    );
  }
  private requireExecution(id: string): OwnerExecutionEntry {
    const entry = this.state.executions?.[id];
    if (!entry) fail("resource_not_found", 404);
    return entry;
  }
  private executionChanged(entry: OwnerExecutionEntry): void {
    entry.turn.revision = increment(String(entry.turn.revision));
    entry.run.lastRunEventSeq = increment(String(entry.run.lastRunEventSeq));
    this.appendEvent({
      type: "run.updated",
      resourceRef: { type: "run", id: entry.run.runId },
      resourceRevision: entry.turn.revision,
      runId: entry.run.runId,
      runEventSeq: entry.run.lastRunEventSeq,
      payload: entry.run,
    });
  }
  executionPrepared(id: string): void {
    this.commit(() => {
      const entry = this.requireExecution(id);
      if (entry.phase !== "preparing") fail("reconciliation_required");
      entry.phase = "dispatching";
      entry.turn.state = "queued";
      this.executionChanged(entry);
    });
  }
  executionObserved(
    id: string,
    native: AgentRuntimeRun,
    dispatched = false,
  ): void {
    const previous = this.requireExecution(id);
    if (
      previous.run.runId !== native.id ||
      previous.run.runtimeId !== native.runtimeId
    )
      fail("reconciliation_required");
    if (previous.phase === "terminal" || previous.checkpoint) return;
    if (!["dispatching", "running"].includes(previous.phase))
      fail("reconciliation_required");
    const unseen = (native.events ?? [])
      .map((event) => event.id)
      .filter((id) => !previous.seenEventIds.includes(id));
    const nextStatus =
      previous.run.status === "cancelling"
        ? "cancelling"
        : native.userActionRequired
          ? "review_required"
          : "running";
    if (
      !dispatched &&
      !unseen.length &&
      previous.run.status === nextStatus &&
      previous.phase === "running"
    )
      return;
    this.commit(() => {
      const entry = this.requireExecution(id);
      if (entry.phase === "reconciliation_required")
        fail("reconciliation_required");
      entry.phase = "running";
      entry.run.status = nextStatus;
      entry.run.startedAt = new Date(native.startedAt).toISOString();
      entry.run.activity = projectMobileRunActivity(native.events);
      entry.turn.state = nextStatus;
      entry.seenEventIds = [
        ...new Set([...entry.seenEventIds, ...unseen]),
      ].slice(-1000);
      if (dispatched) {
        const receipt = this.state.operations[entry.operationKey].receipt;
        if (receipt.status === "reconciliation_required")
          fail("reconciliation_required");
        receipt.status = "applied";
        receipt.updatedAt = new Date(this.now()).toISOString();
      }
      this.executionChanged(entry);
    });
  }
  executionCancelling(id: string): void {
    if (this.requireExecution(id).checkpoint) return;
    if (
      ["terminal", "reconciliation_required"].includes(
        this.requireExecution(id).phase,
      )
    )
      return;
    this.commit(() => {
      const entry = this.requireExecution(id);
      entry.run.status = "cancelling";
      entry.turn.state = "cancelling";
      this.executionChanged(entry);
    });
  }
  executionUncertain(id: string): void {
    this.commit(() => {
      const entry = this.requireExecution(id);
      if (entry.phase === "terminal") return;
      entry.phase = "reconciliation_required";
      entry.run.status = "reconciliation_required";
      entry.turn.state = "reconciliation_required";
      const receipt = this.state.operations[entry.operationKey].receipt;
      if (receipt.status !== "applied") {
        receipt.status = "reconciliation_required";
        receipt.updatedAt = new Date(this.now()).toISOString();
      }
      this.executionChanged(entry);
    });
  }
  executionRejected(id: string, error: { code?: string }): void {
    this.commit(() => {
      const entry = this.requireExecution(id);
      if (entry.phase !== "preparing") fail("reconciliation_required");
      const code =
        error.code &&
        (MOBILE_ERROR_CODES as readonly string[]).includes(error.code)
          ? error.code
          : "requires_owner_action";
      const detail = {
        code,
        message: code,
        requestId: entry.requestId,
        retryable: false,
      };
      const receipt = this.state.operations[entry.operationKey].receipt;
      receipt.status = "rejected";
      receipt.error = detail;
      receipt.updatedAt = new Date(this.now()).toISOString();
      entry.phase = "terminal";
      entry.turn.state = "failed";
      entry.run.status = "failed";
      entry.run.error = detail;
      entry.run.allowedActions = ["read"];
      this.executionChanged(entry);
    });
  }
  /** Persist a final-message write-ahead checkpoint; retry only this original write, never dispatch. */
  stageExecutionFinal(id: string, checkpoint: ExecutionCheckpoint): void {
    const previous = this.requireExecution(id);
    if (previous.phase === "terminal") return;
    validateCheckpoint(id, previous, checkpoint);
    if (previous.checkpoint) {
      if (hash(previous.checkpoint) !== hash(checkpoint))
        fail("reconciliation_required");
      return;
    }
    if (!["dispatching", "running"].includes(previous.phase))
      fail("reconciliation_required");
    this.commit(() => {
      const entry = this.requireExecution(id);
      entry.checkpoint = structuredClone(checkpoint);
      entry.phase = "persisting";
      entry.run.status = "review_required";
      entry.turn.state = "review_required";
      // A final event is emitted only by executionFinalCommitted after original storage succeeds.
    });
  }
  executionFinalCommitted(id: string): void {
    this.commit(() => {
      const entry = this.requireExecution(id);
      if (entry.phase === "terminal") return;
      if (!entry.checkpoint) fail("reconciliation_required");
      const sequence = entry.run.lastRunEventSeq;
      entry.run = {
        ...entry.checkpoint.terminalRun,
        activity: entry.run.activity ?? [],
        lastRunEventSeq: sequence,
      };
      entry.turn.state = entry.run.status;
      entry.phase = "terminal";
      delete entry.checkpoint;
      const receipt = this.state.operations[entry.operationKey].receipt;
      receipt.status = "applied";
      delete receipt.error;
      receipt.updatedAt = new Date(this.now()).toISOString();
      this.executionChanged(entry);
    });
  }
  indexMessages(conversationId: string, messages: Json[]): Json[] {
    const indexed = structuredClone(messages);
    let changed = false;
    // Read pagination must not clone every other conversation and the entire event log.
    const index: MessageIndex = Object.hasOwn(
      this.state.messages,
      conversationId,
    )
      ? structuredClone(this.state.messages[conversationId])
      : {
          nextSeq: "0",
          entries: Object.create(null) as MessageIndex["entries"],
        };
    Object.setPrototypeOf(index.entries, null);
    const ids = new Set<string>();
    for (const message of indexed) {
      const {
        messageSeq: unusedSequence,
        messageRevision: unusedRevision,
        ...body
      } = message;
      void unusedSequence;
      void unusedRevision;
      const id = String(message.id),
        fingerprint = hash(body);
      if (typeof message.id !== "string" || !message.id || ids.has(message.id))
        fail("invalid_input", 422);
      ids.add(message.id);
      let entry = index.entries[id];
      if (!entry) {
        index.nextSeq = increment(index.nextSeq);
        entry = index.entries[id] = {
          seq: index.nextSeq,
          revision: "1",
          hash: fingerprint,
        };
        changed = true;
      } else if (entry.hash !== fingerprint) {
        entry.revision = increment(entry.revision);
        entry.hash = fingerprint;
        changed = true;
      }
      message.messageSeq = entry.seq;
      message.messageRevision = entry.revision;
    }
    if (changed)
      this.commit(() => {
        this.state.messages[conversationId] = index;
      });
    return indexed;
  }
  delivered(
    deviceId: string,
    conversationId: string,
    sequences: string[],
  ): void {
    const valid = new Set(
      Object.values(this.state.messages[conversationId]?.entries ?? {}).map(
        (entry) => entry.seq,
      ),
    );
    if (sequences.some((seq) => !decimal(seq) || !valid.has(seq)))
      fail("invalid_input", 422);
    const previous = this.state.deliveredPositions[deviceId]?.[conversationId];
    if (previous && sequences.every((seq) => previous.includes(seq))) return;
    this.commit(() => {
      const positions = Object.hasOwn(this.state.deliveredPositions, deviceId)
        ? this.state.deliveredPositions[deviceId]
        : (this.state.deliveredPositions[deviceId] = Object.create(
            null,
          ) as Record<string, string[]>);
      Object.setPrototypeOf(positions, null);
      positions[conversationId] = [
        ...new Set([...(positions[conversationId] || []), ...sequences]),
      ];
    });
  }
  readPosition(deviceId: string, conversationId: string): string {
    return this.state.readPositions[deviceId]?.[conversationId] || "0";
  }
  markRead(deviceId: string, conversationId: string, seq: string): string {
    if (
      !decimal(seq) ||
      !this.state.deliveredPositions[deviceId]?.[conversationId]?.includes(seq)
    )
      fail("invalid_input", 422);
    return this.commit(() => {
      const positions = Object.hasOwn(this.state.readPositions, deviceId)
        ? this.state.readPositions[deviceId]
        : (this.state.readPositions[deviceId] = Object.create(null) as Record<
            string,
            string
          >);
      Object.setPrototypeOf(positions, null);
      const old = positions[conversationId] || "0";
      return (positions[conversationId] =
        BigInt(seq) > BigInt(old) ? seq : old);
    });
  }
  publish(
    event: Omit<Json, "eventId" | "spaceChangeSeq" | "dataEpoch" | "createdAt">,
  ): Json {
    return this.commit(() => this.appendEvent(event));
  }
  /** A complete original-source observation commits its checkpoints with all changed events. */
  observeSourceEvents(
    entries: Array<{ key: string; event: Json; deletion: Json }>,
  ): void {
    const next = Object.create(null) as NonNullable<State["sourceEvents"]>;
    const changes: Json[] = [];
    const previous = this.state.sourceEvents;
    for (const entry of entries) {
      if (Object.hasOwn(next, entry.key)) fail("requires_owner_action");
      assertMobileSchema("ResourceRef", entry.deletion.resourceRef);
      assertMobileSchema("ResourceDeletion", entry.deletion.payload);
      if (
        entry.deletion.type !== "resource.deleted" ||
        !decimal(entry.deletion.resourceRevision)
      )
        fail("requires_owner_action");
      for (const event of [entry.event, entry.deletion])
        assertMobileSchema("Event", {
          ...event,
          eventId: `${this.state.dataEpoch}:${this.state.changeSeq}`,
          spaceChangeSeq: this.state.changeSeq,
          dataEpoch: this.state.dataEpoch,
          createdAt: new Date(this.now()).toISOString(),
        });
      const fingerprint = hash(entry.event);
      next[entry.key] = {
        hash: fingerprint,
        deletion: structuredClone(entry.deletion),
      };
      if (previous && previous[entry.key]?.hash !== fingerprint)
        changes.push(entry.event);
    }
    if (previous)
      for (const [key, entry] of Object.entries(previous))
        if (!Object.hasOwn(next, key)) changes.push(entry.deletion);
    if (previous && hash(previous) === hash(next)) return;
    this.commit(() => {
      for (const event of changes) this.appendEvent(event);
      this.state.sourceEvents = next;
    });
  }
  sourceEventKeys(): string[] {
    return Object.keys(this.state.sourceEvents ?? {});
  }
  /** Atomically replaces one or more source projections without deleting unrelated resources. */
  observeSourceEventChanges(
    entries: Array<{ key: string; event: Json; deletion: Json }>,
    removedKeys: string[],
  ): void {
    const previous = this.state.sourceEvents ?? Object.create(null);
    const next = Object.assign(
      Object.create(null),
      previous,
    ) as NonNullable<State["sourceEvents"]>;
    const changes: Json[] = [];
    const seen = new Set<string>();
    const removed = new Set(removedKeys);
    if (removed.size !== removedKeys.length) fail("requires_owner_action");
    for (const entry of entries) {
      if (
        typeof entry.key !== "string" ||
        !entry.key ||
        entry.key.length > 4096 ||
        seen.has(entry.key) ||
        removed.has(entry.key)
      )
        fail("requires_owner_action");
      seen.add(entry.key);
      assertMobileSchema("ResourceRef", entry.deletion.resourceRef);
      assertMobileSchema("ResourceDeletion", entry.deletion.payload);
      if (
        entry.deletion.type !== "resource.deleted" ||
        !decimal(entry.deletion.resourceRevision)
      )
        fail("requires_owner_action");
      for (const event of [entry.event, entry.deletion])
        assertMobileSchema("Event", {
          ...event,
          eventId: `${this.state.dataEpoch}:${this.state.changeSeq}`,
          spaceChangeSeq: this.state.changeSeq,
          dataEpoch: this.state.dataEpoch,
          createdAt: new Date(this.now()).toISOString(),
        });
      const fingerprint = hash(entry.event);
      next[entry.key] = {
        hash: fingerprint,
        deletion: structuredClone(entry.deletion),
      };
      if (previous[entry.key]?.hash !== fingerprint) changes.push(entry.event);
    }
    for (const key of removed) {
      if (typeof key !== "string" || !key || key.length > 4096)
        fail("requires_owner_action");
      const prior = previous[key];
      if (!prior) continue;
      delete next[key];
      changes.push(prior.deletion);
    }
    if (!changes.length) return;
    this.commit(() => {
      for (const event of changes) this.appendEvent(event);
      this.state.sourceEvents = next;
    });
  }
  private appendEvent(event: Json): Json {
    this.state.changeSeq = increment(this.state.changeSeq);
    const value = {
      ...event,
      eventId: `${this.state.dataEpoch}:${this.state.changeSeq}`,
      spaceChangeSeq: this.state.changeSeq,
      dataEpoch: this.state.dataEpoch,
      createdAt: new Date(this.now()).toISOString(),
    };
    assertMobileSchema("Event", value);
    this.state.events.push(structuredClone(value));
    this.state.events = this.state.events
      .filter(
        (entry) =>
          Date.parse(String(entry.createdAt)) > this.now() - 7 * 86400_000,
      )
      .slice(-100000);
    return value;
  }
  cursor(deviceId: string, grantRevision: string, values: Json = {}): string {
    const payload = Buffer.from(
      canonical({
        ...values,
        ownerId: this.ownerId,
        spaceId: this.spaceId,
        dataEpoch: this.dataEpoch,
        deviceId,
        grantRevision,
        changeSeq: this.state.changeSeq,
        expiresAt: this.now() + 300000,
      }),
    ).toString("base64url");
    return `${payload}.${createHmac("sha256", Buffer.from(this.state.cursorKey, "hex")).update(payload).digest("base64url")}`;
  }
  parseCursor(cursor: string, deviceId: string, grantRevision: string): Json {
    if (typeof cursor !== "string" || cursor.length > 4096)
      fail("cursor_expired", 410);
    const [payload, signature, extra] = cursor.split(".");
    try {
      const expected = createHmac(
        "sha256",
        Buffer.from(this.state.cursorKey, "hex"),
      )
        .update(payload)
        .digest();
      const received = Buffer.from(signature, "base64url");
      if (
        extra ||
        expected.length !== received.length ||
        !timingSafeEqual(expected, received)
      )
        fail("cursor_expired", 410);
      const value = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as Json;
      if (
        value.ownerId !== this.ownerId ||
        value.spaceId !== this.spaceId ||
        value.dataEpoch !== this.dataEpoch ||
        value.deviceId !== deviceId ||
        value.grantRevision !== grantRevision ||
        typeof value.expiresAt !== "number" ||
        value.expiresAt <= this.now() ||
        !decimal(value.changeSeq) ||
        BigInt(value.changeSeq) > BigInt(this.state.changeSeq)
      )
        fail("cursor_expired", 410);
      return value;
    } catch {
      return fail("cursor_expired", 410);
    }
  }
  eventsAfter(sequence: string): Json[] {
    const retained = this.state.events.filter(
      (entry) =>
        Date.parse(String(entry.createdAt)) > this.now() - 7 * 86400_000,
    );
    if (retained.length !== this.state.events.length)
      this.commit(() => {
        this.state.events = retained;
      });
    if (!decimal(sequence) || BigInt(sequence) > BigInt(this.state.changeSeq))
      fail("cursor_expired", 410);
    const floor = this.state.events[0]?.spaceChangeSeq;
    if (floor && BigInt(sequence) < BigInt(String(floor)) - 1n)
      fail("cursor_expired", 410);
    if (!floor && sequence !== this.state.changeSeq)
      fail("cursor_expired", 410);
    return this.state.events
      .filter(
        (event) => BigInt(String(event.spaceChangeSeq)) > BigInt(sequence),
      )
      .map((event) => structuredClone(event));
  }
}
