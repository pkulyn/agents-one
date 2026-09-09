import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { setPath: vi.fn(), getPath: () => "C:\\temp" },
}));

let testHome = "";

async function loadStore(): Promise<
  typeof import("../src/main/web-agent/conversation-store")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/web-agent/conversation-store");
}

describe("Web Agent conversation mapping store", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-web-agent-store-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists only allowed provider references and rejects duplicate remote bindings", async () => {
    const store = await loadStore();
    const ref = { url: "https://www.doubao.com/chat/conversation-1" };
    store.saveWebAgentConversation("default", {
      runtimeId: "doubao-web",
      localSessionId: "web-doubao:one",
      provider: "doubao",
      ref,
      lastVerifiedAt: 1,
    });

    expect(
      store.getWebAgentConversation("default", "doubao-web", "web-doubao:one"),
    ).toMatchObject({ ref, profileId: "default" });
    expect(() =>
      store.saveWebAgentConversation("default", {
        runtimeId: "doubao-web",
        localSessionId: "web-doubao:two",
        provider: "doubao",
        ref,
        lastVerifiedAt: 2,
      }),
    ).toThrow("multiple local conversations");
  });

  it("drops malformed or foreign-origin mappings when reading", async () => {
    const store = await loadStore();
    store.saveWebAgentConversation("default", {
      runtimeId: "doubao-web",
      localSessionId: "web-doubao:one",
      provider: "doubao",
      ref: { url: "https://www.doubao.com/chat/conversation-1" },
      lastVerifiedAt: 1,
    });
    const file = join(testHome, "desktop", "web-agent-conversations.json");
    const { readFileSync, writeFileSync } = await import("fs");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      mappings: unknown[];
    };
    parsed.mappings.push({
      runtimeId: "evil",
      localSessionId: "bad",
      provider: "doubao",
      ref: { url: "https://evil.example/chat" },
    });
    writeFileSync(file, JSON.stringify(parsed));
    expect(store.getWebAgentConversation("default", "evil", "bad")).toBeNull();
    expect(store.hasWebAgentConversationStore("default")).toBe(true);
  });

  it("does not persist Doubao's generic landing route as a conversation", async () => {
    const store = await loadStore();

    expect(() =>
      store.saveWebAgentConversation("default", {
        runtimeId: "doubao-web",
        localSessionId: "web-doubao:landing",
        provider: "doubao",
        ref: {
          url: "https://www.doubao.com/chat/?from_login=1",
          opaqueId: "https://www.doubao.com/chat/?from_login=1",
        },
        lastVerifiedAt: 1,
      }),
    ).toThrow("mapping is invalid");
  });

  it("persists a concrete Grok conversation but rejects its landing route", async () => {
    const store = await loadStore();
    const ref = { url: "https://grok.com/c/grok-conversation-1" };

    store.saveWebAgentConversation("default", {
      runtimeId: "grok-web",
      localSessionId: "web-grok:one",
      provider: "grok",
      ref,
      lastVerifiedAt: 1,
    });

    expect(
      store.getWebAgentConversation("default", "grok-web", "web-grok:one"),
    ).toMatchObject({ ref, provider: "grok" });
    expect(() =>
      store.saveWebAgentConversation("default", {
        runtimeId: "grok-web",
        localSessionId: "web-grok:landing",
        provider: "grok",
        ref: { url: "https://grok.com/" },
        lastVerifiedAt: 2,
      }),
    ).toThrow("mapping is invalid");
  });
});
