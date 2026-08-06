import http from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OPENCLAW_CAPABILITIES,
  cancelOpenClawTask,
  getOpenClawTask,
  isSelfSignedCertificateError,
  probeOpenClawRuntime,
  startOpenClawTask,
  getOpenClawArtifact,
  uploadOpenClawArtifact,
  type OpenClawRuntimeConfig,
} from "../src/main/openclaw-runtime";

interface RecordedRequest {
  method: string;
  url: string;
  body: string;
}

describe("OpenClaw runtime bridge client", () => {
  it("retries TLS only for recognized self-signed certificate errors", () => {
    expect(
      isSelfSignedCertificateError({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
    ).toBe(true);
    expect(
      isSelfSignedCertificateError({ code: "SELF_SIGNED_CERT_IN_CHAIN" }),
    ).toBe(true);
    expect(isSelfSignedCertificateError({ code: "CERT_HAS_EXPIRED" })).toBe(
      false,
    );
    expect(isSelfSignedCertificateError(new Error("network reset"))).toBe(
      false,
    );
  });

  let server: http.Server;
  let baseUrl = "";
  const requests: RecordedRequest[] = [];

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
          body,
        });

        if (req.url === "/capabilities" || req.url === "/health") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              capabilities: {
                chat: true,
                taskDispatch: true,
                streaming: true,
                cancellation: true,
                tools: true,
                memory: false,
                orchestration: true,
                readOnlyPlanning: true,
                mailbox: false,
                securityEvents: true,
                artifacts: true,
                workspaceAccess: false,
              },
              message: "ready",
            }),
          );
          return;
        }

        if (req.url === "/fallback/capabilities") {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }

        if (req.url === "/fallback/health") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        if (req.method === "POST" && req.url === "/tasks") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "task-1",
              status: "running",
              sessionId: "session-1",
            }),
          );
          return;
        }

        if (req.method === "POST" && req.url === "/artifacts") {
          const parsed = JSON.parse(body) as {
            name?: string;
            mime?: string;
            size?: number;
            sha256?: string;
          };
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "artifact-1",
              name: parsed.name,
              mime: parsed.mime,
              size: parsed.size,
              sha256: parsed.sha256,
            }),
          );
          return;
        }

        if (req.method === "GET" && req.url === "/artifacts/artifact-1") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "artifact-1",
              name: "brief.txt",
              mime: "text/plain",
              size: 5,
              sha256: "a".repeat(64),
              content_base64: "aGVsbG8=",
            }),
          );
          return;
        }

        if (req.method === "POST" && req.url === "/snake/tasks") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "task-1",
              status: "running",
              session_id: "session-1",
            }),
          );
          return;
        }

        if (req.method === "GET" && req.url === "/tasks/task-1") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "task-1",
              status: "succeeded",
              output: "done",
              sessionId: "session-1",
            }),
          );
          return;
        }

        if (req.method === "GET" && req.url === "/snake/tasks/task-1") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "task-1",
              status: "succeeded",
              result: "done",
              session_id: "session-1",
            }),
          );
          return;
        }

        if (
          req.method === "POST" &&
          req.url === "/tasks/task%2Fwith%20slash/cancel"
        ) {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              id: "task/with slash",
              status: "cancelled",
              error: "cancelled by user",
            }),
          );
          return;
        }

        if (req.url === "/slow/health") {
          setTimeout(() => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          }, 2_000);
          return;
        }

        if (req.url === "/broken/capabilities") {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: "capability service unavailable" }));
          return;
        }

        if (req.url === "/error/tasks") {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              detail: "server failed while handling prompt with secret text",
            }),
          );
          return;
        }

        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
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

  function config(path = ""): OpenClawRuntimeConfig {
    return { endpoint: `${baseUrl}${path}`, timeoutMs: 2_000 };
  }

  it("prefers capabilities and normalizes returned coordination capabilities", async () => {
    const result = await probeOpenClawRuntime(config());

    expect(requests[0]).toMatchObject({ method: "GET", url: "/capabilities" });
    expect(result).toEqual({
      state: "healthy",
      message: "ready",
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: true,
        cancellation: true,
        tools: true,
        memory: false,
        orchestration: true,
        readOnlyPlanning: true,
        mailbox: false,
        securityEvents: true,
        artifacts: true,
        workspaceAccess: false,
      },
    });
  });

  it("uses default capabilities when health omits them", async () => {
    await expect(probeOpenClawRuntime(config("/fallback"))).resolves.toEqual({
      state: "healthy",
      capabilities: DEFAULT_OPENCLAW_CAPABILITIES,
      message: undefined,
    });
  });

  it("does not fall back to health when the dedicated capabilities endpoint fails", async () => {
    const result = await probeOpenClawRuntime(config("/broken"));

    expect(result).toMatchObject({
      state: "unhealthy",
      message: "OpenClaw runtime returned HTTP 500.",
    });
    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual(["GET /broken/capabilities"]);
  });

  it("starts, reads, and cancels tasks through the bridge endpoints", async () => {
    const started = await startOpenClawTask(config(), {
      prompt: "build a thing",
      profile: "research",
      sessionId: "session-1",
    });
    const loaded = await getOpenClawTask(config(), "task-1");
    const cancelled = await cancelOpenClawTask(config(), "task/with slash");

    expect(started).toEqual({
      id: "task-1",
      status: "running",
      output: undefined,
      sessionId: "session-1",
      error: undefined,
    });
    expect(JSON.parse(requests[0].body)).toEqual({
      prompt: "build a thing",
      profile: "research",
      sessionId: "session-1",
      session_id: "session-1",
    });
    expect(loaded).toMatchObject({
      id: "task-1",
      status: "succeeded",
      output: "done",
    });
    expect(cancelled).toMatchObject({
      id: "task/with slash",
      status: "cancelled",
    });
    expect(
      requests.map((request) => `${request.method} ${request.url}`),
    ).toEqual([
      "POST /tasks",
      "GET /tasks/task-1",
      "POST /tasks/task%2Fwith%20slash/cancel",
    ]);
  });

  it("accepts snake_case session ids from OpenClaw bridges", async () => {
    const started = await startOpenClawTask(config("/snake"), {
      prompt: "continue chat",
      sessionId: "session-1",
    });
    const loaded = await getOpenClawTask(config("/snake"), "task-1");

    expect(started).toMatchObject({
      id: "task-1",
      status: "running",
      sessionId: "session-1",
    });
    expect(JSON.parse(requests[0].body)).toMatchObject({
      prompt: "continue chat",
      sessionId: "session-1",
      session_id: "session-1",
    });
    expect(loaded).toMatchObject({
      id: "task-1",
      status: "succeeded",
      output: "done",
      sessionId: "session-1",
    });
  });

  it("uploads controlled artifacts and passes artifact and remote workspace references to a task", async () => {
    const uploaded = await uploadOpenClawArtifact(config(), {
      name: "brief.txt",
      mime: "text/plain",
      bytes: Buffer.from("hello"),
      sha256: "a".repeat(64),
    });
    const loaded = await getOpenClawArtifact(config(), uploaded.id);
    await startOpenClawTask(config(), {
      prompt: "review the brief",
      artifactIds: [uploaded.id],
      workspaceRef: "git:https://example.test/project.git#main",
    });

    expect(uploaded).toMatchObject({
      id: "artifact-1",
      name: "brief.txt",
      size: 5,
    });
    expect(loaded).toMatchObject({
      id: "artifact-1",
      contentBase64: "aGVsbG8=",
    });
    expect(JSON.parse(requests[0].body)).toMatchObject({
      name: "brief.txt",
      mime: "text/plain",
      size: 5,
      sha256: "a".repeat(64),
      contentBase64: "aGVsbG8=",
    });
    expect(JSON.parse(requests[2].body)).toMatchObject({
      artifactIds: ["artifact-1"],
      artifact_ids: ["artifact-1"],
      workspaceRef: "git:https://example.test/project.git#main",
      workspace_ref: "git:https://example.test/project.git#main",
    });
  });

  it("rejects invalid endpoints, credentials, secret fields, and bad timeouts", async () => {
    await expect(
      probeOpenClawRuntime({
        endpoint: "file:///tmp/openclaw",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/http or https/i);
    await expect(
      probeOpenClawRuntime({
        endpoint: "https://user:pass@example.test",
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/credentials/i);
    await expect(
      probeOpenClawRuntime({
        endpoint: "https://example.test",
        timeoutMs: 999,
      }),
    ).rejects.toThrow(/timeoutMs/i);
    await expect(
      startOpenClawTask(
        {
          endpoint: baseUrl,
          timeoutMs: 1000,
          apiKey: "do-not-store",
        } as OpenClawRuntimeConfig,
        { prompt: "hello" },
      ),
    ).rejects.toThrow(/secret or credential/i);
    await expect(
      startOpenClawTask(config(), {
        prompt: "hello",
        token: "do-not-send",
      } as never),
    ).rejects.toThrow(/secret or credential/i);
  });

  it("returns an unhealthy probe on timeout without leaking request details", async () => {
    const result = await probeOpenClawRuntime({
      endpoint: `${baseUrl}/slow`,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      state: "unhealthy",
      capabilities: {
        chat: false,
        taskDispatch: false,
        streaming: false,
        cancellation: false,
        tools: false,
        memory: false,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: false,
        workspaceAccess: false,
      },
      message: "OpenClaw runtime request timed out.",
    });
  });

  it("throws sanitized errors for non-2xx task responses", async () => {
    await expect(
      startOpenClawTask(config("/error"), {
        prompt: "this prompt must not appear in the error",
      }),
    ).rejects.toThrow("OpenClaw runtime request failed with HTTP 500.");

    await expect(
      startOpenClawTask(config("/error"), {
        prompt: "this prompt must not appear in the error",
      }),
    ).rejects.not.toThrow(/prompt|secret text/);
  });
});
