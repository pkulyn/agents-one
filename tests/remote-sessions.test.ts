import http from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dashboardApiUrl,
  remoteDeleteSession,
  remoteGetSessionMessages,
  remoteListCachedSessions,
  remoteListSessions,
  remoteReadMediaAsDataUrl,
  remoteRequestJson,
  remoteSearchSessions,
  remoteUpdateSessionTitle,
  type RemoteSessionConfig,
} from "../src/main/remote-sessions";

interface RecordedRequest {
  method: string;
  url: string;
  token: string;
  body: string;
}

describe("remote session REST bridge", () => {
  let server: http.Server;
  let baseUrl = "";
  const requests: RecordedRequest[] = [];

  it("preserves a reverse-proxied dashboard path prefix when building API URLs", () => {
    expect(
      dashboardApiUrl(
        {
          remoteUrl: "https://example.test/hermes-dashboard/",
          apiKey: "token",
        },
        "/api/sessions?limit=1",
      ),
    ).toBe("https://example.test/hermes-dashboard/api/sessions?limit=1");
  });

  beforeEach(async () => {
    requests.length = 0;
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({
          method: req.method || "GET",
          url: req.url || "",
          token: String(req.headers["x-hermes-session-token"] || ""),
          body,
        });

        res.setHeader("Content-Type", "application/json");
        if (req.url?.startsWith("/api/media")) {
          const url = new URL(req.url, "http://127.0.0.1");
          if (url.searchParams.get("path") === "/opt/data/images/duck.png") {
            res.end(
              JSON.stringify({
                data_url: "data:image/png;base64,ZHVjaw==",
              }),
            );
            return;
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ detail: "File not found" }));
          return;
        }

        if (req.url?.startsWith("/api/sessions/search")) {
          const url = new URL(req.url, "http://127.0.0.1");
          if (url.searchParams.get("q") === "duck") {
            res.end(
              JSON.stringify({
                results: [
                  {
                    session_id: "sess-search",
                    session_started: 1700000001,
                    source: "chat",
                    model: "deepseek/deepseek-v4-pro",
                    snippet: "<<duck>> in bath",
                  },
                ],
              }),
            );
            return;
          }
          res.end(JSON.stringify({ results: [] }));
          return;
        }

        if (req.url === "/api/sessions/sess-search") {
          res.end(
            JSON.stringify({
              id: "sess-search",
              source: "tui",
              started_at: 1700000003,
              ended_at: null,
              message_count: 7,
              model: "deepseek/deepseek-v4-pro",
              title: "Duck search session",
              preview: "duck in bath",
            }),
          );
          return;
        }

        if (
          req.url ===
          "/api/profiles/sessions?limit=2&offset=3&min_messages=0&archived=exclude&order=recent&profile=all"
        ) {
          res.end(
            JSON.stringify({
              total: 1,
              sessions: [
                {
                  id: "sess-list",
                  source: "chat",
                  started_at: 1700000000,
                  ended_at: null,
                  message_count: 4,
                  model: "codex-cli/gpt-5.5",
                  title: null,
                  preview: "Remote preview",
                },
                {
                  id: "sess-cron",
                  source: "cronjob",
                  started_at: 1700000001,
                  message_count: 1,
                  title: "Nightly script",
                  preview: "Scheduled maintenance",
                },
              ],
            }),
          );
          return;
        }

        if (
          req.url ===
          "/api/profiles/sessions?limit=50&offset=0&min_messages=0&archived=exclude&order=recent&profile=all"
        ) {
          res.end(
            JSON.stringify({
              sessions: [
                {
                  id: "sess-cache",
                  source: "chat",
                  started_at: 1700000002,
                  message_count: 2,
                  model: "custom/deepseek-v4-pro",
                  title: "Session ss-cache",
                  preview: "Cached remote preview",
                },
                {
                  id: "sess-title-from-message",
                  source: "chat",
                  started_at: 1700000004,
                  message_count: 2,
                  model: "custom/deepseek-v4-pro",
                  title: "Session 4af90b",
                  preview: "",
                },
                {
                  id: "sess-cache-cron",
                  source: "scheduled",
                  started_at: 1700000003,
                  message_count: 1,
                  preview: "Scheduled remote preview",
                },
                {
                  id: "sess-dashboard-orphan",
                  source: "api_server",
                  started_at: 1700000005,
                  message_count: 3,
                  title: "Session orphan",
                  preview: "",
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-title-from-message/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-title-from-message",
              messages: [
                {
                  id: 21,
                  role: "human",
                  content: "Plan the OpenClaw adapter handshake",
                  timestamp: 20,
                },
                {
                  id: 22,
                  role: "agent",
                  content: "Here is the plan.",
                  timestamp: 21,
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-dashboard-orphan/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-dashboard-orphan",
              messages: [
                {
                  id: 23,
                  role: "assistant",
                  content: "Let me inspect the connection.",
                  timestamp: 22,
                },
                {
                  id: 24,
                  role: "tool",
                  content: "ok",
                  timestamp: 23,
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-rich/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-rich",
              messages: [
                {
                  id: 1,
                  role: "user",
                  content: "make an image",
                  timestamp: 10,
                },
                {
                  id: 2,
                  role: "assistant",
                  content: "Thinking aloud",
                  timestamp: 11,
                  reasoning: "I should call the image skill.",
                  tool_calls: JSON.stringify([
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "skill_view",
                        arguments: JSON.stringify({
                          name: "ai-playground-image-gen",
                        }),
                      },
                    },
                  ]),
                },
                {
                  id: 3,
                  role: "tool",
                  content: '{"success":true}',
                  timestamp: 12,
                  tool_call_id: "call-1",
                  tool_name: "skill_view",
                },
              ],
            }),
          );
          return;
        }

        if (
          req.url ===
          "/api/profiles/sessions?limit=75&offset=0&min_messages=0&archived=exclude&order=recent&profile=all"
        ) {
          res.end(
            JSON.stringify({
              sessions: [
                {
                  id: "sess-rich",
                  source: "chat",
                  started_at: 1700000005,
                  message_count: 3,
                  model: "deepseek/deepseek-v4-pro",
                  title: "Rich fallback session",
                  preview: "make an image",
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-alias/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-alias",
              messages: [
                {
                  id: "30",
                  role: "human",
                  text: "我的提问在哪里？",
                  timestamp: 30,
                },
                {
                  id: "31",
                  role: "agent",
                  reasoning: "用户问历史里缺少提问。",
                  timestamp: 31,
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-pair/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-pair",
              messages: [
                {
                  id: 4,
                  prompt: "连接正常吗？",
                  response: "连接正常，Hermes 通信畅通。",
                  timestamp: 40,
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-image/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-image",
              messages: [
                {
                  id: 10,
                  role: "user",
                  content:
                    "[The user attached an image:\n" +
                    "A close-up view of red ZX81 text on black plastic.]\n" +
                    "[You can examine it with vision_analyze using image_url:\n" +
                    "/opt/data/images/duck.png]\n\n" +
                    "what is this?",
                  timestamp: 10,
                },
              ],
            }),
          );
          return;
        }

        if (req.url === "/api/sessions/sess-image-missing/messages") {
          res.end(
            JSON.stringify({
              session_id: "sess-image-missing",
              messages: [
                {
                  id: 11,
                  role: "user",
                  content:
                    "[The user attached an image but analysis failed.]\n" +
                    "[You can examine it with vision_analyze using image_url:\n" +
                    "/opt/data/images/missing.png]\n\n" +
                    "what is this?",
                  timestamp: 10,
                },
              ],
            }),
          );
          return;
        }

        if (req.method === "PATCH" && req.url === "/api/sessions/sess-title") {
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (
          req.method === "DELETE" &&
          req.url === "/api/sessions/sess-delete"
        ) {
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.url === "/api/auth-fallback") {
          if (req.headers["x-hermes-session-token"] === "fallback-token") {
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.statusCode = 401;
          res.end(JSON.stringify({ detail: "invalid dashboard token" }));
          return;
        }

        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function config(): RemoteSessionConfig {
    return { remoteUrl: `${baseUrl}/api`, apiKey: "test-token" };
  }

  it("normalizes remote session list rows", async () => {
    const sessions = await remoteListSessions(config(), 2, 3);

    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "/api/profiles/sessions?limit=2&offset=3&min_messages=0&archived=exclude&order=recent&profile=all",
      token: "test-token",
    });
    expect(sessions).toEqual([
      {
        id: "sess-list",
        source: "chat",
        startedAt: 1700000000,
        endedAt: null,
        messageCount: 4,
        model: "codex-cli/gpt-5.5",
        title: null,
        preview: "Remote preview",
      },
    ]);
  });

  it("falls back to the legacy session list endpoint for older dashboards", async () => {
    const originalHandler = server.listeners("request")[0];
    server.removeListener("request", originalHandler);
    server.on("request", (req, res) => {
      requests.push({
        method: req.method || "GET",
        url: req.url || "",
        token: String(req.headers["x-hermes-session-token"] || ""),
        body: "",
      });

      res.setHeader("Content-Type", "application/json");
      if (req.url?.startsWith("/api/profiles/sessions")) {
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: "not found" }));
        return;
      }
      if (
        req.url ===
        "/api/sessions?limit=1&offset=0&archived=exclude&order=recent"
      ) {
        res.end(
          JSON.stringify({
            sessions: [
              {
                id: "legacy-sess",
                started_at: 1700000004,
                message_count: 1,
              },
            ],
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ detail: "not found" }));
    });

    const sessions = await remoteListSessions(config(), 1, 0);

    expect(requests.map((request) => request.url)).toEqual([
      "/api/profiles/sessions?limit=1&offset=0&min_messages=0&archived=exclude&order=recent&profile=all",
      "/api/sessions?limit=1&offset=0&archived=exclude&order=recent",
    ]);
    expect(sessions[0]).toMatchObject({ id: "legacy-sess", messageCount: 1 });
  });

  it("returns remote sessions in the cached-session shape used by the Sessions tab", async () => {
    const sessions = await remoteListCachedSessions(config());

    expect(sessions).toEqual([
      {
        id: "sess-cache",
        title: "Cached remote preview",
        startedAt: 1700000002,
        source: "chat",
        messageCount: 2,
        model: "custom/deepseek-v4-pro",
        // Remote sessions have no local desktop folder binding (issue #27).
        contextFolder: null,
      },
      {
        id: "sess-title-from-message",
        title: "Plan the OpenClaw adapter handshake",
        startedAt: 1700000004,
        source: "chat",
        messageCount: 2,
        model: "custom/deepseek-v4-pro",
        contextFolder: null,
      },
    ]);
  });

  it("normalizes remote role aliases and assistant text stored as reasoning", async () => {
    const items = await remoteGetSessionMessages(config(), "sess-alias");

    expect(items).toEqual([
      {
        kind: "user",
        id: 30,
        content: "我的提问在哪里？",
        timestamp: 30,
      },
      {
        kind: "assistant",
        id: 31,
        content: "用户问历史里缺少提问。",
        timestamp: 31,
      },
    ]);
  });

  it("splits prompt/response records into user and assistant history rows", async () => {
    const items = await remoteGetSessionMessages(config(), "sess-pair");

    expect(items).toEqual([
      {
        kind: "user",
        id: 40,
        content: "连接正常吗？",
        timestamp: 40,
      },
      {
        kind: "assistant",
        id: 41,
        content: "连接正常，Hermes 通信畅通。",
        timestamp: 40.000001,
      },
    ]);
  });

  it("expands remote stored messages into rich history items", async () => {
    const items = await remoteGetSessionMessages(config(), "sess-rich");

    expect(items.map((item) => item.kind)).toEqual([
      "user",
      "reasoning",
      "assistant",
      "tool_call",
      "tool_result",
    ]);
    expect(items[1]).toMatchObject({
      kind: "reasoning",
      text: "I should call the image skill.",
    });
    expect(items[3]).toMatchObject({
      kind: "tool_call",
      callId: "call-1",
      name: "skill_view",
    });
    expect(items[4]).toMatchObject({
      kind: "tool_result",
      callId: "call-1",
      name: "skill_view",
      content: '{"success":true}',
    });
  });

  it("rehydrates remote pasted-image prompts from Hermes vision fallback text", async () => {
    const items = await remoteGetSessionMessages(config(), "sess-image");
    const user = items[0];

    expect(requests.map((request) => request.url)).toEqual([
      "/api/sessions/sess-image/messages",
      "/api/media?path=%2Fopt%2Fdata%2Fimages%2Fduck.png",
    ]);
    expect(user).toMatchObject({
      kind: "user",
      content: "what is this?",
    });
    expect("attachments" in user ? user.attachments?.[0] : null).toMatchObject({
      id: "remote-fallback-att-10-0",
      kind: "image",
      name: "duck.png",
      mime: "image/png",
      size: 4,
      dataUrl: "data:image/png;base64,ZHVjaw==",
      path: "/opt/data/images/duck.png",
    });
  });

  it("hides remote pasted-image fallback text when the remote image is gone", async () => {
    const items = await remoteGetSessionMessages(
      config(),
      "sess-image-missing",
    );
    const user = items[0];

    expect(user).toMatchObject({
      kind: "user",
      content: "what is this?",
    });
    expect("attachments" in user).toBe(false);
  });

  it("fetches remote dashboard media as a data URL", async () => {
    const dataUrl = await remoteReadMediaAsDataUrl(
      config(),
      "/opt/data/images/duck.png",
    );

    expect(requests[0]).toMatchObject({
      method: "GET",
      url: "/api/media?path=%2Fopt%2Fdata%2Fimages%2Fduck.png",
      token: "test-token",
    });
    expect(dataUrl).toBe("data:image/png;base64,ZHVjaw==");
  });

  it("returns null when remote dashboard media is not available", async () => {
    const dataUrl = await remoteReadMediaAsDataUrl(
      config(),
      "/opt/data/images/missing.png",
    );

    expect(dataUrl).toBeNull();
  });

  it("normalizes remote session search results", async () => {
    const results = await remoteSearchSessions(config(), "duck");

    expect(requests[0].url).toBe("/api/sessions/search?q=duck");
    expect(requests[1].url).toBe("/api/sessions/sess-search");
    expect(results).toEqual([
      {
        sessionId: "sess-search",
        title: "Duck search session",
        startedAt: 1700000001,
        source: "chat",
        messageCount: 7,
        model: "deepseek/deepseek-v4-pro",
        snippet: "<<duck>> in bath",
      },
    ]);
  });

  it("falls back to recent transcript scanning when remote search misses a session", async () => {
    const results = await remoteSearchSessions(config(), "Thinking aloud");

    expect(requests.map((request) => request.url)).toEqual([
      "/api/sessions/search?q=Thinking%20aloud",
      "/api/profiles/sessions?limit=75&offset=0&min_messages=0&archived=exclude&order=recent&profile=all",
      "/api/sessions/sess-rich/messages",
    ]);
    expect(results).toEqual([
      {
        sessionId: "sess-rich",
        title: "Rich fallback session",
        startedAt: 1700000005,
        source: "chat",
        messageCount: 3,
        model: "deepseek/deepseek-v4-pro",
        snippet: "<<Thinking aloud>>",
      },
    ]);
  });

  it("sends title updates and deletes to the remote backend", async () => {
    await remoteUpdateSessionTitle(config(), "sess-title", "New title");
    await remoteDeleteSession(config(), "sess-delete");

    expect(requests[0]).toMatchObject({
      method: "PATCH",
      url: "/api/sessions/sess-title",
      token: "test-token",
      body: JSON.stringify({ title: "New title" }),
    });
    expect(requests[1]).toMatchObject({
      method: "DELETE",
      url: "/api/sessions/sess-delete",
      token: "test-token",
    });
  });

  it("retries a rejected dashboard token with the configured fallback key", async () => {
    await expect(
      remoteRequestJson(
        {
          remoteUrl: `${baseUrl}/api`,
          apiKey: "dashboard-token",
          fallbackApiKey: "fallback-token",
        },
        "/api/auth-fallback",
      ),
    ).resolves.toEqual({ ok: true });

    expect(requests.slice(-2).map((request) => request.token)).toEqual([
      "dashboard-token",
      "fallback-token",
    ]);
  });
});
