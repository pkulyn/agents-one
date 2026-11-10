import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OneMcpServerConfig } from "../../shared/agent-runtimes";
import type { OneWorkerTool } from "./protocol";
import { getOneMcpSecrets } from "./credentials";

export interface OneMcpToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
}

type McpTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
};

type ClientConnection = {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
};

function jsonSchema(value: unknown): Record<string, unknown> {
  let count = 0;
  function visit(item: unknown, depth: number): unknown {
    count++;
    if (count > 2048 || depth > 16)
      throw new Error("MCP tool schema exceeds the supported limit.");
    if (
      item === null ||
      typeof item === "string" ||
      typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item))
    )
      return item;
    if (Array.isArray(item)) {
      if (item.length > 512) throw new Error("MCP tool schema is too large.");
      return item.map((child) => visit(child, depth + 1));
    }
    if (!item || typeof item !== "object")
      throw new Error("MCP tool schema contains an unsupported value.");
    const record = item as Record<string, unknown>;
    const entries = Object.entries(record);
    if (entries.length > 512) throw new Error("MCP tool schema is too large.");
    if (Object.hasOwn(record, "$ref")) {
      const ref = record.$ref;
      if (typeof ref !== "string" || !ref.startsWith("#/") || ref.length > 1024)
        throw new Error("Only local JSON schema references are supported.");
      let target: unknown = value;
      for (const part of decodeURIComponent(ref.slice(2)).split("/")) {
        const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
        if (
          !target ||
          typeof target !== "object" ||
          !Object.hasOwn(target, key)
        )
          throw new Error("MCP tool schema reference was not found.");
        target = (target as Record<string, unknown>)[key];
      }
      const expanded = visit(target, depth + 1);
      if (!expanded || typeof expanded !== "object" || Array.isArray(expanded))
        throw new Error("MCP tool schema reference is invalid.");
      return {
        ...expanded,
        ...Object.fromEntries(
          entries
            .filter(([key]) => key !== "$ref")
            .map(([key, child]) => [key, visit(child, depth + 1)]),
        ),
      };
    }
    return Object.fromEntries(
      entries.map(([key, child]) => [key, visit(child, depth + 1)]),
    );
  }
  const result = visit(value, 0);
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result as Record<string, unknown>).type !== "object"
  )
    throw new Error("MCP tool input schema must be a JSON object schema.");
  return result as Record<string, unknown>;
}

function createConnection(
  server: OneMcpServerConfig,
  secrets: Record<string, string>,
): ClientConnection {
  const client = new Client(
    { name: "agents-one-one", version: "0.1.0" },
    { capabilities: {} },
  );
  if (server.transport === "stdio") {
    const env = Object.fromEntries(
      (server.envNames || [])
        .filter((name) => secrets[name] !== undefined)
        .map((name) => [name, secrets[name]]),
    );
    const transport = new StdioClientTransport({
      command: server.command!,
      args: server.args || [],
      env,
      stderr: "pipe",
    });
    return { client, transport };
  }
  const headers: Record<string, string> = {};
  if (secrets.authorization)
    headers.Authorization = `Bearer ${secrets.authorization}`;
  const transport = new StreamableHTTPClientTransport(new URL(server.url!), {
    requestInit: { headers, redirect: "error" },
    reconnectionOptions: {
      maxReconnectionDelay: 1000,
      initialReconnectionDelay: 100,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 0,
    },
  });
  return { client, transport };
}

async function connect(
  server: OneMcpServerConfig,
  secrets: Record<string, string>,
  signal?: AbortSignal,
): Promise<ClientConnection> {
  const connection = createConnection(server, secrets);
  try {
    signal?.throwIfAborted();
    await connection.client.connect(connection.transport, {
      signal,
      timeout: 10_000,
    });
    return connection;
  } catch (error) {
    await connection.transport.close().catch(() => undefined);
    throw error;
  }
}

/** Bound pagination, including cyclic cursors, rather than silently omitting tools. */
async function listAllTools(
  client: Client,
  signal?: AbortSignal,
): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    signal?.throwIfAborted();
    const page = await client.listTools(cursor ? { cursor } : undefined, {
      signal,
      timeout: 10_000,
    });
    tools.push(...(page.tools as McpTool[]));
    if (tools.length > 256 || cursors.size >= 32)
      throw new Error("MCP tool discovery exceeds the supported limit.");
    cursor = page.nextCursor;
    if (cursor) {
      if (cursors.has(cursor))
        throw new Error("MCP tool discovery returned a repeated cursor.");
      cursors.add(cursor);
    }
  } while (cursor);
  return tools;
}

function normalizeToolInfo(tools: McpTool[]): OneMcpToolInfo[] {
  return tools.slice(0, 256).map((tool) => ({
    name: String(tool.name).slice(0, 128),
    description: String(tool.description || "").slice(0, 4000),
    readOnly: tool.annotations?.readOnlyHint === true,
  }));
}

