import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Type } from "typebox";
import { createOneSession } from "./session";
import { startOneWorker } from "./controller";
import { probeOneProvider } from "./probe";
import { reconcileOneSessionBinding } from "./revision";
import { OneToolCleanupError } from "./cleanup-error";

let dir = "";
let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve())),
    );
  server = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = "";
});

describe("One SDK session isolation", () => {
  it("retries a transient provider failure and counts every actual model request", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-retry-"));
    let requests = 0;
    server = createServer((_req, res) => {
      requests += 1;
      if (requests === 1) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "temporarily unavailable" } }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({
          id: "retry-success",
          object: "chat.completion.chunk",
          created: 0,
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: { content: "Recovered response" },
              finish_reason: "stop",
            },
          ],
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    const modelCalls: number[] = [];
    const { session } = await createOneSession({
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "retry-test-key",
      onModelCall: (count) => modelCalls.push(count),
    });
    const events: Array<Record<string, unknown>> = [];
    session.subscribe((event) =>
      events.push(event as unknown as Record<string, unknown>),
    );
    try {
      await session.prompt("retry the transient request");
      expect(requests).toBe(2);
      expect(modelCalls).toEqual([1, 2]);
      expect(session.getLastAssistantText()).toContain("Recovered response");
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 2,
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({ type: "auto_retry_end", success: true }),
      );
      expect(JSON.stringify(events)).not.toContain("retry-test-key");
    } finally {
      session.dispose();
    }
  }, 30000);

  it("stops retrying at the configured attempt bound and retains the final provider error", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-retry-limit-"));
    let requests = 0;
    server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: { message: "service temporarily unavailable" },
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    const modelCalls: number[] = [];
    const { session } = await createOneSession({
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "retry-limit-test-key",
      onModelCall: (count) => modelCalls.push(count),
    });
    const events: Array<Record<string, unknown>> = [];
    session.subscribe((event) =>
      events.push(event as unknown as Record<string, unknown>),
    );
    try {
      await session.prompt("fail after bounded retries");
      expect(requests).toBe(3);
      expect(modelCalls).toEqual([1, 2, 3]);
      expect(session.messages.at(-1)).toMatchObject({
        role: "assistant",
        stopReason: "error",
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "auto_retry_end",
          success: false,
          finalError: expect.any(String),
        }),
      );
      expect(JSON.stringify(events)).not.toContain("retry-limit-test-key");
    } finally {
      session.dispose();
    }
  }, 30000);

  it("runs a real provider tool loop and resumes only its own saved session", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-sdk-"));
    const requests: Array<{
      body: {
        messages: Array<{ role: string }>;
        max_tokens?: number;
        max_completion_tokens?: number;
      };
      authorization: string | undefined;
    }> = [];
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const parsed = JSON.parse(body);
        requests.push({
          body: parsed,
          authorization: req.headers.authorization,
        });
        const isToolResult = parsed.messages.some(
          (m: { role: string }) => m.role === "tool",
        );
        const delta = isToolResult
          ? { content: "The answer is 42." }
          : {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "lookup_answer", arguments: "{}" },
                },
              ],
            };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [{ index: 0, delta, finish_reason: null }],
            }) +
            "\n\n",
        );
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: isToolResult ? "stop" : "tool_calls",
                },
              ],
            }) +
            "\n\n",
        );
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    let toolCalls = 0;
    const options = {
      workspace: dir,
      stateDir: join(dir, "one-state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "test-key",
      contextWindow: 32768,
      maxOutputTokens: 16000,
      tools: [
        {
          name: "lookup_answer",
          label: "Lookup",
          description: "Look up the answer",
          parameters: Type.Object({}),
          execute: async () => {
            toolCalls++;
            return {
              content: [{ type: "text" as const, text: "42" }],
              details: {},
            };
          },
        },
      ],
    };
    const { session } = await createOneSession(options);
    const sessionId = session.sessionId;
    try {
      expect(session.getActiveToolNames()).toEqual(["lookup_answer"]);
      await session.prompt("Find the answer");
      expect(toolCalls).toBe(1);
      expect(session.getLastAssistantText()).toContain("42");
      expect(requests).toHaveLength(2);
      expect(
        requests[0].body.max_tokens ?? requests[0].body.max_completion_tokens,
      ).toBe(16000);
      expect(requests[0].authorization).toBe("Bearer test-key");
      expect(
        requests[1].body.messages.some(
          (m: { role: string }) => m.role === "tool",
        ),
      ).toBe(true);
    } finally {
      session.dispose();
    }
    const beforeLimit = requests.length;
    const capped = await createOneSession({
      ...options,
      stateDir: join(dir, "capped-state"),
      maxModelCalls: 1,
    });
    try {
      await capped.session.prompt("Find the answer");
      expect(requests.length - beforeLimit).toBe(1);
      expect(capped.session.messages.at(-1)).toMatchObject({
        role: "assistant",
        stopReason: "error",
        errorMessage: expect.stringContaining("model call limit"),
      });
    } finally {
      capped.session.dispose();
    }
    const saved = await readFile(
      join(options.stateDir, "auth.json"),
      "utf8",
    ).catch(() => "");
    expect(saved).not.toContain("test-key");
    const reopened = await createOneSession({ ...options, sessionId });
    try {
      expect(reopened.session.messages.length).toBeGreaterThan(0);
      expect(reopened.session.getLastAssistantText()).toContain("42");
    } finally {
      reopened.session.dispose();
    }
    await expect(
      createOneSession({ ...options, sessionId: "missing" }),
    ).rejects.toThrow("session not found");
    const otherWorkspace = join(dir, "other");
    const rebound = await createOneSession({
      ...options,
      workspace: otherWorkspace,
      sessionId,
    });
    try {
      expect(rebound.session.sessionManager.getCwd()).toBe(otherWorkspace);
      expect(rebound.session.getLastAssistantText()).toContain("42");
    } finally {
      rebound.session.dispose();
    }
  }, 30000);

  it("does not enable builtin tools and rejects reserved names", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-sdk-"));
    const options = {
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: "https://example.test/v1",
      modelId: "test-model",
      apiKey: "key",
    };
    await expect(
      createOneSession({ ...options, baseUrl: "http://example.test/v1" }),
    ).rejects.toThrow("provider URL");
    await expect(
      createOneSession({
        ...options,
        baseUrl: "https://example.test/v1?token=x",
      }),
    ).rejects.toThrow("provider URL");
    const { session } = await createOneSession(options);
    try {
      expect(session.getActiveToolNames()).toEqual([]);
    } finally {
      session.dispose();
    }
    await expect(
      createOneSession({
        ...options,
        tools: [
          {
            name: "bash",
            label: "x",
            description: "x",
            parameters: Type.Object({}),
            execute: async () => ({ content: [], details: {} }),
          },
        ],
      }),
    ).rejects.toThrow("reserved");
  });

  // @lat: [[main-process#Main Process#One session resume reconciliation#One model API protocol selection#Provider and tool failure diagnostics]]
  it("runs an isolated worker and delegates each tool call to its host", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-worker-"));
    const receivedBodies: string[] = [];
    let behavior:
      | "normal"
      | "unauthorized"
      | "no-tool"
      | "rate-limited"
      | "unavailable"
      | "interrupted"
      | "malformed"
      | "split-tool" = "normal";
    server = createServer((req, res) => {
      if (
        behavior === "unauthorized" ||
        behavior === "rate-limited" ||
        behavior === "unavailable"
      ) {
        res.writeHead(
          behavior === "unauthorized"
            ? 401
            : behavior === "rate-limited"
              ? 429
              : 503,
          { "Content-Type": "application/json" },
        );
        const message =
          behavior === "unauthorized"
            ? "invalid credential"
            : behavior === "rate-limited"
              ? "rate limit exceeded"
              : "provider unavailable";
        res.end(JSON.stringify({ error: { message } }));
        return;
      }
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedBodies.push(body);
        const parsed = JSON.parse(body);
        if (behavior === "interrupted") {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.write(
            "data: " +
              JSON.stringify({
                id: "partial",
                object: "chat.completion.chunk",
                created: 0,
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    delta: { content: "Partial response" },
                    finish_reason: null,
                  },
                ],
              }) +
              "\n\n",
          );
          setTimeout(() => res.destroy(), 20);
          return;
        }
        const completed = parsed.messages.some(
          (m: { role: string }) => m.role === "tool",
        );
        if (behavior === "split-tool" && !completed) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          const chunks = [
            {
              tool_calls: [
                {
                  index: 0,
                  id: "call_split",
                  type: "function",
                  function: {
                    name: parsed.tools[0].function.name,
                    arguments: '{"value":',
                  },
                },
              ],
            },
            {
              tool_calls: [
                { index: 0, function: { arguments: '"forty-two"}' } },
              ],
            },
          ];
          for (const delta of chunks)
            res.write(
              "data: " +
                JSON.stringify({
                  id: "split",
                  object: "chat.completion.chunk",
                  created: 0,
                  model: "test-model",
                  choices: [{ index: 0, delta, finish_reason: null }],
                }) +
                "\n\n",
            );
          res.write(
            "data: " +
              JSON.stringify({
                id: "split",
                object: "chat.completion.chunk",
                created: 0,
                model: "test-model",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              }) +
              "\n\n",
          );
          res.end("data: [DONE]\n\n");
          return;
        }
        const delta =
          behavior === "no-tool"
            ? { content: "I cannot call tools" }
            : completed
              ? { content: "Worker finished" }
              : {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: {
                        name: parsed.tools[0].function.name,
                        arguments:
                          behavior === "malformed" ? '{"value":"valid"' : "{}",
                      },
                    },
                  ],
                };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [{ index: 0, delta, finish_reason: null }],
            }) +
            "\n\n",
        );
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason:
                    completed || behavior === "no-tool" ? "stop" : "tool_calls",
                },
              ],
            }) +
            "\n\n",
        );
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    const entry = join(process.cwd(), "src/main/one-runtime/worker.ts");
    const outfile = join(dir, "one-worker.mjs");
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
      banner: {
        js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
      },
      logLevel: "silent",
    });
    const events: unknown[] = [];
    let toolCalls = 0;
    const options = {
      workerPath: outfile,
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "worker-secret",
      prompt: "Find the answer",
      tools: [
        {
          name: "host_lookup",
          label: "Lookup",
          description: "Ask the host",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
      executeTool: async () => {
        toolCalls++;
        return "42";
      },
      onEvent: (event: unknown) => events.push(event),
    };
    const imageData =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY8AAAAAASUVORK5CYII=";
    let releaseTool!: () => void;
    let announceTool!: () => void;
    const toolStarted = new Promise<void>((resolve) => {
      announceTool = resolve;
    });
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    const worker = startOneWorker({
      ...options,
      revisionBinding: {
        runId: "run-one",
        definitionRevision: "a".repeat(64),
        snapshotHash: "b".repeat(64),
      },
      executeTool: async () => {
        toolCalls++;
        announceTool();
        await toolGate;
        return "42";
      },
      imageInput: true,
      images: [{ type: "image", data: imageData, mimeType: "image/png" }],
    });
    await toolStarted;
    let acknowledged = false;
    const steering = worker
      .steer("please include steering marker 7391")
      .then(() => {
        acknowledged = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(acknowledged).toBe(false);
    releaseTool();
    await steering;
    const result = await worker.completion;
    expect(
      receivedBodies.some((body) =>
        body.includes("please include steering marker 7391"),
      ),
    ).toBe(true);
    await expect(worker.steer("too late")).rejects.toThrow();
    expect(receivedBodies[0]).toContain(imageData);
    expect(JSON.stringify(events)).not.toContain(imageData);
    expect(result.output).toBe("Worker finished");
    expect(toolCalls).toBe(1);
    expect(JSON.stringify(events)).not.toContain("worker-secret");
    const resumed = await startOneWorker({
      ...options,
      sessionId: result.sessionId,
      revisionBinding: {
        runId: "run-two",
        definitionRevision: "c".repeat(64),
        snapshotHash: "d".repeat(64),
      },
      imageInput: true,
      prompt: "Continue",
    }).completion;
    expect(resumed.sessionId).toBe(result.sessionId);
    expect(resumed.output).toBe("Worker finished");
    const sessionDir = join(dir, "state", "sessions");
    const sessionFiles = await readdir(sessionDir);
    const sessionText = await readFile(
      join(sessionDir, sessionFiles[0]),
      "utf8",
    );
    const metadata = sessionText
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter(
        (item) =>
          item.type === "custom" &&
          item.customType === "agents-one-run-binding-v1",
      );
    expect(metadata.map((item) => item.data)).toEqual([
      {
        runId: "run-one",
        definitionRevision: "a".repeat(64),
        snapshotHash: "b".repeat(64),
      },
      {
        runId: "run-two",
        definitionRevision: "c".repeat(64),
        snapshotHash: "d".repeat(64),
      },
    ]);
    expect(sessionText).not.toContain("worker-secret");
    expect(
      await reconcileOneSessionBinding(join(sessionDir, sessionFiles[0]), {
        sessionId: result.sessionId,
        runId: "run-one",
        definitionRevision: "a".repeat(64),
        snapshotHash: "b".repeat(64),
      }),
    ).toBe("committed");
    expect(receivedBodies.at(-1)).toContain(imageData);
    expect(JSON.stringify(events)).not.toContain(imageData);
    expect(toolCalls).toBe(1);
    await expect(
      probeOneProvider({
        workerPath: outfile,
        baseUrl: options.baseUrl,
        modelId: options.modelId,
        apiKey: options.apiKey,
      }),
    ).resolves.toBeUndefined();
    behavior = "no-tool";
    await expect(
      probeOneProvider({
        workerPath: outfile,
        baseUrl: options.baseUrl,
        modelId: options.modelId,
        apiKey: options.apiKey,
      }),
    ).rejects.toThrow("did not call");
    behavior = "unauthorized";
    const authError = await probeOneProvider({
      workerPath: outfile,
      baseUrl: options.baseUrl,
      modelId: options.modelId,
      apiKey: options.apiKey,
    }).catch((error: Error) => error);
    expect(authError).toBeInstanceOf(Error);
    expect(String(authError)).toMatch(/401|unauthorized|invalid credential/i);
    expect(String(authError)).not.toContain(options.apiKey);
    for (const status of ["rate-limited", "unavailable"] as const) {
      behavior = status;
      const failure = await probeOneProvider({
        workerPath: outfile,
        baseUrl: options.baseUrl,
        modelId: options.modelId,
        apiKey: options.apiKey,
      }).catch((error: Error) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(String(failure)).toMatch(
        status === "rate-limited"
          ? /429|rate limit/i
          : /503|provider unavailable/i,
      );
      expect(String(failure)).not.toContain(options.apiKey);
    }
    behavior = "interrupted";
    let interruptedSession = "";
    const interrupted = startOneWorker({
      ...options,
      stateDir: join(dir, "interrupted-state"),
      onReady: (id) => {
        interruptedSession = id;
      },
    });
    const streamFailure = await interrupted.completion.catch(
      (error: Error) => error,
    );
    expect(streamFailure).toBeInstanceOf(Error);
    expect(String(streamFailure)).toMatch(
      /stream|fetch|terminated|socket|closed|aborted/i,
    );
    expect(String(streamFailure)).not.toContain(options.apiKey);
    expect(interruptedSession).not.toBe("");
    behavior = "normal";
    const recovered = await startOneWorker({
      ...options,
      stateDir: join(dir, "interrupted-state"),
      sessionId: interruptedSession,
      prompt: "Retry after interruption",
    }).completion;
    expect(recovered.sessionId).toBe(interruptedSession);
    expect(recovered.output).toBe("Worker finished");

    behavior = "malformed";
    const malformedStart = receivedBodies.length;
    let malformedHostCalls = 0;
    const malformed = await startOneWorker({
      ...options,
      stateDir: join(dir, "malformed-state"),
      tools: [
        {
          ...options.tools[0],
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      ],
      executeTool: async () => {
        malformedHostCalls++;
        return "unexpected";
      },
    }).completion;
    expect(malformedHostCalls).toBe(0);
    const toolResults = receivedBodies
      .slice(malformedStart)
      .flatMap((body) =>
        JSON.parse(body).messages.filter(
          (message: { role: string }) => message.role === "tool",
        ),
      );
    expect(JSON.stringify(toolResults)).toMatch(
      /invalid|required|error|validation/i,
    );
    expect(malformed.output).toBe("Worker finished");
    behavior = "split-tool";
    let splitArguments: unknown;
    const split = await startOneWorker({
      ...options,
      stateDir: join(dir, "split-state"),
      tools: [
        {
          ...options.tools[0],
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
        },
      ],
      executeTool: async (_name, args) => {
        splitArguments = args;
        return "42";
      },
    }).completion;
    expect(splitArguments).toEqual({ value: "forty-two" });
    expect(split.output).toBe("Worker finished");
    behavior = "normal";
    let announce!: () => void;
    const requested = new Promise<void>((resolve) => {
      announce = resolve;
    });
    let cleaned = false;
    const cancelled = startOneWorker({
      ...options,
      stateDir: join(dir, "cancel-state"),
      executeTool: async (_name, _params, signal) => {
        announce();
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () =>
              setTimeout(() => {
                cleaned = true;
                reject(new Error("aborted"));
              }, 150),
            {
              once: true,
            },
          ),
        );
      },
    });
    await requested;
    const cancelledCompletion = expect(cancelled.completion).rejects.toThrow(
      "cancelled",
    );
    const unconfirmed = cancelled.steer("cancelled before delivery");
    const unconfirmedResult = expect(unconfirmed).rejects.toThrow();
    cancelled.cancel();
    await unconfirmedResult;
    await cancelledCompletion;
    expect(cleaned).toBe(true);
    let announceUnconfirmed!: () => void;
    const unconfirmedStarted = new Promise<void>((resolve) => {
      announceUnconfirmed = resolve;
    });
    const failedCleanup = startOneWorker({
      ...options,
      stateDir: join(dir, "cleanup-failed-state"),
      executeTool: async (_name, _params, signal) => {
        announceUnconfirmed();
        return new Promise<string>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new OneToolCleanupError()),
            { once: true },
          ),
        );
      },
    });
    await unconfirmedStarted;
    const failure = expect(failedCleanup.completion).rejects.toThrow(
      "cleanup could not be confirmed",
    );
    failedCleanup.cancel();
    await failure;
  }, 30000);
  it("automatically compacts a long session and restores its saved summary", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-compact-"));
    let summaryRequests = 0;
    let totalRequests = 0;
    const modelCalls: number[] = [];
    let resumedSawSummary = false;
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        totalRequests++;
        const request = JSON.parse(body);
        const serialized = JSON.stringify(request.messages);
        const isSummary = serialized.includes("<conversation>");
        if (isSummary) summaryRequests++;
        if (serialized.includes("PERSISTED_SUMMARY_MARKER"))
          resumedSawSummary = true;
        const delta = {
          content: isSummary
            ? "PERSISTED_SUMMARY_MARKER: project requires Chinese output"
            : "done",
        };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const choice of [
          { delta, finish_reason: null },
          { delta: {}, finish_reason: "stop" },
        ]) {
          res.write(
            "data: " +
              JSON.stringify({
                id: "test",
                object: "chat.completion.chunk",
                created: 0,
                model: "test-model",
                choices: [{ index: 0, ...choice }],
              }) +
              "\n\n",
          );
        }
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    const options = {
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "test-key",
      contextWindow: 4096,
      onModelCall: (count: number) => modelCalls.push(count),
    };
    const created = await createOneSession(options);
    const events: Array<{ type: string }> = [];
    created.session.subscribe((event) => events.push(event));
    const id = created.session.sessionId;
    try {
      for (let i = 0; i < 5 && !summaryRequests; i++)
        await created.session.prompt(
          "turn " + i + " " + "project details ".repeat(350),
        );
      expect(summaryRequests).toBeGreaterThan(0);
      expect(modelCalls).toHaveLength(totalRequests);
      expect(modelCalls.length).toBeGreaterThan(summaryRequests);
      expect(events.some((event) => event.type === "compaction_start")).toBe(
        true,
      );
      expect(
        created.session.sessionManager
          .getEntries()
          .some((entry) => entry.type === "compaction"),
      ).toBe(true);
    } finally {
      created.session.dispose();
    }
    const reopened = await createOneSession({ ...options, sessionId: id });
    try {
      await reopened.session.prompt("Continue the project");
      expect(resumedSawSummary).toBe(true);
      expect(reopened.session.getLastAssistantText()).toBe("done");
    } finally {
      reopened.session.dispose();
    }
    await expect(
      createOneSession({ ...options, contextWindow: 4095 }),
    ).rejects.toThrow("context window");
  }, 30000);
  it("cancels an in-progress summary without saving a partial compaction", async () => {
    dir = await mkdtemp(join(tmpdir(), "agents-one-compact-cancel-"));
    let notify!: () => void;
    const summaryStarted = new Promise<void>((resolve) => {
      notify = resolve;
    });
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        if (body.includes("<conversation>")) {
          res.writeHead(200, { "Content-Type": "text/event-stream" });
          res.flushHeaders();
          notify();
          return;
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [
                { index: 0, delta: { content: "done" }, finish_reason: null },
              ],
            }) +
            "\n\n",
        );
        res.write(
          "data: " +
            JSON.stringify({
              id: "test",
              object: "chat.completion.chunk",
              created: 0,
              model: "test-model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            }) +
            "\n\n",
        );
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test address");
    const { session } = await createOneSession({
      workspace: dir,
      stateDir: join(dir, "state"),
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelId: "test-model",
      apiKey: "test-key",
      contextWindow: 4096,
    });
    try {
      let interrupted = false;
      for (let i = 0; i < 6 && !interrupted; i++) {
        const prompt = session.prompt(
          "turn " + i + " " + "project details ".repeat(350),
        );
        const isSummary = await Promise.race([
          summaryStarted.then(() => true),
          prompt.then(() => false),
        ]);
        if (isSummary) {
          interrupted = true;
          await session.abort();
          await prompt.catch(() => undefined);
        }
      }
      expect(interrupted).toBe(true);
      expect(
        session.sessionManager
          .getEntries()
          .some((entry) => entry.type === "compaction"),
      ).toBe(false);
      expect(
        session.sessionManager
          .getEntries()
          .some((entry) => entry.type === "message"),
      ).toBe(true);
    } finally {
      session.dispose();
    }
  }, 30000);
});
