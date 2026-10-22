import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import {
  MOBILE_CONTROL_BASE,
  resolveMobileRoute,
} from "../src/shared/mobile-control";
import type { OwnerControlRequest } from "../src/main/mobile-control/owner-tunnel";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
import type {
  ConversationRepository,
  Json,
} from "../src/main/mobile-control/conversation-projection";
import type { OwnerExecutionBackend } from "../src/main/mobile-control/execution-types";
import { MobileExecutionCoordinator } from "../src/main/mobile-control/execution-coordinator";
import { DesktopMobileCatalog } from "../src/main/mobile-control/desktop-catalog";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "owner",
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (path: string, data: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  },
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
let now: number;
let repository: ConversationRepository;
let ledger: MobileOwnerLedger;
let controller: MobileConversationController;
// @lat: [[mobile-owner-tunnel#Owner tunnel tests#Current execution availability]]
it("rechecks execution availability for every status as proof appears and expires", () => {
  let verified = false;
  const execution = new MobileExecutionCoordinator(
    {
      get: () => null,
      projectId: () => undefined,
      begin: vi.fn(),
      finish: vi.fn(),
    },
    { authorize: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn() },
    ledger,
  );
  const creation = { validate: vi.fn(), create: vi.fn() };
  const owner = new MobileConversationController(
    repository,
    ledger,
    "Desktop",
    () => now,
    execution,
    creation,
    undefined,
    undefined,
    undefined,
    undefined,
    () => verified,
  );
  expect(owner.status()).toMatchObject({
    executionAvailable: false,
    capabilities: ["conversation:read", "conversation:manage"],
  });
  verified = true;
  expect(owner.status()).toMatchObject({
    executionAvailable: true,
    capabilities: [
      "conversation:read",
      "conversation:manage",
      "conversation:create",
      "conversation:advance",
    ],
  });
  verified = false;
  expect(owner.status()).toMatchObject({
    executionAvailable: false,
    capabilities: ["conversation:read", "conversation:manage"],
  });
  expect(creation.create).not.toHaveBeenCalled();
});
const file = (): string =>
  join(state.root, "owner", "desktop", "runtime-conversations.json");
