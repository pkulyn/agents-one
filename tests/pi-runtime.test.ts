import { describe, expect, it } from "vitest";
import { piExecArgs, piInvocation } from "../src/main/pi-runtime";

describe("Pi Agent CLI runtime invocation", () => {
  it("keeps unscoped conversations tool-free and noninteractive", () => {
    expect(
      piExecArgs("analysis", "inspect this", "pi-session-1", "D:\\sessions"),
    ).toEqual([
      "--print",
      "--mode",
      "json",
      "--session-dir",
      "D:\\sessions",
      "--session-id",
      "pi-session-1",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
      "--no-tools",
      "inspect this",
    ]);
  });

  it("allows only read tools when a conversation has an explicit workspace", () => {
    const args = piExecArgs(
      "analysis",
      "inspect this project",
      "pi-session-read",
      "D:\\sessions",
      [],
      true,
    );
    expect(args).toContain("--tools");
    expect(args).toContain("read,grep,find,ls");
    expect(args).not.toContain("--no-tools");
  });

  it("allows tools only for an implementation process already isolated by its caller", () => {
    expect(
      piExecArgs(
        "implementation",
        "change this",
        "pi-session-2",
        "D:\\sessions",
      ),
    ).not.toContain("--no-tools");
  });

  it("passes only staged attachment copies through Pi's explicit file syntax", () => {
    expect(
      piExecArgs("analysis", "summarize", "pi-session-3", "D:\\sessions", [
        "D:\\inputs\\brief.txt",
      ]),
    ).toContain("@D:\\inputs\\brief.txt");
  });

  it("passes a configured model override through Pi's native flag", () => {
    expect(
      piExecArgs(
        "analysis",
        "summarize",
        "pi-session-4",
        "D:\\sessions",
        [],
        false,
        "ark/glm-5.2",
      ),
    ).toEqual(expect.arrayContaining(["--model", "ark/glm-5.2"]));
  });

  it("unwraps the Windows npm shim without enabling a shell", () => {
    expect(
      piInvocation("D:\\portable-node\\pi.cmd", "win32", () => true),
    ).toEqual({
      command: "D:\\portable-node\\node.exe",
      prefix: [
        "D:\\portable-node\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js",
      ],
    });
  });
});
