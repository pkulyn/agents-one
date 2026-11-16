import { arch, platform } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { OneMcpServerConfig } from "../../shared/agent-runtimes";
import type { OneWorkerTool } from "./protocol";
import { agentsMdPath } from "./memory";
import type { OneMcpServerStatus } from "./mcp";

/** Explicit non-secret projection; never serialize runtime config or process.env. */
export function createOneRuntimeInfo(options: {
  runtimeId: string;
  runtimeName: string;
  workspace: string;
  mode: string;
  profileRoot: string;
  dataRoot: string;
  modelToolsEnabled: boolean;
  mcpServers: OneMcpServerConfig[];
  mcpStatus: OneMcpServerStatus[];
  availableTools: string[];
}): { tool: OneWorkerTool; execute: (signal: AbortSignal) => string } {
  const agentsMd = agentsMdPath(options.profileRoot, options.runtimeId);
  const snapshot = {
    identity: "Agents One built-in agent, local Pi SDK (not an external CLI)",
    name: options.runtimeName,
    runtimeId: options.runtimeId,
    platform: platform(),
    architecture: arch(),
    workspace: options.workspace,
    permission: options.mode,
    workspacePaths: "relative paths within the current workspace",
    modelToolsEnabled: options.modelToolsEnabled,
    hostShell: {
      available: options.availableTools.includes("host_shell"),
      reason: !options.modelToolsEnabled
        ? "model_tool_calls_disabled"
        : options.mode === "full_access"
          ? "full_access_confirmed"
          : "requires_confirmed_full_access",
      settings: "输入框下方权限 → 完全访问（用户确认）；不提供管理员权限",
    },
    personalization: {
      path: agentsMd,
      exists: existsSync(agentsMd),
      loadedInSystemPrompt: true,
      settings: "智能体 → 智能体配置 → One → 个性化",
    },
    configuration: {
      path: join(options.dataRoot, "desktop.json"),
      credentials:
        "Protected separately; enter secrets in settings, never in chat.",
      builtInSkill: "builtin:agents-one-configuration",
    },
    mcp: {
      settings: "智能体 → 智能体配置 → One → 插件与扩展 → MCP",
      refresh:
        "Saved changes apply to the next task, including the next message in the same conversation.",
      servers: options.mcpServers.map((s) => ({
        ...(options.mcpStatus.find((item) => item.id === s.id) || {
          status: !options.modelToolsEnabled
            ? "model_tool_calls_disabled"
            : "not_attempted",
        }),
        id: s.id,
        name: s.name,
        enabled: s.enabled,
        allowedToolCount: s.allowedTools.length,
      })),
      writeTools:
        "Only explicitly allowlisted tools marked read-only are available outside confirmed full access.",
    },
    availableTools: [...options.availableTools, "one_runtime_info"],
  };
  const result = JSON.stringify(snapshot);
  return {
    tool: {
      name: "one_runtime_info",
      label: "Inspect One environment",
      description:
        "Read actual workspace, permissions, One AGENTS.md path and non-secret MCP/tool status. Use for environment/configuration questions; read the built-in configuration skill for setup instructions. This tool does not grant access or edit settings.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    execute(signal) {
      signal.throwIfAborted();
      return result;
    },
  };
}