function rows(): RuntimeConversation[] {
  return ["a", "b", "c"].map((id, position) => ({
    id,
    runtimeId: "runtime-1",
    runtimeName: "Original runtime",
    runtimeKind: "pi",
    runtimeLocation: "local",
    title: `Original ${id}`,
    createdAt: 1000,
    updatedAt: 3000 - position * 1000,
    pinned: false,
    archived: false,
    revision: "1",
    messageCount: 120,
    messages: Array.from({ length: 120 }, (_, index) => ({
      id: `${id}-message-${index + 1}`,
      role: index % 2 ? "agent" : "user",
      content: `${id} original body ${index + 1}`,
      createdAt: 1000 + index,
    })),
  }));
}
beforeEach(async () => {
  now = Date.parse("2026-10-05T00:00:00Z");
  state.root = mkdtempSync(join(tmpdir(), "agents-one-owner-controller-"));
  mkdirSync(dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify({ conversations: rows() }));
  vi.resetModules();
  const { DesktopConversationRepository } =
    await import("../src/main/mobile-control/desktop-conversations");
  repository = new DesktopConversationRepository("owner");
  ledger = new MobileOwnerLedger(
    join(state.root, "ledger.json"),
    "owner-1",
    "space-1",
    () => now,
  );
  controller = new MobileConversationController(
    repository,
    ledger,
    "Synthetic desktop",
    () => now,
  );
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
function request(
  path: string,
  method = "GET",
  changes: Partial<OwnerControlRequest> = {},
): OwnerControlRequest {
  const full = `${MOBILE_CONTROL_BASE}/owners/owner-1/spaces/space-1${path}`,
    resolved = resolveMobileRoute(method, full)!;
  const value: OwnerControlRequest = {
    requestId: "request-1",
    method,
    path: full,
    operationId: resolved.route.operationId,
    params: resolved.params,
    query: {},
    headers: {},
    body: null,
    device: {
      deviceId: "device-1",
      ownerId: "owner-1",
      spaceId: "space-1",
      scopes: ["conversation:read", "conversation:manage"],
      grantRevision: "1",
      expiresAt: "2026-10-06T00:00:00Z",
      revoked: false,
    },
    signal: new AbortController().signal,
    ...changes,
  };
  if (value.headers["idempotency-key"])
    value.headers["x-client-mutation-id"] = value.headers["idempotency-key"];
  return value;
}
const body = async (value: OwnerControlRequest): Promise<Json> =>
  (await controller.handle(value)).body as Json;
const items = (value: Json): Json[] => value.items as Json[];

describe("real desktop conversation control routes", () => {
  // @lat: [[mobile-data#Mobile data#Original conversation continuation availability]]
  it("offers advance for an original conversation only with matching execution authority and device scope", async () => {
    const execution = new MobileExecutionCoordinator(
      { get: () => null, projectId: () => undefined, begin: vi.fn(), finish: vi.fn() },
      { authorize: vi.fn(), start: vi.fn(), get: vi.fn(), cancel: vi.fn() }, ledger,
    );
    let enforced = true;
    const policy = { id: "policy", runtimeId: "runtime-1", projectId: null, enforced: true, allowedActions: ["advance"] };
    controller = new MobileConversationController(repository, ledger, "Desktop", () => now, execution, undefined, {
      snapshot: () => ({ runtimes: [], projects: [], policies: [{ ...policy, enforced }] }),
    });
    const input = request("/conversations/a");
    expect((await body(input)).allowedActions).not.toContain("advance");
    input.device.scopes.push("conversation:advance");
    expect((await body(input)).allowedActions).toContain("advance");
    expect((await body(input)).restrictionReason).toBeNull();
    enforced = false;
    expect((await body(input)).allowedActions).not.toContain("advance");
    enforced = true;
    policy.projectId = "other-project" as never;
    expect((await body(input)).allowedActions).not.toContain("advance");
    expect(readFileSync(file(), "utf8")).toBe(JSON.stringify({ conversations: rows() }));
  });
  // @lat: [[mobile-data#Mobile data#Conversation preview authenticated frozen original reads]]
  it("returns authorized original previews with frozen pages and leaves source bytes and read position unchanged", async () => {
    const original = readFileSync(file());
    const first = await body(
      request("/conversations", "GET", { query: { limit: "1" } }),
    );
    expect(items(first)[0].lastMessagePreview).toBe("a original body 120");
    const changed = rows();
    changed[1].messages[119].content = "Desktop changed latest answer";
    writeFileSync(file(), JSON.stringify({ conversations: changed }));
    const beforeRead = readFileSync(file());
    const next = await body(
      request("/conversations", "GET", {
        query: { limit: "1", cursor: String(first.nextCursor) },
      }),
    );
    expect(items(next)[0].lastMessagePreview).toBe("b original body 120");
    const fresh = await body(request("/conversations/b"));
    expect(fresh.lastMessagePreview).toBe("Desktop changed latest answer");
    expect(fresh.lastReadMessageSeq).toBe("0");
    const denied = request("/conversations");
    denied.device.scopes = [];
    await expect(body(denied)).rejects.toThrow("scope_denied");
    expect(readFileSync(file())).toEqual(beforeRead);
    expect(original.equals(beforeRead)).toBe(false);
  });
  // @lat: [[mobile-data#Mobile data#Runtime avatar Owner authorization]]
  it("reads the current avatar through the Owner route and rejects revoked or cross-source requests without changing original history", async () => {
    const original = readFileSync(file());
    const runtime = {
      id: "runtime-1",
      name: "Original runtime",
      kind: "codex" as const,
      location: "local" as const,
      enabled: true,
      managed: "user" as const,
      avatar:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8XKD4n4GBgYGJAQoAJzoChzU5gKEAAAAASUVORK5CYII=",
      config: {},
    };
    const backend: OwnerExecutionBackend = {
      authorize: vi.fn(),
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    const catalog = new DesktopMobileCatalog(
      { runtimes: () => [runtime], projects: () => [], policies: () => [] },
      backend,
      () => now,
    );
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      undefined,
      catalog,
    );
    const id = String(catalog.snapshot().runtimes[0].avatar);
    const input = request(`/runtimes/runtime-1/avatars/${id}`);
    expect(await body(input)).toEqual(catalog.avatar(runtime.id, id));
    await expect(
      body({ ...input, device: { ...input.device, ownerId: "other" } }),
    ).rejects.toThrow("scope_denied");
    await expect(
      body({ ...input, device: { ...input.device, revoked: true } }),
    ).rejects.toThrow("revoked");
    await expect(
      body({ ...input, query: { url: "https://private/image" } }),
    ).rejects.toThrow("invalid_input");
    await expect(
      body(request(`/runtimes/runtime-1/avatars/ava-missing`)),
    ).rejects.toThrow("resource_not_found");
    expect(readFileSync(file())).toEqual(original);
    expect(backend.start).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Catalog frozen pages and device actions]]
  it("freezes directory pages and intersects executable actions with available handlers and device scopes", async () => {
    let runtimeRows: Json[] = ["one", "two"].map((id) => ({
      id,
      name: id,
      category: "local",
      healthy: true,
      capabilities: [],
      allowedActions: ["read", "create", "advance"],
    }));
    const snapshot = vi.fn(() => ({
      runtimes: runtimeRows,
      projects: [
        {
          id: "project-one",
          name: "Original project",
          allowedExecutionPolicyIds: [],
        },
      ],
      policies: [
        {
          id: "policy-one",
          runtimeId: "one",
          mode: "inspect",
          enforced: true,
          unattendedApproved: false,
          allowedActions: ["create", "advance"],
        },
      ],
    }));
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      undefined,
      { snapshot },
    );
    const first = await body(
      request("/runtimes", "GET", { query: { limit: "1" } }),
    );
    expect(items(first)[0]).toMatchObject({
      id: "one",
      allowedActions: ["read"],
    });
    runtimeRows = [{ ...runtimeRows[1], name: "Desktop changed" }];
    const second = await body(
      request("/runtimes", "GET", {
        query: { cursor: String(first.nextCursor), limit: "1" },
      }),
    );
    expect(items(second)[0].name).toBe("two");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(
      items(await body(request("/execution-policies")))[0].allowedActions,
    ).toEqual([]);
    expect(items(await body(request("/projects")))[0].id).toBe("project-one");
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      { validate: () => undefined, create: () => rows()[0] },
      { snapshot },
    );
    const creator = request("/runtimes");
    creator.device.scopes.push("conversation:create");
    expect(items(await body(creator))[0].allowedActions).toEqual([
      "read",
      "create",
    ]);
    const another = request("/runtimes", "GET", {
      query: { cursor: String(first.nextCursor) },
    });
    another.device.deviceId = "another-device";
    await expect(body(another)).rejects.toThrow("cursor_expired");
  });
  // @lat: [[mobile-data#Mobile data#Uncertain creation never duplicates]]
  it("retains the allocated original ID when a creation write succeeds but its acknowledgement is lost", async () => {
    const { DesktopConversationCreation } =
      await import("../src/main/mobile-control/conversation-creation");
    const backend: OwnerExecutionBackend = {
      authorize: (policyId, runtimeId) => ({
        policyId,
        runtime: {
          id: runtimeId,
          name: "Desktop",
          kind: "codex",
          location: "local",
          enabled: true,
          managed: "user",
          config: {},
        },
        task: { mode: "analysis" },
      }),
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    const creation = new DesktopConversationCreation("owner", backend);
    const create = creation.create.bind(creation);
    vi.spyOn(creation, "create").mockImplementation((id, value) => {
      create(id, value);
      throw Error("Synthetic lost acknowledgement");
    });
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      creation,
    );
    const mutation = request("/conversations", "POST", {
      headers: { "idempotency-key": "create-uncertain" },
      body: { runtimeId: "runtime-1", executionPolicyId: "policy-1" },
    });
    mutation.device.scopes.push("conversation:create");
    await expect(body(mutation)).rejects.toThrow(
      "Synthetic lost acknowledgement",
    );
    const receipt = ledger.operations("device-1")[0];
    expect(receipt.status).toBe("reconciliation_required");
    expect(
      repository.list().some((value) => value.id === receipt.resourceRef?.id),
    ).toBe(true);
    expect(await body(mutation)).toEqual(receipt);
    expect(creation.create).toHaveBeenCalledTimes(1);
    expect(repository.list()).toHaveLength(4);
  });
  // @lat: [[mobile-data#Mobile data#Empty original creation replay]]
  it("creates an empty original record with desktop appearance and replays the same durable ID without dispatch", async () => {
    const { DesktopConversationCreation } =
      await import("../src/main/mobile-control/conversation-creation");
    const backend: OwnerExecutionBackend = {
      authorize: vi.fn((policyId, runtimeId, projectId) => ({
        policyId,
        projectId,
        runtime: {
          id: runtimeId,
          name: "Desktop runtime",
          kind: "codex",
          location: "local",
          managed: "user",
          enabled: true,
          color: "#F37021",
          avatar: "data:image/png;base64,aGVsbG8=",
          config: {},
        },
        task: { mode: "safe_write", workspaceId: projectId },
      })),
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      new DesktopConversationCreation("owner", backend),
    );
    const mutation = request("/conversations", "POST", {
      headers: { "idempotency-key": "create-1" },
      body: {
        runtimeId: "runtime-1",
        executionPolicyId: "desktop-task-" + "a".repeat(64),
        title: "Mobile new task",
        clientMutationId: "create-1",
      },
    });
    mutation.device.scopes.push("conversation:create");
    const receipt = await body(mutation);
    expect(receipt.status).toBe("applied");
    const id = String((receipt.resultRef as Json).conversationId);
    const store = await import("../src/main/runtime-conversation-store");
    expect(
      store.getRuntimeConversation(id, "owner", { fullHistory: true }),
    ).toMatchObject({
      title: "Mobile new task",
      runtimeName: "Desktop runtime",
      runtimeAvatar: "data:image/png;base64,aGVsbG8=",
      runtimeColor: "#F37021",
      accessMode: "auto",
      revision: "1",
      messages: [],
      messageCount: 0,
    });
    expect(await body(mutation)).toEqual(receipt);
    expect(repository.list()).toHaveLength(4);
    expect(backend.authorize).toHaveBeenCalledTimes(2);
    expect(backend.start).not.toHaveBeenCalled();
    ledger = new MobileOwnerLedger(
      join(state.root, "ledger.json"),
      "owner-1",
      "space-1",
      () => now,
    );
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      new DesktopConversationCreation("owner", backend),
    );
    expect(await body(mutation)).toEqual(receipt);
    await expect(
      body({
        ...mutation,
        body: { ...(mutation.body as Json), title: "Different task" },
      }),
    ).rejects.toThrow("idempotency_conflict");
  });

  // @lat: [[mobile-data#Mobile data#Explicit full-access conversation creation]]
  it("persists full access only when a generated desktop task policy carries confirmation", async () => {
    const { DesktopConversationCreation } =
      await import("../src/main/mobile-control/conversation-creation");
    const policyId = "desktop-task-" + "f".repeat(64);
    const backend: OwnerExecutionBackend = {
      authorize: vi.fn((receivedPolicyId, runtimeId, projectId) => ({
        policyId: receivedPolicyId,
        projectId,
        runtime: {
          id: runtimeId,
          name: "Desktop runtime",
          kind: "codex",
          location: "local",
          enabled: true,
          managed: "user",
          config: {},
        },
        task: { mode: "full_access", fullAccessConfirmed: true },
      })),
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    const creation = new DesktopConversationCreation("owner", backend);
    const input = {
      runtimeId: "runtime-1",
      executionPolicyId: policyId,
      title: "Confirmed full access",
    };
    creation.validate(input);
    expect(creation.create("mobile-full-access", input)).toMatchObject({
      accessMode: "full_access",
      workspaceId: undefined,
      messages: [],
    });
    expect(backend.authorize).toHaveBeenCalledTimes(2);

    const legacy = new DesktopConversationCreation("owner", {
      ...backend,
      authorize: vi.fn((receivedPolicyId, runtimeId) => ({
        policyId: receivedPolicyId,
        runtime: {
          id: runtimeId,
          name: "Desktop runtime",
          kind: "codex",
          location: "local",
          enabled: true,
          managed: "user",
          config: {},
        },
        task: { mode: "full_access", fullAccessConfirmed: true },
      })),
    });
    expect(() => legacy.validate({
      runtimeId: "runtime-1",
      executionPolicyId: "legacy-policy",
    })).toThrow("unverified_policy");
  });

  // @lat: [[mobile-data#Mobile data#Creation authorization revalidation]]
  it("refuses unapproved and revoked creation policies before saving any original record", async () => {
    const { DesktopConversationCreation } =
      await import("../src/main/mobile-control/conversation-creation");
    const denied = Object.assign(Error("unverified_policy"), {
      code: "unverified_policy",
      status: 403,
    });
    const authorize = vi.fn().mockImplementation(() => {
      throw denied;
    });
    const backend: OwnerExecutionBackend = {
      authorize,
      start: vi.fn(),
      get: vi.fn(),
      cancel: vi.fn(),
    };
    controller = new MobileConversationController(
      repository,
      ledger,
      "Desktop",
      () => now,
      undefined,
      new DesktopConversationCreation("owner", backend),
    );
    const mutation = request("/conversations", "POST", {
      headers: { "idempotency-key": "create-denied" },
      body: { runtimeId: "runtime-1", executionPolicyId: "policy-1" },
    });
    mutation.device.scopes.push("conversation:create");
    const bytes = readFileSync(file(), "utf8");
    await expect(body(mutation)).rejects.toThrow("unverified_policy");
    expect(ledger.operations("device-1")).toHaveLength(0);
    authorize.mockImplementationOnce((policyId, runtimeId) => ({
      policyId,
      runtime: { id: runtimeId, name: "Desktop", config: {} },
      task: { mode: "analysis" },
    }));
    await expect(body(mutation)).rejects.toThrow("unverified_policy");
    expect(ledger.operations("device-1")[0].status).toBe("rejected");
    expect(readFileSync(file(), "utf8")).toBe(bytes);
    expect(backend.start).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Restricted history contract visibility]]
  it("returns readable restricted histories with the contract activity and attention filtering", async () => {
    const original = repository.list()[0];
    vi.spyOn(repository, "list").mockReturnValue([
      {
        ...original,
        sourceKind: "native_session",
        manageable: false,
        revision: undefined,
        restrictionReason: "requires_owner_action",
      },
      {
        ...original,
        id: "active-restricted",
        sourceKind: "collaboration",
        manageable: false,
        revision: undefined,
        restrictionReason: "requires_owner_action",
        activeRunIds: ["original-active-run"],
      },
    ]);
    const detail = await body(request(`/conversations/${original.id}`));
    expect(detail).toMatchObject({
      sourceKind: "native_session",
      activity: "needs_attention",
      allowedActions: ["read"],
      restrictionReason: "requires_owner_action",
    });
    expect(items(await body(request("/conversations")))).toHaveLength(2);
    const attention = await body(
      request("/conversations", "GET", { query: { state: "attention" } }),
    );
    expect(items(attention).map((item) => item.id)).toEqual([original.id]);
    const active = await body(
      request("/conversations", "GET", { query: { state: "active" } }),
    );
    expect(items(active)[0]).toMatchObject({
      id: "active-restricted",
      activity: "active",
    });
  });

  // @lat: [[mobile-data#Mobile data#Frozen conversation pagination]]
  it("freezes sort, filters and titles across pages even when the desktop updates the original record", async () => {
    const first = await body(
      request("/conversations", "GET", { query: { limit: "1" } }),
    );
    expect(items(first).map((item) => item.id)).toEqual(["a"]);
    repository.patch("b", { title: "Desktop changed b", pinned: true }, "1");
    const second = await body(
      request("/conversations", "GET", {
        query: { limit: "1", cursor: String(first.nextCursor) },
      }),
    );
    expect(items(second)[0]).toMatchObject({
      id: "b",
      title: "Original b",
      revision: "1",
    });
    const current = await body(request("/conversations"));
    expect(items(current)[0]).toMatchObject({
      id: "b",
      title: "Desktop changed b",
      pinned: true,
      revision: "2",
    });
    await expect(
      body(
        request("/conversations", "GET", {
          query: { cursor: String(first.nextCursor), archived: "true" },
        }),
      ),
    ).rejects.toThrow("cursor_expired");
    const other = request("/conversations");
    other.device = { ...other.device, deviceId: "device-2" };
    other.query.cursor = String(first.nextCursor);
    await expect(body(other)).rejects.toThrow("cursor_expired");
    now += 300000;
    await expect(
      body(
        request("/conversations", "GET", {
          query: { cursor: String(first.nextCursor) },
        }),
      ),
    ).rejects.toThrow("cursor_expired");
  });
  // @lat: [[mobile-data#Mobile data#Frozen message pagination]]
  it("returns the latest 50 messages, then older pages of the same snapshot without duplicating live appends", async () => {
    const first = await body(request("/conversations/a/messages"));
    expect(items(first)).toHaveLength(50);
    expect(items(first)[0]).toMatchObject({
      id: "a-message-71",
      messageSeq: "71",
    });
    expect(items(first).at(-1)).toMatchObject({
      id: "a-message-120",
      messageSeq: "120",
    });
    const store = await import("../src/main/runtime-conversation-store");
    const original = store.getRuntimeConversation("a", "owner", {
      fullHistory: true,
    })!;
    store.saveRuntimeConversation({
      ...original,
      profile: "owner",
      expectedRevision: "1",
      messages: [
        ...original.messages,
        {
          id: "new-message",
          role: "agent",
          content: "Later real response",
          createdAt: 5000,
        },
      ],
    });
    const second = await body(
      request("/conversations/a/messages", "GET", {
        query: { cursor: String(first.snapshotCursor), beforeSeq: "71" },
      }),
    );
    expect(items(second)).toHaveLength(50);
    expect(items(second)[0].id).toBe("a-message-21");
    expect(items(second).at(-1)?.id).toBe("a-message-70");
    const third = await body(
      request("/conversations/a/messages", "GET", {
        query: { cursor: String(second.snapshotCursor), beforeSeq: "21" },
      }),
    );
    expect(items(third)).toHaveLength(20);
    expect(third.hasMoreBefore).toBe(false);
    expect(
      new Set(
        [...items(first), ...items(second), ...items(third)].map(
          (item) => item.id,
        ),
      ).size,
    ).toBe(120);
    const current = await body(request("/conversations/a/messages"));
    expect(items(current).at(-1)).toMatchObject({
      id: "new-message",
      messageSeq: "121",
    });
  });
  // @lat: [[mobile-data#Mobile data#Control read visibility]]
  it("marks only returned visible boundaries and isolates read positions for different phones", async () => {
    await body(request("/conversations/a/messages"));
    await expect(
      body(
        request("/conversations/a/read", "POST", {
          body: { lastReadMessageSeq: "50" },
        }),
      ),
    ).rejects.toThrow("invalid_input");
    expect(
      await body(
        request("/conversations/a/read", "POST", {
          body: { lastReadMessageSeq: "120" },
        }),
      ),
    ).toMatchObject({ lastReadMessageSeq: "120" });
    expect(await body(request("/conversations/a"))).toMatchObject({
      lastReadMessageSeq: "120",
    });
    const other = request("/conversations/a");
    other.device = { ...other.device, deviceId: "device-2" };
    expect(await body(other)).toMatchObject({ lastReadMessageSeq: "0" });
  });
  // @lat: [[mobile-data#Mobile data#Original conversation mutation receipts]]
  it("applies a versioned mutation once and replays its persisted receipt before checking the current source revision", async () => {
    const mutation = request("/conversations/a", "PATCH", {
      headers: { "idempotency-key": "mutation-1", "if-match": '"1"' },
      body: { title: "Mobile changed a", clientMutationId: "mutation-1" },
    });
    const receipt = await body(mutation);
    expect(receipt).toMatchObject({
      status: "applied",
      resultRef: { conversationId: "a" },
    });
    expect(repository.list().find((item) => item.id === "a")).toMatchObject({
      title: "Mobile changed a",
      revision: "2",
    });
    repository.patch("a", { title: "Desktop changed a" }, "2");
    expect(await body(mutation)).toEqual(receipt);
    expect(repository.list().find((item) => item.id === "a")?.revision).toBe(
      "3",
    );
    expect(await body(request(`/operations/${receipt.operationId}`))).toEqual(
      receipt,
    );
    expect(items(await body(request("/operations")))).toEqual([receipt]);
    await expect(
      body({
        ...mutation,
        body: { title: "Changed body", clientMutationId: "mutation-1" },
      }),
    ).rejects.toThrow("idempotency_conflict");
    const other = request(`/operations/${receipt.operationId}`);
    other.device = { ...other.device, deviceId: "device-2" };
    await expect(body(other)).rejects.toThrow("resource_not_found");
  });
  // @lat: [[mobile-data#Mobile data#Control scope and revision validation]]
  it("enforces scopes, Owner binding, signed route identity, schema and If-Match before changing business data", async () => {
    const original = readFileSync(file(), "utf8");
    const base = request("/conversations/a", "PATCH", {
      body: { pinned: true },
      headers: { "idempotency-key": "m1", "if-match": '"1"' },
    });
    await expect(
      body({
        ...base,
        device: { ...base.device, scopes: ["conversation:read"] },
      }),
    ).rejects.toThrow("scope_denied");
    await expect(
      body({ ...base, device: { ...base.device, spaceId: "wrong-space" } }),
    ).rejects.toThrow("scope_denied");
    await expect(body({ ...base, operationId: "createTurn" })).rejects.toThrow(
      "scope_denied",
    );
    await expect(
      body({
        ...base,
        headers: { "idempotency-key": "m2", "x-client-mutation-id": "m2" },
      }),
    ).rejects.toThrow("revision_required");
    await expect(
      body({ ...base, body: { shell: "anything" } }),
    ).rejects.toThrow("invalid_input");
    await expect(
      body({
        ...base,
        headers: {
          "idempotency-key": "m3",
          "x-client-mutation-id": "m3",
          "if-match": '"2"',
        },
      }),
    ).rejects.toThrow("revision_conflict");
    expect(readFileSync(file(), "utf8")).toBe(original);
    expect(ledger.operations("device-1")).toEqual([]);
    const readonly = request("/conversations/a");
    readonly.device.scopes = ["conversation:read"];
    expect((await body(readonly)).allowedActions).toEqual(["read"]);
    const expired = request("/conversations/a");
    expired.device.expiresAt = "2026-10-04T00:00:00Z";
    await expect(body(expired)).rejects.toThrow("revoked");
    const invalidExpiry = request("/runtimes");
    invalidExpiry.device.expiresAt = "invalid-date";
    await expect(body(invalidExpiry)).rejects.toThrow("revoked");
    const foreign = request("/conversations/a");
    foreign.path = foreign.path.replace(
      "/owners/owner-1/",
      "/owners/foreign-owner/",
    );
    foreign.params = resolveMobileRoute("GET", foreign.path)!.params;
    await expect(body(foreign)).rejects.toThrow("scope_denied");
  });
  // @lat: [[mobile-data#Mobile data#Original content search]]
  it("searches original visible message content and supports archive and project filters", async () => {
    const result = await body(
      request("/conversations/search", "POST", {
        body: { query: "b original body 111" },
      }),
    );
    expect(items(result).map((item) => item.id)).toEqual(["b"]);
    repository.patch("b", { archived: true }, "1");
    expect(
      items(await body(request("/conversations"))).map((item) => item.id),
    ).not.toContain("b");
    expect(
      items(
        await body(
          request("/conversations", "GET", { query: { archived: "true" } }),
        ),
      ).map((item) => item.id),
    ).toEqual(["b"]);
    expect(
      items(
        await body(
          request("/conversations", "GET", {
            query: { projectId: "missing-project" },
          }),
        ),
      ),
    ).toEqual([]);
  });
});
