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
      "--dangerously-skip-permissions",
    );
  });

  it("uses Claude Code's native bypass mode for confirmed full access", () => {
    expect(claudeCodeExecArgs("full_access", "update this")).toContain(
      "--dangerously-skip-permissions",
    );
  });

  it("keeps Claude Code skills, MCP, plugins, hooks and Bash in safe-write mode", () => {
    const args = claudeCodeExecArgs("safe_write", "update this safely");
    expect(args).toEqual(
      expect.arrayContaining(["--dangerously-skip-permissions"]),
    );
    expect(args).not.toContain("--allowedTools");
    expect(args).not.toContain("--disallowedTools");
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

  it("retains Claude partial thinking and tool frames without persisting text deltas", () => {
    const thinkingDelta =
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Inspect files."}}}';
    const toolStart =
      '{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu-1","name":"Read","input":{}}}}';
    const toolInput =
      '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file_path\\":\\"README.md\\"}"}}}';
    const blockStop =
      '{"type":"stream_event","event":{"type":"content_block_stop","index":1}}';
    const textDelta =
      '{"type":"stream_event","event":{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"final"}}}';

    expect(filterClaudeCodeStreamLine(thinkingDelta)).toBe(thinkingDelta);
    expect(filterClaudeCodeStreamLine(toolStart)).toBe(toolStart);
    expect(filterClaudeCodeStreamLine(toolInput)).toBe(toolInput);
    expect(filterClaudeCodeStreamLine(blockStop)).toBe(blockStop);
    expect(filterClaudeCodeStreamLine(textDelta)).toBe("");
  });

  it("recognizes authenticated Claude Code status without storing credentials", () => {
    expect(
      claudeCodeLoggedIn('{"loggedIn":true,"authMethod":"oauth_token"}'),
    ).toBe(true);
    expect(claudeCodeLoggedIn('{"loggedIn":false}')).toBe(false);
    expect(claudeCodeLoggedIn("not logged in")).toBe(false);
  });
});
