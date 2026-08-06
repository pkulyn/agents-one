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
    expect(
      codexExecArgs("D:\\worktree", "implementation", "change this"),
    ).toContain("workspace-write");
  });

  it("uses workspace-write for a confirmed direct full-access task", () => {
    expect(
      codexExecArgs("D:\\project", "full_access", "update the project"),
    ).toContain("workspace-write");
  });

  it("allows only the staged input directory and declared images alongside the workspace", () => {
    expect(
      codexExecArgs(
        "D:\\repo",
        "analysis",
        "inspect the supplied files",
        "D:\\inputs\\task-1",
        ["D:\\inputs\\task-1\\diagram.png"],
      ),
    ).toEqual([
      "exec",
      "--json",
      "--sandbox",
      "read-only",
      "--cd",
      "D:\\repo",
      "--add-dir",
      "D:\\inputs\\task-1",
      "--image",
      "D:\\inputs\\task-1\\diagram.png",
      "inspect the supplied files",
    ]);
  });

  it("uses an explicit model only when the runtime has a model override", () => {
    expect(
      codexExecArgs(
        "D:\\repo",
        "analysis",
        "inspect this",
        undefined,
        [],
        "gpt-5.3-codex",
      ),
    ).toEqual(
      expect.arrayContaining(["--model", "gpt-5.3-codex", "inspect this"]),
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
