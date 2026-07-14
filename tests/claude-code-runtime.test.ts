import { describe, expect, it } from "vitest";
import {
  claudeCodeExecArgs,
  claudeCodeInvocation,
  claudeCodeLoggedIn,
  filterClaudeCodeStreamLine,
} from "../src/main/claude-code-runtime";

describe("Claude Code runtime invocation", () => {
  it("uses the non-mutating plan contract for analysis", () => {
    expect(claudeCodeExecArgs("analysis", "inspect this")).toEqual([
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--no-session-persistence",
      "--permission-mode",
      "plan",
      "inspect this",
    ]);
  });

  it("allows edits only for a separately-created implementation worktree", () => {
    expect(claudeCodeExecArgs("implementation", "change this")).toContain("acceptEdits");
  });

  it("unwraps the Windows script shim without enabling a shell", () => {
    expect(
      claudeCodeInvocation("D:\\portable-node\\claude.cmd", "win32", () => true),
    ).toEqual({
      command: "D:\\portable-node\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
      prefix: [],
    });
  });

  it("removes startup metadata while retaining final output and errors", () => {
    expect(filterClaudeCodeStreamLine('{"type":"system","subtype":"init"}')).toBe("");
    expect(filterClaudeCodeStreamLine('{"type":"system","subtype":"hook_response","output":"large hook payload"}')).toBe("");
    expect(filterClaudeCodeStreamLine('{"type":"assistant","message":{"content":[]}}')).not.toBe("");
    expect(filterClaudeCodeStreamLine('{"type":"result","result":"done"}')).not.toBe("");
  });

  it("recognizes authenticated Claude Code status without storing credentials", () => {
    expect(claudeCodeLoggedIn('{"loggedIn":true,"authMethod":"oauth_token"}')).toBe(true);
    expect(claudeCodeLoggedIn('{"loggedIn":false}')).toBe(false);
    expect(claudeCodeLoggedIn("not logged in")).toBe(false);
  });
});