export async function inspectOneMcpServer(
  server: OneMcpServerConfig,
  secrets: Record<string, string>,
): Promise<OneMcpToolInfo[]> {
  const connection = await connect(server, secrets);
  try {
    return normalizeToolInfo(await listAllTools(connection.client));
  } finally {
    await connection.transport.close().catch(() => undefined);
  }
}

function safeToolName(serverId: string, toolName: string): string {
  const cleaned = `mcp_${serverId}_${toolName}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (cleaned.length <= 64) return cleaned;
  const digest = createHash("sha256")
    .update(cleaned)
    .digest("hex")
    .slice(0, 10);
  return `${cleaned.slice(0, 53)}_${digest}`;
}

function toolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  const response = result as Record<string, unknown>;
  const pieces: string[] = [];
  if (Array.isArray(response.content)) {
    for (const item of response.content) {
      if (!item || typeof item !== "object") continue;
      const content = item as Record<string, unknown>;
      if (content.type === "text" && typeof content.text === "string")
        pieces.push(content.text);
      else if (content.type === "resource" && content.resource)
        pieces.push(JSON.stringify(content.resource));
    }
  }
  if (response.structuredContent)
    pieces.push(JSON.stringify(response.structuredContent));
  const output = pieces.join("\n").slice(0, 64 * 1024);
  if (response.isError === true) throw new Error(output || "MCP tool failed.");
  return output || JSON.stringify(response).slice(0, 64 * 1024);
}

export async function connectOneMcpTools(
  runtimeId: string,
  servers: OneMcpServerConfig[],
  permission: "read" | "write",
  onServerError?: (serverName: string, error: unknown) => void,
  signal?: AbortSignal,
): Promise<{
  tools: OneWorkerTool[];
  executeTool: (
    name: string,
    parameters: unknown,
    signal: AbortSignal,
  ) => Promise<string>;
  close: () => Promise<void>;
}> {
  const tools: OneWorkerTool[] = [];
  const handlers = new Map<
    string,
    { connection: ClientConnection; remoteName: string }
  >();
  const connections: ClientConnection[] = [];
  for (const server of servers) {
    if (signal?.aborted) {
      await Promise.all(
        connections.map((connection) =>
          connection.transport.close().catch(() => undefined),
        ),
      );
      throw new Error("One task cancelled");
    }
    if (!server.enabled || !server.allowedTools.length) continue;
    try {
      const connection = await connect(
        server,
        getOneMcpSecrets(runtimeId, server.id),
        signal,
      );
      connections.push(connection);
      const listed = await listAllTools(connection.client, signal);
      for (const tool of listed) {
        if (
          !server.allowedTools.includes(tool.name) ||
          (permission === "read" && tool.annotations?.readOnlyHint !== true)
        )
          continue;
        let parameters: Record<string, unknown>;
        try {
          parameters = jsonSchema(tool.inputSchema);
        } catch (error) {
          onServerError?.(`${server.name} / ${tool.name}`, error);
          continue;
        }
        const name = safeToolName(server.id, tool.name);
        if (handlers.has(name) || tools.length >= 96) continue;
        handlers.set(name, { connection, remoteName: tool.name });
        tools.push({
          name,
          label: `${server.name}: ${tool.name}`.slice(0, 128),
          description:
            `${server.name} MCP: ${tool.description || tool.name}`.slice(
              0,
              4000,
            ),
          parameters,
        });
      }
    } catch (error) {
      if (signal?.aborted) {
        await Promise.all(
          connections.map((connection) =>
            connection.transport.close().catch(() => undefined),
          ),
        );
        throw new Error("One task cancelled");
      }
      onServerError?.(server.name, error);
    }
  }
  return {
    tools,
    async executeTool(name, parameters, signal): Promise<string> {
      if (signal.aborted) throw new Error("One task cancelled");
      const handler = handlers.get(name);
      if (!handler) throw new Error("MCP tool is not authorized for One.");
      if (
        !parameters ||
        typeof parameters !== "object" ||
        Array.isArray(parameters)
      )
        throw new Error("MCP tool arguments must be an object.");
      let removeAbortListener: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = (): void => {
          reject(new Error("One task cancelled"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      });
      let result: unknown;
      try {
        result = await Promise.race([
          handler.connection.client.callTool(
            {
              name: handler.remoteName,
              arguments: parameters as Record<string, unknown>,
            },
            undefined,
            { signal },
          ),
          aborted,
        ]);
      } finally {
        removeAbortListener?.();
      }
      if (signal.aborted) throw new Error("One task cancelled");
      return toolResultText(result);
    },
    async close(): Promise<void> {
      await Promise.all(
        connections.map((connection) =>
          connection.transport.close().catch(() => undefined),
        ),
      );
      handlers.clear();
    },
  };
}
