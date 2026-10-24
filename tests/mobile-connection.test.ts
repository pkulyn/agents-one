import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createHash, generateKeyPairSync } from "node:crypto";
import { DesktopSecretStore } from "../src/main/desktop-secret-store";
import { MobileConnectionManager } from "../src/main/mobile-connection";
const fixtures = JSON.parse(
  readFileSync(
    new URL("../contracts/mobile-control/v1/fixtures.json", import.meta.url),
    "utf8",
  ),
);
vi.mock("../src/main/utils", () => {
  const mocked = {
    getActiveProfileNameSync: () => "default",
    profileHome: (p: string) => p,
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/restore-write-lock", () => ({
  assertAgentsOneWritesAllowed: () => {},
}));
const folders: string[] = [];
afterEach(() => {
  for (const path of folders.splice(0))
    rmSync(path, { recursive: true, force: true });
});
const token = "test-mobile-management-key-" + "z".repeat(32);
// Keep the inferred vi.fn mock and fixture projection types for test overrides.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function setup(available = true) {
  const dir = mkdtempSync(join(tmpdir(), "agents-one-mobile-settings-"));
  folders.push(dir);
  const store = new DesktopSecretStore(join(dir, "secrets.json"), {
    available,
    backend: "test-protected",
    encrypt: (s) => Buffer.from(s).map((v) => v ^ 0xa5),
    decrypt: (b) =>
      Buffer.from(b)
        .map((v) => v ^ 0xa5)
        .toString(),
  });
  const view = {
    protocolVersion: "mobile-control/1.0",
    enabled: false,
    taskChannelReady: false,
    owner: fixtures.objects.OwnerSpace,
    claims: [],
    devices: [],
    allowedScopes: ["conversation:read", "schedule:read"],
  };
  const request = vi.fn(
    async () =>
      new Response(JSON.stringify(view), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  return {
    store,
    view,
    request,
    manager: new MobileConnectionManager(() => store, request as typeof fetch),
    file: join(dir, "secrets.json"),
  };
}
describe("desktop mobile connection", () => {
  it("registers Host trust once in the protected profile binding and never projects it to renderer", async () => {
    const s = setup();
    const signingPublicKey = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
    const hostCredential = "host-test-" + "h".repeat(40);
    const registration = {
      protocolVersion: "mobile-owner/1.0",
      ownerId: s.view.owner.ownerId,
      spaceId: s.view.owner.spaceId,
      hostCredential,
      signingPublicKey,
    };
    let registrations = 0;
    s.request.mockImplementation(async (...args: unknown[]) => {
      const url = String(args[0]);
      if (url.endsWith("/host-credentials")) registrations++;
      return new Response(
        JSON.stringify(
          url.endsWith("/host-credentials") ? registration : s.view,
        ),
        { headers: { "Content-Type": "application/json" } },
      );
    });
    await s.manager.execute("profile-a", {
      action: "save",
      endpoint: "https://connect.example",
      managementToken: token,
    });
    expect(await s.manager.ownerBinding("profile-a")).toBeUndefined();
    s.view.enabled = true;
    const key =
      "mobile-connection:" +
      createHash("sha256").update("profile-a").digest("hex");
    const legacy = { read: () => null, remove: () => {} };
    const saved = JSON.parse(s.store.get(key, legacy)!);
    s.store.set(
      key,
      JSON.stringify({ ...saved, futureBindingOption: "preserve-me" }),
      legacy,
    );
    const binding = await s.manager.ownerBinding("profile-a");
    expect(binding?.hostCredential).toBe(hostCredential);
    expect(binding?.signingPublicKey).toBe(signingPublicKey);
    expect(await s.manager.ownerBinding("profile-a")).toEqual(binding);
    expect(registrations).toBe(1);
    expect(JSON.parse(s.store.get(key, legacy)!).futureBindingOption).toBe(
      "preserve-me",
    );
    expect(readFileSync(s.file, "utf8")).not.toContain(hostCredential);
    const renderer = JSON.stringify(
      await s.manager.execute("profile-a", { action: "status" }),
    );
    expect(renderer).not.toContain(hostCredential);
    expect(renderer).not.toContain(signingPublicKey);
    expect(await s.manager.ownerBinding("profile-b")).toBeUndefined();
  });
  it("isolates profiles and stores credentials only in the protected store", async () => {
    const s = setup();
    expect(
      (await s.manager.execute("profile-a", { action: "status" })).status
        .configured,
    ).toBe(false);
    const saved = await s.manager.execute("profile-a", {
      action: "save",
      endpoint: "https://connect.example",
      managementToken: token,
    });
    expect(saved.status.configured).toBe(true);
    expect(JSON.stringify(saved)).not.toContain(token);
    expect(readFileSync(s.file, "utf8")).not.toContain(token);
    expect(
      (await s.manager.execute("profile-b", { action: "status" })).status
        .configured,
    ).toBe(false);
    const options = s.request.mock.calls[0] as unknown as [string, RequestInit];
    expect(options[0]).toBe(
      "https://connect.example/agents-one/mobile/admin/v1/status",
    );
    expect(options[1].redirect).toBe("error");
    expect(
      (
        await new MobileConnectionManager(
          () => s.store,
          s.request as typeof fetch,
        ).execute("profile-a", { action: "status" })
      ).status.configured,
    ).toBe(true);
  });
  it("rejects insecure endpoints and unavailable protection before saving", async () => {
    const s = setup();
    await expect(
      s.manager.execute("p", {
        action: "save",
        endpoint: "http://127.0.0.1",
        managementToken: token,
      }),
    ).rejects.toThrow("invalid_input");
    expect(s.request).not.toHaveBeenCalled();
    const unavailable = setup(false);
    await expect(
      unavailable.manager.execute("p", {
        action: "save",
        endpoint: "https://connect.example",
        managementToken: token,
      }),
    ).rejects.toThrow("secure_storage_unavailable");
  });
  it("fails closed on changed Owner bindings and sanitizes network errors", async () => {
    const s = setup();
    await s.manager.execute("p", {
      action: "save",
      endpoint: "https://connect.example",
      managementToken: token,
    });
    s.view.owner = { ...s.view.owner, ownerId: "other-owner" };
    await expect(s.manager.execute("p", { action: "invite" })).rejects.toThrow(
      "connection_binding_conflict",
    );
    s.request.mockRejectedValueOnce(Error(token));
    expect((await s.manager.execute("p", { action: "status" })).status).toEqual(
      {
        configured: true,
        endpoint: "https://connect.example",
        connectionError: "service_unavailable",
      },
    );
  });
});

it("reads an existing Windows binding through slash and casing changes without rewriting secrets or registering a new Host", async () => {
  const s = setup();
  s.view.enabled = true;
  const oldHome = s.file.slice(0, s.file.lastIndexOf("\\"));
  const key =
    "mobile-connection:" + createHash("sha256").update(oldHome).digest("hex");
  const saved = {
    endpoint: "https://connect.example",
    managementToken: token,
    ownerId: s.view.owner.ownerId,
    spaceId: s.view.owner.spaceId,
    hostCredential: "host-test-" + "h".repeat(40),
    signingPublicKey: generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64"),
    futureBindingOption: "preserved",
  };
  s.store.set(key, JSON.stringify(saved), {
    read: () => null,
    remove: () => {},
  });
  const before = readFileSync(s.file, "utf8");
  const slashHome = oldHome.replaceAll("\\", "/");
  expect(
    (await s.manager.execute(slashHome, { action: "status" })).status
      .configured,
  ).toBe(true);
  expect(
    (await s.manager.execute(slashHome.toUpperCase(), { action: "status" }))
      .status.configured,
  ).toBe(true);
  expect(await s.manager.ownerBinding(slashHome)).toMatchObject({
    hostCredential: saved.hostCredential,
    signingPublicKey: saved.signingPublicKey,
  });
  expect(
    (await s.manager.execute(oldHome + "-other", { action: "status" })).status
      .configured,
  ).toBe(false);
  expect(
    s.request.mock.calls.every(([url]) => String(url).endsWith("/status")),
  ).toBe(true);
  expect(readFileSync(s.file, "utf8")).toBe(before);
});

it("copies one unambiguous legacy mobile binding to the sole default profile and keeps the source key", async () => {
  const s = setup();
  const profilesRoot = join(dirname(s.file), "data", "profiles");
  const home = join(profilesRoot, "default");
  mkdirSync(home, { recursive: true });
  const saved = {
    endpoint: "https://connect.example",
    managementToken: token,
    ownerId: s.view.owner.ownerId,
    spaceId: s.view.owner.spaceId,
    hostCredential: "host-test-" + "h".repeat(40),
    signingPublicKey: generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64"),
  };
  const legacyKey = "mobile-connection:" + "a".repeat(64);
  const legacy = { read: () => null, remove: () => {} };
  s.store.set(legacyKey, JSON.stringify(saved), legacy);

  const result = await s.manager.execute(home, { action: "status" });
  const currentHome = process.platform === "win32" ? home.toLowerCase() : home;
  const currentKey =
    "mobile-connection:" +
    createHash("sha256").update(currentHome).digest("hex");
  expect(result.status.configured).toBe(true);
  expect(s.store.get(currentKey, legacy)).toBe(JSON.stringify(saved));
  expect(s.store.get(legacyKey, legacy)).toBe(JSON.stringify(saved));

  const ambiguous = setup();
  const ambiguousHome = join(
    dirname(ambiguous.file),
    "data",
    "profiles",
    "default",
  );
  mkdirSync(ambiguousHome, { recursive: true });
  mkdirSync(join(dirname(ambiguous.file), "data", "profiles", "writer"));
  ambiguous.store.set(legacyKey, JSON.stringify(saved), legacy);
  const ambiguousResult = await ambiguous.manager.execute(ambiguousHome, {
    action: "status",
  });
  expect(ambiguousResult.status.configured).toBe(false);
  expect(ambiguous.request).not.toHaveBeenCalled();
  expect(ambiguous.store.get(legacyKey, legacy)).toBe(JSON.stringify(saved));
});

it("refuses unreadable canonical trust instead of falling back to an older legacy path", async () => {
  const s = setup();
  const home = s.file.slice(0, s.file.lastIndexOf("\\"));
  const key = (p: string) =>
    "mobile-connection:" + createHash("sha256").update(p).digest("hex");
  const legacy = { read: () => null, remove: () => {} };
  s.store.set(
    key(home),
    JSON.stringify({
      endpoint: "https://connect.example",
      managementToken: token,
    }),
    legacy,
  );
  s.store.set(key(home.toLowerCase()), "new-config", legacy);
  const decrypt = s.store.protector.decrypt;
  vi.spyOn(s.store.protector, "decrypt").mockImplementation((b) => {
    const value = decrypt(b);
    if (value === "new-config") throw Error("unreadable");
    return value;
  });
  const before = readFileSync(s.file, "utf8");
  expect(
    (await s.manager.execute(home.replaceAll("\\", "/"), { action: "status" }))
      .status,
  ).toEqual({
    configured: true,
    connectionError: "secure_storage_unavailable",
  });
  await expect(s.manager.ownerBinding(home)).rejects.toThrow(
    "secure_storage_unavailable",
  );
  expect(s.request).not.toHaveBeenCalled();
  expect(readFileSync(s.file, "utf8")).toBe(before);
});
