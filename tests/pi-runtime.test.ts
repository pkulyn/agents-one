import * as permissionFs from "node:fs";
import * as permissionPath from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getPiModelContextWindow,
  getPiConfiguredModels,
  piChildEnvironment,
  piExecArgs,
  piInvocation,
  piReadOnlyExtensionSource,
  piOutputError,
  piRpcArgs,
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

  it("lists locally configured models without launching Pi", () => {
    const configDir = mkdtempSync(join(tmpdir(), "agents-one-pi-catalog-"));
    writeFileSync(
      join(configDir, "models.json"),
      JSON.stringify({
        providers: {
          ark: {
            apiKey: "must-not-leak",
            models: [{ id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" }],
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      join(configDir, "models-store.json"),
      JSON.stringify({
        ark: {
          models: [
            { id: "deepseek-v4-flash", name: "Duplicate" },
            { id: "doubao-seed-2.1-turbo", name: "Doubao Seed" },
          ],
        },
      }),
      "utf-8",
    );

    expect(getPiConfiguredModels(configDir)).toEqual([
      {
        provider: "ark",
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
      },
      {
        provider: "ark",
        id: "doubao-seed-2.1-turbo",
        displayName: "Doubao Seed",
      },
    ]);
    expect(JSON.stringify(getPiConfiguredModels(configDir))).not.toContain(
      "must-not-leak",
    );
  });

  it("keeps unscoped read-only conversations able to read and query", () => {
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
      "--no-mcp",
      "--tools",
      "read,grep,find,ls",
      "--exclude-tools",
      "bash,powershell,tool_search,codemode,mcp__*",
      "inspect this",
    ]);
  });

  it("disables extension and MCP execution for automatic tasks", () => {
    const args = piExecArgs(
      "safe_write",
      "use llm-wiki",
      "pi-session-skills",
      "D:\\sessions",
    );
    expect(args).not.toContain("--no-skills");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("--no-mcp");
    expect(args).not.toContain("--no-context-files");
    expect(args).toContain("--tools");
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

  it("keeps only native file readers and editors in safe-write mode", () => {
    const args = piExecArgs(
      "safe_write",
      "update this safely",
      "pi-session-safe",
      "D:\\sessions",
    );
    expect(args).toContain("--tools");
    expect(args).toContain("read,grep,find,ls,write,edit");
    expect(args).toContain("--exclude-tools");
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

  it("uses Pi RPC mode with an explicit session only for stateful controls", () => {
    expect(piRpcArgs("D:\\sessions", "pi-session-5")).toEqual([
      "--mode",
      "rpc",
      "--session-dir",
      "D:\\sessions",
      "--session-id",
      "pi-session-5",
    ]);
    expect(piRpcArgs("D:\\sessions")).toEqual([
      "--mode",
      "rpc",
      "--session-dir",
      "D:\\sessions",
      "--no-session",
    ]);
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

  it("recognizes Pi print-mode message frames with a final text reply", () => {
    expect(
      piOutputError(
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Inspect the image." },
              { type: "text", text: "图片识别完成。" },
            ],
            stopReason: "stop",
          },
        }),
      ),
    ).toBeUndefined();
  });

  it("treats a terminal Pi turn without final text as incomplete", () => {
    expect(
      piOutputError(
        JSON.stringify({
          type: "agent_end",
          messages: [
            {
              role: "assistant",
              content: [{ type: "thinking", thinking: "Inspect the image." }],
              stopReason: "stop",
            },
          ],
        }),
      ),
    ).toBe("Pi Agent 本轮在工具或思考阶段结束，未返回最终答复。");
  });
});

describe("Pi read-only native permission hook", () => {
  // @lat: [[runtime-chat#Pi read-only tool boundary]]
  it("allows native readers but blocks declared custom queries and mutations", () => {
    let handler: (event: {
      toolName: string;
      parentToolCallId?: string;
    }) => { block: boolean; reason: string } | undefined;
    const install = new Function(
      "fs",
      "path",
      piReadOnlyExtensionSource()
        .replace(/^import .*;\r?$/gm, "")
        .replace(
          "export default function agentsOneReadOnly",
          "return function agentsOneReadOnly",
        ),
    )(permissionFs, permissionPath);
    install({
      on: (_event: string, callback: typeof handler) => {
        handler = callback;
      },
      getAllTools: () => [
        { name: "mcp__search", annotations: { readOnlyHint: true } },
        {
          name: "mcp__delete",
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        { name: "unknown_extension" },
      ],
    });
    for (const toolName of ["read", "grep", "find", "ls"]) {
      expect(handler!({ toolName })).toBeUndefined();
    }
    for (const toolName of [
      "write",
      "edit",
      "bash",
      "powershell",
      "mcp__delete",
      "unknown_extension",
      "tool_search",
      "codemode",
      "mcp__search",
    ]) {
      const denied = handler!({
        toolName,
        parentToolCallId: "codemode/nested",
      });
      expect(denied).toMatchObject({ block: true });
      expect(denied?.reason).toContain(toolName);
      expect(denied?.reason).toContain("只读");
      expect(denied?.reason).toContain("移动或删除需切换为完全访问");
    }
  });
  it("blocks automatic deletion and movement before execution while keeping reads and edits enabled", () => {
    const writableRoot = mkdtempSync(join(tmpdir(), "pi-auto-root-"));
    let handler!: (
      event: {
        toolName: string;
        input: Record<string, unknown>;
      },
      ctx?: { cwd: string },
    ) => { block: boolean; reason: string } | undefined;
    const install = new Function(
      "fs",
      "path",
      piReadOnlyExtensionSource("safe_write", writableRoot)
        .replace(/^import .*;\r?$/gm, "")
        .replace(
          "export default function agentsOneReadOnly",
          "return function agentsOneReadOnly",
        ),
    )(permissionFs, permissionPath);
    install({
      on: (_event: string, callback: typeof handler) => {
        handler = callback;
      },
    });
    for (const toolName of ["read", "write", "edit"])
      expect(
        handler(
          { toolName, input: { path: "file.txt" } },
          { cwd: writableRoot },
        ),
      ).toBeUndefined();
    expect(
      handler({ toolName: "bash", input: { command: "git status" } }),
    ).toMatchObject({ block: true });
    for (const event of [
      { toolName: "bash", input: { command: "rm original.txt" } },
      {
        toolName: "powershell",
        input: { command: "Remove-Item -LiteralPath original.txt" },
      },
      { toolName: "mcp__delete_file", input: { path: "original.txt" } },
      { toolName: "mcp__file_operation", input: { operation: "move" } },
    ]) {
      expect(handler(event)).toMatchObject({
        block: true,
        reason: expect.stringContaining("完全访问"),
      });
    }
  });
});
