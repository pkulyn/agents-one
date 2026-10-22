import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";

let root: string;
let file: string;
let now: number;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-owner-ledger-"));
  file = join(root, "ledger.json");
  now = Date.parse("2026-10-05T00:00:00Z");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const open = (): MobileOwnerLedger =>
  new MobileOwnerLedger(file, "owner-1", "space-1", () => now);
function request(
  changes: Partial<OwnerControlRequest> = {},
): OwnerControlRequest {
  return {
    requestId: "request-1",
    method: "PATCH",
    path: "/conversations/conversation-1",
    operationId: "patchConversation",
    params: { id: "conversation-1" },
    query: {},
    headers: { "idempotency-key": "mutation-1", "if-match": '"1"' },
    body: { title: "Synthetic rename" },
    device: {
      deviceId: "device-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      scopes: ["conversation:manage"],
      grantRevision: "1",
      expiresAt: "2026-10-06T00:00:00Z",
      revoked: false,
    },
    signal: new AbortController().signal,
    ...changes,
  };
}
const message = (
  id: string,
  content = "Synthetic text",
): Record<string, unknown> => ({ id, content });
const permission = (): Record<string, unknown> => ({
  type: "permission.changed",
  resourceRef: { type: "permission", id: "device-1" },
  resourceRevision: "1",
  payload: {
    deviceId: "device-1",
    grantRevision: "1",
    scopes: ["conversation:read"],
    revoked: false,
  },
});

