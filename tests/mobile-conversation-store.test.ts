import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: (profile: string) => join(state.root, profile),
  agentsOneProfileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (path: string, data: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  },
}));
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-mobile-conversations-"));
  vi.resetModules();
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
const base = {
  id: "conversation-1",
  title: "Original title",
  runtimeId: "runtime-1",
  runtimeName: "Synthetic Runtime",
  runtimeKind: "pi" as const,
  runtimeLocation: "local" as const,
  messages: [
    {
      id: "message-1",
      role: "user" as const,
      content: "Synthetic request",
      createdAt: 1,
    },
  ],
};
function file(
  profile = "default",
  name = "runtime-conversations.json",
): string {
  return join(state.root, profile, "desktop", name);
}
function seed(
  value: unknown,
  profile = "default",
  name = "runtime-conversations.json",
): void {
  mkdirSync(dirname(file(profile, name)), { recursive: true });
  writeFileSync(file(profile, name), JSON.stringify(value));
}

describe("shared desktop and mobile conversation writes", () => {
  it("rejects an existing-record checkpoint after desktop deletion rather than recreating its old history", async () => {
    const store = await import("../src/main/runtime-conversation-store");
    const original = store.saveRuntimeConversation(base);
    store.deleteRuntimeConversation(base.id);
    const before = readFileSync(file(), "utf8");
    expect(() =>
      store.saveRuntimeConversation({
        ...base,
        expectedRevision: original.revision,
      }),
    ).toThrow("resource_not_found");
    expect(readFileSync(file(), "utf8")).toBe(before);
    expect(store.getRuntimeConversation(base.id)).toBeNull();
  });
  it("increments versions for desktop rename and rejects a stale mobile patch without altering data", async () => {
    const store = await import("../src/main/runtime-conversation-store");
    const initial = store.saveRuntimeConversation(base);
    expect(initial.revision).toBe("1");
    store.updateRuntimeConversationTitle(base.id, "Desktop rename");
    const desktop = store.getRuntimeConversation(base.id)!;
    expect(desktop.revision).toBe("2");
    const before = readFileSync(file(), "utf8");
    expect(() =>
      store.patchRuntimeConversation(base.id, { pinned: true }, "1"),
    ).toThrow("revision_conflict");
    expect(readFileSync(file(), "utf8")).toBe(before);
    const updated = store.patchRuntimeConversation(
      base.id,
      { pinned: true, archived: true },
      "2",
    );
    expect(updated).toMatchObject({
      title: "Desktop rename",
      pinned: true,
      archived: true,
      revision: "3",
    });
    expect(() =>
      store.saveRuntimeConversation({ ...base, expectedRevision: "2" }),
    ).toThrow("revision_conflict");
    vi.resetModules();
    expect(
      (
        await import("../src/main/runtime-conversation-store")
      ).getRuntimeConversation(base.id)?.revision,
    ).toBe("3");
  });
  it("preserves root, record, message and execution extensions while keeping invalid historical records", async () => {
    seed({
      futureRoot: { keep: true },
      conversations: [
        {
          ...base,
          futureRecord: "keep",
          messages: [
            {
              ...base.messages[0],
              futureMessage: 42,
              execution: {
                runId: "run-1",
                events: [
                  {
                    id: "e-1",
                    type: "completed",
                    summary: "Synthetic",
                    createdAt: 1,
                  },
                ],
                futureExecution: "keep",
              },
            },
          ],
        },
        { id: "future-source", opaque: "keep unsupported history" },
      ],
    });
    const store = await import("../src/main/runtime-conversation-store");
    const before = store.getRuntimeConversation(base.id)!;
    store.saveRuntimeConversation({
      ...before,
      messages: [
        ...before.messages,
        {
          id: "message-2",
          role: "agent",
          content: "Synthetic result",
          createdAt: 2,
        },
      ],
    });
    const saved = JSON.parse(readFileSync(file(), "utf8"));
    expect(saved.futureRoot).toEqual({ keep: true });
    const row = saved.conversations.find(
      (r: { id: string }) => r.id === base.id,
    );
    expect(row.futureRecord).toBe("keep");
    expect(row.messages[0].futureMessage).toBe(42);
    expect(row.messages[0].execution.futureExecution).toBe("keep");
    expect(
      saved.conversations.find((r: { id: string }) => r.id === "future-source")
        .opaque,
    ).toBe("keep unsupported history");
  });
  it("keeps messages outside the desktop view window across rename and append", async () => {
    const messages = Array.from({ length: 620 }, (_, i) => ({
      id: `message-${i}`,
      role: "user",
      content: `Synthetic ${i}`,
      createdAt: i + 1,
    }));
    seed({ conversations: [{ ...base, messages }] });
    const store = await import("../src/main/runtime-conversation-store");
    expect(store.getRuntimeConversation(base.id)?.messages).toHaveLength(500);
    expect(
      store.getRuntimeConversation(base.id, undefined, { fullHistory: true })
        ?.messages,
    ).toHaveLength(620);
    store.updateRuntimeConversationTitle(base.id, "Renamed");
    const latest = store.getRuntimeConversation(base.id)!;
    store.saveRuntimeConversation({
      ...latest,
      messages: [
        ...latest.messages,
        {
          id: "message-new",
          role: "agent",
          content: "Final result",
          createdAt: 700,
        },
      ],
    });
    const raw = JSON.parse(readFileSync(file(), "utf8")).conversations[0];
    expect(raw.messages).toHaveLength(621);
    expect(raw.messages[0].id).toBe("message-0");
    expect(raw.messages.at(-1).content).toBe("Final result");
    store.saveRuntimeConversation({
      ...base,
      id: "first-long-history",
      messages: messages.map((message) => ({
        ...message,
        role: "user" as const,
      })),
    });
    expect(
      store.getRuntimeConversation("first-long-history", undefined, {
        fullHistory: true,
      })?.messages,
    ).toHaveLength(620);
  });
  it("archives without cancelling a run and rejects project changes in active or bound native sessions", async () => {
    const store = await import("../src/main/runtime-conversation-store");
    store.saveRuntimeConversation({
      ...base,
      activeRuntimeRunId: "run-1",
      workspaceId: "project-1",
    });
    const archived = store.patchRuntimeConversation(
      base.id,
      { archived: true },
      "1",
    );
    expect(archived.activeRuntimeRunId).toBe("run-1");
    expect(() =>
      store.patchRuntimeConversation(
        base.id,
        { workspaceId: "project-2" },
        archived.revision!,
      ),
    ).toThrow("run_active");
    const ended = store.saveRuntimeConversation({
      ...archived,
      activeRuntimeRunId: null,
      runtimeSessionId: "native-session-1",
    });
    expect(() =>
      store.patchRuntimeConversation(
        base.id,
        { workspaceId: "project-2" },
        ended.revision!,
      ),
    ).toThrow("project_binding_conflict");
    store.clearRuntimeConversationWorkspaceId("project-1");
    const cleared = store.getRuntimeConversation(base.id)!;
    expect(cleared.workspaceId).toBeUndefined();
    expect(BigInt(cleared.revision!)).toBeGreaterThan(BigInt(ended.revision!));
  });
  it("does not overwrite a malformed or incompatible existing history document", async () => {
    const store = await import("../src/main/runtime-conversation-store");
    for (const raw of [
      "broken JSON",
      '{"conversations":"future-format"}',
      "[]",
    ]) {
      mkdirSync(dirname(file()), { recursive: true });
      writeFileSync(file(), raw);
      expect(() => store.saveRuntimeConversation(base)).toThrow(
        "conversation_storage_invalid",
      );
      expect(readFileSync(file(), "utf8")).toBe(raw);
    }
  });
  it("publishes committed changes with original identity and leaves another profile untouched", async () => {
    const store = await import("../src/main/runtime-conversation-store");
    const changes: unknown[] = [];
    const unsubscribe = store.onRuntimeConversationChanged((change) =>
      changes.push(change),
    );
    store.saveRuntimeConversation({ ...base, profile: "work" });
    expect(store.getRuntimeConversation(base.id)).toBeNull();
    expect(changes).toEqual([
      {
        profile: "work",
        conversationId: base.id,
        revision: "1",
        kind: "runtime_conversation",
      },
    ]);
    unsubscribe();
    store.updateRuntimeConversationTitle(base.id, "Next", "work");
    expect(changes).toHaveLength(1);
  });
  it("retains Quick Chat extensions and older messages while using the same versioned management path", async () => {
    const messages = Array.from({ length: 110 }, (_, i) => ({
      id: `q-${i}`,
      role: "user",
      content: "Synthetic",
      createdAt: i + 1,
      futureMessage: "keep",
    }));
    seed(
      { futureRoot: true, chats: [{ ...base, messages, futureRecord: true }] },
      "default",
      "quick-chats.json",
    );
    const store = await import("../src/main/runtime-conversation-store");
    expect(store.listQuickChats()[0].messages).toHaveLength(80);
    expect(
      store.listQuickChats(undefined, { fullHistory: true })[0].messages,
    ).toHaveLength(110);
    const patched = store.patchQuickChat(
      base.id,
      { pinned: true, title: "Quick rename" },
      "1",
    );
    expect(patched.revision).toBe("2");
    store.saveQuickChats(store.listQuickChats());
    const saved = JSON.parse(
      readFileSync(file("default", "quick-chats.json"), "utf8"),
    );
    expect(saved.futureRoot).toBe(true);
    expect(saved.chats[0].futureRecord).toBe(true);
    expect(saved.chats[0].messages).toHaveLength(110);
    expect(saved.chats[0].messages[0].futureMessage).toBe("keep");
    store.saveQuickChats(
      Array.from({ length: 45 }, (_, i) => ({
        ...base,
        id: `quick-${i}`,
        createdAt: i,
        updatedAt: i,
      })),
    );
    store.saveQuickChats(store.listQuickChats());
    expect(store.listQuickChats(undefined, { fullHistory: true })).toHaveLength(
      45,
    );
  });
});
