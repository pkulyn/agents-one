import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "fs";
import http from "http";
import { createHash } from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { deriveAgentTransport } from "../src/shared/agent-runtimes";

const sendMessageMock = vi.hoisted(() => vi.fn());
const probeCodexRuntimeMock = vi.hoisted(() => vi.fn());
const startCodexProcessMock = vi.hoisted(() => vi.fn());
const probeClaudeCodeRuntimeMock = vi.hoisted(() => vi.fn());
const startClaudeCodeProcessMock = vi.hoisted(() => vi.fn());
const probePiRuntimeMock = vi.hoisted(() => vi.fn());
const startPiProcessMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/hermes", () => ({
  sendMessage: sendMessageMock,
}));

vi.mock("../src/main/claude-code-runtime", () => ({
  probeClaudeCodeRuntime: probeClaudeCodeRuntimeMock,
  startClaudeCodeProcess: startClaudeCodeProcessMock,
}));

vi.mock("../src/main/codex-runtime", () => ({
  probeCodexRuntime: probeCodexRuntimeMock,
  startCodexProcess: startCodexProcessMock,
}));

vi.mock("../src/main/pi-runtime", () => ({
  probePiRuntime: probePiRuntimeMock,
  startPiProcess: startPiProcessMock,
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
    sendMessageMock.mockReset();
    probeCodexRuntimeMock.mockReset();
    startCodexProcessMock.mockReset();
    probeClaudeCodeRuntimeMock.mockReset();
    startClaudeCodeProcessMock.mockReset();
    probePiRuntimeMock.mockReset();
    startPiProcessMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("registers the managed Hermes runtime as a local built-in", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();

    expect(runtimes.listAgentRuntimes()).toContainEqual(
      expect.objectContaining({
        id: "hermes-local",
        kind: "hermes",
        location: "local",
        managed: "builtin",
        config: expect.objectContaining({
          transport: "cli",
          agentTransport: "local-api",
        }),
      }),
    );
  });

  it("stores user runtime definitions without accepting embedded credentials", async () => {
    const { runtimes } = await loadModules();
    const saved = runtimes.saveAgentRuntime({
      id: "codex-local",
      name: "Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: {
        executablePath: "codex",
        transport: "cli",
        timeoutMs: 10_000,
      },
    });

    expect(saved).toMatchObject({ id: "codex-local", managed: "user" });
    expect(runtimes.listAgentRuntimes()).toContainEqual(
      expect.objectContaining({ id: "codex-local" }),
    );
    expect(() =>
      runtimes.saveAgentRuntime({
        ...saved,
        managed: undefined as never,
        config: { apiKey: "must-not-be-stored" } as never,
      }),
    ).toThrow(/credentials/i);
  });

  it("stores a remote Gateway token separately from the runtime definition", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "hermes-gateway",
      name: "Hermes Gateway",
      kind: "hermes",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://hermes.example/agents-one/v1",
        remoteGateway: { protocol: "agents-one-v1" },
        transport: "http",
        timeoutMs: 10_000,
      },
    });

    expect(
      runtimes.getAgentRuntimeCredentialStatus("hermes-gateway"),
    ).toEqual({ required: true, configured: false });
    runtimes.setAgentRuntimeBearerToken("hermes-gateway", "gateway-token");
    expect(
      runtimes.getAgentRuntimeCredentialStatus("hermes-gateway"),
    ).toEqual({ required: true, configured: true });
    expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
      "gateway-token",
    );
  });

  it("uses one protected token for an Agents One Remote Gateway v1 runtime", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          capabilities: {
            conversation: { stream: "sse", continuation: true },
            tasks: { start: true, get: true, cancel: true },
            artifacts: { upload: true, download: true },
            outboundWorkspaceGateway: {
              enabled: true,
              operations: ["list", "read", "write", "move", "delete"],
              maxOperationBytes: 262144,
              maxGrantSeconds: 1800,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "family-relay",
        name: "家庭 Relay",
        kind: "pi",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://relay.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
          timeoutMs: 10_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "family-relay",
        "gateway-token-value",
      );

      await expect(
        runtimes.probeAgentRuntime("family-relay"),
      ).resolves.toMatchObject({
        state: "healthy",
        capabilities: expect.objectContaining({
          chat: true,
          taskDispatch: true,
          workspaceAccess: true,
        }),
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://relay.example/agents-one/v1/capabilities",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer gateway-token-value",
          }),
        }),
      );
      expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
        "gateway-token-value",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("dispatches a Gateway v1 run to its own remote agent instead of legacy Hermes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "remote-run-hers",
          status: "succeeded",
          conversationId: "hers-conversation-1",
          output: "Hers 已收到并完成测试。",
          events: [
            {
              id: "evt-workspace-generic-failure",
              sequence: 1,
              type: "tool.failed",
              data: {
                tool: { name: "workspace_gateway" },
              },
            },
            {
              id: "evt-workspace-completed",
              sequence: 2,
              type: "workspace.completed",
              data: { summary: "工作区读写已完成。" },
            },
          ],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-family",
        name: "Hers",
        kind: "hermes",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://family-relay.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
          timeoutMs: 10_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken("hers-family", "hers-gateway-token");

      const run = await runtimes.startAgentRuntimeTask("hers-family", {
        prompt: "请只回复 Hers 已连接。",
        mode: "analysis",
        conversation: true,
      });
      expect(run).toMatchObject({
        runtimeId: "hers-family",
        status: "succeeded",
        sessionId: "hers-conversation-1",
        output: "Hers 已收到并完成测试。",
      });
      expect(run.events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "error",
            summary: "工具 workspace_gateway",
          }),
        ]),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://family-relay.example/agents-one/v1/runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer hers-gateway-token",
          }),
        }),
      );
      const requestBody = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      ) as { mode?: string; execution?: { timeoutSeconds?: number } };
      expect(requestBody.mode).toBe("conversation");
      expect(requestBody.execution?.timeoutSeconds).toBe(1800);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("accepts delivered media or artifacts without a workspace audit entry", async () => {
    const { runtimes } = await loadModules();

    expect(
      runtimes.hasRemoteDeliveredContent(
        'MEDIA:"C:\\Users\\chenfl\\Desktop\\test-chart.png"',
      ),
    ).toBe(true);
    expect(
      runtimes.hasRemoteDeliveredContent(undefined, [
        {
          id: "artifact-created",
          type: "artifact.created",
          createdAt: Date.now(),
        },
      ]),
    ).toBe(true);
    expect(runtimes.hasRemoteDeliveredContent("普通文本回复")).toBe(false);
  });

  it("accepts a valid collaboration proposal as a control outcome without workspace evidence", async () => {
    const { runtimes } = await loadModules();
    const proposal = [
      "需要由 Pi 执行、Claude Code 复核。",
      "<agents-one-collaboration-proposal>",
      '{"title":"冒烟测试","brief":"生成并复核测试文档","assignments":[{"role":"执行","runtimeId":"pi-local"},{"role":"复核","runtimeId":"claude-local"}]}',
      "</agents-one-collaboration-proposal>",
    ].join("\n");

    expect(
      runtimes.hasRemoteWorkspaceOutcome(proposal, undefined, undefined, [
        "pi-local",
        "claude-local",
      ]),
    ).toBe(true);
    expect(
      runtimes.hasRemoteWorkspaceOutcome(proposal, undefined, undefined, [
        "pi-local",
      ]),
    ).toBe(false);
    expect(
      runtimes.hasRemoteWorkspaceOutcome("普通文本回复", undefined, undefined, [
        "pi-local",
        "claude-local",
      ]),
    ).toBe(false);
  });

  it("uploads Gateway input attachments before dispatching the run", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        const url = String(input);
        const body = init?.body
          ? (JSON.parse(String(init.body)) as Record<string, unknown>)
          : {};
        requests.push({ url, body });
        if (url.endsWith("/capabilities")) {
          return new Response(
            JSON.stringify({
              protocolVersion: "1.0",
              capabilities: {
                conversation: { stream: "sse" },
                tasks: { start: true, get: true, cancel: true },
                artifacts: { upload: true, download: true },
              },
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/artifacts")) {
          return new Response(
            JSON.stringify({
              id: "artifact-brief",
              name: "brief.txt",
              mime: "text/plain",
              size: 5,
            }),
            { status: 201 },
          );
        }
        return new Response(
          JSON.stringify({
            id: "remote-run-with-attachment",
            status: "succeeded",
            output: "附件已读取。",
          }),
          { status: 202 },
        );
      });
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-attachments",
        name: "Hers-2",
        kind: "hermes",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://relay.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          timeoutMs: 10_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "hers-attachments",
        "attachment-token",
      );

      const run = await runtimes.startAgentRuntimeTask("hers-attachments", {
        prompt: "请读取附件。",
        mode: "analysis",
        attachments: [
          {
            id: "brief-1",
            kind: "text-file",
            name: "brief.txt",
            mime: "text/plain",
            size: 5,
            text: "hello",
          },
        ],
      });

      expect(run).toMatchObject({
        status: "succeeded",
        output: "附件已读取。",
        inputArtifacts: [
          expect.objectContaining({ name: "brief.txt", size: 5 }),
        ],
      });
      const runRequest = requests.find((request) =>
        request.url.endsWith("/runs"),
      );
      expect(runRequest?.body.input).toEqual(
        expect.objectContaining({ artifactIds: ["artifact-brief"] }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("hydrates a completed Gateway artifact in the main process", async () => {
    const bytes = Buffer.from("remote chart bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-with-output-artifact",
            status: "succeeded",
            output:
              "图表已生成。artifact.created id: artifact-chart name: test-chart.png mime: image/png size: " +
              `${bytes.length} sha256: ${sha256}`,
          }),
          { status: 202, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "artifact-chart",
            name: "test-chart.png",
            mime: "image/png",
            size: bytes.length,
            sha256,
            contentBase64: bytes.toString("base64"),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-artifact-output",
        name: "Hers-2 artifact",
        kind: "hermes",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://relay.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          timeoutMs: 10_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "hers-artifact-output",
        "artifact-output-token",
      );

      const run = await runtimes.startAgentRuntimeTask(
        "hers-artifact-output",
        { prompt: "生成图表。", mode: "analysis" },
      );
      const artifact = run.artifacts?.[0];
      expect(run.status).toBe("succeeded");
      expect(artifact).toMatchObject({
        id: "artifact-chart",
        label: "test-chart.png",
        mime: "image/png",
        size: bytes.length,
        sha256,
        path: expect.any(String),
      });
      expect(existsSync(artifact?.path || "")).toBe(true);
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "https://relay.example/agents-one/v1/runs",
        "https://relay.example/agents-one/v1/artifacts/artifact-chart",
      ]);
      if (artifact?.path) rmSync(artifact.path, { force: true });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps a Gateway v1 conversation usable without a local workspace grant", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "remote-run-hers-project",
          status: "succeeded",
          conversationId: "hers-conversation-project",
          output: "Hers 普通对话已继续。",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-project",
        name: "Hers",
        kind: "hermes",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://family-relay.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
          timeoutMs: 10_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken("hers-project", "hers-project-token");

      await expect(
        runtimes.startAgentRuntimeTask("hers-project", {
          prompt: "你好，请确认连接。",
          mode: "analysis",
          sessionId: "hers-existing-conversation",
          timeoutMs: 10_000,
        }),
      ).resolves.toMatchObject({
        runtimeId: "hers-project",
        status: "succeeded",
        sessionId: "hers-conversation-project",
        output: "Hers 普通对话已继续。",
      });

      const request = fetchMock.mock.calls[0]?.[1];
      const body = JSON.parse(String(request?.body)) as {
        conversationId?: string;
        input?: { text?: string; workspaceRef?: string };
        execution?: { permission?: string };
      };
      expect(body.conversationId).toBe("hers-existing-conversation");
      expect(body.input?.workspaceRef).toBeUndefined();
      expect(body.input?.text).toBe("你好，请确认连接。");
      expect(body.execution?.permission).toBe("read");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("probes a new Runtime draft without saving it to the registry", async () => {
    const { runtimes } = await loadModules();
    probePiRuntimeMock.mockResolvedValue({
      healthy: true,
      workspaceAccess: true,
      message: "Pi ready",
    });

    await expect(
      runtimes.probeAgentRuntimeDraft({
        id: "pi-draft",
        name: "Pi Draft",
        kind: "pi",
        location: "local",
        enabled: true,
        config: {
          executablePath: "pi",
          transport: "cli",
          timeoutMs: 10_000,
        },
      }),
    ).resolves.toMatchObject({
      runtimeId: "pi-draft",
      state: "healthy",
      message: "Pi ready",
    });

    expect(runtimes.listAgentRuntimes()).not.toContainEqual(
      expect.objectContaining({ id: "pi-draft" }),
    );
  });

  it("does not remove built-in runtimes and marks uninstalled adapters unsupported", async () => {
    const { runtimes } = await loadModules();

    expect(() => runtimes.removeAgentRuntime("hermes-local")).toThrow(
      /cannot be removed/i,
    );
    expect(await runtimes.probeAgentRuntime("hermes-local")).toMatchObject({
      state: "unsupported",
      capabilities: expect.objectContaining({ taskDispatch: false }),
    });
  });

  it("preserves structured Codex tool evidence for the native renderer", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-structured",
      name: "Codex structured",
      kind: "codex",
      location: "local",
      enabled: true,
      config: {
        executablePath: "codex",
        transport: "cli",
        workspace: testHome,
        timeoutMs: 10_000,
      },
    });
    startCodexProcessMock.mockImplementationOnce((_config, _task, onOutput) => {
      onOutput(
        [
          JSON.stringify({
            type: "thread.started",
            model: "gpt-5.2-codex",
            provider: "openai",
            context_window: 400_000,
          }),
          JSON.stringify({
            type: "item.started",
            item: {
              type: "command_execution",
              id: "codex-call-1",
              command: "node --version",
            },
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              id: "codex-call-1",
              output: "v20.17.0",
            },
          }),
          JSON.stringify({
            type: "turn.completed",
            usage: {
              input_tokens: 1_240,
              output_tokens: 320,
              total_tokens: 1_560,
              context_used: 8_400,
              context_window: 400_000,
            },
          }),
        ].join("\n") + "\n",
      );
      return Promise.resolve({
        inputArtifacts: [],
        cancel: vi.fn(),
        completion: Promise.resolve({
          output: "done",
          inputArtifacts: [],
          artifacts: [],
        }),
      });
    });

    const run = await runtimes.startAgentRuntimeTask("codex-structured", {
      prompt: "Check the Node version.",
      mode: "analysis",
      workspace: testHome,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completed = await runtimes.getAgentRuntimeRun(run.id);
    expect(completed).toMatchObject({
      model: {
        provider: "openai",
        id: "gpt-5.2-codex",
        contextWindowTokens: 400_000,
      },
      usage: {
        inputTokens: 1_240,
        outputTokens: 320,
        totalTokens: 1_560,
        contextUsedTokens: 8_400,
        contextWindowTokens: 400_000,
      },
    });
    expect(completed?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_call",
          tool: expect.objectContaining({
            name: "Terminal",
            kind: "terminal",
            callId: "codex-call-1",
            inputSummary: expect.stringContaining("node --version"),
          }),
        }),
        expect.objectContaining({
          type: "tool_result",
          tool: expect.objectContaining({
            name: "Terminal",
            callId: "codex-call-1",
            outputSummary: "v20.17.0",
          }),
          detail: "v20.17.0",
        }),
      ]),
    );
  });

  it("probes, runs, archives artifacts, and cancels a local Claude Code runtime", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "claude-local",
      name: "Claude Code local",
      kind: "claude-code",
      location: "local",
      enabled: true,
      config: {
        executablePath: "D:\\efunds\\nodejs\\claude.cmd",
        transport: "cli",
        workspace: testHome,
        timeoutMs: 10_000,
      },
    });
    probeClaudeCodeRuntimeMock.mockResolvedValue({
      healthy: true,
      workspaceAccess: true,
      message: "2.1.185 (Claude Code)",
    });
    await expect(
      runtimes.probeAgentRuntime("claude-local"),
    ).resolves.toMatchObject({
      state: "healthy",
      capabilities: expect.objectContaining({
        taskDispatch: true,
        cancellation: true,
        artifacts: true,
        workspaceAccess: true,
      }),
      message: "2.1.185 (Claude Code)",
    });

    let resolveCompletion!: (value: {
      output: string;
      worktreePath?: string;
      diffSummary?: string;
      artifacts: Array<{
        kind: "worktree" | "diff" | "final";
        label: string;
        path?: string;
        content?: string;
      }>;
    }) => void;
    const cancel = vi.fn();
    startClaudeCodeProcessMock.mockImplementationOnce(
      (_config, _task, onOutput) => {
        onOutput("Claude is working.\n");
        return Promise.resolve({
          worktreePath: join(
            testHome,
            "desktop",
            "worktrees",
            "claude-code",
            "task-1",
          ),
          cancel,
          completion: new Promise((resolve) => {
            resolveCompletion = resolve;
          }),
        });
      },
    );

    const run = await runtimes.startAgentRuntimeTask("claude-local", {
      prompt: "Implement safely.",
      mode: "implementation",
      workspace: testHome,
    });
    expect(run).toMatchObject({
      status: "running",
      output: "Claude is working.\n",
      worktreePath: expect.stringContaining("claude-code"),
    });
    expect(startClaudeCodeProcessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        executablePath: "D:\\efunds\\nodejs\\claude.cmd",
      }),
      expect.objectContaining({ mode: "implementation", workspace: testHome }),
      expect.any(Function),
    );

    resolveCompletion({
      output: "Claude task complete.",
      worktreePath: join(
        testHome,
        "desktop",
        "worktrees",
        "claude-code",
        "task-1",
      ),
      diffSummary: " docs/example.md | 1 +",
      artifacts: [
        {
          kind: "worktree",
          label: "Isolated worktree",
          path: join(testHome, "desktop", "worktrees", "claude-code", "task-1"),
        },
        {
          kind: "diff",
          label: "Git diff",
          content: "diff --git a/docs/example.md b/docs/example.md",
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completedClaude = await runtimes.getAgentRuntimeRun(run.id);
    expect(completedClaude).toMatchObject({
      status: "succeeded",
      output: "Claude task complete.",
      diffSummary: " docs/example.md | 1 +",
      artifacts: expect.arrayContaining([
        expect.objectContaining({
          kind: "worktree",
          label: "Isolated worktree",
        }),
        expect.objectContaining({ kind: "diff", label: "Git diff" }),
      ]),
    });
    expect(completedClaude?.artifacts || []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "final", label: "最终答复" }),
      ]),
    );

    const cancelSecond = vi.fn();
    startClaudeCodeProcessMock.mockImplementationOnce(() =>
      Promise.resolve({
        cancel: cancelSecond,
        completion: new Promise(() => undefined),
      }),
    );
    const cancellable = await runtimes.startAgentRuntimeTask("claude-local", {
      prompt: "Long analysis.",
      mode: "analysis",
      workspace: testHome,
    });
    await expect(runtimes.cancelAgentRuntimeTask(cancellable.id)).resolves.toBe(
      true,
    );
    expect(cancelSecond).toHaveBeenCalledTimes(1);
    await expect(
      runtimes.getAgentRuntimeRun(cancellable.id),
    ).resolves.toMatchObject({
      status: "cancelled",
      error: "Runtime task was cancelled.",
    });
  });

  it("preserves structured Claude tool evidence for the native renderer", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "claude-structured",
      name: "Claude Code structured",
      kind: "claude-code",
      location: "local",
      enabled: true,
      config: {
        executablePath: "claude",
        transport: "cli",
        workspace: testHome,
        timeoutMs: 10_000,
      },
    });
    startClaudeCodeProcessMock.mockImplementationOnce(
      (_config, _task, onOutput) => {
        onOutput(
          [
            JSON.stringify({
              type: "stream_event",
              event: {
                type: "content_block_start",
                index: 0,
                content_block: { type: "thinking", thinking: "" },
              },
            }),
            JSON.stringify({
              type: "stream_event",
              event: {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "thinking_delta",
                  thinking: "我先确认目标文件",
                },
              },
            }),
            JSON.stringify({
              type: "stream_event",
              event: {
                type: "content_block_delta",
                index: 0,
                delta: {
                  type: "thinking_delta",
                  thinking: "及验收约束。",
                },
              },
            }),
            JSON.stringify({
              type: "stream_event",
              event: { type: "content_block_stop", index: 0 },
            }),
            JSON.stringify({
              type: "stream_event",
              event: {
                type: "content_block_start",
                index: 1,
                content_block: {
                  type: "tool_use",
                  id: "toolu-read-1",
                  name: "Read",
                  input: {},
                },
              },
            }),
            JSON.stringify({
              type: "stream_event",
              event: {
                type: "content_block_delta",
                index: 1,
                delta: {
                  type: "input_json_delta",
                  partial_json: '{"file_path":"docs/README.md"}',
                },
              },
            }),
            JSON.stringify({
              type: "stream_event",
              event: { type: "content_block_stop", index: 1 },
            }),
            JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "toolu-read-1",
                    name: "Read",
                    input: { file_path: "docs/README.md" },
                  },
                ],
              },
            }),
            JSON.stringify({
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "toolu-read-1",
                    content: "# Agents One",
                  },
                ],
              },
            }),
            JSON.stringify({
              type: "result",
              model: "claude-sonnet-4-6",
              modelUsage: {
                "claude-sonnet-4-6": {
                  input_tokens: 640,
                  output_tokens: 96,
                  cache_read_input_tokens: 2_048,
                  cache_creation_input_tokens: 256,
                  total_tokens: 3_040,
                  context_window: 200_000,
                },
              },
            }),
          ].join("\n") + "\n",
        );
        return Promise.resolve({
          sessionId: "claude-structured-session",
          cancel: vi.fn(),
          completion: Promise.resolve({
            output: "done",
            sessionId: "claude-structured-session",
            inputArtifacts: [],
            artifacts: [],
          }),
        });
      },
    );

    const run = await runtimes.startAgentRuntimeTask("claude-structured", {
      prompt: "Read the project README.",
      mode: "analysis",
      workspace: testHome,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completed = await runtimes.getAgentRuntimeRun(run.id);
    expect(completed).toMatchObject({
      model: { id: "claude-sonnet-4-6" },
      usage: {
        inputTokens: 640,
        outputTokens: 96,
        totalTokens: 3_040,
        contextUsedTokens: 2_944,
        contextWindowTokens: 200_000,
      },
    });
    expect(completed?.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "progress",
          summary: "我先确认目标文件及验收约束。",
        }),
        expect.objectContaining({
          type: "tool_call",
          tool: expect.objectContaining({
            name: "Read",
            kind: "tool",
            callId: "toolu-read-1",
            inputSummary: expect.stringContaining("docs/README.md"),
          }),
        }),
        expect.objectContaining({
          type: "tool_result",
          tool: expect.objectContaining({
            callId: "toolu-read-1",
            outputSummary: "# Agents One",
          }),
          detail: "# Agents One",
        }),
      ]),
    );
    expect(
      completed?.events.filter(
        (event) =>
          event.type === "tool_call" && event.tool?.callId === "toolu-read-1",
      ),
    ).toHaveLength(1);
    expect(
      completed?.events.find(
        (event) =>
          event.type === "tool_result" && event.tool?.callId === "toolu-read-1",
      )?.tool?.name,
    ).toBe("Read");
  });

  it("times out a local Claude Code runtime and preserves captured output", async () => {
    vi.useFakeTimers();
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "claude-timeout",
        name: "Claude Code timeout",
        kind: "claude-code",
        location: "local",
        enabled: true,
        config: {
          executablePath: "D:\\efunds\\nodejs\\claude.cmd",
          transport: "cli",
          workspace: testHome,
          timeoutMs: 1_000,
        },
      });
      const cancel = vi.fn();
      startClaudeCodeProcessMock.mockImplementationOnce(
        (_config, _task, onOutput) => {
          onOutput("partial output\n");
          return Promise.resolve({
            worktreePath: join(
              testHome,
              "desktop",
              "worktrees",
              "claude-code",
              "task-timeout",
            ),
            cancel,
            completion: new Promise(() => undefined),
          });
        },
      );

      const run = await runtimes.startAgentRuntimeTask("claude-timeout", {
        prompt: "Slow implementation.",
        mode: "implementation",
        workspace: testHome,
        timeoutMs: 1_000,
      });
      vi.advanceTimersByTime(1_000);

      expect(cancel).toHaveBeenCalledTimes(1);
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "timed_out",
        output: "partial output\n",
        worktreePath: expect.stringContaining("claude-code"),
        error: "Runtime task exceeded 1000ms.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("probes and runs a local Pi Agent CLI runtime with a resumable session", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local",
      name: "Pi Agent",
      kind: "pi",
      location: "local",
      enabled: true,
      config: {
        executablePath: "pi",
        transport: "cli",
        workspace: testHome,
        timeoutMs: 10_000,
      },
    });
    probePiRuntimeMock.mockResolvedValue({
      healthy: true,
      workspaceAccess: true,
      message: "pi 0.80.10",
    });
    await expect(runtimes.probeAgentRuntime("pi-local")).resolves.toMatchObject(
      {
        state: "healthy",
        capabilities: expect.objectContaining({
          chat: true,
          taskDispatch: true,
          artifacts: true,
        }),
      },
    );

    const cancel = vi.fn();
    startPiProcessMock.mockImplementationOnce((_config, _task, onOutput) => {
      onOutput(
        [
          JSON.stringify({
            type: "message",
            message: {
              role: "assistant",
              model: "deepseek-v4-flash",
              provider: "custom",
              usage: {
                input: 510,
                output: 72,
                cacheRead: 2_048,
                cacheWrite: 0,
                totalTokens: 2_630,
                context_window: 131_072,
              },
              content: [
                {
                  type: "thinking",
                  thinking: "我先检查项目中的 PowerMem 配置。",
                },
                {
                  type: "toolCall",
                  name: "write",
                  arguments: {
                    content: "# draft",
                  },
                },
                {
                  type: "toolCall",
                  name: "write",
                  arguments: {
                    path: "D:/Agent Console/Agents-One/.sandbox/report.md",
                    content: "# report",
                  },
                },
                {
                  type: "toolCall",
                  name: "bash",
                  arguments: {
                    command: "npm test -- --run tests/pi-runtime.test.ts",
                  },
                },
              ],
            },
          }),
          JSON.stringify({
            type: "message",
            message: {
              role: "toolResult",
              toolName: "write",
              content: [
                {
                  type: "text",
                  text: "Successfully wrote 8 bytes to D:/Agent Console/Agents-One/.sandbox/report.md",
                },
              ],
            },
          }),
          JSON.stringify({ type: "message_end" }),
        ].join("\n") + "\n",
      );
      return Promise.resolve({
        sessionId: "pi-session-1",
        inputArtifacts: [],
        cancel,
        completion: Promise.resolve({
          output: '{"type":"message_end"}\n',
          sessionId: "pi-session-1",
          inputArtifacts: [],
          artifacts: [],
        }),
      });
    });
    const run = await runtimes.startAgentRuntimeTask("pi-local", {
      prompt: "Plan this safely.",
      mode: "analysis",
      workspace: testHome,
    });
    expect(run).toMatchObject({ status: "running", sessionId: "pi-session-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const completedPi = await runtimes.getAgentRuntimeRun(run.id);
    expect(completedPi).toMatchObject({
      status: "succeeded",
      sessionId: "pi-session-1",
      model: {
        provider: "custom",
        id: "deepseek-v4-flash",
        contextWindowTokens: 131_072,
      },
      usage: {
        inputTokens: 510,
        outputTokens: 72,
        totalTokens: 2_630,
        contextUsedTokens: 2_558,
        contextWindowTokens: 131_072,
      },
      events: expect.arrayContaining([
        expect.objectContaining({
          type: "progress",
          summary: "我先检查项目中的 PowerMem 配置。",
        }),
        expect.objectContaining({
          type: "tool_call",
          summary:
            "Pi Agent 调用 write：D:/Agent Console/Agents-One/.sandbox/report.md",
          tool: expect.objectContaining({
            name: "write",
            kind: "tool",
            inputSummary: expect.stringContaining(
              "D:/Agent Console/Agents-One/.sandbox/report.md",
            ),
          }),
        }),
        expect.objectContaining({
          type: "tool_call",
          summary:
            "Pi Agent 调用 bash：npm test -- --run tests/pi-runtime.test.ts",
        }),
        expect.objectContaining({
          type: "tool_result",
          summary:
            "Pi Agent write 结果：Successfully wrote 8 bytes to D:/Agent Console/Agents-One/.sandbox/report.md",
          tool: expect.objectContaining({
            name: "write",
            outputSummary: expect.stringContaining(
              "Successfully wrote 8 bytes",
            ),
          }),
          detail: expect.stringContaining("Successfully wrote 8 bytes"),
        }),
      ]),
    });
    expect(
      completedPi?.events?.some((event) =>
        /写入 \d+ 个字符/.test(event.summary),
      ),
    ).toBe(false);
    expect(completedPi?.artifacts || []).toHaveLength(0);
  });

});

