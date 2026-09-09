import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { setPath: vi.fn(), getPath: () => "C:\\temp" },
}));

let testHome: string;

async function loadStore(): Promise<
  typeof import("../src/main/runtime-conversation-store")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/runtime-conversation-store");
}

describe("runtime conversation store", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-runtime-conversations-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists runtime conversations and returns summaries newest first", async () => {
    const store = await loadStore();

    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-conv-gateway",
      title: "Hermes Gateway hello",
      runtimeId: "hermes-gateway",
      runtimeName: "Hermes Gateway",
      runtimeKind: "hermes",
      runtimeLocation: "remote",
      runtimeSessionId: "oc-session-1",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "你好",
          createdAt: 1,
        },
        {
          id: "msg-2",
          role: "agent",
          content: "你好，连接正常。",
          createdAt: 2,
        },
      ],
    });
    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-conv-codex",
      title: "Codex check",
      runtimeId: "codex",
      runtimeName: "Codex",
      runtimeKind: "codex",
      runtimeLocation: "local",
      messages: [
        {
          id: "msg-3",
          role: "user",
          content: "检查项目",
          createdAt: 3,
        },
      ],
    });
    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-conv-pi",
      title: "PI check",
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      messages: [
        {
          id: "msg-4",
          role: "user",
          content: "你好PI",
          createdAt: 4,
        },
        {
          id: "msg-5",
          role: "agent",
          content: "已收到，连接正常。",
          createdAt: 5,
        },
      ],
    });

    expect(store.listRuntimeConversations("default")).toEqual([
      expect.objectContaining({
        id: "runtime-conv-pi",
        runtimeName: "Pi",
        runtimeKind: "pi",
        messageCount: 2,
      }),
      expect.objectContaining({
        id: "runtime-conv-codex",
        runtimeName: "Codex",
        runtimeKind: "codex",
        messageCount: 1,
      }),
      expect.objectContaining({
        id: "runtime-conv-gateway",
        runtimeName: "Hermes Gateway",
        runtimeSessionId: "oc-session-1",
        messageCount: 2,
      }),
    ]);
    expect(
      store.getRuntimeConversation("runtime-conv-gateway", "default"),
    ).toMatchObject({
      title: "Hermes Gateway hello",
      messages: [
        expect.objectContaining({ role: "user", content: "你好" }),
        expect.objectContaining({ role: "agent", content: "你好，连接正常。" }),
      ],
    });
  });

  it("round-trips an opaque workspace id without requiring a local path", async () => {
    const store = await loadStore();
    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-conv-workspace-id",
      title: "Capability workspace",
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      workspaceId: "project-safe",
      messages: [],
    });

    expect(store.getRuntimeConversation("runtime-conv-workspace-id", "default"))
      .toMatchObject({ workspaceId: "project-safe" });
  });

  it("unlinks runtime conversations when a project is removed", async () => {
    const store = await loadStore();
    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-project-task",
      title: "项目任务",
      runtimeId: "codex",
      runtimeName: "Codex",
      runtimeKind: "codex",
      runtimeLocation: "local",
      workspace: "D:\\Projects\\Alpha",
      messages: [{ id: "m1", role: "user", content: "测试", createdAt: 1 }],
    });
    expect(
      store.clearRuntimeConversationWorkspace("D:\\Projects\\Alpha", "default"),
    ).toBe(1);
    expect(store.getRuntimeConversation("runtime-project-task", "default")?.workspace)
      .toBeUndefined();
  });

  it("renames and deletes conversations within the selected profile", async () => {
    const store = await loadStore();

    store.saveRuntimeConversation({
      profile: "default",
      id: "runtime-conv-1",
      title: "Before",
      runtimeId: "hermes-gateway",
      runtimeName: "Hermes Gateway",
      runtimeKind: "hermes",
      runtimeLocation: "remote",
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "first prompt",
          createdAt: 1,
        },
      ],
    });
    store.saveRuntimeConversation({
      profile: "work",
      id: "runtime-conv-1",
      title: "Other profile",
      runtimeId: "codex",
      runtimeName: "Codex",
      runtimeKind: "codex",
      runtimeLocation: "local",
      messages: [
        {
          id: "msg-2",
          role: "user",
          content: "other prompt",
          createdAt: 1,
        },
      ],
    });

    store.updateRuntimeConversationTitle("runtime-conv-1", "After", "default");
    expect(
      store.getRuntimeConversation("runtime-conv-1", "default")?.title,
    ).toBe("After");
    expect(store.getRuntimeConversation("runtime-conv-1", "work")?.title).toBe(
      "Other profile",
    );

    store.deleteRuntimeConversation("runtime-conv-1", "default");
    expect(
      store.getRuntimeConversation("runtime-conv-1", "default"),
    ).toBeNull();
    expect(
      store.getRuntimeConversation("runtime-conv-1", "work"),
    ).toMatchObject({
      title: "Other profile",
    });
  });
});
