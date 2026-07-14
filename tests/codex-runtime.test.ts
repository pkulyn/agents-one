import { describe, expect, it } from "vitest";
import { codexExecArgs, codexInvocation } from "../src/main/codex-runtime";

describe("Codex runtime invocation", () => {
  it("uses the read-only noninteractive contract for analysis", () => {
    expect(codexExecArgs("D:\\repo", "analysis", "inspect this")).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--cd",
      "D:\\repo",
      "inspect this",
    ]);
  });

  it("permits writes only inside the already-isolated worktree", () => {
    expect(codexExecArgs("D:\\worktree", "implementation", "change this")).toContain(
      "workspace-write",
    );
  });

  it("keeps a normal executable invocation shell-free", () => {
    expect(codexInvocation("codex")).toEqual({ command: "codex", prefix: [] });
  });

  it("unwraps the Windows npm .cmd shim without enabling a shell", () => {
    expect(
      codexInvocation("D:\\portable-node\\codex.cmd", "win32", () => true),
    ).toEqual({
      command: "D:\\portable-node\\node.exe",
      prefix: [
        "D:\\portable-node\\node_modules\\@openai\\codex\\bin\\codex.js",
      ],
    });
  });
});
