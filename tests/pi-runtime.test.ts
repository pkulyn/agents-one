import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getPiModelContextWindow,
  piChildEnvironment,
  piExecArgs,
  piInvocation,
  piOutputError,
} from "../src/main/pi-runtime";

describe("Pi Agent CLI runtime invocation", () => {
  it("reads the selected model context window from Pi's custom catalogue", () => {
    const configDir = mkdtempSync(join(tmpdir(), "agents-one-pi-models-"));
    writeFileSync(
      join(configDir, "models.json"),
      JSON.stringify({
        providers: {
          ark: {
            models: [
              { id: "small-model", contextWindow: 128_000 },
              { id: "deepseek-v4-flash", contextWindow: 1_000_000 },
            ],
          },
        },
      }),
      "utf-8",
    );

    expect(getPiModelContextWindow("ARK", "deepseek-v4-flash", configDir)).toBe(
      1_000_000,
    );
    expect(getPiModelContextWindow("ark", "missing", configDir)).toBeNull();
  });

  it("falls back to Pi's refreshed provider catalogue", () => {
    const configDir = mkdtempSync(join(tmpdir(), "agents-one-pi-store-"));
    writeFileSync(
      join(configDir, "models-store.json"),
      JSON.stringify({
        deepseek: {
          models: [{ id: "deepseek-v4-flash", contextWindow: 999_000 }],
        },
      }),
      "utf-8",
    );

    expect(
      getPiModelContextWindow("deepseek", "deepseek-v4-flash", configDir),
    ).toBe(999_000);
  });

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
      "--no-tools",
      "inspect this",
    ]);
  });

  it("keeps Pi's native resources and custom tools enabled for writable tasks", () => {
    const args = piExecArgs(
      "safe_write",
      "use llm-wiki",
      "pi-session-skills",
      "D:\\sessions",
    );
    expect(args).not.toContain("--no-skills");
    expect(args).not.toContain("--no-extensions");
    expect(args).not.toContain("--no-context-files");
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--no-tools");
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

  it("keeps the complete native tool set in an isolated implementation process", () => {
    const args = piExecArgs(
      "implementation",
      "change this",
      "pi-session-2",
      "D:\\sessions",
    );
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--exclude-tools");
    expect(args).not.toContain("--no-tools");
  });

  it("keeps Pi's complete native tool set in safe-write mode", () => {
    const args = piExecArgs(
      "safe_write",
      "update this safely",
      "pi-session-safe",
      "D:\\sessions",
    );
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--exclude-tools");
    expect(args).not.toContain("--no-tools");
  });

  it("keeps the complete native tool set in a full-access process", () => {
    const args = piExecArgs(
      "full_access",
      "create this",
      "pi-session-full",
      "D:\\sessions",
    );
    expect(args).not.toContain("--tools");
    expect(args).not.toContain("--exclude-tools");
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

  it("passes the terminal environment to Pi extensions and MCP adapters", () => {
    expect(
      piChildEnvironment({
        PATH: "D:\\portable-node",
        HTTPS_PROXY: "http://127.0.0.1:7890",
        no_proxy: "localhost,127.0.0.1",
      CUSTOM_MCP_TOKEN: "available-to-user-configured-mcp",
      }),
    ).toEqual({
      PATH: "D:\\portable-node",
      HTTPS_PROXY: "http://127.0.0.1:7890",
      no_proxy: "localhost,127.0.0.1",
      CUSTOM_MCP_TOKEN: "available-to-user-configured-mcp",
    });
  });

  it("treats a structured Pi model error as a failed run even when the CLI exits cleanly", () => {
    const output = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "fetch failed",
        },
      }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [],
            stopReason: "error",
            errorMessage: "fetch failed",
          },
        ],
      }),
    ].join("\n");

    expect(piOutputError(output)).toBe(
      "Pi Agent 无法连接模型服务（fetch failed）。请检查网络或代理设置后重试。",
    );
  });

  it("does not retain an earlier retry error after Pi returns final text", () => {
    const output = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "fetch failed",
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Pi 联调正常。" }],
          stopReason: "stop",
        },
      }),
    ].join("\n");

    expect(piOutputError(output)).toBeUndefined();
  });
});
