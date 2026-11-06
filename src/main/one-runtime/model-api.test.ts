import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { Type } from "typebox";
import { createOneSession } from "./session";
import { probeOneProvider } from "./probe";

let directory = "";
let server: Server | undefined;
let workerDirectory = "";
let workerPath = "";
beforeAll(async () => {
  workerDirectory = await mkdtemp(join(tmpdir(), "agents-one-api-worker-"));
  workerPath = join(workerDirectory, "worker.mjs");
  await build({
    entryPoints: [join(process.cwd(), "src/main/one-runtime/worker.ts")],
    outfile: workerPath,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    logLevel: "silent",
  });
}, 30000);
afterAll(async () => {
  if (workerDirectory)
    await rm(workerDirectory, { recursive: true, force: true });
});
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = "";
});

it("rejects an unrecognized protocol before contacting a provider", async () => {
  directory = await mkdtemp(join(tmpdir(), "agents-one-api-"));
  await expect(
    createOneSession({
      workspace: directory,
      stateDir: join(directory, "state"),
      baseUrl: "https://example.test",
      modelId: "model",
      apiKey: "test-key",
      apiType: "unknown-protocol" as never,
    }),
  ).rejects.toThrow("Invalid One model API type");
});

it("uses the selected Anthropic Messages protocol for a complete tool loop", async () => {
  directory = await mkdtemp(join(tmpdir(), "agents-one-api-"));
  const requests: Array<{
    path: string;
    key: string | undefined;
    body: {
      messages: Array<{ content: unknown }>;
      tools: Array<{ name: string }>;
    };
  }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw);
      requests.push({
        path: req.url || "",
        key: req.headers["x-api-key"] as string | undefined,
        body,
      });
      if (!req.url?.startsWith("/v1/messages")) {
        res.writeHead(404).end();
        return;
      }
      const hasResult = body.messages.some(
        (message: { content: unknown }) =>
          Array.isArray(message.content) &&
          message.content.some(
            (block: { type: string }) => block.type === "tool_result",
          ),
      );
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_test",
            type: "message",
            role: "assistant",
            content: [],
            model: "test-model",
            stop_reason: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        },
        {
          type: "content_block_start",
          index: 0,
          content_block: hasResult
            ? { type: "text", text: "" }
            : {
                type: "tool_use",
                id: "tool_1",
                name: body.tools[0].name,
                input: {},
              },
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: hasResult
            ? { type: "text_delta", text: "The answer is 42." }
            : { type: "input_json_delta", partial_json: "{}" },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: {
            stop_reason: hasResult ? "end_turn" : "tool_use",
            stop_sequence: null,
          },
          usage: { output_tokens: 5 },
        },
        { type: "message_stop" },
      ];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of events)
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  let calls = 0;
  const options = {
    workspace: directory,
    stateDir: join(directory, "state"),
    baseUrl: `http://127.0.0.1:${address.port}`,
    modelId: "test-model",
    apiKey: "test-key",
    apiType: "anthropic-messages" as const,
    tools: [
      {
        name: "lookup_answer",
        label: "Lookup",
        description: "Look up the answer",
        parameters: Type.Object({}),
        execute: async () => {
          calls++;
          return {
            content: [{ type: "text" as const, text: "42" }],
            details: {},
          };
        },
      },
    ],
  };
  const { session } = await createOneSession(options);
  try {
    await session.prompt("Find the answer");
    expect(calls).toBe(1);
    expect(session.getLastAssistantText()).toContain("42");
    expect(requests.map((request) => request.path)).toEqual([
      "/v1/messages?beta=true",
      "/v1/messages?beta=true",
    ]);
    expect(requests[0].key).toBe("test-key");
    expect(
      requests[1].body.messages.some(
        (message: { content: unknown }) =>
          Array.isArray(message.content) &&
          message.content.some(
            (block: { type: string }) => block.type === "tool_result",
          ),
      ),
    ).toBe(true);
  } finally {
    session.dispose();
  }
  await expect(
    probeOneProvider({
      workerPath,
      baseUrl: options.baseUrl,
      modelId: options.modelId,
      apiKey: options.apiKey,
      apiType: options.apiType,
    }),
  ).resolves.toBeUndefined();
  expect(requests).toHaveLength(4);
}, 30000);

