import { expect, it } from "vitest";
import type { OneMcpServerConfig } from "../../shared/agent-runtimes";
import { connectOneMcpTools, inspectOneMcpServer } from "./mcp";

function stdioServer(): OneMcpServerConfig {
  const code = [
    'import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";',
    'import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";',
    'import { z } from "zod";',
    'const server = new McpServer({ name: "one-test", version: "1.0.0" });',
    'server.registerTool("read_data", { description: "Read test data", inputSchema: { value: z.string() }, annotations: { readOnlyHint: true } }, async ({ value }) => ({ content: [{ type: "text", text: `read-result:${value}` }] }));',
    'server.registerTool("write_data", { description: "Write test data", inputSchema: { value: z.string() }, annotations: { readOnlyHint: false } }, async ({ value }) => ({ content: [{ type: "text", text: `write-result:${value}` }] }));',
    "await server.connect(new StdioServerTransport());",
  ].join("\n");
  return {
    id: "test-mcp",
    name: "Test MCP",
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    args: ["-e", code],
    envNames: [],
    allowedTools: ["read_data", "write_data"],
  };
}

// @lat: [[main-process#Main Process#One session resume reconciliation#One MCP tool connection and consent#Restricts runtime tools to enabled and explicitly authorized server tools]]
it("connects to a real local MCP server and limits read tasks to declared read-only tools", async () => {
  const errors: string[] = [];
  const bridge = await connectOneMcpTools(
    "one-agent",
    [stdioServer()],
    "read",
    (_name, error) => errors.push(String(error)),
  );
  try {
    expect(errors).toEqual([]);
    expect(bridge.tools.map((tool) => tool.label)).toEqual([
      "Test MCP: read_data",
    ]);
    await expect(
      bridge.executeTool(
        bridge.tools[0].name,
        {},
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await expect(
      bridge.executeTool(
        bridge.tools[0].name,
        { value: "ok" },
        new AbortController().signal,
      ),
    ).resolves.toBe("read-result:ok");
  } finally {
    await bridge.close();
  }
});

it("does not expose a remotely listed tool until the user allowlists it", async () => {
  const server = stdioServer();
  server.allowedTools = ["read_data"];
  const errors: string[] = [];
  const bridge = await connectOneMcpTools(
    "one-agent",
    [server],
    "write",
    (_name, error) => errors.push(String(error)),
  );
  try {
    expect(errors).toEqual([]);
    expect(bridge.tools).toHaveLength(1);
    expect(bridge.tools[0].label).toBe("Test MCP: read_data");
  } finally {
    await bridge.close();
  }
});

function pagedServer(repeatCursor = false): OneMcpServerConfig {
  const code = [
    'import {Server} from "@modelcontextprotocol/sdk/server/index.js";',
    'import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";',
    'import {ListToolsRequestSchema,CallToolRequestSchema} from "@modelcontextprotocol/sdk/types.js";',
    'const s=new Server({name:"review",version:"1"},{capabilities:{tools:{}}});let cancelled=false;',
    'const plain=name=>({name,inputSchema:{type:"object"},annotations:{readOnlyHint:true}});',
    's.setRequestHandler(ListToolsRequestSchema,async req=>req.params?.cursor?({tools:[plain("slow"),plain("status")],' +
      (repeatCursor ? 'nextCursor:"page2"' : "") +
      '}):({tools:[{...plain("localref"),inputSchema:{type:"object",properties:{value:{$ref:"#/$defs/value"}},$defs:{value:{type:"string"}},required:["value"]}}, {...plain("remote"),inputSchema:{type:"object",properties:{value:{$ref:"https://example.invalid/schema"}}}}],nextCursor:"page2"}));',
    's.setRequestHandler(CallToolRequestSchema,async(req,extra)=>{if(req.params.name==="slow"){await new Promise(resolve=>{if(extra.signal.aborted){cancelled=true;resolve();}else extra.signal.addEventListener("abort",()=>{cancelled=true;resolve();},{once:true});});}return {content:[{type:"text",text:req.params.name==="status"?String(cancelled):"ok"}]}});',
    "await s.connect(new StdioServerTransport());",
  ].join("\n");
  return {
    id: "paged",
    name: "Paged",
    transport: "stdio",
    enabled: true,
    command: process.execPath,
    args: ["-e", code],
    envNames: [],
    allowedTools: ["localref", "remote", "slow", "status"],
  };
}

it("discovers every page and expands local refs while reporting unsupported remote refs", async () => {
  const server = pagedServer();
  expect((await inspectOneMcpServer(server, {})).map((x) => x.name)).toEqual([
    "localref",
    "remote",
    "slow",
    "status",
  ]);
  const warnings: string[] = [];
  const bridge = await connectOneMcpTools(
    "one-agent",
    [server],
    "read",
    (name) => warnings.push(name),
  );
  try {
    expect(bridge.tools.map((x) => x.name)).toEqual([
      "mcp_paged_localref",
      "mcp_paged_slow",
      "mcp_paged_status",
    ]);
    expect(warnings).toEqual(["Paged / remote"]);
    expect(bridge.tools[0].parameters.properties).toMatchObject({
      value: { type: "string" },
    });
    await expect(
      bridge.executeTool(
        bridge.tools[0].name,
        { value: "ok" },
        new AbortController().signal,
      ),
    ).resolves.toBe("ok");
  } finally {
    await bridge.close();
  }
});

it("forwards cancellation to the server request instead of merely racing locally", async () => {
  const bridge = await connectOneMcpTools("one-agent", [pagedServer()], "read");
  try {
    const controller = new AbortController();
    const call = bridge.executeTool("mcp_paged_slow", {}, controller.signal);
    const rejected = expect(call).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 100));
    controller.abort();
    await rejected;
    await expect
      .poll(() =>
        bridge.executeTool(
          "mcp_paged_status",
          {},
          new AbortController().signal,
        ),
      )
      .toBe("true");
  } finally {
    await bridge.close();
  }
});

it("bounds repeated discovery cursors and skips cancelled preparation", async () => {
  await expect(inspectOneMcpServer(pagedServer(true), {})).rejects.toThrow(
    "repeated cursor",
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    connectOneMcpTools(
      "one-agent",
      [pagedServer()],
      "read",
      undefined,
      controller.signal,
    ),
  ).rejects.toThrow("cancelled");
});

it("cancels an in-flight initialization before starting any model work", async () => {
  const server = pagedServer();
  server.args = [
    "-e",
    "process.stdin.resume();process.stdin.on('data',()=>{});",
  ];
  const controller = new AbortController();
  const pending = connectOneMcpTools(
    "one-agent",
    [server],
    "read",
    undefined,
    controller.signal,
  );
  const rejected = expect(pending).rejects.toThrow("cancelled");
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await rejected;
  } finally {
    clearTimeout(timer);
  }
});
