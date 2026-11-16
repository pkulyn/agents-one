import { expect, it } from "vitest";
import { createOneRuntimeInfo } from "./runtime-info";

it("reports effective permissions and MCP state without exposing endpoint/command/env/credential fields", () => {
  const info = createOneRuntimeInfo({
    runtimeId: "one",
    runtimeName: "Research",
    workspace: "/project",
    profileRoot: "/profile",
    dataRoot: "/data",
    mode: "safe_write",
    modelToolsEnabled: true,
    availableTools: ["workspace_read"],
    mcpServers: [
      {
        id: "memory",
        name: "Memory",
        enabled: true,
        transport: "http",
        url: "https://example.test/private-secret",
        command: "private-command",
        envNames: ["PRIVATE_ENV"],
        allowedTools: ["read", "write"],
      },
    ],
    mcpStatus: [
      {
        id: "memory",
        status: "connected",
        availableToolCount: 1,
        filteredToolCount: 1,
        unsupportedToolCount: 0,
      },
    ],
  });
  const result = info.execute(new AbortController().signal);
  expect(result).not.toMatch(/private-secret|private-command|PRIVATE_ENV/);
  const value = JSON.parse(result);
  expect(value.workspace).toBe("/project");
  expect(value.name).toBe("Research");
  expect(value.hostShell).toMatchObject({
    available: false,
    reason: "requires_confirmed_full_access",
  });
  expect(value.mcp.servers[0]).toMatchObject({
    status: "connected",
    allowedToolCount: 2,
    filteredToolCount: 1,
  });
  expect(value.personalization.path.replace(/\\/g, "/")).toBe(
    "/profile/desktop/one/one/AGENTS.md",
  );
  const abort = new AbortController();
  abort.abort();
  expect(() => info.execute(abort.signal)).toThrow();
});

it("separates model-disabled tools from unavailable shell permission", () => {
  const value = JSON.parse(
    createOneRuntimeInfo({
      runtimeId: "one",
      runtimeName: "Research",
      workspace: "/project",
      profileRoot: "/profile",
      dataRoot: "/data",
      mode: "full_access",
      modelToolsEnabled: false,
      availableTools: [],
      mcpServers: [],
      mcpStatus: [],
    }).execute(new AbortController().signal),
  );
  expect(value.hostShell).toMatchObject({
    available: false,
    reason: "model_tool_calls_disabled",
  });
});
