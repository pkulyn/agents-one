import { describe, expect, it } from "vitest";
import { piExecArgs, piReadOnlyExtensionSource } from "../src/main/pi-runtime";
type ToolEvent = {
  toolName: string;
  input?: Record<string, unknown>;
  parentToolCallId?: string;
};
function gate(mode: "analysis" | "safe_write"): (event: ToolEvent) => unknown {
  let handler!: (event: ToolEvent) => unknown;
  const install = new Function(
    piReadOnlyExtensionSource(mode).replace(
      "export default function agentsOneReadOnly",
      "return function agentsOneReadOnly",
    ),
  )();
  install({
    on: (_name: string, callback: typeof handler) => {
      handler = callback;
    },
    getAllTools: () => [
      { name: "mcp__pretend_read", annotations: { readOnlyHint: true } },
      { name: "custom_query", annotations: { readOnlyHint: true } },
    ],
  });
  return handler;
}
describe("strict Pi automatic capabilities", () => {
  it.each([
    "bash",
    "powershell",
    "codemode",
    "tool_search",
    "mcp__pretend_read",
    "custom_query",
    "task",
    "unknown_extension",
  ])("blocks opaque or user-declared tool %s before execution", (toolName) => {
    expect(
      gate("safe_write")({
        toolName,
        input: { command: "python harmless-looking-script.py" },
        parentToolCallId: "nested",
      }),
    ).toMatchObject({
      block: true,
      reason: expect.stringContaining("完全访问"),
    });
  });
  it.each(["mcp__pretend_read", "custom_query", "codemode", "tool_search"])(
    "does not use self-declared readOnlyHint to authorize %s",
    (toolName) => {
      expect(gate("analysis")({ toolName })).toMatchObject({ block: true });
    },
  );
  it("keeps native controlled reads and edits available", () => {
    for (const toolName of ["read", "grep", "find", "ls", "write", "edit"])
      expect(gate("safe_write")({ toolName })).toBeUndefined();
    for (const toolName of ["read", "grep", "find", "ls"])
      expect(gate("analysis")({ toolName })).toBeUndefined();
  });
  it.each(["analysis", "safe_write"] as const)(
    "disables automatic extensions and MCP for %s",
    (mode) => {
      const args = piExecArgs(
        mode,
        "fixture prompt",
        "native-session",
        "fixture-sessions",
      );
      expect(args).toContain("--no-extensions");
      expect(args).toContain("--no-mcp");
      expect(args[args.indexOf("--tools") + 1]).toBe(
        mode === "analysis"
          ? "read,grep,find,ls"
          : "read,grep,find,ls,write,edit",
      );
      expect(args[args.indexOf("--exclude-tools") + 1]).toContain("mcp__*");
    },
  );
  it("leaves explicit full access native resources available", () => {
    const args = piExecArgs("full_access", "fixture", "session", "sessions");
    for (const flag of [
      "--no-extensions",
      "--no-mcp",
      "--tools",
      "--exclude-tools",
    ])
      expect(args).not.toContain(flag);
  });
});
