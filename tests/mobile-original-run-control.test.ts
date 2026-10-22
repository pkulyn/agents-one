import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { AgentRuntimeRun } from "../src/shared/agent-runtimes";
import type { Json } from "../src/main/mobile-control/conversation-projection";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { OriginalMobileRunControl } from "../src/main/mobile-control/original-run-control";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
let root: string,
  ledger: MobileOwnerLedger,
  run: Json | undefined,
  native: AgentRuntimeRun | null,
  scheduled: boolean,
  locked: boolean,
  control: OriginalMobileRunControl;
const cancel = vi.fn();
function setup(): void {
  control = new OriginalMobileRunControl(
    { sync: async () => {}, list: () => (run ? [run] : []), get: () => run },
    ledger,
    {
      guard: () => {
        if (locked) throw Error("owner_unavailable");
      },
      scheduled: () => scheduled,
      native: async () => native,
      cancel,
    },
  );
}
function request(
  key = "mutation-1",
  scopes = ["conversation:advance"],
): OwnerControlRequest {
  const mutation = `00000000-0000-4000-8000-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/runs/run-1/cancel`,
    route = resolveMobileRoute("POST", path)!;
  return {
    requestId: "cancel-request",
    method: "POST",
    path,
    operationId: route.route.operationId,
    params: route.params,
    headers: { "idempotency-key": mutation, "x-client-mutation-id": mutation },
    query: {},
    body: {},
    signal: new AbortController().signal,
    device: {
      ownerId: "owner-1",
      spaceId: "space-1",
      deviceId: "phone-1",
      grantRevision: "1",
      scopes,
      revoked: false,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  };
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-original-cancel-"));
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  run = {
    runId: "run-1",
    runtimeId: "runtime-1",
    conversationId: "original",
    status: "running",
  };
  native = {
    id: "run-1",
    runtimeId: "runtime-1",
    status: "running",
    startedAt: 1000,
  };
  scheduled = false;
  locked = false;
  cancel.mockReset();
  cancel.mockImplementation(async () => ({ accepted: true, run: native }));
  setup();
});
afterEach(() => {
  const rel = relative(realpathSync(tmpdir()), realpathSync(root));
  if (
    isAbsolute(rel) ||
    rel.startsWith("..") ||
    !rel.startsWith("agents-one-original-cancel-")
  )
    throw Error("unsafe cleanup");
  rmSync(root, { recursive: true, force: true });
});
// @lat: [[mobile-data#Mobile data#Original cancellation receipt without terminal invention]]
it("persists acceptance before Main control, serializes duplicate keys and replays after restart without inventing terminal state", async () => {
  const req = request();
  cancel.mockImplementation(async () => {
    expect(ledger.operation(req)?.status).toBe("accepted");
    return { accepted: true, run: native };
  });
  const results = await Promise.all([control.cancel(req), control.cancel(req)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0]).toMatchObject({
    status: "applied",
    resultRef: { runId: "run-1", conversationId: "original" },
  });
  expect(cancel).toHaveBeenCalledOnce();
  expect(run!.status).toBe("running");
  ledger = new MobileOwnerLedger(
    join(root, "ledger.json"),
    "owner-1",
    "space-1",
  );
  setup();
  expect(await control.cancel(req)).toEqual(results[0]);
  expect(cancel).toHaveBeenCalledOnce();
});
// @lat: [[mobile-data#Mobile data#Original cancellation unknown outcome retention]]
it("retains uncertain acknowledgement and persistence outcomes without sending Main control again", async () => {
  const req = request();
  cancel.mockRejectedValue(Error("unknown network result"));
  await expect(control.cancel(req)).rejects.toMatchObject({
    code: "reconciliation_required",
  });
  expect(ledger.operation(req)?.status).toBe("reconciliation_required");
  await control.cancel(req);
  expect(cancel).toHaveBeenCalledOnce();
  cancel.mockResolvedValue({ accepted: true, run: native });
  const next = request("mutation-2");
  vi.spyOn(ledger, "complete").mockImplementationOnce(() => {
    throw Error("disk unavailable");
  });
  await expect(control.cancel(next)).rejects.toMatchObject({
    code: "reconciliation_required",
  });
  expect(ledger.operation(next)?.status).toBe("reconciliation_required");
  await control.cancel(next);
  expect(cancel).toHaveBeenCalledTimes(2);
});
// @lat: [[mobile-data#Mobile data#Original cancellation known rejection and terminal replay]]
it("records explicit rejection and handles proven terminal history without sending another control", async () => {
  cancel.mockResolvedValue({ accepted: false, run: native });
  const req = request();
  await expect(control.cancel(req)).rejects.toMatchObject({
    code: "requires_owner_action",
  });
  expect(ledger.operation(req)?.status).toBe("rejected");
  await control.cancel(req);
  expect(cancel).toHaveBeenCalledOnce();
  run!.status = "succeeded";
  native = null;
  expect(await control.cancel(request("terminal-key"))).toMatchObject({
    status: "applied",
  });
  expect(cancel).toHaveBeenCalledOnce();
});
// @lat: [[mobile-data#Mobile data#Original cancellation scope and source admission]]
it("refuses schedule-only permissions, scheduled ownership, revoked grants, missing sources and foreign native identities before control", async () => {
  await expect(
    control.cancel(request("no-scope", ["schedule:cancel"])),
  ).rejects.toMatchObject({ code: "scope_denied" });
  scheduled = true;
  expect(control.scope("run-1")).toBe("schedule:cancel");
  await expect(control.cancel(request())).rejects.toMatchObject({
    code: "scope_denied",
  });
  scheduled = false;
  const revoked = request();
  revoked.device.revoked = true;
  await expect(control.cancel(revoked)).rejects.toMatchObject({
    code: "revoked",
  });
  locked = true;
  await expect(control.cancel(request())).rejects.toThrow("owner_unavailable");
  locked = false;
  native!.runtimeId = "foreign";
  await expect(control.cancel(request())).rejects.toMatchObject({
    code: "requires_owner_action",
  });
  native = null;
  await expect(control.cancel(request())).rejects.toMatchObject({
    code: "reconciliation_required",
  });
  run = undefined;
  await expect(control.cancel(request())).rejects.toMatchObject({
    code: "resource_not_found",
  });
  expect(cancel).not.toHaveBeenCalled();
  expect(ledger.operations("phone-1")).toEqual([]);
});
// @lat: [[mobile-data#Mobile data#Original cancellation malformed control refusal]]
it("refuses swapped routes and failure to persist acceptance before any Main control", async () => {
  const req = request();
  req.params.id = "foreign";
  await expect(control.cancel(req)).rejects.toMatchObject({
    code: "scope_denied",
  });
  vi.spyOn(ledger, "accept").mockImplementationOnce(() => {
    throw Error("ledger unavailable");
  });
  await expect(control.cancel(request())).rejects.toThrow("ledger unavailable");
  expect(cancel).not.toHaveBeenCalled();
});
