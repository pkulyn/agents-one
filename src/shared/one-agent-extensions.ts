import type { OneMcpServerConfig, OnePluginConfig } from "./agent-runtimes";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MCP_TOOL = /^[^\0\r\n]{1,128}$/;

export function normalizeOnePlugins(
  value: unknown,
): OnePluginConfig[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 64)
    throw new Error("One plugin configuration is invalid.");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("One plugin configuration is invalid.");
    const item = raw as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !ID.test(item.id) ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 128 ||
      typeof item.directory !== "string" ||
      !item.directory.trim() ||
      item.directory.length > 4096 ||
      typeof item.enabled !== "boolean" ||
      (item.version !== undefined &&
        (typeof item.version !== "string" || item.version.length > 64))
    )
      throw new Error("One plugin configuration is invalid.");
    seen.add(item.id);
    return {
      id: item.id,
      name: item.name.trim(),
      ...(typeof item.version === "string" ? { version: item.version } : {}),
      directory: item.directory,
      enabled: item.enabled,
    };
  });
}

export function normalizeOneMcpServers(
  value: unknown,
): OneMcpServerConfig[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 32)
    throw new Error("One MCP server configuration is invalid.");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("One MCP server configuration is invalid.");
    const item = raw as Record<string, unknown>;
    const transport = item.transport;
    if (
      typeof item.id !== "string" ||
      !ID.test(item.id) ||
      seen.has(item.id) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 128 ||
      (transport !== "stdio" && transport !== "http") ||
      typeof item.enabled !== "boolean" ||
      !Array.isArray(item.allowedTools) ||
      item.allowedTools.length > 128 ||
      item.allowedTools.some(
        (name) => typeof name !== "string" || !MCP_TOOL.test(name),
      )
    )
      throw new Error("One MCP server configuration is invalid.");
    const allowedTools = Array.from(new Set(item.allowedTools as string[]));
    seen.add(item.id);
    if (transport === "stdio") {
      if (
        typeof item.command !== "string" ||
        !item.command.trim() ||
        item.command.length > 2048 ||
        /[\0\r\n]/.test(item.command) ||
        (item.args !== undefined &&
          (!Array.isArray(item.args) ||
            item.args.length > 64 ||
            item.args.some(
              (arg) =>
                typeof arg !== "string" ||
                arg.length > 2048 ||
                /[\0\r\n]/.test(arg),
            )))
      )
        throw new Error("One MCP stdio server is invalid.");
      const envNames = item.envNames ?? [];
      if (
        !Array.isArray(envNames) ||
        envNames.length > 32 ||
        envNames.some(
          (name) => typeof name !== "string" || !ENV_NAME.test(name),
        )
      )
        throw new Error("One MCP server environment names are invalid.");
      return {
        id: item.id,
        name: item.name.trim(),
        transport,
        enabled: item.enabled,
        command: item.command,
        args: (item.args as string[] | undefined) || [],
        envNames: Array.from(new Set(envNames as string[])),
        allowedTools,
      };
    }
    if (
      typeof item.url !== "string" ||
      item.url.length > 4096 ||
      item.envNames !== undefined
    )
      throw new Error("One MCP HTTP server is invalid.");
    let url: URL;
    try {
      url = new URL(item.url);
    } catch {
      throw new Error("One MCP HTTP server URL is invalid.");
    }
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error("One MCP HTTP server URL is invalid.");
    return {
      id: item.id,
      name: item.name.trim(),
      transport,
      enabled: item.enabled,
      url: url.toString(),
      allowedTools,
    };
  });
}
