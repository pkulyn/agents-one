import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createProjectInspection } from "./project-inspection";
import { realpathSync } from "node:fs";
import type { ProjectWriteRunner } from "./project-write-runner";

type Json = Record<string, unknown>;
const PROTOCOLS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const TOOLS = [
  {
    name: "read_project_text",
    description:
      "Read bounded UTF-8 text from the authorized project using a relative path.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "list_project_directory",
    description:
      "List a bounded authorized project directory. An empty path selects its root.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
];
const WRITE_TOOL = {
  name: "write_project_text",
  description:
    "Create or replace bounded UTF-8 project text. Read the existing SHA256 first; use null only for a missing file. Supply a unique writeId per intended change; replay the same writeId and identical arguments after an uncertain response.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      text: { type: "string" },
      expectedSha256: {
        anyOf: [
          { type: "string", pattern: "^[a-f0-9]{64}$" },
          { type: "null" },
        ],
      },
      writeId: {
        type: "string",
        minLength: 1,
        maxLength: 160,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$",
      },
    },
    required: ["path", "text", "expectedSha256", "writeId"],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
};
function object(value: unknown): value is Json {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function only(value: Json, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/** Main-owned local transport. Its secret and absolute root must never enter mobile payloads. */
export async function startProjectInspectionMcp(
  root: string,
  authorize: () => void,
  writer?: ProjectWriteRunner,
): Promise<{ url: string; token: string; close: () => Promise<void> }> {
  if (writer && writer.projectRoot() !== realpathSync(root))
    throw Error("Project writer binding unavailable.");
  const lifetime = new AbortController();
  const pending = new Set<Promise<unknown>>();
  const current = (): void => {
    if (lifetime.signal.aborted) throw Error();
    const result: unknown = authorize();
    if (result instanceof Promise) void result.catch(() => undefined);
    if (result !== undefined || lifetime.signal.aborted) throw Error();
  };
  const project = createProjectInspection(root, current);
  const token = randomBytes(32).toString("base64url");
  const expected = Buffer.from(`Bearer ${token}`);
  let closed = false;
  let closing: Promise<void> | undefined;
  const server = createServer(async (request, response) => {
    const supplied = Buffer.from(request.headers.authorization ?? "");
    if (
      closed ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected) ||
      request.headers.origin
    ) {
      response.writeHead(401).end();
      return;
    }
    if (request.url !== "/mcp" || request.method !== "POST") {
      response.writeHead(404).end();
      return;
    }
    let id: string | number | null = null;
    function reply(
      result: unknown,
      error?: { code: number; message: string },
    ): void {
      if (response.headersSent || response.writableEnded || response.destroyed)
        return;
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          ...(error ? { error } : { result }),
        }),
      );
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > (writer ? 2 * 1024 * 1024 : 16384)) {
          response.writeHead(413).end();
          return;
        }
        chunks.push(bytes);
      }
      const frame: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
      if (
        !object(frame) ||
        frame.jsonrpc !== "2.0" ||
        typeof frame.method !== "string" ||
        !only(frame, ["jsonrpc", "method", "id", "params"]) ||
        (frame.params !== undefined && !object(frame.params)) ||
        (frame.id !== undefined &&
          typeof frame.id !== "string" &&
          !(typeof frame.id === "number" && Number.isSafeInteger(frame.id)))
      ) {
        reply(undefined, { code: -32600, message: "Invalid request" });
        return;
      }
      id = frame.id === undefined ? null : (frame.id as string | number);
      if (frame.id === undefined) {
        if (frame.method === "notifications/initialized")
          response.writeHead(204).end();
        else response.writeHead(400).end();
        return;
      }
      // Revocation is checked for catalogs and initialization as well as actual reads.
      current();
      const params = frame.params ?? {};
      switch (frame.method) {
        case "initialize": {
          if (typeof params.protocolVersion !== "string") {
            reply(undefined, { code: -32602, message: "Unsupported protocol" });
            return;
          }
          reply({
            protocolVersion: PROTOCOLS.includes(params.protocolVersion)
              ? params.protocolVersion
              : "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "agents-one-project-inspection", version: "1" },
          });
          return;
        }
        case "ping":
          reply({});
          return;
        case "tools/list":
          reply({ tools: writer ? [...TOOLS, WRITE_TOOL] : TOOLS });
          return;
        case "resources/list":
          reply({ resources: [] });
          return;
        case "resources/templates/list":
          reply({ resourceTemplates: [] });
          return;
        case "tools/call": {
          if (
            !only(params, ["name", "arguments", "_meta"]) ||
            !object(params.arguments)
          ) {
            reply(undefined, {
              code: -32602,
              message: "Invalid tool arguments",
            });
            return;
          }
          if (params.name === "write_project_text" && writer) {
            const input = params.arguments;
            if (
              Object.keys(input).sort().join(",") !==
                "expectedSha256,path,text,writeId" ||
              typeof input.path !== "string" ||
              typeof input.text !== "string" ||
              typeof input.writeId !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.writeId) ||
              (input.expectedSha256 !== null &&
                (typeof input.expectedSha256 !== "string" ||
                  !/^[a-f0-9]{64}$/.test(input.expectedSha256)))
            ) {
              reply(undefined, {
                code: -32602,
                message: "Invalid tool arguments",
              });
              return;
            }
            try {
              current();
              const operation = writer.write({
                key: input.writeId,
                path: input.path,
                text: input.text,
                expectedSha256: input.expectedSha256 as string | null,
                signal: lifetime.signal,
              });
              pending.add(operation);
              let value: Awaited<typeof operation>;
              try {
                value = await operation;
              } finally {
                pending.delete(operation);
              }
              current();
              reply({
                content: [
                  {
                    type: "text",
                    text: JSON.stringify({
                      path: value.path,
                      previousSha256: value.previousSha256,
                      sha256: value.sha256,
                      bytes: value.bytes,
                    }),
                  },
                ],
              });
            } catch {
              reply({
                isError: true,
                content: [
                  {
                    type: "text",
                    text: "Project write is unavailable or requires reconciliation.",
                  },
                ],
              });
            }
            return;
          }
          if (!only(params.arguments, ["path"])) {
            reply(undefined, {
              code: -32602,
              message: "Invalid tool arguments",
            });
            return;
          }
          try {
            const value =
              params.name === "read_project_text"
                ? project.readText(params.arguments.path)
                : params.name === "list_project_directory"
                  ? project.list(params.arguments.path)
                  : undefined;
            if (value === undefined) {
              reply(undefined, { code: -32602, message: "Unknown tool" });
              return;
            }
            current();
            reply({ content: [{ type: "text", text: JSON.stringify(value) }] });
          } catch {
            reply({
              isError: true,
              content: [
                { type: "text", text: "Project inspection is unavailable." },
              ],
            });
          }
          return;
        }
        default:
          reply(undefined, { code: -32601, message: "Method not found" });
      }
    } catch {
      // No exception or OS diagnostic may disclose local paths/credentials.
      reply(undefined, { code: -32600, message: "Request unavailable" });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Project inspection transport unavailable.");
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    close: () => {
      if (closing) return closing;
      closed = true;
      lifetime.abort();
      closing = (async () => {
        await Promise.allSettled([...pending]);
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        });
      })();
      return closing;
    },
  };
}
