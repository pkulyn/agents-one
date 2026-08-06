import { describe, expect, it } from "vitest";
import {
  claudeCodeExecArgs,
  claudeCodeInvocation,
  claudeCodeLoggedIn,
  filterClaudeCodeStreamLine,
} from "../src/main/claude-code-runtime";

describe("Claude Code runtime invocation", () => {
  it("uses the non-mutating plan contract for analysis", () => {
    expect(
      claudeCodeExecArgs("analysis", "inspect this", undefined, {
        sessionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "plan",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
      "inspect this",
    ]);
  });

  it("resumes a persisted CLI session with the configured model override", () => {
    expect(
      claudeCodeExecArgs("analysis", "continue this", undefined, {
        sessionId: "22222222-2222-4222-8222-222222222222",
        resume: true,
        model: "sonnet",
      }),
    ).toEqual(
      expect.arrayContaining([
        "--model",
        "sonnet",
        "--resume",
        "22222222-2222-4222-8222-222222222222",
        "continue this",
      ]),
    );
  });

  it("allows edits only for a separately-created implementation worktree", () => {
    expect(claudeCodeExecArgs("implementation", "change this")).toContain(
      "acceptEdits",
    );
  });

  it("uses edit permission for a confirmed direct full-access task", () => {
    expect(claudeCodeExecArgs("full_access", "update this")).toContain(
      "acceptEdits",
    );
  });

  it("adds only Agents One's staged input directory to the Claude Code scope", () => {
    expect(
      claudeCodeExecArgs(
        "analysis",
        "inspect the supplied files",
        "D:\\inputs\\task-1",
        { sessionId: "33333333-3333-4333-8333-333333333333" },
      ),
    ).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--permission-mode",
      "plan",
      "--session-id",
      "33333333-3333-4333-8333-333333333333",
      "--add-dir",
      "D:\\inputs\\task-1",
      "--",
      "inspect the supplied files",
    ]);
  });

  it("unwraps the Windows script shim without enabling a shell", () => {
    expect(
      claudeCodeInvocation(
        "D:\\portable-node\\claude.cmd",
        "win32",
        () => true,
      ),
    ).toEqual({
      command:
        "D:\\portable-node\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
      prefix: [],
    });
  });

  it("removes startup metadata while retaining final output and errors", () => {
    expect(
      filterClaudeCodeStreamLine('{"type":"system","subtype":"init"}'),
    ).toBe("");
    expect(
      filterClaudeCodeStreamLine(
        '{"type":"system","subtype":"hook_response","output":"large hook payload"}',
      ),
    ).toBe("");
    expect(
      filterClaudeCodeStreamLine(
        '{"type":"assistant","message":{"content":[]}}',
      ),
    ).not.toBe("");
    expect(
      filterClaudeCodeStreamLine(
        '{"type":"user","message":{"content":[{"type":"tool_result"}]}}',
      ),
    ).not.toBe("");
    expect(
      filterClaudeCodeStreamLine('{"type":"result","result":"done"}'),
    ).not.toBe("");
  });

  it("recognizes authenticated Claude Code status without storing credentials", () => {
    expect(
      claudeCodeLoggedIn('{"loggedIn":true,"authMethod":"oauth_token"}'),
    ).toBe(true);
    expect(claudeCodeLoggedIn('{"loggedIn":false}')).toBe(false);
    expect(claudeCodeLoggedIn("not logged in")).toBe(false);
  });
});
