import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  OwnerControlHandler,
  OwnerControlRequest,
} from "../src/main/mobile-control/owner-tunnel";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";

const state = vi.hoisted(() => ({
  root: "",
  handler: undefined as OwnerControlHandler | undefined,
  start: vi.fn(),
  stop: vi.fn(),
  unsubscribe: vi.fn(),
  changed: undefined as (() => void) | undefined,
  dispatch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock(
  "../src/main/mobile-control/desktop-policy-authority",
  async (original) => ({
    ...(await original<
      typeof import("../src/main/mobile-control/desktop-policy-authority")
    >()),
    refreshDesktopExecutionApprovals: state.refresh,
  }),
);
vi.mock("../src/main/utils", () => {
  const mocked = {
    getActiveProfileNameSync: () => "owner",
    profileHome: (profile: string) => join(state.root, profile),
    safeWriteFile: (file: string, data: string) => {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/mobile-connection", () => ({
  isMobileConnectionChanging: () => false,
  mobileOwnerBinding: async () => ({
    endpoint: "https://relay.example",
    ownerId: "owner-1",
    spaceId: "space-1",
    hostCredential: "private",
    signingPublicKey: "fixed",
  }),
  onMobileConnectionChanged: (listener: () => void) => {
    state.changed = listener;
    return state.unsubscribe;
  },
}));
vi.mock("../src/main/agent-runtimes", () => ({
  listAgentRuntimes: () => [
    {
      id: "original-runtime",
      name: "Original agent",
      kind: "codex",
      location: "local",
      enabled: true,
      managed: "user",
      config: {},
    },
  ],
  getAgentRuntimeRun: vi.fn(),
  resolveAgentRuntimeArtifactPath: vi.fn(() => null),
  startAgentRuntimeTask: state.dispatch,
  requestAgentRuntimeTaskCancellation: vi.fn(),
  cancelAgentRuntimeTask: vi.fn(),
}));
vi.mock("../src/main/mobile-control/owner-tunnel", () => ({
  MobileOwnerTunnel: class {
    constructor(_binding: unknown, handler: OwnerControlHandler) {
      state.handler = handler;
    }
    start(): void {
      state.start();
    }
    stop(): void {
      state.stop();
    }
  },
}));
vi.mock("../src/main/mobile-control/owner-ledger-client", async () => {
  const { MobileOwnerLedger } =
    await import("../src/main/mobile-control/owner-ledger");
  return {
    MobileOwnerLedgerClient: class extends MobileOwnerLedger {
      async whenReady(): Promise<void> {}
    },
  };
});
vi.mock("../src/main/mobile-control/owner-tunnel-process", () => ({
  MobileOwnerTunnelProcess: class {
    constructor(
      _binding: unknown,
      private readonly handler: OwnerControlHandler,
    ) {}
    start(): void {
      state.handler = this.handler;
      state.start();
    }
    stop(): void {
      state.stop();
    }
  },
}));
let stop: (() => void) | undefined;
it("reads the original runner live state through the production Owner without requiring execution approval", async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  mkdirSync(join(state.root, "owner"), { recursive: true });
  state.handler = undefined;
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  const schedules = await import("../src/main/task-schedules");
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.handler).toBeDefined());
  expect(await state.handler!.status()).toMatchObject({
    schedulerOnline: false,
    executionAvailable: true,
  });
  schedules.startTaskScheduleRunner();
  try {
    expect(await state.handler!.status()).toMatchObject({
      schedulerOnline: true,
      executionAvailable: true,
    });
  } finally {
    await schedules.stopTaskScheduleRunnerAndWait();
  }
  expect(await state.handler!.status()).toMatchObject({
    schedulerOnline: false,
  });
  expect(state.dispatch).not.toHaveBeenCalled();
}, 15000);
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.clearAllMocks();
  rmSync(state.root, { recursive: true, force: true });
});
it("renews current Owner authority without phone requests and stops the renewal timer during disposal", async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  stop = startDesktopMobileOwner();
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.refresh).toHaveBeenCalledOnce();
  expect(state.refresh).toHaveBeenCalledWith("owner", expect.anything(), 60000);
  expect(state.dispatch).not.toHaveBeenCalled();
  stop();
  stop = undefined;
  await vi.advanceTimersByTimeAsync(60000);
  expect(state.refresh).toHaveBeenCalledOnce();
});
function request(suffix: string): OwnerControlRequest {
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${suffix}`;
  const route = resolveMobileRoute("GET", path)!;
  return {
    requestId: "request",
    method: "GET",
    path,
    operationId: route.route.operationId,
    params: route.params,
    query: {},
    headers: {},
    body: null,
    signal: new AbortController().signal,
    device: {
      deviceId: "phone-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      grantRevision: "1",
      revoked: false,
      expiresAt: "2099-01-01T00:00:00Z",
      scopes: ["conversation:read", "schedule:read"],
    },
  };
}
it("creates an original conversation from desktop task selections without any approval document or model dispatch", async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  mkdirSync(join(state.root, "owner"), { recursive: true });
  state.handler = undefined;
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.handler).toBeDefined());
  const page = (await state.handler!.handle(request("/execution-policies")))
    .body as {
    items: Array<{
      id: string;
      runtimeId: string;
      mode: string;
      projectId: string | null;
    }>;
  };
  const choice = page.items.find(
    (row) =>
      row.mode === "desktop_analysis" &&
      row.runtimeId === "original-runtime" &&
      row.projectId === null,
  )!;
  expect(choice.id).toMatch(/^desktop-task-[a-f0-9]{64}$/);
  const mutation = request("/conversations");
  mutation.method = "POST";
  const route = resolveMobileRoute(mutation.method, mutation.path)!;
  mutation.operationId = route.route.operationId;
  mutation.params = route.params;
  mutation.device.scopes.push("conversation:create");
  mutation.headers = {
    "idempotency-key": "new-desktop-selection",
    "x-client-mutation-id": "new-desktop-selection",
  };
  mutation.body = {
    runtimeId: "original-runtime",
    executionPolicyId: choice.id,
    projectId: null,
    title: "Phone selected agent",
  };
  const receipt = await state.handler!.handle(mutation);
  expect(receipt.body).toMatchObject({
    status: "applied",
    resourceRef: { type: "conversation" },
  });
  const original = readFileSync(
    join(state.root, "owner", "desktop", "runtime-conversations.json"),
    "utf8",
  );
  expect(original).toContain("Phone selected agent");
  expect(original).toContain("original-runtime");
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(() =>
    readFileSync(
      join(state.root, "owner", "desktop", "mobile-execution-policies.json"),
    ),
  ).toThrow();
});
it("reads ordinary desktop Runs and original artifacts through the production Owner without phone execution entries", async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  state.handler = undefined;
  const desktop = join(state.root, "owner", "desktop");
  mkdirSync(desktop, { recursive: true });
  const file = join(desktop, "runtime-conversations.json");
  const original = JSON.stringify({
    futureRoot: "preserve",
    conversations: [
      {
        id: "original",
        title: "Ordinary desktop",
        runtimeId: "original-runtime",
        runtimeName: "Agent",
        runtimeKind: "codex",
        runtimeLocation: "local",
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 1,
        messages: [
          {
            id: "message-1",
            role: "agent",
            content: "ordinary body",
            createdAt: 2000,
            execution: {
              runId: "native-original",
              events: [{ type: "completed", createdAt: 2000 }],
            },
          },
        ],
      },
    ],
  });
  writeFileSync(file, original);
  const schedules = join(desktop, "task-schedules.json"),
    scheduleBytes = JSON.stringify({ futureRoot: "preserve", schedules: [] });
  writeFileSync(schedules, scheduleBytes);
  const runtimes = await import("../src/main/agent-runtimes");
  vi.mocked(runtimes.getAgentRuntimeRun).mockResolvedValue({
    id: "native-original",
    runtimeId: "original-runtime",
    status: "succeeded",
    startedAt: 1000,
    completedAt: 2000,
    artifacts: [
      {
        id: "native-artifact",
        kind: "file",
        label: "original.txt",
        content: "Original artifact bytes",
      },
    ],
  });
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.handler).toBeDefined());
  const req = request("/snapshots");
  req.device.scopes.push("artifact:read");
  const result = (await state.handler!.handle(req)).body as Record<
    string,
    unknown
  >;
  expect(result.runs).toMatchObject([
    {
      runId: "native-original",
      conversationId: "original",
      status: "succeeded",
      allowedActions: ["read"],
      artifacts: [{ name: "original.txt", runId: "native-original" }],
    },
  ]);
  const run = (result.runs as Array<{ artifacts: Array<{ id: string }> }>)[0],
    artifact = run.artifacts[0];
  const download = request(`/artifacts/${artifact.id}/content`);
  download.device.scopes.push("artifact:read");
  const response = await state.handler!.handle(download),
    chunks: Buffer[] = [];
  for await (const chunk of response.download!.chunks)
    chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe("Original artifact bytes");
  expect(
    (await state.handler!.handle(request("/runs/native-original"))).body,
  ).toMatchObject({ runId: "native-original", artifacts: [] });
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(readFileSync(schedules, "utf8")).toBe(scheduleBytes);
  expect(state.dispatch).not.toHaveBeenCalled();
  const oldHandler = state.handler!,
    oldEpoch = (await oldHandler.status()).dataEpoch;
  const pendingDownload = await oldHandler.handle(download);
  const { exportAgentsOneBackupTo, restoreAgentsOneBackupFrom } =
    await import("../src/main/agents-one-backup");
  const archive = join(state.root, "restore-mobile.agents-one-backup"),
    home = join(state.root, "owner");
  expect(
    (await exportAgentsOneBackupTo(archive, { sourceHome: home })).success,
  ).toBe(true);
  const restored = await restoreAgentsOneBackupFrom(archive, {
    targetHome: home,
  });
  expect(restored, restored.error).toMatchObject({ success: true });
  await expect(oldHandler.status()).rejects.toMatchObject({
    code: "owner_unavailable",
  });
  await expect(
    pendingDownload.download!.chunks[Symbol.asyncIterator]().next(),
  ).rejects.toMatchObject({ code: "owner_unavailable" });
  stop!();
  state.handler = undefined;
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.handler).toBeDefined());
  expect((await state.handler!.status()).dataEpoch).not.toBe(oldEpoch);
  const stale = request("/snapshots");
  stale.query.cursor = String(result.snapshotCursor);
  await expect(state.handler!.handle(stale)).rejects.toMatchObject({
    code: "cursor_expired",
  });
  // Native is gone after process restart. Its pre-restore artifact copy must not reappear.
  vi.mocked(runtimes.getAgentRuntimeRun).mockReset();
  const oldArtifact = request(`/artifacts/${artifact.id}`);
  oldArtifact.device.scopes.push("artifact:read");
  await expect(state.handler!.handle(oldArtifact)).rejects.toMatchObject({
    code: "resource_not_found",
  });
});
it("routes ordinary original Run cancellation to Main and filters its action for schedule-only devices", async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  state.handler = undefined;
  const desktop = join(state.root, "owner", "desktop");
  mkdirSync(desktop, { recursive: true });
  const bytes = JSON.stringify({
    conversations: [
      {
        id: "original",
        title: "Original",
        runtimeId: "original-runtime",
        runtimeName: "Agent",
        runtimeKind: "codex",
        runtimeLocation: "local",
        createdAt: 1000,
        updatedAt: 2000,
        messageCount: 0,
        messages: [],
        activeRuntimeRunId: "native-original",
      },
    ],
  });
  const file = join(desktop, "runtime-conversations.json");
  writeFileSync(file, bytes);
  writeFileSync(
    join(desktop, "task-schedules.json"),
    JSON.stringify({ schedules: [] }),
  );
  const runtimes = await import("../src/main/agent-runtimes"),
    native = {
      id: "native-original",
      runtimeId: "original-runtime",
      status: "running" as const,
      startedAt: 1000,
    };
  vi.mocked(runtimes.getAgentRuntimeRun).mockImplementation(async () => ({
    ...native,
  }));
  vi.mocked(runtimes.requestAgentRuntimeTaskCancellation).mockImplementation(
    async () => ({ accepted: true, run: { ...native } }),
  );
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.handler).toBeDefined());
  const read = request("/snapshots");
  read.device.scopes.push("schedule:cancel");
  const before = (await state.handler!.handle(read)).body as Record<
    string,
    unknown
  >;
  expect(before.runs).toMatchObject([
    { runId: "native-original", allowedActions: ["read"] },
  ]);
  const full = request("/runs/native-original");
  full.device.scopes.push("conversation:advance");
  expect((await state.handler!.handle(full)).body).toMatchObject({
    allowedActions: ["read", "cancel"],
    status: "running",
  });
  const events = request("/events"),
    abort = new AbortController();
  events.device.scopes.push("schedule:cancel");
  events.signal = abort.signal;
  events.query.cursor = String(before.snapshotCursor);
  native.startedAt = 2000;
  const iterator = (await state.handler!.handle(events)).events![
    Symbol.asyncIterator
  ]();
  expect((await iterator.next()).value).toMatchObject({
    type: "run.updated",
    payload: { allowedActions: ["read"] },
  });
  abort.abort();
  await iterator.return?.();
  const path = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1/runs/native-original/cancel`,
    route = resolveMobileRoute("POST", path)!;
  const cancel = {
    ...request("/runs/native-original"),
    method: "POST",
    path,
    operationId: route.route.operationId,
    params: route.params,
    headers: {
      "idempotency-key": "cancel-original",
      "x-client-mutation-id": "cancel-original",
    },
    body: {},
  };
  cancel.device.scopes.push("schedule:cancel");
  await expect(state.handler!.handle(cancel)).rejects.toMatchObject({
    code: "scope_denied",
  });
  expect(runtimes.requestAgentRuntimeTaskCancellation).not.toHaveBeenCalled();
  cancel.device.scopes.push("conversation:advance");
  expect((await state.handler!.handle(cancel)).body).toMatchObject({
    status: "applied",
    resourceRef: { type: "run", id: "native-original" },
  });
  await state.handler!.handle(cancel);
  expect(runtimes.requestAgentRuntimeTaskCancellation).toHaveBeenCalledOnce();
  expect((await state.handler!.handle(full)).body).toMatchObject({
    status: "running",
  });
  expect(readFileSync(file, "utf8")).toBe(bytes);
  expect(state.dispatch).not.toHaveBeenCalled();
  vi.mocked(runtimes.getAgentRuntimeRun).mockReset();
  vi.mocked(runtimes.requestAgentRuntimeTaskCancellation).mockReset();
});
it("assembles the production handler over original files, preserves bytes, and advertises only wired capabilities", async () => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-production-owner-"));
  const desktop = join(state.root, "owner", "desktop");
  mkdirSync(desktop, { recursive: true });
  const conversation = join(desktop, "runtime-conversations.json");
  const original = JSON.stringify({
    futureRoot: "preserve",
    conversations: [
      {
        id: "original-conversation",
        title: "Original title",
        runtimeId: "original-runtime",
        runtimeName: "Original agent",
        runtimeKind: "pi",
        runtimeLocation: "local",
        createdAt: 1000,
        updatedAt: 2000,
        revision: "1",
        messageCount: 1,
        messages: [
          {
            id: "original-message",
            role: "user",
            content: "Original body",
            createdAt: 1000,
          },
        ],
      },
    ],
  });
  writeFileSync(conversation, original);
  const schedules = join(desktop, "task-schedules.json");
  const scheduleBytes = JSON.stringify({
    futureRoot: "preserve",
    schedules: [],
  });
  writeFileSync(schedules, scheduleBytes);
  const { startDesktopMobileOwner } =
    await import("../src/main/mobile-control/desktop-owner");
  stop = startDesktopMobileOwner();
  await vi.waitFor(() => expect(state.start).toHaveBeenCalledTimes(1));
  const handler = state.handler!;
  expect(await handler.status()).toMatchObject({
    executionAvailable: true,
    schedulerOnline: false,
    capabilities: [
      "conversation:read",
      "conversation:manage",
      "artifact:read",
      "conversation:create",
      "conversation:advance",
      "schedule:read",
      "schedule:manage",
      "schedule:cancel",
      "schedule:trigger",
    ],
  });
  const result = await handler.handle(request("/conversations"));
  expect(result.body).toMatchObject({
    items: [
      {
        id: "original-conversation",
        title: "Original title",
        runtimeId: "original-runtime",
      },
    ],
  });
  const messages = await handler.handle(
    request("/conversations/original-conversation/messages"),
  );
  expect(messages.body).toMatchObject({
    items: [{ id: "original-message", content: "Original body" }],
  });
  expect((await handler.handle(request("/schedules"))).body).toMatchObject({
    items: [],
  });
  expect(readFileSync(conversation, "utf8")).toBe(original);
  expect(readFileSync(schedules, "utf8")).toBe(scheduleBytes);
  const controlFiles = readdirSync(join(desktop, "mobile-control"));
  expect(
    controlFiles.filter(
      (name) => name.startsWith("owner-") && name.endsWith(".json"),
    ),
  ).toHaveLength(1);
  expect(controlFiles).toContain("artifacts");
  const mutation = request("/conversations");
  mutation.method = "POST";
  const mutationRoute = resolveMobileRoute(mutation.method, mutation.path)!;
  mutation.operationId = mutationRoute.route.operationId;
  mutation.params = mutationRoute.params;
  mutation.device.scopes.push("conversation:create");
  mutation.headers = {
    "idempotency-key": "create-without-proof",
    "x-client-mutation-id": "create-without-proof",
  };
  mutation.body = {
    runtimeId: "original-runtime",
    executionPolicyId: "unapproved-policy",
  };
  await expect(handler.handle(mutation)).rejects.toMatchObject({
    code: "resource_not_found",
  });
  expect(state.dispatch).not.toHaveBeenCalled();
  expect(readFileSync(conversation, "utf8")).toBe(original);
  const boot = (await handler.handle(request("/bootstrap"))).body as {
    snapshotCursor: string;
  };
  const changed = JSON.parse(original);
  changed.conversations[0].title = "Actual original file update";
  changed.conversations[0].revision = "2";
  changed.conversations[0].messages[0].content =
    "Actual original message update";
  writeFileSync(conversation, JSON.stringify(changed));
  const abort = new AbortController();
  const stream = request("/events");
  stream.signal = abort.signal;
  stream.query.cursor = boot.snapshotCursor;
  const events = (await handler.handle(stream)).events![Symbol.asyncIterator]();
  expect((await events.next()).value).toMatchObject({
    type: "conversation.updated",
    payload: {
      id: "original-conversation",
      title: "Actual original file update",
      revision: "2",
    },
  });
  expect((await events.next()).value).toMatchObject({
    type: "message.upsert",
    payload: {
      id: "original-message",
      messageSeq: "1",
      messageRevision: "2",
      content: "Actual original message update",
    },
  });
  abort.abort();
  expect((await events.next()).done).toBe(true);
  expect(JSON.parse(readFileSync(conversation, "utf8"))).toEqual(changed);
  expect(readFileSync(schedules, "utf8")).toBe(scheduleBytes);
  stop();
  stop = undefined;
  expect(state.stop).toHaveBeenCalledTimes(1);
  expect(state.unsubscribe).toHaveBeenCalledTimes(1);
  await expect(handler.status()).rejects.toMatchObject({ status: 503 });
});