describe("deriveAgentTransport", () => {
  it("returns the explicit agentTransport when set", () => {
    expect(
      deriveAgentTransport({
        location: "local",
        kind: "pi",
        config: { agentTransport: "local-cli", transport: "cli" },
      }),
    ).toBe("local-cli");
  });

  it("maps any remote runtime to gateway-v1", () => {
    expect(
      deriveAgentTransport({
        location: "remote",
        kind: "hermes",
        config: { endpoint: "https://x" },
      }),
    ).toBe("gateway-v1");
    expect(
      deriveAgentTransport({
        location: "remote",
        kind: "openclaw",
        config: { remoteGateway: { protocol: "agents-one-v1" } },
      }),
    ).toBe("gateway-v1");
  });

  it("maps local Hermes / http transport to local-api", () => {
    expect(
      deriveAgentTransport({
        location: "local",
        kind: "hermes",
        config: { transport: "cli" },
      }),
    ).toBe("local-api");
    expect(
      deriveAgentTransport({
        location: "local",
        kind: "codex",
        config: { transport: "http" },
      }),
    ).toBe("local-api");
  });

  it("maps local CLI runtimes to local-cli by default", () => {
    expect(
      deriveAgentTransport({
        location: "local",
        kind: "pi",
        config: { transport: "cli" },
      }),
    ).toBe("local-cli");
    expect(
      deriveAgentTransport({
        location: "local",
        kind: "claude-code",
        config: { transport: "cli" },
      }),
    ).toBe("local-cli");
  });
});