describe("Owner durable control ledger", () => {
  // @lat: [[mobile-data#Mobile data#Durable operation receipts]]
  it("persists intent before returning, replays exact results across restart and rejects changed requests", () => {
    const ledger = open();
    const accepted = ledger.accept(request(), {
      type: "conversation",
      id: "conversation-1",
    });
    expect(accepted.status).toBe("accepted");
    expect(JSON.parse(readFileSync(file, "utf8")).operations).toEqual(
      expect.objectContaining({
        [JSON.stringify(["device-1", "patchConversation", "mutation-1"])]:
          expect.objectContaining({ receipt: accepted }),
      }),
    );
    const applied = ledger.complete(request(), {
      conversationId: "conversation-1",
    });
    expect(open().operation(request())).toEqual(applied);
    expect(ledger.accept(request())).toEqual(applied);
    expect(() =>
      ledger.operation(request({ body: { title: "Changed" } })),
    ).toThrow("idempotency_conflict");
    expect(() =>
      ledger.reject(
        request({
          headers: { "idempotency-key": "mutation-1", "if-match": '"2"' },
        }),
        { code: "revision_conflict" },
      ),
    ).toThrow("idempotency_conflict");
    expect(() =>
      ledger.reject(request(), { code: "revision_conflict" }),
    ).toThrow("idempotency_conflict");
    expect(ledger.complete(request(), { conversationId: "other" })).toEqual(
      applied,
    );
  });
  // @lat: [[mobile-data#Mobile data#Uncertain operations after restart]]
  it("marks unresolved intent uncertain after restart without replaying or allowing terminal overwrite", () => {
    const ledger = open();
    ledger.accept(request());
    const recovered = open();
    expect(recovered.operation(request())?.status).toBe(
      "reconciliation_required",
    );
    expect(() => recovered.complete(request())).toThrow(
      "reconciliation_required",
    );
    expect(() => recovered.reject(request(), { code: "run_active" })).toThrow(
      "reconciliation_required",
    );
    const next = request({
      headers: { "idempotency-key": "mutation-2", "if-match": '"1"' },
    });
    recovered.accept(next);
    const rejected = recovered.reject(next, {
      code: "secret runtime exception",
    });
    expect(rejected.error).toMatchObject({
      code: "requires_owner_action",
      message: "requires_owner_action",
      retryable: false,
    });
    expect(() => recovered.complete(next)).toThrow("idempotency_conflict");
  });
  // @lat: [[mobile-data#Mobile data#Device operation isolation]]
  it("isolates receipt namespaces even for colon-containing identifiers and unusual object keys", () => {
    const ledger = open();
    const first = request({
      device: { ...request().device, deviceId: "device:a" },
      operationId: "action",
      headers: { "idempotency-key": "b:mutation" },
    });
    const second = request({
      device: { ...request().device, deviceId: "device" },
      operationId: "a:action:b",
      headers: { "idempotency-key": "mutation" },
    });
    ledger.accept(first);
    ledger.accept(second);
    expect(ledger.operations("device:a")).toHaveLength(1);
    expect(ledger.operations("device")).toHaveLength(1);
    expect(ledger.operations("other")).toEqual([]);
    expect(ledger.operations("device:a")[0].operationId).not.toBe(
      ledger.operations("device")[0].operationId,
    );
  });
  // @lat: [[mobile-data#Mobile data#Stable message sequence]]
  it("keeps original IDs and sequence while increasing revisions on upsert, without duplicating body storage", () => {
    const ledger = open();
    const first = ledger.indexMessages("constructor", [
      message("constructor"),
      message("message-2"),
    ]);
    expect(
      first.map((item) => [item.id, item.messageSeq, item.messageRevision]),
    ).toEqual([
      ["constructor", "1", "1"],
      ["message-2", "2", "1"],
    ]);
    const recovered = open();
    const updated = recovered.indexMessages("constructor", [
      message("message-2", "Synthetic final"),
      first[0],
      message("message-3"),
    ]);
    expect(
      updated.map((item) => [item.messageSeq, item.messageRevision]),
    ).toEqual([
      ["2", "2"],
      ["1", "1"],
      ["3", "1"],
    ]);
    expect(readFileSync(file, "utf8")).not.toContain("Synthetic final");
    const before = readFileSync(file, "utf8");
    expect(() =>
      recovered.indexMessages("constructor", [
        message("extra"),
        message("extra"),
      ]),
    ).toThrow("invalid_input");
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(
      recovered.indexMessages("constructor", [message("message-4")])[0]
        .messageSeq,
    ).toBe("4");
  });
  // @lat: [[mobile-data#Mobile data#Returned read boundaries]]
  it("accepts only a returned boundary for that device and conversation and never moves read position backwards", () => {
    const ledger = open();
    ledger.indexMessages("constructor", [
      message("a"),
      message("b"),
      message("c"),
    ]);
    ledger.delivered("constructor", "constructor", ["1", "3"]);
    expect(() => ledger.markRead("constructor", "constructor", "2")).toThrow(
      "invalid_input",
    );
    expect(() => ledger.markRead("other", "constructor", "3")).toThrow(
      "invalid_input",
    );
    expect(() => ledger.delivered("constructor", "constructor", ["4"])).toThrow(
      "invalid_input",
    );
    expect(ledger.markRead("constructor", "constructor", "3")).toBe("3");
    expect(ledger.markRead("constructor", "constructor", "1")).toBe("3");
    expect(open().readPosition("constructor", "constructor")).toBe("3");
    expect(ledger.readPosition("other", "constructor")).toBe("0");
  });
  // @lat: [[mobile-data#Mobile data#Bound cursor validity]]
  it("binds signed cursors to device, grant, space, epoch and five-minute lifetime", () => {
    const ledger = open();
    const cursor = ledger.cursor("device-1", "1", {
      ownerId: "injected",
      deviceId: "injected",
      expiresAt: now + 999999,
      snapshotId: "snapshot-1",
    });
    expect(ledger.parseCursor(cursor, "device-1", "1")).toMatchObject({
      ownerId: "owner-1",
      deviceId: "device-1",
      expiresAt: now + 300000,
      snapshotId: "snapshot-1",
    });
    expect(() => ledger.parseCursor(cursor + "x", "device-1", "1")).toThrow(
      "cursor_expired",
    );
    expect(() => ledger.parseCursor(cursor, "device-2", "1")).toThrow(
      "cursor_expired",
    );
    expect(() => ledger.parseCursor(cursor, "device-1", "2")).toThrow(
      "cursor_expired",
    );
    now += 300000;
    expect(() => ledger.parseCursor(cursor, "device-1", "1")).toThrow(
      "cursor_expired",
    );
  });
  // @lat: [[mobile-data#Mobile data#Owner event retention]]
  it("persists ordered Owner events, expires gaps and rolls back invalid event writes", () => {
    const ledger = open();
    ledger.publish(permission());
    expect(open().eventsAfter("0")).toHaveLength(1);
    const before = readFileSync(file, "utf8");
    expect(() => ledger.publish({ type: "bogus" })).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(ledger.changeSeq).toBe("1");
    now += 7 * 86400000 + 1;
    ledger.publish(permission());
    expect(() => ledger.eventsAfter("0")).toThrow("cursor_expired");
    expect(ledger.eventsAfter("1")).toHaveLength(1);
    expect(() => ledger.eventsAfter("3")).toThrow("cursor_expired");
    now += 7 * 86400000 + 1;
    expect(() => ledger.eventsAfter("1")).toThrow("cursor_expired");
    expect(ledger.eventsAfter("2")).toEqual([]);
  });
  // @lat: [[mobile-data#Mobile data#Ledger storage integrity]]
  it("preserves extensions and fails closed on malformed state, binding mismatches and invalid read positions", () => {
    open();
    const value = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...value, extension: { preserve: true } }),
    );
    open().accept(request());
    expect(JSON.parse(readFileSync(file, "utf8")).extension).toEqual({
      preserve: true,
    });
    const valid = readFileSync(file, "utf8");
    expect(() => new MobileOwnerLedger(file, "other-owner", "space-1")).toThrow(
      "mobile_ledger_invalid",
    );
    expect(readFileSync(file, "utf8")).toBe(valid);
    writeFileSync(
      file,
      JSON.stringify({
        ...value,
        readPositions: { device: { conversation: "-1" } },
      }),
    );
    const invalid = readFileSync(file, "utf8");
    expect(() => open()).toThrow("mobile_ledger_invalid");
    expect(readFileSync(file, "utf8")).toBe(invalid);
    writeFileSync(file, "broken");
    expect(() => open()).toThrow("mobile_ledger_invalid");
  });
  // @lat: [[mobile-data#Mobile data#Ledger failed persistence]]
  it("does not return an accepted receipt or consume a message sequence if atomic replacement fails", () => {
    const ledger = open();
    const saved = readFileSync(file, "utf8");
    rmSync(file);
    mkdirSync(file);
    expect(() => ledger.accept(request())).toThrow();
    expect(ledger.operation(request())).toBeNull();
    expect(() =>
      ledger.indexMessages("constructor", [message("constructor")]),
    ).toThrow();
    rmSync(file, { recursive: true });
    writeFileSync(file, saved);
    expect(
      ledger.indexMessages("constructor", [message("constructor")])[0]
        .messageSeq,
    ).toBe("1");
    expect(ledger.accept(request()).status).toBe("accepted");
  });
});
