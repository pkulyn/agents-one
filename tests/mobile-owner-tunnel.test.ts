import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import WebSocket from "ws";
import { createConnectService } from "../services/agents-one-connect/src/server.mjs";
import {
  canonical,
  resolveBusinessRoute,
  validate,
} from "../contracts/mobile-control/v1/owner-tunnel.mjs";
import {
  MOBILE_ROUTES,
  assertMobileSchema,
} from "../src/shared/mobile-control";
import {
  MobileOwnerTunnel,
  OwnerAuthorization,
  type OwnerControlHandler,
  type OwnerControlRequest,
} from "../src/main/mobile-control/owner-tunnel";
import { MobileOwnerLedger } from "../src/main/mobile-control/owner-ledger";
import { MobileConversationController } from "../src/main/mobile-control/conversation-controller";
import { DesktopMobileCatalog } from "../src/main/mobile-control/desktop-catalog";
import type { OwnerExecutionBackend } from "../src/main/mobile-control/execution-types";

const desktop = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "owner",
  profileHome: (profile: string) => join(desktop.root, profile),
  safeWriteFile: (file: string, value: string) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, value);
  },
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});

const fixtures = JSON.parse(
  readFileSync(
    new URL("../contracts/mobile-control/v1/fixtures.json", import.meta.url),
    "utf8",
  ),
);
const cleanup: (() => void | Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const admin = "owner-test-secret-" + "a".repeat(40);
const root = "/agents-one/mobile/v1/owners/owner-1/spaces/space-1";
type TestResponse = {
  status: number;
  body: Awaited<ReturnType<Response["json"]>>;
};
async function until(
  predicate: () => Promise<boolean> | boolean,
): Promise<void> {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Owner handshake did not settle");
}
// The fixture factory retains inferred mock and handler types for test overrides.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function setup(
  scopes = [
    "conversation:read",
    "conversation:advance",
    "conversation:manage",
    "schedule:read",
  ],
  relayClockOffsetMs = 0,
) {
  const folder = mkdtempSync(join(tmpdir(), "agents-one-owner-tunnel-"));
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const options = {
    now: () => Date.now() + relayClockOffsetMs,
    owners: [
      {
        ownerId: "owner-1",
        spaceId: "space-1",
        label: "Synthetic test Owner",
        adminToken: admin,
      },
    ],
    storagePath: join(folder, "auth.json"),
    stateKey: "e".repeat(64),
  };
  const service = createConnectService({ mobile: options });
  const address = await service.listen(0);
  const endpoint = `http://127.0.0.1:${address.port}`;
  cleanup.push(() => service.close());
  async function request(
    path: string,
    method = "GET",
    token = admin,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    const response = await fetch(endpoint + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
    };
  }
  const management = (
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<TestResponse> =>
    request("/agents-one/mobile/admin/v1" + path, method, admin, body);
  await management("/enabled", "PUT", { enabled: true });
  const registration = (await management("/host-credentials", "POST", {})).body;
  const invitation = (await management("/invitations", "POST", {})).body;
  const claim = (
    await request("/agents-one/mobile/v1/pairing/claims", "POST", "", {
      invitation: invitation.invitation,
      deviceLabel: "Synthetic phone",
    })
  ).body;
  await management(`/claims/${claim.id}/approve`, "POST", {
    verificationPhrase: claim.verificationPhrase,
    scopes,
  });
  const credentials = (
    await request(
      `/agents-one/mobile/v1/pairing/claims/${claim.id}/exchange`,
      "POST",
      claim.claimProof,
      {},
      {
        "Idempotency-Key": "exchange-test",
        "X-Client-Mutation-Id": "exchange-test",
      },
    )
  ).body;
  const owner = {
    ...fixtures.objects.OwnerSpace,
    ownerId: "owner-1",
    spaceId: "space-1",
    online: true,
    capabilities: scopes,
  };
  const captured: OwnerControlRequest[] = [];
  const handler: OwnerControlHandler = {
    status: () => owner,
    handle: async (input) => {
      captured.push(input);
      return {
        status: 200,
        body: {
          ...fixtures.objects.Bootstrap,
          ownerSpace: owner,
          grantRevision: input.device.grantRevision,
        },
      };
    },
  };
  const client = new MobileOwnerTunnel(
    { ...registration, endpoint },
    handler,
    (url) => new WebSocket(url),
    true,
  );
  cleanup.push(() => client.stop());
  const mobile = (
    path: string,
    method = "GET",
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TestResponse> =>
    request(
      path.startsWith("/") ? path : `${root}/${path}`,
      method,
      credentials.accessToken,
      body,
      headers,
    );
  return {
    endpoint,
    registration,
    management,
    request,
    mobile,
    client,
    handler,
    captured,
    credentials,
    options,
    service,
  };
}

describe("mobile Owner outbound tunnel", () => {
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Refresh ACK window]]
  it("waits for fresh grant confirmation without reporting an established Owner offline", async () => {
    const s = await setup();
    s.client.start();
    await until(async () => (await s.management("/status")).body.taskChannelReady);
    const original = WebSocket.prototype.send;
    let held: (() => void) | undefined;
    const spy = vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (this: WebSocket, ...args: Parameters<WebSocket["send"]>) {
      if (JSON.parse(String(args[0])).type === "authorization_ack") {
        held = () => original.apply(this, args);
        return;
      }
      return original.apply(this, args);
    });
    cleanup.push(() => spy.mockRestore());
    await s.management("/enabled", "PUT", { enabled: true });
    await until(() => !!held);
    expect((await s.management("/status")).body.taskChannelReady).toBe(true);
    let completed = false;
    const pending = s.mobile("bootstrap").then((result) => { completed = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(completed).toBe(false);
    expect(s.captured).toHaveLength(0);
    held!();
    expect((await pending).status).toBe(200);
    expect(s.captured).toHaveLength(1);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Refresh wait revocation]]
  it("rechecks device revocation after waiting for a refresh ACK", async () => {
    const s = await setup();
    s.client.start();
    await until(async () => (await s.management("/status")).body.taskChannelReady);
    const original = WebSocket.prototype.send;
    let held: (() => void) | undefined;
    const spy = vi.spyOn(WebSocket.prototype, "send").mockImplementation(function (this: WebSocket, ...args: Parameters<WebSocket["send"]>) {
      if (JSON.parse(String(args[0])).type === "authorization_ack") {
        held = () => original.apply(this, args);
        return;
      }
      return original.apply(this, args);
    });
    cleanup.push(() => spy.mockRestore());
    await s.management("/enabled", "PUT", { enabled: true });
    await until(() => !!held);
    const pending = s.mobile("bootstrap");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const first = held;
    await s.management(`/devices/${s.credentials.deviceId}`, "DELETE");
    await until(() => held !== first);
    held!();
    expect((await pending).body.error.code).toBe("revoked");
    expect(s.captured).toHaveLength(0);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Bounded Relay clock lead]]
  it("connects an authenticated desktop to a Relay whose clock leads by eighteen seconds", async () => {
    const s = await setup(["conversation:read"], 18_000);
    s.client.start();
    await until(async () => (await s.management("/status")).body.taskChannelReady);
    expect((await s.mobile("bootstrap")).status).toBe(200);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Clock lead lease and expiry limits]]
  it("caps a clock-leading authorization lease at thirty local seconds and rejects expired or excessively future signed frames", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    let time = Date.now();
    const initial = time;
    const auth = new OwnerAuthorization({endpoint:"https://connect.example",ownerId:"owner-1",spaceId:"space-1",hostCredential:"synthetic",signingPublicKey:publicKey.export({type:"spki",format:"der"}).toString("base64")}, () => time);
    const signed = (expiresAt: number, updateId: string) => {
      const payload = {protocolVersion:"mobile-owner/1.0",ownerId:"owner-1",spaceId:"space-1",updateId,expiresAt,grants:{enabled:true,devices:[{...fixtures.objects.DeviceGrant,ownerId:"owner-1",spaceId:"space-1",deviceId:"phone-1",grantRevision:"1",expiresAt:new Date(initial+86400_000).toISOString(),revoked:false,scopes:["conversation:read"]}]}};
      return {payload,signature:sign(null,Buffer.from(canonical(payload)),privateKey).toString("base64")};
    };
    expect(()=>auth.update(signed(initial,"expired"))).toThrow("scope_denied");
    expect(()=>auth.update(signed(initial+75_001,"too-future"))).toThrow("scope_denied");
    expect(()=>auth.update(signed(initial+61_000,"ahead-31"))).not.toThrow();
    expect(auth.active("phone-1","1")).toBe(true);
    time=initial+29_999;
    expect(auth.active("phone-1","1")).toBe(true);
    time=initial+30_000;
    expect(auth.active("phone-1","1")).toBe(false);
  });
  // @lat: [[mobile-data#Mobile data#Schedule recent execution original Relay integration]]
  it("reads recent executions through authenticated Relay from the original desktop schedule file without persisting results in Relay state", async () => {
    const s = await setup(["schedule:read"]);
    desktop.root = dirname(s.options.storagePath);
    const file = join(desktop.root, "owner", "desktop", "task-schedules.json");
    mkdirSync(dirname(file), { recursive: true });
    const now = Date.now();
    const original = {
      version: 5,
      unknownRoot: "preserved",
      schedules: [
        {
          id: "original-plan",
          revision: "7",
          name: "Original plan",
          schedule: "5m",
          prompt: "Original task instructions",
          runtimeId: "original-runtime",
          mode: "analysis",
          enabled: true,
          timeoutMs: 300000,
          concurrencyPolicy: "skip",
          pendingRuns: 0,
          createdAt: now,
          updatedAt: now,
          nextRunAt: now + 300000,
          runs: [
            {
              id: "original-execution",
              trigger: "manual",
              triggeredAt: now,
              status: "running",
              runtimeRunId: "original-live-run",
              conversationId: "original-result",
              summary: "Original recent output at D:/private/output",
              unknownRun: "private",
            },
          ],
        },
      ],
    };
    const bytes = JSON.stringify(original);
    writeFileSync(file, bytes);
    const { DesktopMobileScheduleReadRepository } =
      await import("../src/main/mobile-control/schedule-read");
    const schedules = new DesktopMobileScheduleReadRepository("owner");
    const ledger = new MobileOwnerLedger(
      join(desktop.root, "schedule-ledger.json"),
      "owner-1",
      "space-1",
    );
    const patch = vi.fn();
    const controller = new MobileConversationController(
      { list: () => [], get: () => undefined, patch },
      ledger,
      "Desktop",
      Date.now,
      undefined,
      undefined,
      undefined,
      schedules,
    );
    s.handler.status = () => controller.status();
    s.handler.handle = (input) => controller.handle(input);
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const page = await s.mobile("schedules");
    expect(page.status).toBe(200);
    expect(page.body.items[0].recentExecution.execution).toMatchObject({
      id: "original-execution",
      scheduleId: "original-plan",
      status: "running",
      runtimeRunId: "original-live-run",
      conversationId: "original-result",
    });
    expect(page.body.items[0].recentExecution.execution).not.toHaveProperty(
      "completedAt",
    );
    const history = await s.mobile("schedules/original-plan/executions");
    expect(history.status).toBe(200);
    expect(page.body.items[0].recentExecution.execution).toEqual(
      history.body.items[0],
    );
    expect(JSON.stringify(page.body)).not.toMatch(
      /D:\/private|unknownRun|Original task instructions/,
    );
    expect(readFileSync(file, "utf8")).toBe(bytes);
    expect(readFileSync(s.options.storagePath, "utf8")).not.toContain(
      "Original recent output",
    );
    await s.management(`/devices/${s.credentials.deviceId}`, "DELETE");
    expect((await s.mobile("schedules")).body.error.code).toBe("revoked");
    expect(patch).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-data#Mobile data#Runtime avatar authenticated Relay integration]]
  it("transfers original avatar bytes through the authenticated HTTP and Owner WebSocket channel and rejects stale references and revoked devices", async () => {
    const s = await setup(["conversation:read"]);
    const avatar = fixtures.objects.RuntimeAvatar;
    const runtime = {
      id: "runtime-1",
      name: "Original runtime",
      kind: "codex" as const,
      location: "local" as const,
      enabled: true,
      managed: "user" as const,
      avatar: `data:${avatar.mime};base64,${avatar.base64}`,
      config: { executablePath: "D:/private/runtime.exe" },
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
    );
    const ledger = new MobileOwnerLedger(
      join(dirname(s.options.storagePath), "avatar-ledger.json"),
      "owner-1",
      "space-1",
    );
    const patch = vi.fn();
    const controller = new MobileConversationController(
      { list: () => [], get: () => undefined, patch },
      ledger,
      "Desktop",
      Date.now,
      undefined,
      undefined,
      catalog,
    );
    s.handler.status = () => controller.status();
    s.handler.handle = (input) => controller.handle(input);
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const directory = await s.mobile("runtimes");
    expect(directory.status).toBe(200);
    expect(directory.body.items[0].avatar).toBe(avatar.id);
    expect(JSON.stringify(directory.body)).not.toContain(avatar.base64);
    expect(JSON.stringify(directory.body)).not.toContain("private");
    const path = `runtimes/runtime-1/avatars/${avatar.id}`;
    const response = await s.mobile(path);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...avatar, runtimeId: runtime.id });
    expect(Buffer.from(response.body.base64, "base64").length).toBe(
      response.body.sizeBytes,
    );
    expect(
      createHash("sha256")
        .update(Buffer.from(response.body.base64, "base64"))
        .digest("hex"),
    ).toBe(response.body.sha256);
    expect((await s.request(`${root}/${path}`, "GET", "")).status).toBe(401);
    expect(
      (
        await s.mobile(
          `/agents-one/mobile/v1/owners/other/spaces/space-1/${path}`,
        )
      ).status,
    ).toBe(404);
    expect(
      (await s.mobile(`runtimes/missing/avatars/${avatar.id}`)).status,
    ).toBe(404);
    runtime.avatar = "";
    expect((await s.mobile(path)).body.error.code).toBe("resource_not_found");
    runtime.avatar = `data:${avatar.mime};base64,${avatar.base64}`;
    await s.management(`/devices/${s.credentials.deviceId}`, "DELETE");
    expect((await s.mobile(path)).body.error.code).toBe("revoked");
    expect(readFileSync(s.options.storagePath, "utf8")).not.toContain(
      avatar.base64,
    );
    expect(patch).not.toHaveBeenCalled();
    expect(backend.start).not.toHaveBeenCalled();
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Persistent event HTTP integration]]
  it("routes persistent Owner events through signed WSS into real HTTP SSE and resumes from the exact event ID", async () => {
    const s = await setup(["conversation:read"]);
    const ledger = new MobileOwnerLedger(
      join(dirname(s.options.storagePath), "event-ledger.json"),
      "owner-1",
      "space-1",
    );
    const controller = new MobileConversationController(
      {
        list: () => [],
        get: () => undefined,
        patch: () => {
          throw Error();
        },
      },
      ledger,
      "Original Owner",
    );
    s.handler.status = () => controller.status();
    s.handler.handle = (request) => controller.handle(request);
    const anchor = ledger.cursor(
      s.credentials.deviceId,
      s.credentials.grantRevision,
    );
    const publish = (): Record<string, unknown> =>
      ledger.publish({
        type: "owner.status",
        resourceRef: { type: "owner", id: "owner-1" },
        resourceRevision: "1",
        payload: controller.status(),
      });
    const first = publish();
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    async function receive(query: string, last?: string): Promise<string> {
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 5000);
      try {
        const response = await fetch(`${s.endpoint}${root}/events${query}`, {
          signal: abort.signal,
          headers: {
            Authorization: `Bearer ${s.credentials.accessToken}`,
            ...(last ? { "Last-Event-ID": last } : {}),
          },
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        while (!text.includes("\n\n")) {
          const chunk = await reader.read();
          if (chunk.done) throw Error("event_missing");
          text += decoder.decode(chunk.value);
        }
        return text;
      } finally {
        clearTimeout(timer);
        abort.abort();
      }
    }
    const received = await receive(`?cursor=${encodeURIComponent(anchor)}`);
    expect(received).toContain(`id: ${first.eventId}\n`);
    expect(received).toContain('"capabilities":["conversation:read"]');
    const second = publish();
    const resumed = await receive("", String(first.eventId));
    expect(resumed).toContain(`id: ${second.eventId}\n`);
    expect(resumed).not.toContain(`id: ${first.eventId}\n`);
  });
  // @lat: [[mobile-data#Mobile data#Relay to original history integration]]
  it("routes authenticated phone reads and idempotent management through the Owner to the original desktop store", async () => {
    const s = await setup(["conversation:read", "conversation:manage"]);
    desktop.root = dirname(s.options.storagePath);
    const file = join(
      desktop.root,
      "owner",
      "desktop",
      "runtime-conversations.json",
    );
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        futureRoot: "keep",
        conversations: [
          {
            id: "original-conversation",
            title: "Original desktop title",
            runtimeId: "runtime-1",
            runtimeName: "Original Agent",
            runtimeKind: "pi",
            runtimeLocation: "local",
            createdAt: 1000,
            updatedAt: 2000,
            messages: [
              {
                id: "original-message",
                role: "user",
                content: "Original desktop message",
                createdAt: 1000,
              },
            ],
          },
        ],
      }),
    );
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    const ledger = new MobileOwnerLedger(
      join(desktop.root, "owner", "desktop", "mobile-owner-ledger.json"),
      "owner-1",
      "space-1",
    );
    const controller = new MobileConversationController(
      repository,
      ledger,
      "Synthetic desktop with real storage modules",
    );
    s.handler.status = () => controller.status();
    s.handler.handle = (request) => controller.handle(request);
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const bootstrap = await s.mobile("bootstrap");
    expect(bootstrap.body.capabilities).toEqual([
      "conversation:read",
      "conversation:manage",
    ]);
    expect(bootstrap.body.ownerSpace.executionAvailable).toBe(false);
    const history = await s.mobile("conversations");
    expect(history.status).toBe(200);
    expect(history.body.items[0]).toMatchObject({
      id: "original-conversation",
      title: "Original desktop title",
      revision: "1",
      lastMessagePreview: "Original desktop message",
    });
    const messages = await s.mobile(
      "conversations/original-conversation/messages",
    );
    expect(messages.body.items[0]).toMatchObject({
      id: "original-message",
      content: "Original desktop message",
      messageSeq: "1",
    });
    const headers = {
      "Idempotency-Key": "rename-1",
      "X-Client-Mutation-Id": "rename-1",
      "If-Match": '"1"',
    };
    const mutation = await s.mobile(
      "conversations/original-conversation",
      "PATCH",
      { title: "Phone rename" },
      headers,
    );
    expect(mutation.status).toBe(202);
    expect(mutation.body.status).toBe("applied");
    expect(
      (
        await s.mobile(
          "conversations/original-conversation",
          "PATCH",
          { title: "Phone rename" },
          headers,
        )
      ).body,
    ).toEqual(mutation.body);
    expect(repository.list()[0]).toMatchObject({
      title: "Phone rename",
      revision: "2",
    });
    expect(JSON.parse(readFileSync(file, "utf8")).futureRoot).toBe("keep");
    expect(
      (await s.mobile(`operations/${mutation.body.operationId}`)).body,
    ).toEqual(mutation.body);
    const relayState = readFileSync(s.options.storagePath, "utf8");
    expect(relayState).not.toContain("Original desktop message");
    expect(relayState).not.toContain("Phone rename");
    await s.management(`/devices/${s.credentials.deviceId}`, "DELETE");
    expect((await s.mobile("conversations")).body.error.code).toBe("revoked");
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Generated business allowlist]]
  it("uses the generated contract for every business route and write schema", () => {
    for (const candidate of MOBILE_ROUTES.filter((route) =>
      route.path.includes("/spaces/{spaceId}/"),
    )) {
      const path = candidate.path
        .replaceAll("{ownerId}", "owner-1")
        .replaceAll("{spaceId}", "space-1")
        .replaceAll("{id}", "item-1")
        .replaceAll("{avatarId}", "avatar-1");
      const resolved = resolveBusinessRoute(candidate.method, path);
      expect(resolved?.operationId).toBe(candidate.operationId);
      expect(!!resolved?.mutation).toBe(!!candidate.mutation);
      expect(!!resolved?.revision).toBe(!!candidate.revision);
      expect(resolved?.scope).toBe(candidate.scope);
    }
    for (const [name, value] of Object.entries(fixtures.objects)) {
      expect(() => validate(name, value)).not.toThrow();
      expect(() => assertMobileSchema(name, value)).not.toThrow();
    }
    expect(resolveBusinessRoute("POST", root + "/ipc")).toBeNull();
    expect(resolveBusinessRoute("GET", "/agents-one/v1/runs")).toBeNull();
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Authenticated routing]]
  it("routes a scoped real HTTP request over the independent Owner WebSocket", async () => {
    const s = await setup();
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const response = await s.mobile("bootstrap");
    expect(response.status).toBe(200);
    assertMobileSchema("Bootstrap", response.body);
    expect(s.captured).toHaveLength(1);
    expect(s.captured[0].device.deviceId).toBe(s.credentials.deviceId);
    expect(JSON.stringify(s.captured)).not.toContain(s.credentials.accessToken);
    expect(
      (await s.mobile(root.replace("owner-1", "owner-2") + "/bootstrap"))
        .status,
    ).toBe(404);
    s.client.stop();
    await until(
      async () => !(await s.management("/status")).body.taskChannelReady,
    );
    expect((await s.mobile("bootstrap")).body.error.code).toBe("owner_offline");
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Long history response]]
  it("transports a long message page larger than the request frame limit without truncating final text", async () => {
    const s = await setup();
    const content = "测".repeat(200000);
    const page = {
      ...fixtures.objects.MessagePage,
      items: Array.from({ length: 4 }, (_, i) => ({
        ...fixtures.objects.Message,
        id: `message-${i}`,
        conversationId: "conversation-1",
        messageSeq: String(i + 1),
        content,
      })),
    };
    s.handler.handle = async () => ({ status: 200, body: page });
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const response = await s.mobile("conversations/conversation-1/messages");
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(4);
    expect(response.body.items[3].content).toBe(content);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Scope and write gates]]
  it("rejects writes without scope, revision, stable identity or known fields before dispatch", async () => {
    const s = await setup(["conversation:read"]);
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    expect(
      (
        await s.mobile("conversations/c-1/turns", "POST", {
          text: "test",
          executionPolicyId: "p-1",
        })
      ).status,
    ).toBe(403);
    expect(s.captured).toHaveLength(0);
    const w = await setup();
    w.client.start();
    await until(
      async () => (await w.management("/status")).body.taskChannelReady,
    );
    const headers = { "Idempotency-Key": "m-1", "X-Client-Mutation-Id": "m-1" };
    expect(
      (
        await w.mobile(
          "conversations/c-1",
          "PATCH",
          { title: "Title" },
          headers,
        )
      ).status,
    ).toBe(428);
    expect(
      (
        await w.mobile(
          "conversations/c-1",
          "PATCH",
          { title: "Title", arbitraryCommand: "bad" },
          { ...headers, "If-Match": '"1"' },
        )
      ).status,
    ).toBe(422);
    expect((await w.mobile("conversations?limit=10&limit=20")).status).toBe(
      422,
    );
    expect(w.captured).toHaveLength(0);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Grant confirmation]]
  it("never reports ready or forwards while the Owner has not confirmed grants", async () => {
    const s = await setup();
    const socket = new WebSocket(
      s.endpoint.replace("http:", "ws:") + "/agents-one/mobile/owner/v1/tunnel",
    );
    cleanup.push(() => socket.terminate());
    socket.on("message", () =>
      socket.send(
        JSON.stringify({
          type: "owner_status",
          owner: {
            ...fixtures.objects.OwnerSpace,
            ownerId: "owner-1",
            spaceId: "space-1",
            online: true,
          },
        }),
      ),
    );
    await new Promise<void>((resolve, reject) => {
      socket.on("open", resolve);
      socket.on("error", reject);
    });
    socket.send(
      JSON.stringify({
        type: "hello",
        protocolVersion: "mobile-owner/1.0",
        role: "owner",
        ownerId: "owner-1",
        spaceId: "space-1",
        hostCredential: s.registration.hostCredential,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await s.management("/status")).body.taskChannelReady).toBe(false);
    expect((await s.mobile("bootstrap")).status).toBe(503);
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Revocation during streaming]]
  it("closes an authorized SSE on device revocation and leaves accepted execution independent", async () => {
    const s = await setup();
    let aborted = false;
    s.handler.handle = async (request) => ({
      status: 200,
      events: (async function* () {
        yield fixtures.objects.Event;
        await new Promise<void>((resolve) =>
          request.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          ),
        );
      })(),
    });
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const response = await fetch(s.endpoint + root + "/events", {
      headers: { Authorization: `Bearer ${s.credentials.accessToken}` },
    });
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("data:");
    await s.management(`/devices/${s.credentials.deviceId}`, "DELETE");
    const end = await reader.read();
    expect(end.done).toBe(true);
    await until(() => aborted);
    expect((await s.mobile("bootstrap")).body.error.code).toBe("revoked");
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Artifact transfer]]
  it("streams bounded Artifact chunks and verifies length/hash without relay persistence", async () => {
    const s = await setup(["artifact:read"]);
    const bytes = Buffer.alloc(196608, 0x61);
    const metadata = {
      ...fixtures.objects.Artifact,
      id: "artifact-1",
      name: "synthetic.txt",
      mime: "text/plain",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    s.handler.handle = async () => ({
      status: 200,
      download: {
        metadata,
        chunks: (async function* () {
          yield bytes;
        })(),
      },
    });
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const response = await fetch(
      s.endpoint + root + "/artifacts/artifact-1/content",
      { headers: { Authorization: `Bearer ${s.credentials.accessToken}` } },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const output = Buffer.from(await response.arrayBuffer());
    expect(output.equals(bytes)).toBe(true);
    expect(createHash("sha256").update(output).digest("hex")).toBe(
      metadata.sha256,
    );
    expect(readFileSync(s.options.storagePath, "utf8")).not.toContain(
      bytes.subarray(0, 200).toString(),
    );
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Interrupted mutation]]
  it("reports an interrupted dispatched write as requiring reconciliation without replay", async () => {
    const s = await setup();
    let started = false;
    s.handler.handle = async (request) => {
      started = true;
      await new Promise<void>((resolve) =>
        request.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return { status: 202, body: fixtures.objects.OperationReceipt };
    };
    s.client.start();
    await until(
      async () => (await s.management("/status")).body.taskChannelReady,
    );
    const response = s.mobile(
      "conversations/c-1",
      "PATCH",
      { title: "Synthetic rename" },
      {
        "If-Match": '"1"',
        "Idempotency-Key": "write-1",
        "X-Client-Mutation-Id": "write-1",
      },
    );
    await until(() => started);
    s.client.stop();
    const result = await response;
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe("reconciliation_required");
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Host credential separation]]
  it("keeps a stable signing key across restart and excludes admin or phone tokens from Owner authentication", async () => {
    const s = await setup();
    expect(s.registration.hostCredential).not.toBe(admin);
    const restarted = createConnectService({ mobile: s.options });
    await restarted.listen(0);
    cleanup.push(() => restarted.close());
    const address = restarted.server.address() as { port: number };
    const res = await fetch(
      `http://127.0.0.1:${address.port}/agents-one/mobile/admin/v1/host-credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${admin}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    expect((await res.json()).signingPublicKey).toBe(
      s.registration.signingPublicKey,
    );
    for (const wrong of [
      admin,
      s.credentials.accessToken,
      s.credentials.refreshCredential,
    ]) {
      const socket = new WebSocket(
        s.endpoint.replace("http:", "ws:") +
          "/agents-one/mobile/owner/v1/tunnel",
      );
      cleanup.push(() => socket.terminate());
      await new Promise<void>((resolve, reject) => {
        socket.on("open", resolve);
        socket.on("error", reject);
      });
      const closed = new Promise<number>((resolve) =>
        socket.on("close", resolve),
      );
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: "mobile-owner/1.0",
          role: "owner",
          ownerId: "owner-1",
          spaceId: "space-1",
          hostCredential: wrong,
        }),
      );
      expect(await closed).toBe(4000);
    }
  });
  // @lat: [[mobile-owner-tunnel#Owner tunnel tests#Signed context and replay]]
  it("pins the signing key, binds all request fields and rejects nonce replay", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const time = Date.now();
    const binding = {
      endpoint: "https://connect.example",
      ownerId: "owner-1",
      spaceId: "space-1",
      hostCredential: "synthetic",
      signingPublicKey: publicKey
        .export({ type: "spki", format: "der" })
        .toString("base64"),
    };
    const auth = new OwnerAuthorization(binding, () => time);
    const signed = (
      payload: unknown,
    ): { payload: unknown; signature: string } => ({
      payload,
      signature: sign(
        null,
        Buffer.from(canonical(payload)),
        privateKey,
      ).toString("base64"),
    });
    const device = {
      ...fixtures.objects.DeviceGrant,
      ownerId: "owner-1",
      spaceId: "space-1",
      deviceId: "phone-1",
      grantRevision: "1",
      expiresAt: new Date(time + 86400_000).toISOString(),
      revoked: false,
      scopes: ["conversation:read"],
    };
    auth.update(
      signed({
        protocolVersion: "mobile-owner/1.0",
        ownerId: "owner-1",
        spaceId: "space-1",
        updateId: "auth-1",
        grants: { enabled: true, devices: [device] },
        expiresAt: time + 30_000,
      }),
    );
    const payload = {
      protocolVersion: "mobile-owner/1.0",
      audience: "owner-1",
      spaceId: "space-1",
      deviceId: "phone-1",
      grantRevision: "1",
      authorizationId: "auth-1",
      method: "GET",
      path: root + "/bootstrap",
      query: {},
      bodyHash: createHash("sha256").update("null").digest("hex"),
      headers: {},
      requestId: "request-1",
      nonce: "nonce-1",
      expiresAt: time + 30_000,
    };
    const frame = { ...signed(payload), requestId: "request-1", body: null };
    for (const changed of [
      { path: root + "/ipc" },
      { audience: "owner-2" },
      { query: { limit: "10" } },
      { headers: { "if-match": '"7"' } },
    ])
      expect(() =>
        auth.request(
          { ...frame, payload: { ...payload, ...changed } },
          new AbortController().signal,
        ),
      ).toThrow("scope_denied");
    expect(() =>
      auth.request(
        { ...frame, body: { injected: true } },
        new AbortController().signal,
      ),
    ).toThrow("scope_denied");
    expect(auth.request(frame, new AbortController().signal).operationId).toBe(
      "getBootstrap",
    );
    expect(() => auth.request(frame, new AbortController().signal)).toThrow(
      "idempotency_conflict",
    );
    auth.clear();
    expect(() =>
      auth.request(
        { ...frame, ...signed({ ...payload, nonce: "nonce-2" }) },
        new AbortController().signal,
      ),
    ).toThrow("scope_denied");
  });
});
