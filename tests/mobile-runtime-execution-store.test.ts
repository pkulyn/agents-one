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
import type { RuntimeConversationMessage } from "../src/shared/runtime-conversations";

const state = vi.hoisted(() => ({ root: "" }));
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
let store: typeof import("../src/main/runtime-conversation-store");
const file = (): string =>
  join(state.root, "owner", "desktop", "runtime-conversations.json");
const user: RuntimeConversationMessage = {
  id: "run-one-user",
  role: "user",
  content: "Advance original task",
  createdAt: 1000,
};
const result: RuntimeConversationMessage = {
  id: "run-one-result",
  role: "agent",
  content: "Original final reply",
  createdAt: 2000,
  execution: { runId: "run-one", events: [] },
};
beforeEach(async () => {
  state.root = mkdtempSync(
    join(tmpdir(), "agents-one-runtime-execution-store-"),
  );
  vi.resetModules();
  store = await import("../src/main/runtime-conversation-store");
  store.saveRuntimeConversation({
    profile: "owner",
    id: "original-conversation",
    title: "Original title",
    runtimeId: "runtime-one",
    runtimeName: "Original runtime",
    runtimeKind: "codex",
    runtimeLocation: "local",
    messages: [],
  });
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
describe("Owner original execution commits", () => {
  it("completes an ordinary desktop cancellation against current metadata without a Renderer observer or duplicate result", async () => {
    const { completeOriginalCancelledRun } =
      await import("../src/main/mobile-control/original-cancel-completion");
    const saved = store.saveRuntimeConversation({
      ...store.getRuntimeConversation("original-conversation", "owner")!,
      profile: "owner",
      messages: [user],
    });
    store.claimRuntimeConversationRun(
      saved.id,
      saved.revision!,
      "run-one",
      { runtimeId: saved.runtimeId },
      "owner",
    );
    const claimed = store.getRuntimeConversation(saved.id, "owner", {
      fullHistory: true,
    })!;
    store.patchRuntimeConversation(
      saved.id,
      { title: "Current title", pinned: true },
      claimed.revision!,
      "owner",
    );
    const run = {
      id: "run-one",
      runtimeId: saved.runtimeId,
      status: "cancelled",
      startedAt: 1000,
      completedAt: 2000,
      events: [],
    } as import("../src/shared/agent-runtimes").AgentRuntimeRun;
    const finish = (
      id: string,
      runId: string,
      message: RuntimeConversationMessage,
      sessionId: string | undefined,
    ): void => {
      store.completeRuntimeConversationTurn(
        id,
        runId,
        message,
        sessionId,
        "owner",
      );
    };
    completeOriginalCancelledRun(run, [claimed], finish);
    const current = store.getRuntimeConversation(saved.id, "owner", {
      fullHistory: true,
    })!;
    expect(current).toMatchObject({ title: "Current title", pinned: true });
    expect(current.activeRuntimeRunId).toBeUndefined();
    expect(current.messages).toHaveLength(2);
    expect(current.messages[0]).toEqual(user);
    const before = readFileSync(file(), "utf8");
    completeOriginalCancelledRun(run, [current], finish);
    expect(readFileSync(file(), "utf8")).toBe(before);
  });
  it("checks legacy project binding while allowing Web Agent metadata without a workspace capability", () => {
    const original = store.saveRuntimeConversation({
      ...store.getRuntimeConversation("original-conversation", "owner")!,
      profile: "owner",
      workspace: "D:/original-project",
      messages: [user],
    });
    const binding = { runtimeId: original.runtimeId };
    expect(() =>
      store.claimRuntimeConversationRun(
        original.id,
        original.revision!,
        "run-one",
        binding,
        "owner",
      ),
    ).toThrow("revision_conflict");
    const claimed = store.claimRuntimeConversationRun(
      original.id,
      original.revision!,
      "run-one",
      { ...binding, workspaceMetadataOnly: true },
      "owner",
    );
    expect(claimed.workspace).toBe("D:/original-project");
    expect(claimed.messages).toHaveLength(1);
  });
  it("claims a saved desktop user once and refuses stale, active and mismatched claims without altering bytes", () => {
    const saved = store.saveRuntimeConversation({
      ...store.getRuntimeConversation("original-conversation", "owner")!,
      profile: "owner",
      expectedRevision: "1",
      messages: [user],
    });
    const before = readFileSync(file(), "utf8");
    expect(() =>
      store.claimRuntimeConversationRun(
        saved.id,
        saved.revision!,
        "run-one",
        { runtimeId: "other" },
        "owner",
      ),
    ).toThrow("revision_conflict");
    expect(readFileSync(file(), "utf8")).toBe(before);
    const claimed = store.claimRuntimeConversationRun(
      saved.id,
      saved.revision!,
      "run-one",
      { runtimeId: saved.runtimeId },
      "owner",
    );
    expect(claimed).toMatchObject({
      revision: "3",
      activeRuntimeRunId: "run-one",
      messages: [user],
    });
    expect(claimed.activeRuntimeRunOwner).toBeUndefined();
    const bytes = readFileSync(file(), "utf8");
    expect(() =>
      store.claimRuntimeConversationRun(
        saved.id,
        saved.revision!,
        "run-two",
        { runtimeId: saved.runtimeId },
        "owner",
      ),
    ).toThrow("revision_conflict");
    expect(() =>
      store.beginRuntimeConversationTurn(
        saved.id,
        "3",
        "phone-run",
        { ...user, id: "phone-user" },
        "owner",
      ),
    ).toThrow("run_active");
    expect(readFileSync(file(), "utf8")).toBe(bytes);
  });
  it("marks Main ownership before dispatch and rejects a legacy Renderer checkpoint until Main commits its result", () => {
    const admitted = store.beginRuntimeConversationTurn(
      "original-conversation",
      "1",
      "run-one",
      user,
      "owner",
    );
    expect(admitted.activeRuntimeRunOwner).toBe("main");
    const before = readFileSync(file(), "utf8");
    expect(() =>
      store.saveRuntimeConversation({
        ...admitted,
        profile: "owner",
        activeRuntimeRunOwner: undefined,
        activeRuntimeRunId: null,
        messages: [user, result],
      }),
    ).toThrow("run_active");
    expect(readFileSync(file(), "utf8")).toBe(before);
    const completed = store.completeRuntimeConversationTurn(
      "original-conversation",
      "run-one",
      result,
      "native-original-session",
      "owner",
    );
    expect(completed.activeRuntimeRunOwner).toBeUndefined();
    expect(completed.messages).toHaveLength(2);
  });
  it("compares revision and active Run in the same original commit and saves one user message before dispatch", () => {
    const admitted = store.beginRuntimeConversationTurn(
      "original-conversation",
      "1",
      "run-one",
      user,
      "owner",
    );
    expect(admitted).toMatchObject({
      revision: "2",
      activeRuntimeRunId: "run-one",
      messages: [user],
    });
    const originalBytes = readFileSync(file(), "utf8");
    expect(() =>
      store.beginRuntimeConversationTurn(
        "original-conversation",
        "1",
        "run-two",
        { ...user, id: "run-two-user" },
        "owner",
      ),
    ).toThrow("revision_conflict");
    expect(() =>
      store.beginRuntimeConversationTurn(
        "original-conversation",
        "2",
        "run-two",
        { ...user, id: "run-two-user" },
        "owner",
      ),
    ).toThrow("run_active");
    expect(readFileSync(file(), "utf8")).toBe(originalBytes);
  });
  it("persists the final reply against current metadata after desktop rename, pin and archive changes", () => {
    store.beginRuntimeConversationTurn(
      "original-conversation",
      "1",
      "run-one",
      user,
      "owner",
    );
    store.patchRuntimeConversation(
      "original-conversation",
      { title: "Desktop updated title", pinned: true, archived: true },
      "2",
      "owner",
    );
    const completed = store.completeRuntimeConversationTurn(
      "original-conversation",
      "run-one",
      result,
      "native-original-session",
      "owner",
    );
    expect(completed).toMatchObject({
      title: "Desktop updated title",
      pinned: true,
      archived: true,
      runtimeSessionId: "native-original-session",
      revision: "4",
      messages: [user, result],
    });
    expect(completed.activeRuntimeRunId).toBeUndefined();
    const originalBytes = readFileSync(file(), "utf8");
    expect(
      store.completeRuntimeConversationTurn(
        "original-conversation",
        "run-one",
        result,
        "native-original-session",
        "owner",
      ),
    ).toEqual(completed);
    expect(readFileSync(file(), "utf8")).toBe(originalBytes);
    expect(() =>
      store.completeRuntimeConversationTurn(
        "original-conversation",
        "run-one",
        { ...result, content: "Conflicting reply" },
        "native-original-session",
        "owner",
      ),
    ).toThrow("reconciliation_required");
  });
  it("retains old message windows and extensions when accepting and completing a new turn", () => {
    const raw = JSON.parse(readFileSync(file(), "utf8"));
    raw.extension = { keep: true };
    raw.conversations[0].extension = { keep: true };
    raw.conversations[0].messages = Array.from({ length: 600 }, (_, i) => ({
      id: `old-${i}`,
      role: i % 2 ? "agent" : "user",
      content: `Original body ${i}`,
      createdAt: i + 1,
      extension: { keep: true },
    }));
    writeFileSync(file(), JSON.stringify(raw));
    store.beginRuntimeConversationTurn(
      "original-conversation",
      "1",
      "run-one",
      user,
      "owner",
    );
    store.completeRuntimeConversationTurn(
      "original-conversation",
      "run-one",
      result,
      undefined,
      "owner",
    );
    const stored = JSON.parse(readFileSync(file(), "utf8"));
    expect(stored.extension).toEqual({ keep: true });
    expect(stored.conversations[0].extension).toEqual({ keep: true });
    expect(stored.conversations[0].messages).toHaveLength(602);
    expect(stored.conversations[0].messages[0]).toMatchObject({
      id: "old-0",
      extension: { keep: true },
    });
  });
});
