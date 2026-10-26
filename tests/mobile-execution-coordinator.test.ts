import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AgentRuntimeRun,
  AgentRuntimeDefinition,
} from "../src/shared/agent-runtimes";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import type {
  OwnerExecutionBackend,
  OwnerExecutionStore,
} from "../src/main/mobile-control/execution-types";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { MobileExecutionCoordinator } from "../src/main/mobile-control/execution-coordinator";
import { createDesktopMobileArtifacts } from "../src/main/mobile-control/desktop-artifacts";
import { DesktopConversationRepository } from "../src/main/mobile-control/desktop-conversations";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import { projectRuntimeConversation } from "../src/main/mobile-control/conversation-projection";
import {
  assertMobileSchema,
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";

const state = vi.hoisted(() => ({
  root: "",
  getRun: vi.fn(),
  resolvePath: vi.fn(),
}));
vi.mock("../src/main/agent-runtimes", () => ({
  getAgentRuntimeRun: state.getRun,
  resolveAgentRuntimeArtifactPath: state.resolvePath,
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
    getActiveProfileNameSync: () => "owner",
    profileHome: (profile: string) => join(state.root, profile),
    safeWriteFile: (file: string, body: string) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    },
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
let original: typeof import("../src/main/runtime-conversation-store");
let store: OwnerExecutionStore;
let ledger: MobileOwnerLedger;
let file: string;
const coordinators: MobileExecutionCoordinator[] = [];
const now = Date.parse("2026-10-05T00:00:00Z");
const runtime: AgentRuntimeDefinition = {
  id: "runtime-1",
  name: "Original runtime",
  kind: "codex",
  location: "local",
  enabled: true,
  managed: "user",
  config: {},
};
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function request(
  overrides: Partial<OwnerControlRequest> = {},
): OwnerControlRequest {
  const value = {
    requestId: "request-1",
    method: "POST",
    path: "/conversations/conversation-1/turns",
    operationId: "createTurn",
    params: { id: "conversation-1" },
    query: {},
    headers: { "idempotency-key": "mutation-1", "if-match": '"1"' },
    body: {
      text: "Advance actual original task",
      executionPolicyId: "policy-1",
    },
    device: {
      deviceId: "device-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      scopes: ["conversation:read", "conversation:advance"],
      grantRevision: "1",
      expiresAt: "2026-10-06T00:00:00Z",
      revoked: false,
    },
    signal: new AbortController().signal,
    ...overrides,
  };
  value.path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${value.path}`;
  value.params = resolveMobileRoute(value.method, value.path)!.params;
  value.headers["x-client-mutation-id"] = value.headers["idempotency-key"];
  if (value.method !== "GET" && value.body && typeof value.body === "object")
    value.body = {
      ...value.body,
      clientMutationId: value.headers["idempotency-key"],
    };
  return value;
}
const native = (changes: Partial<AgentRuntimeRun> = {}): AgentRuntimeRun => ({
  id: "run-1",
  runtimeId: runtime.id,
  status: "succeeded",
  startedAt: now,
  completedAt: now + 1,
  output: "Actual original final reply",
  sessionId: "native-session-1",
  ...changes,
});
function backend(result = native()): OwnerExecutionBackend {
  return {
    authorize: vi.fn(() => ({
      policyId: "policy-1",
      runtime,
      task: { mode: "analysis" },
    })),
    start: vi.fn(async (_id, _input, options) => {
      await options.persistBeforeDispatch!(
        native({ status: "running", output: undefined }),
      );
      return result;
    }),
    get: vi.fn(async () => result),
    cancel: vi.fn(async () => ({ accepted: true, run: result })),
  };
}
function coordinator(
  implementation: OwnerExecutionBackend,
  delay = () => Promise.resolve(),
  owner = ledger,
): MobileExecutionCoordinator {
  const value = new MobileExecutionCoordinator(
    store,
    implementation,
    owner,
    delay,
    () => now,
  );
  coordinators.push(value);
  return value;
}
beforeEach(async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-execution-coordinator-"));
  vi.resetModules();
  original = await import("../src/main/runtime-conversation-store");
  original.saveRuntimeConversation({
    profile: "owner",
    id: "conversation-1",
    title: "Original title",
    runtimeId: runtime.id,
    runtimeName: runtime.name,
    runtimeKind: runtime.kind,
    runtimeLocation: runtime.location,
    messages: [],
  });
  file = join(state.root, "ledger.json");
  ledger = new MobileOwnerLedger(file, "owner-1", "space-1", () => now);
  store = {
    get: (id) =>
      original.getRuntimeConversation(id, "owner", { fullHistory: true }),
    projectId: (value) => value.workspaceId,
    begin: (id, revision, runId, message) =>
      original.beginRuntimeConversationTurn(
        id,
        revision,
        runId,
        message,
        "owner",
      ),
    finish: (id, runId, checkpoint) =>
      original.completeRuntimeConversationTurn(
        id,
        runId,
        checkpoint.message,
        checkpoint.sessionId,
        "owner",
      ),
  };
});
afterEach(async () => {
  for (const value of coordinators.splice(0)) value.dispose();
  rmSync(state.root, { recursive: true, force: true });
});

describe("Owner Main execution coordinator", () => {
  it("accepts the projectless automatic policy and dispatches it as safe-write", async () => {
    const implementation = backend();
    implementation.authorize = vi.fn((policyId) => ({
      policyId,
      runtime,
      task: { mode: "safe_write" },
    }));
    const work = coordinator(implementation);
    await work.createTurn(
      request({
        body: {
          text: "Research without a project",
          executionPolicyId: "desktop-task-auto",
        },
      }),
    );
    await work.waitForIdle();
    expect(implementation.start).toHaveBeenCalledWith(
      runtime.id,
      expect.objectContaining({ mode: "safe_write", workspaceId: undefined }),
      expect.anything(),
    );
  });

  it("continues a full-access conversation when the current desktop policy explicitly confirms full access", async () => {
    const full = backend();
    full.authorize = vi.fn((policyId) => ({
      policyId,
      runtime,
      task: { mode: "full_access", fullAccessConfirmed: true },
    }));
    original.saveRuntimeConversation({
      ...store.get("conversation-1")!,
      profile: "owner",
      accessMode: "full_access",
    });
    const fullWork = coordinator(full);
    await fullWork.createTurn(
      request({
        headers: {
          "idempotency-key": "full-access-confirmed",
          "if-match": '"2"',
        },
        body: {
          text: "Explicitly authorized full access",
          executionPolicyId: "desktop-task-full",
        },
      }),
    );
    await fullWork.waitForIdle();
    expect(full.start).toHaveBeenCalledWith(
      runtime.id,
      expect.objectContaining({
        mode: "full_access",
        fullAccessConfirmed: true,
      }),
      expect.anything(),
    );
  });

  it("rejects unconfirmed full access and legacy unscoped writes before dispatch", async () => {
    const unconfirmed = backend();
    unconfirmed.authorize = vi.fn((policyId) => ({
      policyId,
      runtime,
      task: { mode: "full_access" },
    }));
    const denied = coordinator(unconfirmed);
    await expect(
      denied.createTurn(
        request({
          headers: { "idempotency-key": "unconfirmed-full", "if-match": '"1"' },
          body: {
            text: "No confirmation",
            executionPolicyId: "desktop-task-full",
          },
        }),
      ),
    ).rejects.toThrow("unverified_policy");
    expect(unconfirmed.start).not.toHaveBeenCalled();

    const legacyWrite = backend();
    legacyWrite.authorize = vi.fn((policyId) => ({
      policyId,
      runtime,
      task: { mode: "safe_write" },
    }));
    await expect(
      coordinator(legacyWrite).createTurn(
        request({
          headers: { "idempotency-key": "legacy-unscoped", "if-match": '"1"' },
          body: {
            text: "Legacy unscoped write",
            executionPolicyId: "policy-1",
          },
        }),
      ),
    ).rejects.toThrow("unverified_policy");
    expect(legacyWrite.start).not.toHaveBeenCalled();
  });

  it("publishes original artifact metadata in the durable final Run and serves scoped snapshot and binary routes without changing the final checkpoint on retry", async () => {
    let clock = now;
    const result = native({
      completedAt: undefined,
      artifacts: [
        {
          kind: "final",
          id: "original-final-file",
          label: "result.txt",
          content: "Explicit artifact bytes",
        },
      ],
    });
    state.getRun.mockResolvedValue(result);
    state.resolvePath.mockReturnValue(null);
    const artifacts = createDesktopMobileArtifacts(
      new DesktopConversationRepository("owner"),
      ledger,
      () => {},
    );
    const finish = store.finish;
    let saves = 0;
    store.finish = (id, runId, checkpoint) => {
      if (++saves === 1) throw Error("temporary storage failure");
      return finish(id, runId, checkpoint);
    };
    const implementation = backend(result);
    const work = new MobileExecutionCoordinator(
      store,
      implementation,
      ledger,
      async () => {
        clock++;
      },
      () => clock,
      artifacts,
    );
    coordinators.push(work);
    await work.createTurn(request());
    await work.waitForIdle();
    expect(saves).toBe(2);
    expect(implementation.start).toHaveBeenCalledTimes(1);
    const entry = ledger.execution("run-1")!;
    expect(entry.phase).toBe("terminal");
    expect(entry.run.completedAt).toBe(new Date(now).toISOString());
    const originalRow = store.get("conversation-1")!;
    expect(originalRow.messages).toHaveLength(2);
    expect(originalRow.messages[1].content).toBe(result.output);
    expect(originalRow.messages[1].execution?.artifacts?.[0].id).toBe(
      "original-final-file",
    );
    const [metadata] = entry.run.artifacts as Array<Record<string, unknown>>;
    expect(metadata.runId).toBe("run-1");
    expect(metadata.id).not.toBe("original-final-file");
    const controller = new MobileConversationController(
      {
        list: () => [projectRuntimeConversation(store.get("conversation-1")!)],
        get: () => projectRuntimeConversation(store.get("conversation-1")!),
        patch: () => {
          throw Error();
        },
      },
      ledger,
      "Owner",
      () => now,
      work,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      artifacts,
    );
    function read(
      path: string,
      operationId: string,
      scope = true,
    ): OwnerControlRequest {
      const req = request({ method: "GET", path, operationId, body: null });
      if (scope) req.device.scopes.push("artifact:read");
      return req;
    }
    const denied = await controller.handle(
      read("/runs/run-1", "getRun", false),
    );
    expect((denied.body as Record<string, unknown>).artifacts).toEqual([]);
    await expect(
      controller.handle(
        read(`/artifacts/${metadata.id}`, "getArtifact", false),
      ),
    ).rejects.toMatchObject({ code: "scope_denied" });
    expect(
      (
        await controller.handle(
          read(`/artifacts/${metadata.id}`, "getArtifact"),
        )
      ).body,
    ).toEqual(metadata);
    const snapshot = await controller.handle(read("/snapshots", "getSnapshot"));
    expect(
      (snapshot.body as { runs: Array<Record<string, unknown>> }).runs[0]
        .artifacts,
    ).toEqual([metadata]);
    const response = await controller.handle(
      read(`/artifacts/${metadata.id}/content`, "downloadArtifact"),
    );
    expect(response.status).toBe(200);
    expect(response.download!.metadata).toEqual(metadata);
    const chunks: Buffer[] = [];
    for await (const chunk of response.download!.chunks)
      chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("Explicit artifact bytes");
  });
  it("retains original history and marks a provider session mismatch uncertain without accepting a substituted reply", async () => {
    original.saveRuntimeConversation({
      ...store.get("conversation-1")!,
      profile: "owner",
      runtimeSessionId: "original-native-session",
    });
    const implementation = backend();
    const work = coordinator(implementation);
    await work.createTurn(
      request({
        headers: { "idempotency-key": "mutation-1", "if-match": '"2"' },
      }),
    );
    await work.waitForIdle();
    expect(implementation.start).toHaveBeenCalledTimes(1);
    expect(ledger.execution("run-1")?.phase).toBe("reconciliation_required");
    expect(store.get("conversation-1")).toMatchObject({
      runtimeSessionId: "original-native-session",
      messages: [expect.objectContaining({ role: "user" })],
    });
    expect(store.get("conversation-1")?.messages).toHaveLength(1);
  });
  it("durably accepts the original Turn before external dispatch finishes and survives phone disconnect", async () => {
    const started = deferred<AgentRuntimeRun>();
    const implementation = backend();
    implementation.start = vi.fn(async (_id, input, options) => {
      expect(input).toMatchObject({
        prompt: "Advance actual original task",
        conversation: true,
        mode: "analysis",
      });
      await options.persistBeforeDispatch!(native({ status: "running" }));
      // This is the real dispatch boundary: both files must already contain original identity.
      const evidence = JSON.parse(readFileSync(file, "utf8"));
      expect(evidence.executions["run-1"].phase).toBe("dispatching");
      expect(Object.values(evidence.operations)[0]).toMatchObject({
        receipt: { status: "accepted" },
      });
      expect(store.get("conversation-1")).toMatchObject({
        activeRuntimeRunId: "run-1",
        messages: [expect.objectContaining({ role: "user" })],
      });
      return started.promise;
    });
    const disconnect = new AbortController();
    const work = coordinator(implementation);
    const receipt = await work.createTurn(
      request({ signal: disconnect.signal }),
    );
    assertMobileSchema("OperationReceipt", receipt);
    expect(receipt.status).toBe("accepted");
    disconnect.abort();
    original.patchRuntimeConversation(
      "conversation-1",
      { title: "Desktop concurrent rename", pinned: true, archived: true },
      "2",
      "owner",
    );
    started.resolve(native());
    await work.waitForIdle();
    expect(implementation.cancel).not.toHaveBeenCalled();
    expect(store.get("conversation-1")).toMatchObject({
      title: "Desktop concurrent rename",
      pinned: true,
      archived: true,
      runtimeSessionId: "native-session-1",
      messages: [
        expect.objectContaining({ role: "user" }),
        expect.objectContaining({ content: "Actual original final reply" }),
      ],
    });
    expect(ledger.execution("run-1")?.phase).toBe("terminal");
    expect(ledger.eventsAfter("0").at(-1)?.payload).toMatchObject({
      status: "succeeded",
    });
    expect(readFileSync(file, "utf8")).not.toContain(
      "Actual original final reply",
    );
  });
  it("replays duplicate requests once and resumes the exact native session on the next original turn", async () => {
    const implementation = backend();
    const work = coordinator(implementation);
    const first = await work.createTurn(request());
    expect(await work.createTurn(request())).toMatchObject({
      operationId: first.operationId,
    });
    await work.waitForIdle();
    await expect(
      Promise.resolve().then(() =>
        work.createTurn(
          request({
            body: { text: "Changed payload", executionPolicyId: "policy-1" },
          }),
        ),
      ),
    ).rejects.toThrow("idempotency_conflict");
    implementation.start = vi.fn(async (_id, input, options) => {
      expect(input.sessionId).toBe("native-session-1");
      await options.persistBeforeDispatch!(
        native({ id: "run-2", status: "running" }),
      );
      return native({ id: "run-2", output: "Next reply" });
    });
    await work.createTurn(
      request({
        headers: { "idempotency-key": "mutation-2", "if-match": '"3"' },
      }),
    );
    await work.waitForIdle();
    expect(store.get("conversation-1")?.messages).toHaveLength(4);
    expect(ledger.executionEntries()).toHaveLength(2);
  });
  it("keeps a final checkpoint after disk failure and recovers only the original commit across restart", async () => {
    const finish = store.finish;
    store.finish = vi.fn(() => {
      throw Error("synthetic disk unavailable");
    });
    const gate = deferred<void>();
    const work = coordinator(backend(), () => gate.promise);
    await work.createTurn(request());
    await vi.waitFor(() =>
      expect(ledger.execution("run-1")?.checkpoint).toBeDefined(),
    );
    expect(
      ledger
        .eventsAfter("0")
        .some(
          (event) =>
            (event.payload as Record<string, unknown>).status === "succeeded",
        ),
    ).toBe(false);
    work.dispose();
    gate.resolve();
    await work.waitForIdle();
    store.finish = finish;
    const recovered = new MobileOwnerLedger(
      file,
      "owner-1",
      "space-1",
      () => now,
    );
    const implementation = backend();
    const recovery = coordinator(implementation, undefined, recovered);
    await recovery.retryPendingFinals();
    await recovery.retryPendingFinals();
    expect(implementation.start).not.toHaveBeenCalled();
    expect(store.get("conversation-1")?.messages).toHaveLength(2);
    expect(recovered.execution("run-1")?.phase).toBe("terminal");
    expect(readFileSync(file, "utf8")).not.toContain(
      "Actual original final reply",
    );
  });
  it("keeps a transient observation error alive but marks a lost native handle uncertain without dispatch retry", async () => {
    const implementation = backend(native({ status: "running" }));
    implementation.get = vi
      .fn()
      .mockRejectedValueOnce(Error("temporary observer failure"))
      .mockResolvedValueOnce(null);
    const work = coordinator(implementation);
    await work.createTurn(request());
    await work.waitForIdle();
    expect(implementation.get).toHaveBeenCalledTimes(2);
    expect(implementation.start).toHaveBeenCalledTimes(1);
    expect(ledger.execution("run-1")?.phase).toBe("reconciliation_required");
    expect(store.get("conversation-1")?.messages).toHaveLength(1);
    expect((await work.createTurn(request())).status).toBe("applied");
    await expect(
      work.createTurn(
        request({
          headers: { "idempotency-key": "mutation-2", "if-match": '"2"' },
        }),
      ),
    ).rejects.toThrow("run_active");
  });
  it("reports cancelling until actual terminal evidence and never equates acknowledgement with cancellation", async () => {
    const gate = deferred<void>();
    const implementation = backend(native({ status: "running" }));
    implementation.get = vi.fn(async () =>
      native({
        status: "cancelled",
        output: "Visible reply before cancellation",
        error: "Cancelled",
      }),
    );
    const work = coordinator(implementation, () => gate.promise);
    await work.createTurn(request());
    await vi.waitFor(() =>
      expect(ledger.execution("run-1")?.phase).toBe("running"),
    );
    const cancel = request({
      path: "/runs/run-1/cancel",
      operationId: "cancelRun",
      params: { id: "run-1" },
      headers: { "idempotency-key": "cancel-1" },
      body: {},
    });
    expect((await work.cancelRun(cancel)).status).toBe("applied");
    expect(ledger.execution("run-1")?.run.status).toBe("cancelling");
    expect(await work.cancelRun(cancel)).toMatchObject({ status: "applied" });
    expect(implementation.cancel).toHaveBeenCalledTimes(1);
    gate.resolve();
    await work.waitForIdle();
    expect(ledger.execution("run-1")?.run.status).toBe("cancelled");
    expect(store.get("conversation-1")?.messages.at(-1)).toMatchObject({
      role: "agent",
      content: "Visible reply before cancellation",
    });
  });
  it("keeps an unacknowledged cancellation uncertain and does not reissue it after retry", async () => {
    const gate = deferred<void>();
    const implementation = backend(native({ status: "running" }));
    implementation.cancel = vi.fn(async () => {
      throw Error("lost cancellation acknowledgement");
    });
    const work = coordinator(implementation, () => gate.promise);
    await work.createTurn(request());
    await vi.waitFor(() =>
      expect(ledger.execution("run-1")?.phase).toBe("running"),
    );
    const cancel = request({
      path: "/runs/run-1/cancel",
      operationId: "cancelRun",
      params: { id: "run-1" },
      headers: { "idempotency-key": "cancel-1" },
      body: {},
    });
    await expect(work.cancelRun(cancel)).rejects.toThrow(
      "lost cancellation acknowledgement",
    );
    expect((await work.cancelRun(cancel)).status).toBe(
      "reconciliation_required",
    );
    expect(implementation.cancel).toHaveBeenCalledTimes(1);
    work.dispose();
    gate.resolve();
    await work.waitForIdle();
  });
  it("denies invalid grants, stale revisions, unconfirmed legacy full access and changed policy before any external dispatch", async () => {
    const implementation = backend();
    const work = coordinator(implementation);
    const unauthorized = request({
      device: { ...request().device, expiresAt: "invalid" },
    });
    await expect(work.createTurn(unauthorized)).rejects.toThrow("revoked");
    await expect(
      work.getRun(
        request({
          device: unauthorized.device,
          method: "GET",
          path: "/runs/run-1",
          operationId: "getRun",
          params: { id: "run-1" },
          headers: {},
          body: undefined,
        }),
      ),
    ).rejects.toThrow("revoked");
    await expect(
      work.createTurn(
        request({
          headers: { "idempotency-key": "mutation-1", "if-match": '"9"' },
        }),
      ),
    ).rejects.toThrow("revision_conflict");
    const existing = store.get("conversation-1")!;
    original.saveRuntimeConversation({
      ...existing,
      profile: "owner",
      accessMode: "full_access",
    });
    implementation.authorize = vi.fn(() => ({
      policyId: "policy-1",
      runtime,
      task: { mode: "full_access", fullAccessConfirmed: true },
    }));
    await expect(
      work.createTurn(
        request({
          headers: { "idempotency-key": "mutation-1", "if-match": '"2"' },
        }),
      ),
    ).rejects.toThrow("unverified_policy");
    expect(implementation.start).not.toHaveBeenCalled();
    original.saveRuntimeConversation({
      ...store.get("conversation-1")!,
      profile: "owner",
      accessMode: "analysis",
    });
    implementation.authorize = vi
      .fn()
      .mockReturnValueOnce({
        policyId: "policy-1",
        runtime,
        task: { mode: "analysis", timeoutMs: 1000 },
      })
      .mockReturnValueOnce({
        policyId: "policy-1",
        runtime,
        task: { mode: "analysis", timeoutMs: 500 },
      });
    await expect(
      work.createTurn(
        request({
          headers: { "idempotency-key": "mutation-1", "if-match": '"3"' },
        }),
      ),
    ).rejects.toThrow("policy_revoked");
    expect(ledger.executionEntries()).toEqual([]);
    expect(store.get("conversation-1")?.messages).toEqual([]);
  });
});
