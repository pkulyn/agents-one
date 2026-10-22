import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { startProjectInspectionMcp } from "../src/main/mobile-control/project-inspection-mcp";

const roots: string[] = [];
const servers: Awaited<ReturnType<typeof startProjectInspectionMcp>>[] = [];
interface RpcReply {
  result?: {
    protocolVersion?: string;
    tools?: { name: string }[];
    content?: { text: string }[];
    resources?: unknown[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}
async function fixture(
  authorize: () => void = () => undefined,
): Promise<Awaited<ReturnType<typeof startProjectInspectionMcp>>> {
  const root = mkdtempSync(join(tmpdir(), "agents-one-project-mcp-"));
  roots.push(root);
  writeFileSync(join(root, "readme.md"), "project fixture");
  const server = await startProjectInspectionMcp(root, authorize);
  servers.push(server);
  return server;
}
async function call(
  server: Awaited<ReturnType<typeof startProjectInspectionMcp>>,
  method: string,
  params: unknown = {},
): Promise<RpcReply> {
  const response = await fetch(server.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${server.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as RpcReply;
}
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const root of roots.splice(0))
    if (
      dirname(resolve(root)) === resolve(tmpdir()) &&
      basename(root).startsWith("agents-one-project-mcp-")
    )
      rmSync(root, { recursive: true, force: true });
});

describe("Main project inspection MCP", () => {
  // @lat: [[mobile-data#Mobile data#Project MCP token precedes project access]]
  it("binds only loopback and rejects missing token or browser origin before authorization", async () => {
    let checks = 0;
    const server = await fixture(() => {
      checks++;
    });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    for (const headers of [
      {},
      { Authorization: "Bearer wrong" },
      {
        Authorization: `Bearer ${server.token}`,
        Origin: "https://untrusted.example",
      },
    ]) {
      const response = await fetch(server.url, {
        method: "POST",
        headers,
        body: "{}",
      });
      expect(response.status).toBe(401);
    }
    expect(checks).toBe(0);
  });

  // @lat: [[mobile-data#Mobile data#Project MCP reads only explicit project tools]]
  it("negotiates stateless MCP and exposes only bounded read and directory tools", async () => {
    const server = await fixture();
    expect(
      (
        await call(server, "initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        })
      ).result?.protocolVersion,
    ).toBe("2025-06-18");
    expect(
      (await call(server, "tools/list")).result?.tools?.map((t) => t.name),
    ).toEqual(["read_project_text", "list_project_directory"]);
    const read = await call(server, "tools/call", {
      name: "read_project_text",
      arguments: { path: "readme.md" },
    });
    expect(JSON.parse(read.result?.content?.[0]?.text ?? "").text).toBe(
      "project fixture",
    );
    expect((await call(server, "resources/list")).result?.resources).toEqual(
      [],
    );
    expect(
      (
        await call(server, "tools/call", {
          name: "write_project_file",
          arguments: { path: "readme.md" },
        })
      ).error?.code,
    ).toBe(-32602);
    expect(
      (await call(server, "resources/read", { uri: "file:///private" })).error
        ?.code,
    ).toBe(-32601);
    await server.close();
    await server.close();
  });

  // @lat: [[mobile-data#Mobile data#Project MCP rejects stale and malformed requests]]
  it("rejects traversal, injected arguments, revoked authority and oversized requests", async () => {
    let revoked = false;
    const server = await fixture(() => {
      if (revoked) throw Error("private-root-must-not-leak");
    });
    const escaped = await call(server, "tools/call", {
      name: "read_project_text",
      arguments: { path: "../private" },
    });
    expect(escaped.result?.isError).toBe(true);
    expect(
      (
        await call(server, "tools/call", {
          name: "read_project_text",
          arguments: { path: "readme.md", root: "private" },
        })
      ).error?.code,
    ).toBe(-32602);
    revoked = true;
    const stale = await call(server, "tools/list");
    expect(stale.error?.message).toBe("Request unavailable");
    expect(JSON.stringify(stale)).not.toContain("private-root");
    const response = await fetch(server.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${server.token}` },
      body: "x".repeat(16385),
    });
    expect(response.status).toBe(413);
  });
});
