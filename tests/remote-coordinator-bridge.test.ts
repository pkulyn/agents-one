import http from "http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cancelRemoteCoordinatorPlan,
  getRemoteCoordinatorPlan,
  probeRemoteCoordinatorBridge,
  startRemoteCoordinatorPlan,
  type RemoteCoordinatorConfig,
} from "../src/main/remote-coordinator-bridge";

interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

describe("remote coordinator Bridge client", () => {
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
          headers: req.headers,
          body,
        });
        res.setHeader("Content-Type", "application/json");

        if (req.url === "/capabilities") {
          res.end(JSON.stringify({
            capabilities: {
              chat: true,
              taskDispatch: true,
              cancellation: true,
              artifacts: true,
              orchestration: true,
              readOnlyPlanning: true,
              securityEvents: true,
            },
            message: "coordinator ready",
          }));
          return;
        }

        if (req.method === "POST" && req.url === "/orchestration/plans") {
          expect(req.headers.authorization).toBe("Bearer bridge-token");
          expect(req.headers["idempotency-key"]).toEqual(expect.any(String));
          const parsed = JSON.parse(body);
          expect(parsed.constraints).toMatchObject({
            toolPolicy: "disabled",
            filesystem: "disabled",
            network: "disabled",
            timeoutSeconds: 120,
          });
          res.end(JSON.stringify({ id: "plan-1", status: "running" }));
          return;
        }

        if (req.method === "GET" && req.url === "/orchestration/plans/plan-1") {
          res.end(JSON.stringify({
            id: "plan-1",
            status: "succeeded",
            plan: {
              summary: "Use Codex for implementation and Hermes for review.",
              tasks: [{ title: "Implement safely", suggestedRuntimeKind: "codex" }],
            },
            artifacts: [{ kind: "final", label: "Plan JSON", content: "{}" }],
          }));
          return;
        }

        if (req.method === "POST" && req.url === "/orchestration/plans/plan-1/cancel") {
          res.end(JSON.stringify({
            id: "plan-1",
            status: "cancelled",
            cleanedUp: true,
          }));
          return;
        }

        if (req.url === "/missing/capabilities") {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
          return;
        }

        if (req.url === "/broken/capabilities") {
          res.statusCode = 500;
          res.end(JSON.stringify({ token: "must not leak" }));
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

  function config(path = ""): RemoteCoordinatorConfig {
    return { endpoint: `${baseUrl}${path}`, timeoutMs: 2_000 };
  }

  it("probes capabilities and runs a constrained plan lifecycle", async () => {
    await expect(
      probeRemoteCoordinatorBridge(config(), { bearerToken: "bridge-token" }),
    ).resolves.toMatchObject({
      state: "healthy",
      message: "coordinator ready",
      capabilities: expect.objectContaining({
        orchestration: true,
        readOnlyPlanning: true,
        securityEvents: true,
      }),
    });

    const started = await startRemoteCoordinatorPlan(
      config(),
      {
        projectId: "project-1",
        request: "Plan this safely.",
        context: {
          title: "Project",
          requirements: "Need a plan.",
          existingTasks: [],
        },
      },
      { bearerToken: "bridge-token" },
    );
    const loaded = await getRemoteCoordinatorPlan(config(), "plan-1", {
      bearerToken: "bridge-token",
    });
    const cancelled = await cancelRemoteCoordinatorPlan(config(), "plan-1", {
      bearerToken: "bridge-token",
    });

    expect(started).toMatchObject({ id: "plan-1", status: "running" });
    expect(loaded).toMatchObject({
      id: "plan-1",
      status: "succeeded",
      output: expect.stringContaining("suggestedRuntimeKind"),
    });
    expect(cancelled).toMatchObject({
      id: "plan-1",
      status: "cancelled",
      cleanedUp: true,
    });
    expect(JSON.stringify(requests)).not.toContain("must not leak");
  });

  it("distinguishes missing capabilities from failed capabilities without leaking response bodies", async () => {
    await expect(probeRemoteCoordinatorBridge(config("/missing"))).resolves.toMatchObject({
      state: "not_found",
    });
    await expect(probeRemoteCoordinatorBridge(config("/broken"))).resolves.toMatchObject({
      state: "unhealthy",
      message: "Remote coordinator Bridge returned HTTP 500.",
    });
  });

  it("rejects secret fields in plan inputs", async () => {
    await expect(
      startRemoteCoordinatorPlan(config(), {
        projectId: "project-1",
        request: "Plan.",
        context: { title: "P", requirements: "R" },
        token: "do-not-send",
      } as never),
    ).rejects.toThrow(/secret or credential/i);
  });
});
