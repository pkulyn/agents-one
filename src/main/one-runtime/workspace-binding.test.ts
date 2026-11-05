import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { resolveOneConversationWorkspace } from "./workspace-binding";

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
