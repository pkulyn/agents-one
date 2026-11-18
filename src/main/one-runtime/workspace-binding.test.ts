import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  findOneConversationWorkspace,
  resolveOneConversationWorkspace,
} from "./workspace-binding";

it("looks up only an existing One conversation directory without following a linked ancestor", () => {
  const root = mkdtempSync(join(tmpdir(), "one-delivery-binding-"));
  const profile = join(root, "profile");
  const stateDir = join(profile, "desktop", "one", "one");
  try {
    expect(
      findOneConversationWorkspace(profile, "one", "missing"),
    ).toBeUndefined();
    expect(existsSync(profile)).toBe(false);
    const created = resolveOneConversationWorkspace(stateDir, {
      conversationId: "c",
      runId: "run",
    });
    expect(findOneConversationWorkspace(profile, "one", "c")).toBe(
      realpathSync(created.workspace),
    );
    expect(
      findOneConversationWorkspace(profile, "../other", "c"),
    ).toBeUndefined();
    expect(
      findOneConversationWorkspace(profile, "one", "different"),
    ).toBeUndefined();
    const outside = join(root, "outside");
    mkdirSync(outside);
    rmSync(created.workspace, { recursive: true });
    symlinkSync(
      outside,
      created.workspace,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(findOneConversationWorkspace(profile, "one", "c")).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("isolates projectless conversations and resumes only the bound workspace", () => {
  const root = mkdtempSync(join(tmpdir(), "one-bindings-"));
  try {
    const a = resolveOneConversationWorkspace(root, {
      conversationId: "conversation-a",
      runId: "run-a",
    });
    const b = resolveOneConversationWorkspace(root, {
      conversationId: "conversation-b",
      runId: "run-b",
    });
    expect(a.workspace).not.toBe(b.workspace);
    a.bind("session-a");
    expect(
      resolveOneConversationWorkspace(root, {
        conversationId: "conversation-a",
        sessionId: "session-a",
        runId: "next",
      }).workspace,
    ).toBe(a.workspace);
    expect(() =>
      resolveOneConversationWorkspace(root, {
        conversationId: "conversation-b",
        sessionId: "session-a",
        runId: "next",
      }),
    ).toThrow("another conversation");
    expect(() =>
      resolveOneConversationWorkspace(root, {
        sessionId: "missing",
        runId: "next",
      }),
    ).toThrow("not found");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
