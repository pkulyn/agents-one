import { afterEach, describe, expect, it, vi } from "vitest";
import {
  explainAgentsOneRemoteGatewayError,
  getAgentsOneRemoteGatewayArtifact,
  getAgentsOneRemoteGatewayRun,
  isAgentsOneRemoteGatewayRunNotFound,
  probeAgentsOneRemoteGateway,
  startAgentsOneRemoteGatewayRun,
  uploadAgentsOneRemoteGatewayArtifact,
} from "../src/main/agents-one-remote-gateway";

describe("Agents One Remote Gateway run contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves nested offline errors and explains how to recover the connector", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "agent_offline" } }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      startAgentsOneRemoteGatewayRun(
        { endpoint: "https://relay.example/agents-one/v1" },
        {
          mode: "conversation",
          text: "hello",
          timeoutSeconds: 60,
          permission: "read",
        },
        { bearerToken: "gateway-token" },
      ),
    ).rejects.toThrow("agent_offline");

    expect(
      explainAgentsOneRemoteGatewayError(
        "Gateway 启动运行失败（HTTP 503）：agent_offline",
      ),
    ).toContain("远程智能体当前离线");
  });

  it("treats a lost Relay run as terminal instead of a transient network outage", () => {
    const error = new Error(
      "Gateway 查询运行失败（HTTP 404）：run_not_found: Run not found.",
    );
    expect(isAgentsOneRemoteGatewayRunNotFound(error)).toBe(true);
    expect(explainAgentsOneRemoteGatewayError(error)).toContain(
      "Relay 重启、热更新",
    );
  });

  it("recognizes an SDK-backed Gateway without changing its runtime contract", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          plugin: {
            id: "agents-one-plugin-sdk",
            version: "0.1.0",
            kind: "remote-gateway",
          },
          capabilities: {
            conversation: { stream: "sse" },
            tasks: { start: true, cancel: true },
            eventStream: {
              protocol: "agents-one-event-stream-v1",
              transport: "poll",
              reasoningSummaries: true,
              toolEvents: true,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const probe = await probeAgentsOneRemoteGateway(
      { endpoint: "https://relay.example/agents-one/v1" },
      { bearerToken: "gateway-token" },
    );

    expect(probe.healthy).toBe(true);
    expect(probe.message).toBe(
      "统一 Gateway v1 已连接。已识别 Agents One 插件 v0.1.0。",
    );
    expect(probe.capabilities.plugin).toEqual({
      id: "agents-one-plugin-sdk",
      version: "0.1.0",
      kind: "remote-gateway",
    });
    expect(probe.capabilities.eventStream).toMatchObject({
      transport: "poll",
      reasoningSummaries: true,
      toolEvents: true,
    });
  });

  it("recognizes transition plugin metadata and flat workspace capabilities", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          pluginInfo: {
            id: "agents-one-plugin-sdk",
            version: "0.1.0",
            kind: "remote-gateway",
          },
          capabilities: {
            conversation: { stream: "sse" },
            tasks: { start: true, cancel: true },
            outboundWorkspaceGateway: true,
            operations: ["list", "read", "write", "move", "delete"],
            maxOperationBytes: 262144,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const probe = await probeAgentsOneRemoteGateway(
      { endpoint: "https://relay.example/agents-one/v1" },
      { bearerToken: "gateway-token" },
    );

    expect(probe.healthy).toBe(true);
    expect(probe.capabilities.plugin).toEqual({
      id: "agents-one-plugin-sdk",
      version: "0.1.0",
      kind: "remote-gateway",
    });
    expect(probe.capabilities.workspaceAccess).toBe(true);
  });

  it("recognizes SDK metadata and run usage nested in response envelopes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          capabilities: {
            plugin: { version: "0.1.0", kind: "remote-gateway" },
            conversation: { stream: "sse" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            id: "run-sdk-envelope",
            status: "succeeded",
            output: {
              text: "已完成 SDK 元数据联调。",
              provider: "ark",
              modelName: "glm-5.2",
              context_window: 1_000_000,
              input_tokens: 256,
              output_tokens: 32,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const probe = await probeAgentsOneRemoteGateway(
      { endpoint: "https://relay.example/agents-one/v1" },
      { bearerToken: "gateway-token" },
    );
    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-sdk-envelope",
      { bearerToken: "gateway-token" },
    );

    expect(probe.message).toBe(
      "统一 Gateway v1 已连接。已识别 Agents One 插件 v0.1.0。",
    );
    expect(probe.capabilities.plugin).toMatchObject({
      id: "agents-one-plugin",
      version: "0.1.0",
      kind: "remote-gateway",
    });
    expect(run.model).toEqual({
      provider: "ark",
      id: "glm-5.2",
      contextWindowTokens: 1_000_000,
    });
    expect(run.usage).toMatchObject({
      inputTokens: 256,
      outputTokens: 32,
      contextWindowTokens: 1_000_000,
    });
  });

  it("keeps a continued workspace run in task mode with its conversation id", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-workspace-continuation",
          status: "running",
          conversationId: "conversation-hers",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    await startAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      {
        runtimeId: "hermes-home2",
        mode: "conversation",
        conversationId: "conversation-hers",
        text: "继续编辑项目文件。",
        workspaceRef: "desktop-gateway:workspace-grant-current",
        timeoutSeconds: 600,
        permission: "write",
      },
      { bearerToken: "gateway-token" },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      runtimeId?: string;
      mode?: string;
      conversationId?: string;
      input?: { workspaceRef?: string };
    };
    expect(body.mode).toBe("task");
    expect(body.runtimeId).toBe("hermes-home2");
    expect(body.conversationId).toBe("conversation-hers");
    expect(body.input?.workspaceRef).toBe(
      "desktop-gateway:workspace-grant-current",
    );
  });

  it("keeps an ordinary continuation in conversation mode", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-conversation",
          status: "running",
          conversationId: "conversation-hers",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    await startAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      {
        mode: "conversation",
        conversationId: "conversation-hers",
        text: "继续普通对话。",
        timeoutSeconds: 600,
        permission: "read",
      },
      { bearerToken: "gateway-token" },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      mode?: string;
      conversationId?: string;
      input?: { workspaceRef?: string };
    };
    expect(body.mode).toBe("conversation");
    expect(body.conversationId).toBe("conversation-hers");
    expect(body.input?.workspaceRef).toBeUndefined();
  });

  it("sends uploaded artifact ids inside the v1 run input", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ id: "run-with-artifact", status: "running" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );

    await startAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      {
        mode: "task",
        text: "请阅读附件。",
        artifactIds: ["artifact_1"],
        timeoutSeconds: 60,
        permission: "read",
      },
      { bearerToken: "gateway-token" },
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      input?: { artifactIds?: string[]; artifact_ids?: string[] };
    };
    expect(body.input?.artifactIds).toEqual(["artifact_1"]);
    expect(body.input?.artifact_ids).toEqual(["artifact_1"]);
  });

  it("uploads an input artifact through the v1 Artifact API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "artifact_1",
          name: "brief.txt",
          mime: "text/plain",
          size: 5,
          sha256: "a".repeat(64),
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      uploadAgentsOneRemoteGatewayArtifact(
        { endpoint: "https://relay.example/agents-one/v1" },
        {
          name: "brief.txt",
          mime: "text/plain",
          bytes: Buffer.from("hello"),
          sha256: "a".repeat(64),
        },
        { bearerToken: "gateway-token" },
      ),
    ).resolves.toMatchObject({ id: "artifact_1", size: 5 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://relay.example/agents-one/v1/artifacts",
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      contentBase64?: string;
    };
    expect(body.contentBase64).toBe(Buffer.from("hello").toString("base64"));
  });

  it("downloads and verifies a remote artifact without exposing a remote path", async () => {
    const bytes = Buffer.from("chart bytes");
    const sha256 = (await import("node:crypto"))
      .createHash("sha256")
      .update(bytes)
      .digest("hex");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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

    await expect(
      getAgentsOneRemoteGatewayArtifact(
        { endpoint: "https://relay.example/agents-one/v1" },
        "artifact-chart",
        { bearerToken: "gateway-token" },
      ),
    ).resolves.toMatchObject({
      id: "artifact-chart",
      name: "test-chart.png",
      mime: "image/png",
      size: bytes.length,
      bytes,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://relay.example/agents-one/v1/artifacts/artifact-chart",
    );
  });

  it("parses an event stream snapshot and runtime metadata from a Gateway run", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-event-stream",
          status: "running",
          conversationId: "conversation-hers",
          model: {
            provider: "ark",
            id: "glm-5.2",
            contextWindowTokens: 1_000_000,
          },
          usage: { inputTokens: 120, outputTokens: 42 },
          events: [
            {
              id: "evt-reasoning-1",
              sequence: 1,
              type: "reasoning.summary",
              createdAt: "2026-07-31T09:00:00.000Z",
              data: { summary: "正在确认项目文件结构。" },
            },
            {
              id: "evt-mcp-1",
              sequence: 2,
              type: "tool.started",
              createdAt: "2026-07-31T09:00:01.000Z",
              data: {
                tool: {
                  callId: "call-memory-1",
                  kind: "mcp",
                  name: "powermem_recall",
                  inputSummary: "检索项目记忆",
                },
              },
            },
            {
              id: "evt-workspace-1",
              sequence: 3,
              type: "workspace.completed",
              createdAt: "2026-07-31T09:00:02.000Z",
              data: {
                operation: "write",
                path: "notes/plan.md",
                summary: "已写入计划文档。",
              },
            },
            {
              id: "evt-chart-1",
              sequence: 4,
              type: "artifact.created",
              data: {
                artifact: {
                  id: "artifact-chart",
                  name: "chart_quarterly_revenue.png",
                  mime: "image/png",
                  size: 128,
                  sha256: "a".repeat(64),
                },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-event-stream",
      { bearerToken: "gateway-token" },
    );

    expect(run.model).toEqual({
      provider: "ark",
      id: "glm-5.2",
      contextWindowTokens: 1_000_000,
    });
    expect(run.usage).toEqual({ inputTokens: 120, outputTokens: 42 });
    expect(run.events?.map((event) => event.type)).toEqual([
      "reasoning.summary",
      "tool.started",
      "workspace.completed",
      "artifact.created",
    ]);
    expect(run.events?.[1]?.data.tool).toMatchObject({
      kind: "mcp",
      name: "powermem_recall",
    });
    expect(run.artifacts).toEqual([
      expect.objectContaining({
        id: "artifact-chart",
        label: "chart_quarterly_revenue.png",
        mime: "image/png",
        size: 128,
        sha256: "a".repeat(64),
      }),
    ]);
  });

  it("keeps the final-answer path for a legacy Gateway without process events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-legacy-gateway",
          status: "succeeded",
          conversationId: "conversation-legacy",
          output: "这是旧 Gateway 的最终答复。",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-legacy-gateway",
      { bearerToken: "gateway-token" },
    );

    expect(run.status).toBe("succeeded");
    expect(run.output).toBe("这是旧 Gateway 的最终答复。");
    expect(run.events).toBeUndefined();
  });

  it("recovers an Artifact API object described in legacy final text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-text-artifact",
          status: "succeeded",
          output:
            "artifact.created id: art-chart-1 name: quarterly_revenue_chart.png mime: image/png size: 32128 sha256: " +
            "a".repeat(64),
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-text-artifact",
      { bearerToken: "gateway-token" },
    );

    expect(run.artifacts).toEqual([
      expect.objectContaining({
        id: "art-chart-1",
        label: "quarterly_revenue_chart.png",
        mime: "image/png",
        size: 32128,
      }),
    ]);
  });

  it("derives a terminal answer and metadata from durable Event Stream events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-terminal-event-stream",
          status: "succeeded",
          conversationId: "conversation-hers",
          error: "failed",
          events: [
            {
              id: "evt-final-answer",
              sequence: 5,
              type: "assistant.completed",
              createdAt: "2026-08-02T09:00:00.000Z",
              data: {
                text: "已完成事件流联调。",
                model: { provider: "ark", id: "glm-5.2" },
                usage: { inputTokens: 39849, outputTokens: 128 },
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-terminal-event-stream",
      { bearerToken: "gateway-token" },
    );

    expect(run.output).toBe("已完成事件流联调。");
    expect(run.error).toBeUndefined();
    expect(run.model).toEqual({ provider: "ark", id: "glm-5.2" });
    expect(run.usage).toEqual({ inputTokens: 39849, outputTokens: 128 });
  });

  it("preserves a meaningful failure reason from terminal events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-failed-with-event-reason",
          status: "failed",
          error: "failed",
          events: [
            {
              id: "evt-run-failed",
              sequence: 1,
              type: "run.failed",
              createdAt: "2026-08-02T09:10:00.000Z",
              data: {
                message: "Workspace Grant 已过期，请重新授权后再试。",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-failed-with-event-reason",
      { bearerToken: "gateway-token" },
    );

    expect(run.status).toBe("failed");
    expect(run.error).toBe("Workspace Grant 已过期，请重新授权后再试。");
    expect(run.events?.[0]?.data.summary).toBe(
      "Workspace Grant 已过期，请重新授权后再试。",
    );
  });

  it("accepts nested run envelopes and does not lose failure details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          run: {
            id: "run-nested-failure",
            status: "failed",
            error: "failed",
          },
          events: [
            {
              id: "evt-nested-failed",
              sequence: 1,
              type: "run.failed",
              createdAt: "2026-08-02T09:11:00.000Z",
              data: {
                error: "远程智能体拒绝执行当前请求。",
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-nested-failure",
      { bearerToken: "gateway-token" },
    );

    expect(run.status).toBe("failed");
    expect(run.error).toBe("远程智能体拒绝执行当前请求。");
    expect(run.events?.[0]?.data.summary).toBe("远程智能体拒绝执行当前请求。");
  });

  it("accepts a run record wrapped directly in data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "run-data-failure",
            status: "failed",
            error: "failed",
            events: [
              {
                id: "evt-data-failed",
                sequence: 1,
                type: "run.failed",
                createdAt: "2026-08-02T09:12:00.000Z",
                data: { detail: "Hers 连接已断开，请稍后重试。" },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-data-failure",
      { bearerToken: "gateway-token" },
    );

    expect(run.status).toBe("failed");
    expect(run.error).toBe("Hers 连接已断开，请稍后重试。");
    expect(run.events?.[0]?.data.summary).toBe("Hers 连接已断开，请稍后重试。");
  });

  it("prefers a detailed offline code when a failed event also has a generic error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "run-agent-offline",
          status: "failed",
          error: "failed",
          events: [
            {
              id: "evt-agent-offline",
              sequence: 1,
              type: "run.failed",
              createdAt: "2026-08-02T09:13:00.000Z",
              data: {
                error: "failed",
                code: "agent_offline",
                detail: "目标 Connector 未注册。",
              },
            },
            {
              id: "evt-terminal-failed",
              sequence: 2,
              type: "run.failed",
              createdAt: "2026-08-02T09:13:01.000Z",
              data: { summary: "远程任务结束：failed。" },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const run = await getAgentsOneRemoteGatewayRun(
      { endpoint: "https://relay.example/agents-one/v1" },
      "run-agent-offline",
      { bearerToken: "gateway-token" },
    );

    expect(run.error).toContain("agent_offline");
    expect(run.error).toContain("Connector");
    expect(run.events?.[0]?.data.code).toBe("agent_offline");
  });
});
