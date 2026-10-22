import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import type { ExecutionCheckpoint } from "../src/main/mobile-control/execution-types";
import type { AgentRuntimeRun } from "../src/shared/agent-runtimes";
import { assertMobileSchema } from "../src/shared/mobile-control";

let root: string;
let file: string;
const now = Date.parse("2026-10-05T00:00:00Z");
const request: OwnerControlRequest = {
  requestId: "request-1",
  method: "POST",
  path: "/conversations/conversation-1/turns",
  operationId: "createTurn",
  params: { id: "conversation-1" },
  query: {},
  headers: { "idempotency-key": "mutation-1", "if-match": '"1"' },
  body: { text: "Synthetic task", executionPolicyId: "policy-1" },
  device: {
    deviceId: "device-1",
    ownerId: "owner-1",
    spaceId: "space-1",
    scopes: ["conversation:advance"],
    grantRevision: "1",
    expiresAt: "2026-10-06T00:00:00Z",
    revoked: false,
  },
  signal: new AbortController().signal,
};
const prepared = {
  runId: "run-1",
  turnId: "turn-1",
  conversationId: "conversation-1",
  runtimeId: "runtime-1",
  messageId: "run-1-user",
  expectedRevision: "1",
  policyId: "policy-1",
  createdAt: now,
};
const native: AgentRuntimeRun = {
  id: "run-1",
  runtimeId: "runtime-1",
  status: "running",
  startedAt: now,
};
const open = (): MobileOwnerLedger =>
  new MobileOwnerLedger(file, "owner-1", "space-1", () => now);
function checkpoint(ledger: MobileOwnerLedger): ExecutionCheckpoint {
  return {
    message: {
      id: "run-1-result",
      role: "agent",
      content: "Synthetic original reply",
      createdAt: now + 1,
      execution: { runId: "run-1", events: [] },
    },
    sessionId: "native-session-1",
    terminalRun: {
      ...ledger.execution("run-1")!.run,
      status: "succeeded",
      completedAt: new Date(now + 1).toISOString(),
      allowedActions: ["read"],
    },
  };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-execution-ledger-"));
  file = join(root, "ledger.json");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
describe("Owner execution evidence", () => {
  // @lat: [[mobile-data#Mobile data#Atomic execution intent]]
  it("commits receipt and native identity together, refuses duplicate admission and rolls back invalid transitions", () => {
    const ledger = open();
    ledger.stageExecution(request, prepared);
    const evidence = JSON.parse(readFileSync(file, "utf8"));
    expect(evidence.executions["run-1"].turn.runId).toBe("run-1");
    expect(ledger.operation(request)?.resultRef).toMatchObject({
      runId: "run-1",
      messageId: "run-1-user",
    });
    expect(() => ledger.stageExecution(request, prepared)).toThrow(
      "idempotency_conflict",
    );
    expect(() => ledger.executionObserved("run-1", native)).toThrow(
      "reconciliation_required",
    );
    expect(() =>
      ledger.stageExecutionFinal("run-1", checkpoint(ledger)),
    ).toThrow("reconciliation_required");
    expect(readFileSync(file, "utf8")).toBe(JSON.stringify(evidence));
    ledger.executionPrepared("run-1");
    ledger.executionObserved("run-1", native, true);
    expect(ledger.operation(request)?.status).toBe("applied");
    const firstEvents = ledger.eventsAfter("0");
    ledger.executionCancelling("run-1");
    expect(firstEvents.at(-1)?.payload).toMatchObject({ status: "running" });
    const sequences = ledger.eventsAfter("0").map((event) => event.runEventSeq);
    expect(sequences).toEqual(["1", "2", "3"]);
    for (const event of ledger.eventsAfter("0"))
      assertMobileSchema("Event", event);
  });
  // @lat: [[mobile-data#Mobile data#Execution crash recovery]]
  it("reports crash uncertainty with a new ordered event and retains unknown ledger data without replay", () => {
    const ledger = open();
    ledger.stageExecution(request, prepared);
    ledger.executionPrepared("run-1");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.extension = { keep: true };
    writeFileSync(file, JSON.stringify(raw));
    const recovered = open();
    expect(recovered.execution("run-1")?.phase).toBe("reconciliation_required");
    expect(recovered.operation(request)?.status).toBe(
      "reconciliation_required",
    );
    expect(recovered.eventsAfter("1").at(-1)).toMatchObject({
      runEventSeq: "2",
      payload: { status: "reconciliation_required" },
    });
    expect(JSON.parse(readFileSync(file, "utf8")).extension).toEqual({
      keep: true,
    });
    expect(() => recovered.executionObserved("run-1", native, true)).toThrow(
      "reconciliation_required",
    );
  });
  // @lat: [[mobile-data#Mobile data#Checkpoint integrity]]
  it("rejects changed final identity and malformed persisted checkpoints before touching original history", () => {
    const ledger = open();
    ledger.stageExecution(request, prepared);
    ledger.executionPrepared("run-1");
    ledger.executionObserved("run-1", native, true);
    const final = checkpoint(ledger);
    const before = readFileSync(file, "utf8");
    expect(() =>
      ledger.stageExecutionFinal("run-1", {
        ...final,
        terminalRun: { ...final.terminalRun, turnId: "other-turn" },
      }),
    ).toThrow("invalid_input");
    expect(readFileSync(file, "utf8")).toBe(before);
    ledger.stageExecutionFinal("run-1", final);
    expect(() =>
      ledger.stageExecutionFinal("run-1", {
        ...final,
        message: { ...final.message, content: "Conflicting reply" },
      }),
    ).toThrow("reconciliation_required");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.executions["run-1"].checkpoint.message.role = "user";
    writeFileSync(file, JSON.stringify(raw));
    const damaged = readFileSync(file, "utf8");
    expect(open).toThrow("mobile_ledger_invalid");
    expect(readFileSync(file, "utf8")).toBe(damaged);
  });
});
