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
import { DatabaseSync } from "node:sqlite";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";
import { assertMobileSchema } from "../src/shared/mobile-control";

const state = vi.hoisted(() => ({ root: "", active: "other" }));
vi.mock("../src/main/utils", () => {
  const mocked = {
    getActiveProfileNameSync: () => state.active,
    profileHome: (profile: string) => join(state.root, profile),
    activeStateDbPath: () => join(state.root, state.active, "state.db"),
    safeWriteFile: (path: string, data: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
    },
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "agents-one-owner-sources-"));
  vi.resetModules();
});
afterEach(() => rmSync(state.root, { recursive: true, force: true }));
function seed(name: string, value: unknown, profile = "owner"): string {
  const file = join(state.root, profile, "desktop", name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return file;
}
function conversation(id = "conversation-1"): RuntimeConversation {
  return {
    id,
    title: "Original",
    runtimeId: "runtime-1",
    runtimeName: "Original runtime",
    runtimeKind: "pi",
    runtimeLocation: "local",
    createdAt: 1000,
    updatedAt: 2000,
    messageCount: 1,
    messages: [
      {
        id: "message-1",
        role: "user",
        content: "Original request",
        createdAt: 1000,
      },
    ],
  };
}
function native(profile = "owner", id = "session-1"): void {
  const file = join(state.root, profile, "state.db");
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(
    "CREATE TABLE sessions(id TEXT PRIMARY KEY, source TEXT, started_at REAL, ended_at REAL, title TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT, timestamp REAL, tool_name TEXT, reasoning TEXT)",
  );
  db.prepare("INSERT INTO sessions VALUES (?, 'cli', 1, 4, ?)").run(
    id,
    `${profile} native title`,
  );
  db.prepare(
    "INSERT INTO messages VALUES (1, ?, 'user', ?, 1, NULL, NULL)",
  ).run(id, "User path D:\\user\\intent.txt stays visible");
  db.prepare(
    "INSERT INTO messages VALUES (2, ?, 'assistant', 'Native answer', 2, NULL, 'Private chain of thought')",
  ).run(id);
  db.prepare(
    "INSERT INTO messages VALUES (3, ?, 'tool', 'token=secret-value D:\\internal\\data', 3, 'read_file', NULL)",
  ).run(id);
  db.close();
  const desktopDb = new DatabaseSync(join(state.root, profile, "desktop.db"));
  desktopDb.exec(
    "CREATE TABLE IF NOT EXISTS desktop_session_context_folders(session_id TEXT, folder_path TEXT, workspace_id TEXT, folder_name TEXT)",
  );
  desktopDb
    .prepare(
      "INSERT INTO desktop_session_context_folders VALUES (?, 'D:\\synthetic\\project', NULL, NULL)",
    )
    .run(id);
  desktopDb.close();
}

describe("profile-bound original desktop source repository", () => {
  it("recognizes the desktop taskId-as-conversationId legacy link only for the matching Runtime", async () => {
    const original = conversation();
    original.runtimeSessionId = "provider-session";
    const source = seed("runtime-conversations.json", {
      conversations: [original],
    });
    const record = {
      taskId: original.id,
      title: "Original collaboration",
      sourceRuntimeId: original.runtimeId,
      status: "configured",
      assignments: [],
      createdAt: 1000,
      updatedAt: 2000,
    };
    const tasks = seed("task-collaborations.json", { records: [record] });
    const beforeSource = readFileSync(source),
      beforeTasks = readFileSync(tasks);
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    expect(repository.list()).toMatchObject([
      {
        id: original.id,
        sourceKind: "collaboration",
        runtimeId: original.runtimeId,
        manageable: false,
        messages: [{ id: "message-1", content: "Original request" }],
      },
    ]);
    expect(readFileSync(source)).toEqual(beforeSource);
    expect(readFileSync(tasks)).toEqual(beforeTasks);
    seed("task-collaborations.json", {
      records: [{ ...record, sourceSessionId: "provider-session" }],
    });
    expect(repository.list()).toMatchObject([
      { id: original.id, sourceKind: "collaboration" },
    ]);
    seed("task-collaborations.json", {
      records: [{ ...record, sourceSessionId: "unrelated-provider-session" }],
    });
    expect(() => repository.list()).toThrow("requires_owner_action");
    seed("task-collaborations.json", {
      records: [{ ...record, sourceRuntimeId: "foreign-runtime" }],
    });
    expect(() => repository.list()).toThrow("requires_owner_action");
  });
  it("reads configured Runtime conversations and cached overlays when an existing desktop database has no Hermes sessions table", async () => {
    const file = seed("runtime-conversations.json", {
      conversations: [conversation()],
    });
    seed("sessions.json", {
      sessions: [
        {
          id: "cached-native",
          source: "cli",
          startedAt: 1,
          title: "Cached native",
        },
      ],
    });
    seed("session-overlays.json", {
      sessions: {
        "cached-native": [{ kind: "user", content: "Original cached request" }],
      },
    });
    const dbFile = join(state.root, "owner", "state.db");
    const db = new DatabaseSync(dbFile);
    db.exec("CREATE TABLE desktop_auxiliary_cache (id TEXT PRIMARY KEY)");
    db.close();
    const before = readFileSync(dbFile),
      beforeRuntime = readFileSync(file);
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const rows = new DesktopConversationRepository("owner").list();
    expect(rows.map((row) => row.id).sort()).toEqual([
      "cached-native",
      "conversation-1",
    ]);
    expect(
      rows.find((row) => row.id === "cached-native")!.messages[0].content,
    ).toBe("Original cached request");
    expect(readFileSync(dbFile)).toEqual(before);
    expect(readFileSync(file)).toEqual(beforeRuntime);
  });
  it("retains signed desktop continuation message IDs while excluding private reasoning and attachment metadata", async () => {
    native();
    const prefix = [
      {
        kind: "user",
        content: "Earlier user",
        attachments: [
          {
            path: "D:\\internal\\attachment",
            dataUrl: "private image payload",
          },
        ],
      },
      { kind: "assistant", content: "Earlier answer" },
      { kind: "reasoning", text: "Private earlier reasoning" },
      {
        kind: "tool_call",
        callId: "tool-1",
        name: "read_file",
        args: "private args",
      },
    ];
    seed("session-overlays.json", {
      sessions: { "session-1": prefix, "overlay-only": prefix },
    });
    seed("sessions.json", {
      sessions: [
        {
          id: "overlay-only",
          source: "cli",
          startedAt: 1,
          title: "Original overlay conversation",
        },
      ],
    });
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    const row = repository.list().find((value) => value.id === "overlay-only")!;
    expect(row.messages.slice(0, 2).map((message) => message.id)).toEqual([
      "-900000000",
      "-900000001",
    ]);
    expect(JSON.stringify(row)).not.toMatch(
      /private args|Private earlier|internal|image payload/,
    );
    assertMobileSchema("Message", {
      id: row.messages[0].id,
      conversationId: row.id,
      kind: row.messages[0].kind,
      content: row.messages[0].content,
      createdAt: new Date(row.messages[0].createdAt).toISOString(),
      visibleToUser: true,
      messageSeq: "1",
    });
  });
  it("reads all four original source kinds without exporting unknown metadata, private reasoning or tool payloads", async () => {
    const runtime = conversation();
    runtime.workspace = "D:\\synthetic\\project";
    runtime.messages.push({
      id: "private",
      role: "agent",
      content: "Private audit only",
      createdAt: 1100,
      meta: { audience: ["audit"], origin: "runtime", persistence: "durable" },
    });
    runtime.messages.push({
      id: "platform",
      role: "system",
      content: "Authorization: Bearer private-key\nOpened D:\\internal\\file",
      createdAt: 1200,
    });
    seed("runtime-conversations.json", {
      futureRoot: "private extension",
      conversations: [runtime],
    });
    seed("quick-chats.json", {
      chats: [{ ...conversation("quick-1"), runtimeSessionId: null }],
    });
    seed("project-folders.json", {
      folders: [
        {
          id: "project-1",
          name: "Original project",
          path: "D:\\synthetic\\project",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    seed("task-collaborations.json", {
      records: [
        {
          taskId: "task-1",
          title: "Original collaboration",
          status: "configured",
          assignments: [],
          createdAt: 1000,
          updatedAt: 2000,
          execution: {
            status: "pending",
            roleRuns: [],
            updatedAt: 2000,
            timeline: [
              {
                id: "original-event",
                type: "handoff",
                label: "Handoff",
                detail: "D:\\internal\\file token=private-key",
                createdAt: 2000,
              },
            ],
          },
        },
      ],
    });
    native();
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const rows = new DesktopConversationRepository("owner").list();
    expect(rows.map((row) => row.sourceKind).sort()).toEqual([
      "collaboration",
      "native_session",
      "quick_chat",
      "runtime_conversation",
    ]);
    expect(rows.find((row) => row.id === "conversation-1")).toMatchObject({
      runtimeId: "runtime-1",
      projectId: "project-1",
      revision: "1",
    });
    const source = rows.find((row) => row.id === "session-1")!;
    expect(source.messages.map((message) => message.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(source.messages[0].content).toContain("D:\\user\\intent.txt");
    expect(source.messages[2]).toMatchObject({
      kind: "tool_summary",
      content: "Tool result: read_file",
    });
    expect(source.projectId).toBe("project-1");
    expect(JSON.stringify(rows)).not.toMatch(
      /private-key|private extension|Private chain|Private audit|internal/,
    );
    expect(rows.find((row) => row.id === "task-1")?.messages[0].id).toBe(
      "original-event",
    );
  });
  it("uses a separate readonly database for the bound profile and leaves original files unchanged", async () => {
    native();
    native("other", "other-session");
    const file = seed("runtime-conversations.json", {
      conversations: [conversation()],
    });
    const original = readFileSync(file, "utf8");
    const dbFile = join(state.root, "owner", "state.db");
    const before = readFileSync(dbFile);
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    expect(
      repository.list().find((row) => row.sourceKind === "native_session")
        ?.title,
    ).toBe("owner native title");
    state.active = "other";
    expect(repository.list().some((row) => row.id === "other-session")).toBe(
      false,
    );
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(readFileSync(dbFile)).toEqual(before);
  });
  it("retains the original linked conversation identity and does not hide unrelated provider sessions", async () => {
    native();
    const runtime = {
      ...conversation(),
      runtimeId: "hermes-local",
      runtimeKind: "hermes" as const,
      runtimeSessionId: "session-1",
    };
    seed("runtime-conversations.json", { conversations: [runtime] });
    seed("task-collaborations.json", {
      records: [
        {
          taskId: "task-1",
          conversationId: runtime.id,
          title: "Collaboration",
          status: "configured",
          assignments: [],
          createdAt: 1000,
          updatedAt: 2000,
        },
      ],
    });
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    expect(repository.list()).toHaveLength(1);
    expect(repository.list()[0]).toMatchObject({
      id: runtime.id,
      sourceKind: "collaboration",
      manageable: false,
    });
    seed("runtime-conversations.json", {
      conversations: [
        { ...runtime, runtimeId: "runtime-1", runtimeKind: "pi" },
      ],
    });
    expect(
      repository
        .list()
        .map((row) => row.id)
        .sort(),
    ).toEqual(["conversation-1", "session-1"]);
  });
  it("patches the original versioned record while preserving source IDs, messages and extensions", async () => {
    const runtime = conversation();
    const file = seed("runtime-conversations.json", {
      futureRoot: { keep: true },
      conversations: [{ ...runtime, opaque: "preserve" }],
    });
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    expect(
      repository.patch(
        runtime.id,
        { title: "Mobile rename", pinned: true, archived: true },
        "1",
      ),
    ).toMatchObject({
      id: runtime.id,
      revision: "2",
      title: "Mobile rename",
      pinned: true,
      archived: true,
    });
    const before = readFileSync(file, "utf8");
    expect(() => repository.patch(runtime.id, { title: "Stale" }, "1")).toThrow(
      "revision_conflict",
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(JSON.parse(before)).toMatchObject({
      futureRoot: { keep: true },
      conversations: [{ opaque: "preserve", messages: runtime.messages }],
    });
  });
  it("rejects unverified native/collaboration writes and missing projects instead of creating replacement records", async () => {
    native();
    seed("runtime-conversations.json", { conversations: [conversation()] });
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    expect(() =>
      repository.patch("session-1", { title: "Rename" }, "1"),
    ).toThrow("requires_owner_action");
    expect(() =>
      repository.patch("conversation-1", { projectId: "unknown" }, "1"),
    ).toThrow("resource_not_found");
    expect(
      repository.list().find((row) => row.id === "session-1"),
    ).toMatchObject({
      manageable: false,
      restrictionReason: "requires_owner_action",
    });
  });
  it("fails explicitly on corrupt source files and cross-source ID collisions", async () => {
    const file = seed("runtime-conversations.json", {
      conversations: [conversation()],
    });
    const { DesktopConversationRepository } =
      await import("../src/main/mobile-control/desktop-conversations");
    const repository = new DesktopConversationRepository("owner");
    seed("quick-chats.json", { chats: [conversation()] });
    expect(() => repository.list()).toThrow("requires_owner_action");
    seed("quick-chats.json", { chats: [] });
    writeFileSync(file, "broken source");
    expect(() => repository.list()).toThrow("requires_owner_action");
    expect(readFileSync(file, "utf8")).toBe("broken source");
  });
});