it("uses OpenAI Responses for a complete tool loop", async () => {
  directory = await mkdtemp(join(tmpdir(), "agents-one-api-"));
  const requests: Array<{
    path: string;
    auth: string | undefined;
    hasResult: boolean;
  }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as {
        input: Array<{ type?: string }>;
        tools: Array<{ name: string }>;
      };
      const hasResult = body.input.some(
        (item) => item.type === "function_call_output",
      );
      requests.push({
        path: req.url || "",
        auth: req.headers.authorization,
        hasResult,
      });
      if (req.url !== "/v1/responses") return void res.writeHead(404).end();
      const item = hasResult
        ? {
            type: "message",
            id: "msg_1",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "The answer is 42.",
                annotations: [],
              },
            ],
          }
        : {
            type: "function_call",
            id: "fc_1",
            call_id: "call_1",
            name: body.tools[0].name,
            arguments: "{}",
            status: "completed",
          };
      const events = [
        { type: "response.created", response: { id: "resp_1" } },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: hasResult
            ? { ...item, content: [] }
            : { ...item, arguments: "" },
        },
        ...(hasResult
          ? [
              {
                type: "response.output_text.delta",
                output_index: 0,
                delta: "The answer is 42.",
              },
            ]
          : [
              {
                type: "response.function_call_arguments.delta",
                output_index: 0,
                delta: "{}",
              },
            ]),
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: "resp_1",
            status: "completed",
            output: [item],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              total_tokens: 15,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ];
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const event of events)
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  let calls = 0;
  const { session } = await createOneSession({
    workspace: directory,
    stateDir: join(directory, "state"),
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelId: "test-model",
    apiKey: "test-key",
    apiType: "openai-responses",
    tools: [
      {
        name: "lookup_answer",
        label: "Lookup",
        description: "Look up the answer",
        parameters: Type.Object({}),
        execute: async () => {
          calls++;
          return {
            content: [{ type: "text" as const, text: "42" }],
            details: {},
          };
        },
      },
    ],
  });
  try {
    await session.prompt("Find the answer");
    expect(calls).toBe(1);
    expect(session.getLastAssistantText()).toContain("42");
    expect(requests).toEqual([
      { path: "/v1/responses", auth: "Bearer test-key", hasResult: false },
      { path: "/v1/responses", auth: "Bearer test-key", hasResult: true },
    ]);
  } finally {
    session.dispose();
  }
  await expect(
    probeOneProvider({
      workerPath,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "test-key",
      apiType: "openai-responses",
    }),
  ).resolves.toBeUndefined();
  expect(requests).toHaveLength(4);
}, 30000);

it("uses Google Generative AI for a complete tool loop", async () => {
  directory = await mkdtemp(join(tmpdir(), "agents-one-api-"));
  const requests: Array<{
    path: string;
    key: string | undefined;
    hasResult: boolean;
  }> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const body = JSON.parse(raw) as {
        contents: Array<{ parts?: Array<{ functionResponse?: unknown }> }>;
        tools: Array<{ functionDeclarations: Array<{ name: string }> }>;
      };
      const hasResult = body.contents.some((message) =>
        message.parts?.some((part) => part.functionResponse),
      );
      requests.push({
        path: req.url || "",
        key: req.headers["x-goog-api-key"] as string | undefined,
        hasResult,
      });
      const part = hasResult
        ? { text: "The answer is 42." }
        : {
            functionCall: {
              name: body.tools[0].functionDeclarations[0].name,
              args: {},
            },
          };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } })}\n\n`,
      );
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  let calls = 0;
  const { session } = await createOneSession({
    workspace: directory,
    stateDir: join(directory, "state"),
    baseUrl: `http://127.0.0.1:${address.port}/v1beta`,
    modelId: "test-model",
    apiKey: "test-key",
    apiType: "google-generative-ai",
    tools: [
      {
        name: "lookup_answer",
        label: "Lookup",
        description: "Look up the answer",
        parameters: Type.Object({}),
        execute: async () => {
          calls++;
          return {
            content: [{ type: "text" as const, text: "42" }],
            details: {},
          };
        },
      },
    ],
  });
  try {
    await session.prompt("Find the answer");
    expect(calls).toBe(1);
    expect(session.getLastAssistantText()).toContain("42");
    expect(requests).toHaveLength(2);
    expect(
      requests.every((request) =>
        request.path.includes(
          "/v1beta/models/test-model:streamGenerateContent",
        ),
      ),
    ).toBe(true);
    expect(requests[0].key).toBe("test-key");
    expect(requests[1].hasResult).toBe(true);
  } finally {
    session.dispose();
  }
  await expect(
    probeOneProvider({
      workerPath,
      baseUrl: `http://127.0.0.1:${address.port}/v1beta`,
      modelId: "test-model",
      apiKey: "test-key",
      apiType: "google-generative-ai",
    }),
  ).resolves.toBeUndefined();
  expect(requests).toHaveLength(4);
}, 30000);
