import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import http from "http";
import { tmpdir } from "os";
import { join } from "path";

const testRemoteConnectionMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const probeRemoteCoordinatorBridgeMock = vi.hoisted(() => vi.fn());
const startRemoteCoordinatorPlanMock = vi.hoisted(() => vi.fn());
const getRemoteCoordinatorPlanMock = vi.hoisted(() => vi.fn());
const cancelRemoteCoordinatorPlanMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/hermes", () => ({
  sendMessage: sendMessageMock,
  testRemoteConnection: testRemoteConnectionMock,
}));

vi.mock("../src/main/remote-coordinator-bridge", () => ({
  probeRemoteCoordinatorBridge: probeRemoteCoordinatorBridgeMock,
  startRemoteCoordinatorPlan: startRemoteCoordinatorPlanMock,
  getRemoteCoordinatorPlan: getRemoteCoordinatorPlanMock,
  cancelRemoteCoordinatorPlan: cancelRemoteCoordinatorPlanMock,
}));

let testHome: string;

async function loadModules(): Promise<{
  config: typeof import("../src/main/config");
  runtimes: typeof import("../src/main/agent-runtimes");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return {
    config: await import("../src/main/config"),
    runtimes: await import("../src/main/agent-runtimes"),
  };
}

describe("agent runtime registry", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "hermes-agent-runtimes-"));
    testRemoteConnectionMock.mockReset();
    sendMessageMock.mockReset();
    probeRemoteCoordinatorBridgeMock.mockReset();
    startRemoteCoordinatorPlanMock.mockReset();
    getRemoteCoordinatorPlanMock.mockReset();
    cancelRemoteCoordinatorPlanMock.mockReset();
    probeRemoteCoordinatorBridgeMock.mockResolvedValue({
      state: "not_found",
      capabilities: {},
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("derives the managed Hermes runtime from the protected connection config", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig({
      ...config.getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "protected-api-key",
    });

    expect(runtimes.listAgentRuntimes()).toContainEqual(
      expect.objectContaining({
        id: "hermes-remote",
        kind: "hermes",
        managed: "builtin",
        config: expect.objectContaining({
          endpoint: "https://hermes.example/hermes-api",
        }),
      }),
    );
    expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
      "protected-api-key",
    );
  });

  it("stores user runtime definitions without accepting embedded credentials", async () => {
    const { runtimes } = await loadModules();
    const saved = runtimes.saveAgentRuntime({
      id: "openclaw-nas",
      name: "OpenClaw NAS",
      kind: "openclaw",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://openclaw.example/bridge",
        transport: "http",
        timeoutMs: 10_000,
      },
    });

    expect(saved).toMatchObject({ id: "openclaw-nas", managed: "user" });
    expect(runtimes.listAgentRuntimes()).toContainEqual(
      expect.objectContaining({ id: "openclaw-nas" }),
    );
    expect(() =>
      runtimes.saveAgentRuntime({
        ...saved,
        managed: undefined as never,
        config: { apiKey: "must-not-be-stored" } as never,
      }),
    ).toThrow(/credentials/i);
  });

  it("does not remove built-in runtimes and marks uninstalled adapters unsupported", async () => {
    const { runtimes } = await loadModules();

    expect(() => runtimes.removeAgentRuntime("hermes-remote")).toThrow(
      /cannot be removed/i,
    );
    expect(await runtimes.probeAgentRuntime("hermes-local")).toMatchObject({
      state: "unsupported",
      capabilities: expect.objectContaining({ taskDispatch: false }),
    });
  });

  it("probes remote Hermes through the established connection health check", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig({
      ...config.getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "protected-api-key",
    });
    testRemoteConnectionMock.mockResolvedValue(true);

    await expect(runtimes.probeAgentRuntime("hermes-remote")).resolves.toMatchObject({
      state: "healthy",
      capabilities: expect.objectContaining({ chat: true, taskDispatch: true }),
    });
    expect(testRemoteConnectionMock).toHaveBeenCalledWith(
      "https://hermes.example/hermes-api",
      "protected-api-key",
    );
  });

  it("starts a remote Hermes runtime task and records streamed output", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig({
      ...config.getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "protected-api-key",
    });
    let callbacks: {
      onChunk: (chunk: string) => void;
      onDone: (sessionId?: string) => void;
      onError: (error: string) => void;
    } | null = null;
    sendMessageMock.mockImplementation((_message, cb) => {
      callbacks = cb;
      return Promise.resolve({ abort: vi.fn() });
    });

    const run = await runtimes.startAgentRuntimeTask("hermes-remote", {
      prompt: "ping",
    });

    expect(run).toMatchObject({ status: "running", output: "" });
    callbacks?.onChunk("pong");
    callbacks?.onDone("session-1");

    await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
      status: "succeeded",
      output: "pong",
      sessionId: "session-1",
    });
    expect(sendMessageMock).toHaveBeenCalledWith(
      "ping",
      expect.objectContaining({
        onChunk: expect.any(Function),
        onDone: expect.any(Function),
        onError: expect.any(Function),
      }),
      undefined,
      undefined,
    );
  });

  it("cancels an active remote Hermes runtime task", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig({
      ...config.getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "protected-api-key",
    });
    const abort = vi.fn();
    sendMessageMock.mockResolvedValue({ abort });

    const run = await runtimes.startAgentRuntimeTask("hermes-remote", {
      prompt: "slow task",
    });
    await Promise.resolve();

    await expect(runtimes.cancelAgentRuntimeTask(run.id)).resolves.toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);
    await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
      status: "cancelled",
      error: "Runtime task was cancelled.",
    });
    await expect(runtimes.cancelAgentRuntimeTask(run.id)).resolves.toBe(false);
  });

  it("runs and cancels a constrained remote coordinator plan", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig({
      ...config.getConnectionConfig(),
      mode: "remote",
      remoteUrl: "https://hermes.example/hermes-api",
      apiKey: "protected-api-key",
    });
    probeRemoteCoordinatorBridgeMock.mockResolvedValue({
      state: "healthy",
      capabilities: {
        chat: true,
        taskDispatch: true,
        streaming: false,
        cancellation: true,
        tools: false,
        memory: false,
        orchestration: true,
        readOnlyPlanning: true,
        mailbox: false,
        securityEvents: true,
        artifacts: true,
        workspaceAccess: false,
      },
    });
    startRemoteCoordinatorPlanMock.mockResolvedValue({
      id: "plan-1",
      status: "running",
    });
    getRemoteCoordinatorPlanMock.mockResolvedValue({
      id: "plan-1",
      status: "succeeded",
      output: "Structured plan",
      artifacts: [],
    });
    cancelRemoteCoordinatorPlanMock.mockResolvedValue({
      id: "plan-2",
      status: "cancelled",
      cleanedUp: true,
    });

    const run = await runtimes.startAgentRuntimeTask("hermes-remote", {
      prompt: "Plan safely.",
      mode: "analysis",
      timeoutMs: 120_000,
      coordinatorPlan: {
        projectId: "project-1",
        title: "Project",
        objective: "Objective",
        existingTasks: [],
      },
    });
    expect(run).toMatchObject({ status: "running", runtimeId: "hermes-remote" });
    expect(startRemoteCoordinatorPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://hermes.example/hermes-api" }),
      expect.objectContaining({
        projectId: "project-1",
        context: expect.objectContaining({ title: "Project" }),
      }),
      { bearerToken: "protected-api-key" },
    );
    await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
      status: "succeeded",
      output: "Structured plan",
      artifacts: expect.arrayContaining([
        expect.objectContaining({ kind: "final", label: "Coordinator plan" }),
      ]),
    });

    startRemoteCoordinatorPlanMock.mockResolvedValueOnce({
      id: "plan-2",
      status: "running",
    });
    const cancellable = await runtimes.startAgentRuntimeTask("hermes-remote", {
      prompt: "Plan slowly.",
      mode: "analysis",
      coordinatorPlan: {
        projectId: "project-2",
        title: "Project 2",
        objective: "Objective 2",
        existingTasks: [],
      },
    });
    await expect(runtimes.cancelAgentRuntimeTask(cancellable.id)).resolves.toBe(true);
    expect(cancelRemoteCoordinatorPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: "https://hermes.example/hermes-api" }),
      "plan-2",
      { bearerToken: "protected-api-key" },
    );
  });

  it("probes, starts, refreshes, and cancels a remote OpenClaw runtime", async () => {
    let taskCount = 0;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        expect(req.headers.authorization).toBe("Bearer bridge-test-token");
        if (req.url === "/health") {
          res.end(
            JSON.stringify({
              capabilities: {
                chat: true,
                taskDispatch: true,
                streaming: false,
                cancellation: true,
                tools: true,
                memory: false,
                orchestration: false,
                readOnlyPlanning: false,
                mailbox: false,
                securityEvents: false,
                artifacts: false,
                workspaceAccess: false,
              },
            }),
          );
          return;
        }
        if (req.method === "POST" && req.url === "/tasks") {
          expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
            prompt: "openclaw task",
          });
          taskCount += 1;
          res.end(
            JSON.stringify({
              id: `task-${taskCount}`,
              status: "running",
            }),
          );
          return;
        }
        if (req.method === "GET" && req.url === "/tasks/task-1") {
          res.end(
            JSON.stringify({
              id: "task-1",
              status: "succeeded",
              output: "done",
            }),
          );
          return;
        }
        if (req.method === "POST" && req.url === "/tasks/task-2/cancel") {
          res.end(
            JSON.stringify({
              id: "task-2",
              status: "cancelled",
              error: "cancelled by user",
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "not found" }));
      });
    });
    const endpoint = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address === "object" && address) {
          resolve(`http://127.0.0.1:${address.port}`);
        }
      });
    });

    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "openclaw-local-test",
        name: "OpenClaw Test",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        config: { endpoint, transport: "http", timeoutMs: 2_000 },
      });
      expect(
        runtimes.getAgentRuntimeCredentialStatus("openclaw-local-test"),
      ).toEqual({ required: true, configured: false });
      runtimes.setAgentRuntimeBearerToken(
        "openclaw-local-test",
        "bridge-test-token",
      );
      expect(
        runtimes.getAgentRuntimeCredentialStatus("openclaw-local-test"),
      ).toEqual({ required: true, configured: true });
      expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
        "bridge-test-token",
      );

      await expect(
        runtimes.probeAgentRuntime("openclaw-local-test"),
      ).resolves.toMatchObject({
        state: "healthy",
        capabilities: expect.objectContaining({
          taskDispatch: true,
          cancellation: true,
          tools: true,
        }),
      });
      const run = await runtimes.startAgentRuntimeTask("openclaw-local-test", {
        prompt: "openclaw task",
      });

      expect(run).toMatchObject({
        status: "running",
        runtimeId: "openclaw-local-test",
      });
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "succeeded",
        output: "done",
      });
      const cancellable = await runtimes.startAgentRuntimeTask(
        "openclaw-local-test",
        { prompt: "openclaw task" },
      );

      await expect(
        runtimes.cancelAgentRuntimeTask(cancellable.id),
      ).resolves.toBe(true);
      await expect(
        runtimes.getAgentRuntimeRun(cancellable.id),
      ).resolves.toMatchObject({
        status: "cancelled",
        error: "cancelled by user",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
