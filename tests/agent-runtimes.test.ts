import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import http from "http";
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
const executePiRpcCommandMock = vi.hoisted(() => vi.fn());
const executePiRpcPromptMock = vi.hoisted(() => vi.fn());
const getPiConfiguredModelsMock = vi.hoisted(() => vi.fn());
const listCodexAppServerModelsMock = vi.hoisted(() => vi.fn());
const compactCodexAppServerThreadMock = vi.hoisted(() => vi.fn());
const listClaudeAgentSdkCommandsMock = vi.hoisted(() => vi.fn());
const listClaudeAgentSdkModelsMock = vi.hoisted(() => vi.fn());
const setClaudeAgentSdkModelMock = vi.hoisted(() => vi.fn());
const compactClaudeAgentSdkSessionMock = vi.hoisted(() => vi.fn());
const executeClaudeAgentSdkCommandMock = vi.hoisted(() => vi.fn());

function fakeOpenCodeAcpScript(): string {
  return [
    "const r=require('readline'),l=r.createInterface({input:process.stdin}),s=x=>process.stdout.write(JSON.stringify({...x,jsonrpc:'2.0'})+String.fromCharCode(10));",
    "l.on('line',x=>{const m=JSON.parse(x);if(m.method==='initialize')s({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'}}});else if(m.method==='session/new')s({id:m.id,result:{sessionId:'main'}});else if(m.method==='session/prompt'){s({method:'session/update',params:{sessionId:'main',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ok'}}}});s({id:m.id,result:{stopReason:'end_turn'}})}});",
  ].join("");
}

function fakeOpenCodeToolAcpScript(): string {
  return [
    "const r=require('readline'),l=r.createInterface({input:process.stdin}),s=x=>process.stdout.write(JSON.stringify({...x,jsonrpc:'2.0'})+String.fromCharCode(10));",
    "l.on('line',x=>{const m=JSON.parse(x);if(m.method==='initialize')s({id:m.id,result:{protocolVersion:1,agentInfo:{name:'OpenCode',version:'test'}}});else if(m.method==='session/new')s({id:m.id,result:{sessionId:'main-tool'}});else if(m.method==='session/prompt'){const rawInput={filePath:process.cwd()+'/README.md',limit:10};s({method:'session/update',params:{sessionId:'main-tool',update:{sessionUpdate:'tool_call',toolCallId:'call-main-1',title:'read',kind:'read',status:'pending',rawInput:{}}}});s({method:'session/update',params:{sessionId:'main-tool',update:{sessionUpdate:'tool_call_update',toolCallId:'call-main-1',title:'read',kind:'read',status:'in_progress',rawInput}}});s({method:'session/update',params:{sessionId:'main-tool',update:{sessionUpdate:'tool_call_update',toolCallId:'call-main-1',title:'README.md',status:'completed',content:[{type:'text',text:'Agents One test'}]}}});s({method:'session/update',params:{sessionId:'main-tool',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'读取完成。'}}}});s({id:m.id,result:{stopReason:'end_turn'}})}});",
  ].join("");
}

vi.mock("../src/main/hermes", () => ({
  sendMessage: sendMessageMock,
}));

vi.mock("../src/main/claude-code-runtime", () => ({
  probeClaudeCodeRuntime: probeClaudeCodeRuntimeMock,
  startClaudeCodeProcess: startClaudeCodeProcessMock,
}));

vi.mock("../src/main/claude-agent-sdk", () => ({
  listClaudeAgentSdkCommands: listClaudeAgentSdkCommandsMock,
  listClaudeAgentSdkModels: listClaudeAgentSdkModelsMock,
  setClaudeAgentSdkModel: setClaudeAgentSdkModelMock,
  compactClaudeAgentSdkSession: compactClaudeAgentSdkSessionMock,
  executeClaudeAgentSdkCommand: executeClaudeAgentSdkCommandMock,
}));

vi.mock("../src/main/codex-runtime", () => ({
  probeCodexRuntime: probeCodexRuntimeMock,
  startCodexProcess: startCodexProcessMock,
}));

vi.mock("../src/main/codex-app-server", () => ({
  listCodexAppServerModels: listCodexAppServerModelsMock,
  compactCodexAppServerThread: compactCodexAppServerThreadMock,
}));

vi.mock("../src/main/pi-runtime", () => ({
  probePiRuntime: probePiRuntimeMock,
  startPiProcess: startPiProcessMock,
  executePiRpcCommand: executePiRpcCommandMock,
  executePiRpcPrompt: executePiRpcPromptMock,
  getPiConfiguredModels: getPiConfiguredModelsMock,
}));

// Runtime registry tests do not launch Electron. Keep them runnable when a
// package-lock-only Electron upgrade intentionally leaves the local binary for
// the later clean-checkout verification stage.
vi.mock("electron", () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: {},
}));

let testHome: string;

async function loadModules(): Promise<{
  config: typeof import("../src/main/config");
  runtimes: typeof import("../src/main/agent-runtimes");
}> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  const workspaceAuthority = await import("../src/main/workspace-authority");
  workspaceAuthority.authorizeUserSelectedWorkspace(testHome);
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
    executePiRpcCommandMock.mockReset();
    executePiRpcPromptMock.mockReset();
    getPiConfiguredModelsMock.mockReset();
    getPiConfiguredModelsMock.mockReturnValue([]);
    listCodexAppServerModelsMock.mockReset();
    compactCodexAppServerThreadMock.mockReset();
    listClaudeAgentSdkCommandsMock.mockReset();
    listClaudeAgentSdkModelsMock.mockReset();
    setClaudeAgentSdkModelMock.mockReset();
    compactClaudeAgentSdkSessionMock.mockReset();
    executeClaudeAgentSdkCommandMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  // @lat: [[adapter-registry#Compatibility and quarantine]]
  it("adds adapter metadata to legacy runtimes and preserves unknown kinds", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();

    const legacy = runtimes.saveAgentRuntime({
      id: "legacy-codex",
      name: "Legacy Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { executablePath: "codex", transport: "cli" },
    });
    expect(legacy).toMatchObject({
      adapterId: "codex",
      vendorId: "openai",
      adapterVersion: "1.0.0",
    });

    const future = runtimes.saveAgentRuntime({
      id: "future-agent",
      name: "Future Agent",
      kind: "future.vendor-agent",
      location: "local",
      enabled: true,
      config: { executablePath: "future-agent", transport: "cli" },
    });
    expect(future).toMatchObject({
      id: "future-agent",
      kind: "future.vendor-agent",
    });
    expect(runtimes.listAgentRuntimes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "future-agent",
          kind: "future.vendor-agent",
        }),
      ]),
    );
    await expect(
      runtimes.probeAgentRuntime("future-agent"),
    ).resolves.toMatchObject({
      state: "unsupported",
      capabilities: expect.objectContaining({ taskDispatch: false }),
    });
    expect(JSON.stringify(config.readDesktopConfig())).toContain(
      "future.vendor-agent",
    );
  });

  it("keeps structured Gateway capability metadata after a registry reload", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();
    runtimes.saveAgentRuntime({
      id: "metadata-runtime",
      name: "Metadata Runtime",
      kind: "opencode",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://gateway.example/agents-one/v1",
        remoteGateway: { protocol: "agents-one-v1" },
        transport: "http",
      },
      capabilitySnapshot: {
        chat: true,
        taskDispatch: true,
        streaming: true,
        cancellation: true,
        tools: true,
        memory: false,
        orchestration: false,
        readOnlyPlanning: false,
        mailbox: false,
        securityEvents: false,
        artifacts: true,
        workspaceAccess: false,
        plugin: {
          id: "agents-one-plugin-sdk",
          version: "0.1.2",
          kind: "remote-gateway",
        },
        eventStream: {
          protocol: "agents-one-event-stream-v1",
          transport: "poll",
          reasoningSummaries: true,
          toolEvents: true,
        },
      },
    });
    const restored = runtimes
      .listAgentRuntimes()
      .find((runtime) => runtime.id === "metadata-runtime");
    expect(restored?.capabilitySnapshot).toMatchObject({
      plugin: { id: "agents-one-plugin-sdk", version: "0.1.2" },
      eventStream: {
        protocol: "agents-one-event-stream-v1",
        transport: "poll",
        reasoningSummaries: true,
      },
    });
  });

  it("quarantines explicit connection-profile conflicts instead of rewriting them", async () => {
    const { config, runtimes } = await loadModules();
    config.writeDesktopConfig({
      agentRuntimes: [
        {
          id: "conflicted-gateway",
          name: "Conflicted Gateway",
          kind: "opencode",
          location: "remote",
          connectionProfile: "self-hosted-gateway",
          enabled: true,
          config: {
            endpoint: "https://gateway.example.test/agents-one/v1",
            remoteGateway: { protocol: "agents-one-v1" },
            connect: {
              endpoint: "https://connect.example.test",
              runtimeId: "opencode-home",
            },
          },
        },
      ],
    });
    const loaded = runtimes
      .listAgentRuntimes()
      .find((runtime) => runtime.id === "conflicted-gateway");
    expect(loaded?.configurationIssue).toMatchObject({
      code: "connection-profile-conflict",
      explicitProfile: "self-hosted-gateway",
      inferredProfile: "managed-connect",
    });
    expect(() =>
      runtimes.saveAgentRuntime({
        ...loaded!,
        configurationIssue: loaded!.configurationIssue,
      }),
    ).toThrow(/配置冲突/);
    expect(
      (
        config.readDesktopConfig().agentRuntimes as Array<
          Record<string, unknown>
        >
      )[0].connectionProfile,
    ).toBe("self-hosted-gateway");
  });

  it("rejects public HTTP Remote Gateway endpoints before persistence", async () => {
    const { runtimes } = await loadModules();
    expect(() =>
      runtimes.saveAgentRuntime({
        id: "http-gateway",
        name: "HTTP Gateway",
        kind: "opencode",
        location: "remote",
        connectionProfile: "self-hosted-gateway",
        enabled: true,
        config: {
          endpoint: "http://gateway.example.test/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      }),
    ).toThrow(/HTTPS/);
  });

  it("probes OpenClaw through the public Gateway v1 contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          capabilities: {
            conversation: { stream: "sse" },
            tasks: { start: true, get: true, cancel: true },
            artifacts: { upload: true, download: true },
            plugin: { id: "openclaw-adapter", version: "test" },
          },
        }),
        { status: 200 },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "openclaw-gateway",
        name: "OpenClaw Gateway",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://openclaw.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "openclaw-gateway",
        "openclaw-gateway-token",
      );
      await expect(
        runtimes.probeAgentRuntime("openclaw-gateway"),
      ).resolves.toMatchObject({
        state: "healthy",
        capabilities: expect.objectContaining({
          artifacts: true,
          artifactUpload: true,
        }),
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://openclaw.example/agents-one/v1/capabilities",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer openclaw-gateway-token",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("probes remote OpenCode through Gateway v1 instead of the desktop ACP", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: "1.0",
          plugin: { id: "opencode-acp", version: "0.1.2" },
          capabilities: {
            conversation: { stream: "sse" },
            tasks: { start: true, get: true, cancel: true },
            artifacts: { upload: true, download: true },
            eventStream: { reasoningSummaries: true, toolEvents: true },
          },
        }),
        { status: 200 },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "opencode-remote",
        name: "Remote OpenCode",
        kind: "opencode",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://opencode.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "opencode-remote",
        "opencode-remote-token",
      );

      await expect(
        runtimes.probeAgentRuntime("opencode-remote"),
      ).resolves.toMatchObject({ state: "healthy" });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://opencode.example/agents-one/v1/capabilities",
        expect.anything(),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("dispatches an OpenClaw run through Gateway v1 with the desktop token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "openclaw-run-1",
          status: "succeeded",
          conversationId: "openclaw-session-1",
          output: "OpenClaw 已完成。",
          events: [
            {
              id: "openclaw-event-1",
              sequence: 1,
              type: "assistant.completed",
              data: { text: "OpenClaw 已完成。" },
            },
          ],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "openclaw-runner",
        name: "OpenClaw Runner",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        config: {
          endpoint: "https://openclaw.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "openclaw-runner",
        "openclaw-run-token",
      );

      await expect(
        runtimes.startAgentRuntimeTask("openclaw-runner", {
          prompt: "请执行 OpenClaw 测试。",
          mode: "analysis",
          conversation: true,
        }),
      ).resolves.toMatchObject({
        runtimeId: "openclaw-runner",
        status: "succeeded",
        sessionId: "openclaw-session-1",
        output: "OpenClaw 已完成。",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://openclaw.example/agents-one/v1/runs",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer openclaw-run-token",
          }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("routes a local OpenCode task through the main Runtime lifecycle", async () => {
    const { runtimes } = await loadModules();
    const saved = runtimes.saveAgentRuntime({
      id: "opencode-main",
      name: "OpenCode Main",
      kind: "opencode",
      location: "local",
      enabled: true,
      config: {
        executablePath: process.execPath,
        acpArgs: ["-e", fakeOpenCodeAcpScript()],
        agentTransport: "local-cli",
      },
    });

    const result = await runtimes.runAgentRuntimeTask(saved.id, {
      prompt: "请完成主流程测试。",
      mode: "analysis",
      conversation: true,
    });
    expect(result).toMatchObject({
      runtimeId: saved.id,
      status: "succeeded",
      sessionId: "main",
      output: "ok",
    });
  });

  it("persists named OpenCode ACP tools and removes the legacy Hermes marker", async () => {
    const { runtimes } = await loadModules();
    const saved = runtimes.saveAgentRuntime({
      id: "opencode-tool-main",
      name: "OpenCode Tool Main",
      kind: "opencode",
      location: "local",
      enabled: true,
      config: {
        executablePath: process.execPath,
        acpArgs: ["-e", fakeOpenCodeToolAcpScript()],
        agentTransport: "local-cli",
      },
    });

    const result = await runtimes.runAgentRuntimeTask(saved.id, {
      prompt: "请读取 README。",
      mode: "analysis",
      conversation: true,
    });
    const toolCalls = (result.events || []).filter(
      (event) => event.type === "tool_call",
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]).toMatchObject({
      summary: "正在调用工具：read",
      detail: '{"filePath":"README.md","limit":10}',
      tool: {
        name: "read",
        callId: "call-main-1",
        inputSummary: '{"filePath":"README.md","limit":10}',
      },
    });
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool_result",
          summary: "工具已完成：read",
          detail: "Agents One test",
        }),
      ]),
    );
    expect(result.events?.some((event) => /Hermes/.test(event.summary))).toBe(
      false,
    );
  });

  it("does not advertise the managed Hermes runtime when the local executable is absent", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();

    expect(runtimes.listAgentRuntimes()).not.toContainEqual(
      expect.objectContaining({ id: "hermes-local" }),
    );
  });

  // @lat: [[web-agent-runtime#Runtime boundary]]
  it("stores a Web Agent runtime without persisting browser credentials", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();
    const saved = runtimes.saveAgentRuntime({
      id: "doubao-web-test",
      name: "豆包网页版",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "doubao",
          profileId: "test/account",
          adapterVersion: "1.0.0",
          enabled: true,
        },
      },
    });
    expect(saved.config.webAgent).toEqual({
      provider: "doubao",
      profileId: "test-account",
      adapterVersion: "1.0.0",
      enabled: true,
    });
    expect(deriveAgentTransport(saved)).toBe("local-web");
    expect(JSON.stringify(config.readDesktopConfig())).not.toMatch(
      /cookie|token/i,
    );
    await expect(
      runtimes.startAgentRuntimeTask(saved.id, {
        prompt: "请分析文件",
        workspace: testHome,
      }),
    ).rejects.toThrow("不接受项目工作区");
    await expect(
      runtimes.startAgentRuntimeTask(saved.id, { prompt: "请直接回答" }),
    ).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("公开构建默认关闭网页 Provider"),
    });
  });

  it("preserves forward-compatible Web Agent config while honoring the adapter switch", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();
    const saved = runtimes.saveAgentRuntime({
      id: "doubao-web-disabled",
      name: "豆包网页版（停用）",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "doubao",
          profileId: "second",
          adapterVersion: "1.0.0",
          enabled: false,
        },
        futureAdapterFlag: "keep-me",
      } as typeof import("../src/shared/agent-runtimes").AgentRuntimeConfig & {
        futureAdapterFlag: string;
      },
    });
    expect(saved.config.webAgent?.enabled).toBe(false);
    expect(
      (saved.config as typeof saved.config & { futureAdapterFlag?: string })
        .futureAdapterFlag,
    ).toBe("keep-me");
    await expect(
      runtimes.startAgentRuntimeTask(saved.id, { prompt: "测试" }),
    ).resolves.toMatchObject({
      status: "failed",
      error: expect.stringContaining("适配器已被禁用"),
    });
  });

  it("accepts ChatGPT Web Agent settings and normalizes its isolated profile", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();
    const saved = runtimes.saveAgentRuntime({
      id: "chatgpt-web-test",
      name: "ChatGPT 网页版",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "chatgpt",
          profileId: "Work/Account",
          adapterVersion: "1.0.0",
          enabled: true,
        },
      },
    });
    expect(saved.config.webAgent).toEqual({
      provider: "chatgpt",
      profileId: "work-account",
      adapterVersion: "1.0.0",
      enabled: true,
    });
  });

  it("accepts Grok Web Agent settings and normalizes its isolated profile", async () => {
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();
    const saved = runtimes.saveAgentRuntime({
      id: "grok-web-test",
      name: "Grok 网页版",
      kind: "web-agent",
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        webAgent: {
          provider: "grok",
          profileId: "Grok/Account",
          adapterVersion: "1.0.0",
          enabled: true,
        },
      },
    });
    expect(saved.config.webAgent).toEqual({
      provider: "grok",
      profileId: "grok-account",
      adapterVersion: "1.0.0",
      enabled: true,
    });
  });

  it("maps Pi model, compact, and discovered commands to typed RPC controls", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-command",
      name: "Pi command test",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { executablePath: "pi", transport: "cli", workspace: testHome },
    });
    executePiRpcCommandMock.mockResolvedValueOnce({
      data: {
        commands: [
          {
            name: "new",
            description: "Runtime attempts to replace the conversation reset",
            source: "extension",
          },
          {
            name: "review",
            description: "Review the patch",
            source: "extension",
          },
          {
            name: "skill:verify",
            description: "Verify the result",
            source: "skill",
          },
        ],
      },
    });

    const catalog = await runtimes.getAgentRuntimeCommandCatalog(
      "pi-command",
      "pi-session",
    );
    expect(catalog.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "model", target: "runtime-control" }),
        expect.objectContaining({
          name: "new",
          target: "desktop",
          description: "新建当前 Runtime 对话",
        }),
        expect.objectContaining({ name: "compact", target: "runtime-control" }),
        expect.objectContaining({ name: "review", target: "runtime-native" }),
        expect.objectContaining({ name: "skill:verify", source: "skill" }),
      ]),
    );

    executePiRpcCommandMock
      .mockResolvedValueOnce({
        data: { models: [{ provider: "ark", id: "glm-5.2" }] },
      })
      .mockResolvedValueOnce({ data: { provider: "ark", id: "glm-5.2" } })
      .mockImplementationOnce(async (_config, request) => {
        request.onEvent?.({ type: "compaction_start" });
        request.onEvent?.({ type: "compaction_end" });
        return { data: { tokensBefore: 1000, estimatedTokensAfter: 240 } };
      });
    const progress = vi.fn();
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "cmd-model",
        runtimeId: "pi-command",
        sessionId: "pi-session",
        name: "model",
        args: "ark/glm-5.2",
      }),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: { model: "ark/glm-5.2" },
    });
    expect(executePiRpcCommandMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        type: "set_model",
        sessionId: "pi-session",
        params: { provider: "ark", modelId: "glm-5.2" },
      }),
    );
    const callsBeforeModelRetry = executePiRpcCommandMock.mock.calls.length;
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "cmd-model",
        runtimeId: "pi-command",
        sessionId: "pi-session",
        name: "model",
        args: "ark/glm-5.2",
      }),
    ).resolves.toMatchObject({ type: "handled" });
    // Same id is an IPC retry, not a second provider-side model switch.
    expect(executePiRpcCommandMock).toHaveBeenCalledTimes(
      callsBeforeModelRetry,
    );

    await expect(
      runtimes.executeAgentRuntimeCommand(
        {
          requestId: "cmd-compact",
          runtimeId: "pi-command",
          sessionId: "pi-session",
          name: "compact",
          args: "保留接口决策",
        },
        progress,
      ),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: {
        compacted: true,
        compaction: {
          trigger: "manual",
          tokensBefore: 1000,
          tokensAfter: 240,
        },
      },
      message: "Pi 上下文压缩完成：1000 → 240 tokens。",
    });
    expect(executePiRpcCommandMock).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({
        type: "compact",
        params: { customInstructions: "保留接口决策" },
        onEvent: expect.any(Function),
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "started",
        message: "Pi 已开始压缩当前会话上下文…",
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "progress",
        message: "Pi 正在整理并压缩会话上下文…",
      }),
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "progress",
        message: "Pi 已完成上下文压缩，正在同步结果…",
      }),
    );

    executePiRpcPromptMock.mockResolvedValue({ output: "复核已完成" });
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "cmd-review",
        runtimeId: "pi-command",
        sessionId: "pi-session",
        name: "review",
      }),
    ).resolves.toMatchObject({ type: "handled", message: /复核已完成/ });
    expect(executePiRpcPromptMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ message: "/review" }),
    );
  });

  it("opens Pi's locally configured model catalogue without a model-list RPC", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-local-catalog",
      name: "Pi local catalog test",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { executablePath: "pi", transport: "cli", workspace: testHome },
    });
    getPiConfiguredModelsMock.mockReturnValue([
      {
        provider: "ark",
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
      },
    ]);
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "pi-local-model-list",
        runtimeId: "pi-local-catalog",
        name: "model",
      }),
    ).resolves.toEqual({
      type: "needs-input",
      input: "model-picker",
      models: [
        {
          id: "ark/deepseek-v4-flash",
          provider: "ark",
          displayName: "DeepSeek V4 Flash",
        },
      ],
    });
    expect(executePiRpcCommandMock).not.toHaveBeenCalled();
  });

  it("uses Pi's session-scoped thinking controls and caches the verified levels", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-thinking",
      name: "Pi thinking test",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { executablePath: "pi", transport: "cli", workspace: testHome },
    });
    executePiRpcCommandMock.mockImplementation(
      async (_config, request: { type: string }) => {
        if (request.type === "get_available_thinking_levels") {
          return { data: { levels: ["off", "low", "high"] } };
        }
        if (request.type === "get_state") {
          return { data: { thinkingLevel: "low" } };
        }
        if (request.type === "set_thinking_level") return { data: {} };
        throw new Error(`Unexpected Pi RPC command: ${request.type}`);
      },
    );

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "pi-thinking-list",
        runtimeId: "pi-thinking",
        sessionId: "pi-thinking-session",
        name: "thinking",
      }),
    ).resolves.toEqual({
      type: "needs-input",
      input: "thinking-picker",
      thinkingLevels: ["off", "low", "high"],
      thinkingLevel: "low",
    });

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "pi-thinking-high",
        runtimeId: "pi-thinking",
        sessionId: "pi-thinking-session",
        name: "thinking",
        args: "high",
      }),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: { thinkingLevel: "high" },
    });
    expect(executePiRpcCommandMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        type: "set_thinking_level",
        params: { level: "high" },
      }),
    );
    expect(
      executePiRpcCommandMock.mock.calls.filter(
        ([, request]) => request.type === "get_available_thinking_levels",
      ),
    ).toHaveLength(1);
  });

  it("opens Pi thinking with the known current level when catalogue RPC is temporarily unavailable", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-thinking-fallback",
      name: "Pi thinking fallback",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { executablePath: "pi", transport: "cli", workspace: testHome },
    });
    executePiRpcCommandMock.mockImplementation(
      async (_config, request: { type: string }) => {
        if (request.type === "get_state") {
          return { data: { thinkingLevel: "high" } };
        }
        if (request.type === "get_available_thinking_levels") {
          throw new Error("Pi RPC transport temporarily unavailable");
        }
        throw new Error(`Unexpected Pi RPC command: ${request.type}`);
      },
    );

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "pi-thinking-fallback-list",
        runtimeId: "pi-thinking-fallback",
        sessionId: "pi-thinking-fallback-session",
        name: "thinking",
      }),
    ).resolves.toEqual({
      type: "needs-input",
      input: "thinking-picker",
      thinkingLevels: ["high"],
      thinkingLevel: "high",
    });
  });

  it("maps Claude Agent SDK model, compact, and native commands to typed controls", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "claude-cli-only",
      name: "Claude Code CLI",
      kind: "claude-code",
      location: "local",
      enabled: true,
      config: {
        executablePath: "claude",
        transport: "cli",
        workspace: testHome,
      },
    });
    listClaudeAgentSdkCommandsMock.mockResolvedValue([
      {
        name: "review",
        description: "Review the current change",
        argumentHint: "[scope]",
        aliases: ["check"],
      },
    ]);

    const catalog = await runtimes.getAgentRuntimeCommandCatalog(
      "claude-cli-only",
      "claude-session",
    );

    expect(catalog.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "model", target: "runtime-control" }),
        expect.objectContaining({ name: "compact", target: "runtime-control" }),
        expect.objectContaining({
          name: "review",
          aliases: ["check"],
          target: "runtime-native",
        }),
      ]),
    );
    listClaudeAgentSdkModelsMock.mockResolvedValue([
      {
        value: "sonnet",
        displayName: "Claude Sonnet",
        description: "Fast and capable",
        supportedEffortLevels: ["low", "high"],
      },
    ]);
    setClaudeAgentSdkModelMock.mockResolvedValue(undefined);
    compactClaudeAgentSdkSessionMock.mockResolvedValue({
      trigger: "manual",
      tokensBefore: 900,
      tokensAfter: 200,
    });
    executeClaudeAgentSdkCommandMock.mockResolvedValue(undefined);
    const progress = vi.fn();
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "claude-model",
        runtimeId: "claude-cli-only",
        sessionId: "claude-session",
        name: "model",
        args: "sonnet",
      }),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: { model: "sonnet" },
    });
    expect(setClaudeAgentSdkModelMock).toHaveBeenCalledWith(
      expect.any(Object),
      "claude-session",
      "sonnet",
    );
    await expect(
      runtimes.executeAgentRuntimeCommand(
        {
          requestId: "claude-compact",
          runtimeId: "claude-cli-only",
          sessionId: "claude-session",
          name: "compact",
          args: "保留接口决策",
        },
        progress,
      ),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: {
        compaction: {
          trigger: "manual",
          tokensBefore: 900,
          tokensAfter: 200,
        },
      },
    });
    expect(compactClaudeAgentSdkSessionMock).toHaveBeenCalledWith(
      expect.any(Object),
      "claude-session",
      "保留接口决策",
    );
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "started" }),
    );
    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "claude-review",
        runtimeId: "claude-cli-only",
        sessionId: "claude-session",
        name: "check",
        args: "diff",
      }),
    ).resolves.toMatchObject({ type: "handled" });
    expect(executeClaudeAgentSdkCommandMock).toHaveBeenCalledWith(
      expect.any(Object),
      "claude-session",
      "review",
      "diff",
    );
  });

  it("uses Codex App Server catalogues and only completes compact after native confirmation", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "codex-command",
      name: "Codex command test",
      kind: "codex",
      location: "local",
      enabled: true,
      config: {
        executablePath: "codex",
        transport: "cli",
        workspace: testHome,
      },
    });
    listCodexAppServerModelsMock.mockResolvedValue([
      { id: "gpt-5.3-codex", displayName: "GPT-5.3 Codex" },
    ]);

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "codex-model",
        runtimeId: "codex-command",
        sessionId: "thread-1",
        name: "model",
        args: "gpt-5.3-codex",
      }),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: { model: "gpt-5.3-codex" },
    });

    compactCodexAppServerThreadMock.mockImplementation(
      async (_config, _threadId, onProgress) => {
        onProgress?.("Codex 已开始压缩当前会话上下文…");
        onProgress?.("Codex 已完成上下文压缩，正在同步结果…");
      },
    );
    const compactProgress = vi.fn();
    await expect(
      runtimes.executeAgentRuntimeCommand(
        {
          requestId: "codex-compact",
          runtimeId: "codex-command",
          sessionId: "thread-1",
          name: "compact",
        },
        compactProgress,
      ),
    ).resolves.toEqual({
      type: "handled",
      message: "Codex 上下文压缩已完成。",
      statePatch: { compacted: true, compaction: { trigger: "manual" } },
    });
    expect(compactCodexAppServerThreadMock).toHaveBeenCalledWith(
      expect.objectContaining({ executablePath: "codex" }),
      "thread-1",
      expect.any(Function),
    );
    expect(compactProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "progress",
        message: "Codex 已完成上下文压缩，正在同步结果…",
      }),
    );

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "codex-compact-instructions",
        runtimeId: "codex-command",
        sessionId: "thread-1",
        name: "compact",
        args: "保留接口决策",
      }),
    ).resolves.toMatchObject({ type: "unsupported" });
  });

  it("defers Pi model changes while a task is running instead of mutating its live session", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "pi-busy-model",
      name: "Pi busy model test",
      kind: "pi",
      location: "local",
      enabled: true,
      config: { executablePath: "pi", transport: "cli", workspace: testHome },
    });
    startPiProcessMock.mockResolvedValue({
      sessionId: "pi-busy-session",
      inputArtifacts: [],
      cancel: vi.fn(),
      completion: new Promise<never>(() => undefined),
    });
    const run = await runtimes.startAgentRuntimeTask("pi-busy-model", {
      prompt: "Keep running.",
      mode: "analysis",
      workspace: testHome,
    });
    executePiRpcCommandMock.mockResolvedValueOnce({
      data: { models: [{ provider: "ark", id: "glm-5.2" }] },
    });

    await expect(
      runtimes.executeAgentRuntimeCommand({
        requestId: "busy-model",
        runtimeId: "pi-busy-model",
        sessionId: "pi-busy-session",
        runId: run.id,
        name: "model",
        args: "ark/glm-5.2",
      }),
    ).resolves.toMatchObject({
      type: "handled",
      statePatch: { model: "ark/glm-5.2" },
      message: /将在下一轮原生 Runtime 请求中生效/,
    });
    expect(
      executePiRpcCommandMock.mock.calls.map(([, request]) => request.type),
    ).toEqual(["get_available_models"]);
  });

  it("advertises the managed Hermes runtime when its executable is installed", async () => {
    const script = join(
      testHome,
      "hermes-agent",
      "venv",
      "Scripts",
      "hermes.exe",
    );
    mkdirSync(join(testHome, "hermes-agent", "venv", "Scripts"), {
      recursive: true,
    });
    writeFileSync(script, "test");
    const { config, runtimes } = await loadModules();
    config.setConnectionConfig();

    expect(runtimes.listAgentRuntimes()).toContainEqual(
      expect.objectContaining({ id: "hermes-local", managed: "builtin" }),
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

    expect(runtimes.getAgentRuntimeCredentialStatus("hermes-gateway")).toEqual({
      required: true,
      configured: false,
    });
    runtimes.setAgentRuntimeBearerToken("hermes-gateway", "gateway-token");
    expect(runtimes.getAgentRuntimeCredentialStatus("hermes-gateway")).toEqual({
      required: true,
      configured: true,
    });
    expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
      "gateway-token",
    );
  });

  it("persists a non-secret Connect device reference for layered diagnostics", async () => {
    const { runtimes } = await loadModules();
    runtimes.saveAgentRuntime({
      id: "opencode-paired",
      name: "OpenCode Paired",
      kind: "opencode",
      location: "remote",
      connectionProfile: "managed-connect",
      enabled: true,
      config: {
        endpoint: "https://connect.example.test",
        remoteGateway: { protocol: "agents-one-v1" },
        connect: {
          endpoint: "https://connect.example.test",
          runtimeId: "opencode-paired",
          deviceId: "device_123",
        },
        transport: "http",
      },
    });

    expect(
      runtimes
        .listAgentRuntimes()
        .find((runtime) => runtime.id === "opencode-paired")?.config.connect,
    ).toEqual({
      endpoint: "https://connect.example.test",
      runtimeId: "opencode-paired",
      deviceId: "device_123",
    });
    expect(JSON.stringify(runtimes.listAgentRuntimes())).not.toContain(
      "device-token",
    );
  });

  it("removes runtime filesystem paths before a run crosses the renderer boundary", async () => {
    const { runtimes } = await loadModules();
    const internal = {
      id: "run-path-private",
      runtimeId: "codex",
      status: "succeeded" as const,
      startedAt: 1,
      worktreeId: "worktree-opaque-run-path-private",
      worktreePath: join(testHome, "worktree"),
      artifacts: [
        {
          kind: "file" as const,
          label: "report.pdf",
          path: join(testHome, "report.pdf"),
        },
      ],
    };

    const rendererRun = runtimes.toRendererAgentRuntimeRun(internal);
    expect(rendererRun).toMatchObject({
      id: internal.id,
      worktreeId: "worktree-opaque-run-path-private",
      artifacts: [
        expect.objectContaining({
          id: "local-run-path-private-0",
          label: "report.pdf",
        }),
      ],
    });
    expect(JSON.stringify(rendererRun)).not.toContain(testHome);
    expect(rendererRun).not.toHaveProperty("worktreePath");
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
          sessionId: "hers-provider-session-1",
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
      ) as {
        mode?: string;
        conversationId?: string;
        execution?: { timeoutSeconds?: number };
      };
      expect(requestBody.mode).toBe("conversation");
      expect(requestBody.conversationId).toMatch(
        /^conversation_[a-f0-9-]{36}$/,
      );
      expect(requestBody.execution?.timeoutSeconds).toBe(1800);
      for (let turn = 2; turn <= 4; turn += 1) {
        fetchMock.mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              id: `remote-run-hers-${turn}`,
              status: "succeeded",
              conversationId: "hers-conversation-1",
              sessionId: "hers-provider-session-1",
              output: `answer-${turn}`,
            }),
            { status: 202, headers: { "content-type": "application/json" } },
          ),
        );
        const next = await runtimes.startAgentRuntimeTask("hers-family", {
          prompt: `follow up ${turn}`,
          mode: "analysis",
          conversation: true,
          sessionId: run.sessionId,
        });
        expect(next.sessionId).toBe("hers-conversation-1");
        const sent = JSON.parse(
          String(fetchMock.mock.calls[turn - 1]?.[1]?.body),
        );
        expect(sent.conversationId).toBe("hers-conversation-1");
      }
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("forwards full-access permission to a configured Agents One Gateway", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "remote-run-full-access",
          status: "succeeded",
          output: "已完成。",
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-full-access",
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
      runtimes.setAgentRuntimeBearerToken(
        "hers-full-access",
        "hers-gateway-token",
      );

      const run = await runtimes.startAgentRuntimeTask("hers-full-access", {
        prompt: "请清理 nul 文件。",
        mode: "full_access",
        fullAccessConfirmed: true,
      });

      expect(run).toMatchObject({
        runtimeId: "hers-full-access",
        status: "succeeded",
      });
      const requestBody = JSON.parse(
        String(fetchMock.mock.calls[0]?.[1]?.body),
      ) as { execution?: { permission?: string } };
      expect(requestBody.execution?.permission).toBe("write");
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps a long remote task timeout valid for Workspace Grant requests", async () => {
    const workspaceRequests: string[] = [];
    const workspaceServer = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const url = request.url || "";
        workspaceRequests.push(url);
        response.setHeader("Content-Type", "application/json");
        if (url.endsWith("/capabilities")) {
          response.end(
            JSON.stringify({
              capabilities: {
                outboundWorkspaceGateway: {
                  enabled: true,
                  operations: ["list", "read", "write", "move", "delete"],
                  maxGrantSeconds: 1800,
                },
              },
            }),
          );
          return;
        }
        if (url.endsWith("/workspace-grants")) {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            grantId?: string;
          };
          response.end(
            JSON.stringify({ accepted: true, grantId: body.grantId }),
          );
          return;
        }
        if (url.endsWith("/revoke")) {
          response.end(JSON.stringify({ accepted: true }));
          return;
        }
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "missing" }));
      });
    });
    await new Promise<void>((resolve) =>
      workspaceServer.listen(0, "127.0.0.1", resolve),
    );
    const address = workspaceServer.address();
    if (typeof address !== "object" || !address) {
      await new Promise<void>((resolve) =>
        workspaceServer.close(() => resolve()),
      );
      throw new Error("Workspace test server did not start.");
    }
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "remote-run-long-timeout",
          status: "succeeded",
          output: '已完成。\nMEDIA: "result.png"',
          events: [
            {
              id: "evt-workspace-completed",
              sequence: 1,
              type: "workspace.completed",
              data: { summary: "工作区操作已完成。" },
            },
          ],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-long-timeout",
        name: "Hers",
        kind: "hermes",
        location: "remote",
        enabled: true,
        config: {
          endpoint: `http://127.0.0.1:${address.port}/agents-one/v1`,
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
          // The task timeout is intentionally longer than the Workspace
          // Gateway client's 60-second request ceiling.
          timeoutMs: 300_000,
        },
      });
      runtimes.setAgentRuntimeBearerToken(
        "hers-long-timeout",
        "hers-gateway-token",
      );

      await expect(
        runtimes.startAgentRuntimeTask("hers-long-timeout", {
          prompt: "请清理项目中的 nul 文件。",
          mode: "full_access",
          fullAccessConfirmed: true,
          workspace: testHome,
        }),
      ).resolves.toMatchObject({
        status: "succeeded",
        output: '已完成。\nMEDIA: "result.png"',
      });
      expect(
        workspaceRequests.some((url) => url.endsWith("/capabilities")),
      ).toBe(true);
      expect(
        workspaceRequests.some((url) => url.endsWith("/workspace-grants")),
      ).toBe(true);
    } finally {
      fetchMock.mockRestore();
      await new Promise<void>((resolve) =>
        workspaceServer.close(() => resolve()),
      );
    }
  });

  it("recovers a legacy remote final answer from a malformed reasoning event", async () => {
    const answer =
      "老大，删除被拒了：目标文件存在，但当前 Workspace Gateway 不允许 delete。";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "remote-run-legacy-answer",
          status: "failed",
          error: "Workspace operation failed",
          events: [
            {
              id: "evt-tool-delete",
              sequence: 1,
              type: "tool.completed",
              data: {
                tool: {
                  kind: "workspace",
                  name: "delete",
                  outputSummary: "operation_not_allowed:delete",
                },
              },
            },
            {
              id: "evt-legacy-answer",
              sequence: 2,
              type: "reasoning.summary",
              data: { text: answer },
            },
          ],
        }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-legacy-answer",
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
      runtimes.setAgentRuntimeBearerToken(
        "hers-legacy-answer",
        "hers-gateway-token",
      );

      const run = await runtimes.startAgentRuntimeTask("hers-legacy-answer", {
        prompt: "请删除 nul。",
        mode: "full_access",
        fullAccessConfirmed: true,
      });

      expect(run).toMatchObject({
        status: "failed",
        output: answer,
        error: "Workspace operation failed",
      });
      expect(run.events).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "progress", summary: answer }),
        ]),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://family-relay.example/agents-one/v1/runs",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("accepts delivered media or artifacts without a workspace audit entry", async () => {
    const { runtimes } = await loadModules();

    expect(
      runtimes.hasRemoteDeliveredContent(
        'MEDIA:"C:\\Users\\tester\\Desktop\\test-chart.png"',
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

      const run = await runtimes.startAgentRuntimeTask("hers-artifact-output", {
        prompt: "生成图表。",
        mode: "analysis",
      });
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

  it("keeps a successful Gateway run successful when an artifact retry later succeeds", async () => {
    const bytes = Buffer.from("retried artifact bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "run-artifact-retry",
            status: "succeeded",
            output: "远程产物已生成。",
            artifacts: [
              {
                id: "artifact-retry",
                name: "retry.txt",
                mime: "text/plain",
                size: bytes.length,
                sha256,
              },
            ],
          }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "not ready" }), { status: 404 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "artifact-retry",
            name: "retry.txt",
            mime: "text/plain",
            size: bytes.length,
            sha256,
            contentBase64: bytes.toString("base64"),
          }),
          { status: 200 },
        ),
      );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-artifact-retry",
        name: "Hers artifact retry",
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
        "hers-artifact-retry",
        "artifact-retry-token",
      );
      const run = await runtimes.startAgentRuntimeTask("hers-artifact-retry", {
        prompt: "生成一个可下载文件。",
        mode: "analysis",
      });
      expect(run).toMatchObject({ status: "succeeded" });
      expect(run.artifacts?.[0]).toMatchObject({
        id: "artifact-retry",
        unavailableReason: expect.stringContaining("下载失败"),
      });

      const retried = await runtimes.retryAgentRuntimeArtifact(
        run.id,
        "artifact-retry",
      );
      expect(retried).toMatchObject({ status: "succeeded" });
      expect(retried?.artifacts?.[0]).toMatchObject({
        id: "artifact-retry",
        path: expect.any(String),
      });
      expect(retried?.artifacts?.[0]?.unavailableReason).toBeUndefined();
      const path = retried?.artifacts?.[0]?.path;
      expect(existsSync(path || "")).toBe(true);
      if (path) rmSync(path, { force: true });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps a Gateway run active until a cancellation is confirmed by polling", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-cancel", status: "running" }),
          {
            status: 202,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-cancel", status: "cancelling" }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-cancel", status: "cancelled" }),
          { status: 200 },
        ),
      );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-cancel-confirmation",
        name: "Hers cancellation confirmation",
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
        "hers-cancel-confirmation",
        "cancel-confirmation-token",
      );
      const run = await runtimes.startAgentRuntimeTask(
        "hers-cancel-confirmation",
        { prompt: "Start a cancellable task.", mode: "analysis" },
      );

      await expect(runtimes.cancelAgentRuntimeTask(run.id)).resolves.toBe(
        false,
      );
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "running",
        events: expect.arrayContaining([
          expect.objectContaining({
            summary: expect.stringContaining("正在确认远端运行"),
          }),
        ]),
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "cancelled",
      });
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "https://relay.example/agents-one/v1/runs",
        "https://relay.example/agents-one/v1/runs/remote-cancel/cancel",
        "https://relay.example/agents-one/v1/runs/remote-cancel",
      ]);
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not mark a Gateway timeout terminal until remote cancellation is confirmed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-timeout", status: "running" }),
          {
            status: 202,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-timeout", status: "cancelling" }),
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "remote-timeout", status: "cancelled" }),
          { status: 200 },
        ),
      );
    try {
      const { runtimes } = await loadModules();
      runtimes.saveAgentRuntime({
        id: "hers-timeout-confirmation",
        name: "Hers timeout confirmation",
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
        "hers-timeout-confirmation",
        "timeout-confirmation-token",
      );
      const run = await runtimes.startAgentRuntimeTask(
        "hers-timeout-confirmation",
        {
          prompt: "Start a task that will time out.",
          mode: "analysis",
          timeoutMs: 1_000,
        },
      );

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "running",
      });

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "timed_out",
        error: expect.stringContaining("远端终态已确认"),
      });
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
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

  it("rejects a task workspace that was not selected by the user or registered", async () => {
    const { runtimes } = await loadModules();
    const unapproved = mkdtempSync(join(tmpdir(), "agents-one-unapproved-"));
    try {
      runtimes.saveAgentRuntime({
        id: "codex-workspace-auth",
        name: "Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        config: { executablePath: "codex", transport: "cli" },
      });

      await expect(
        runtimes.startAgentRuntimeTask("codex-workspace-auth", {
          prompt: "读取项目。",
          mode: "analysis",
          workspace: unapproved,
        }),
      ).rejects.toThrow(/selected through the desktop file chooser/i);
      expect(startCodexProcessMock).not.toHaveBeenCalled();
    } finally {
      rmSync(unapproved, { recursive: true, force: true });
    }
  });

  it("resolves a Runtime workspace from a registered opaque project id", async () => {
    const { runtimes } = await loadModules();
    const projects = await import("../src/main/project-folders");
    const registered = projects.registerProjectFolder(testHome);
    runtimes.saveAgentRuntime({
      id: "codex-workspace-id",
      name: "Codex",
      kind: "codex",
      location: "local",
      enabled: true,
      config: { executablePath: "codex", transport: "cli" },
    });
    startCodexProcessMock.mockResolvedValue({
      cancel: vi.fn(async () => undefined),
      completion: Promise.resolve({ output: "done", artifacts: [] }),
    });

    await runtimes.startAgentRuntimeTask("codex-workspace-id", {
      prompt: "读取项目。",
      mode: "analysis",
      workspaceId: registered!.id,
    });

    expect(startCodexProcessMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        workspace:
          process.platform === "win32" ? testHome.toLowerCase() : testHome,
        workspaceId: registered!.id,
      }),
      expect.any(Function),
    );
  });

  it("bounds a remote workspace Grant lifetime by task, desktop, and Relay limits", async () => {
    const { runtimes } = await loadModules();
    const now = 1_700_000_000_000;

    expect(runtimes.workspaceGrantExpiresAt(10_000, 1_800, now)).toBe(
      now + 10_000,
    );
    expect(runtimes.workspaceGrantExpiresAt(3_600_000, 60, now)).toBe(
      now + 60_000,
    );
    expect(runtimes.workspaceGrantExpiresAt(3_600_000, undefined, now)).toBe(
      now + 3_600_000,
    );
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

  it("keeps the reserved Hermes id protected even when it is not installed", async () => {
    const { runtimes } = await loadModules();

    expect(() => runtimes.removeAgentRuntime("hermes-local")).toThrow(
      /cannot be removed/i,
    );
    expect(runtimes.listAgentRuntimes()).not.toContainEqual(
      expect.objectContaining({ id: "hermes-local" }),
    );
  });

  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
  it("emits one presentation-only event when a Runtime task succeeds", async () => {
    const { runtimes } = await loadModules();
    const avatar = "data:image/png;base64,YXZhdGFy";
    runtimes.saveAgentRuntime({
      id: "codex-completion-notice",
      name: "代码助手",
      avatar,
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
    runtimes.saveAgentRuntimeAppearance("codex-completion-notice", { avatar });
    startCodexProcessMock.mockResolvedValueOnce({
      inputArtifacts: [],
      cancel: vi.fn(),
      completion: Promise.resolve({
        output: "done",
        inputArtifacts: [],
        artifacts: [],
      }),
    });
    const finished = vi.fn();
    const dispose = runtimes.onAgentRuntimeRunFinished(finished);

    try {
      const run = await runtimes.startAgentRuntimeTask(
        "codex-completion-notice",
        {
          prompt: "  整理\n本周项目进展  ",
          profile: "work",
          mode: "analysis",
          workspace: testHome,
        },
      );

      await vi.waitFor(() => expect(finished).toHaveBeenCalledOnce());
      expect(finished).toHaveBeenCalledWith({
        runId: run.id,
        runtimeId: "codex-completion-notice",
        runtimeName: "代码助手",
        runtimeKind: "codex",
        runtimeAvatar: avatar,
        title: "整理 本周项目进展",
        profile: "work",
        status: "succeeded",
        completedAt: expect.any(Number),
      });
    } finally {
      dispose();
    }
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
        executablePath: "D:\\portable-node\\claude.cmd",
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
        executablePath: "D:\\portable-node\\claude.cmd",
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

    let resolveCancelledClaude: (result: {
      output: string;
      error?: string;
      artifacts: never[];
      inputArtifacts: never[];
    }) => void;
    const cancelledCompletion = new Promise<{
      output: string;
      error?: string;
      artifacts: never[];
      inputArtifacts: never[];
    }>((resolve) => {
      resolveCancelledClaude = resolve;
    });
    const cancelSecond = vi.fn(async () => {
      resolveCancelledClaude({
        output: "Claude stopped.",
        error: "Claude Code exited with code 1.",
        artifacts: [],
        inputArtifacts: [],
      });
      await cancelledCompletion;
    });
    startClaudeCodeProcessMock.mockImplementationOnce(() =>
      Promise.resolve({
        cancel: cancelSecond,
        completion: cancelledCompletion,
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
      output: "Claude stopped.",
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
          executablePath: "D:\\portable-node\\claude.cmd",
          transport: "cli",
          workspace: testHome,
          timeoutMs: 1_000,
        },
      });
      let resolveCompletion: (result: {
        output: string;
        error?: string;
        artifacts: never[];
        inputArtifacts: never[];
      }) => void;
      const completion = new Promise<{
        output: string;
        error?: string;
        artifacts: never[];
        inputArtifacts: never[];
      }>((resolve) => {
        resolveCompletion = resolve;
      });
      const cancel = vi.fn(async () => {
        await completion;
      });
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
            completion,
          });
        },
      );

      const run = await runtimes.startAgentRuntimeTask("claude-timeout", {
        prompt: "Slow implementation.",
        mode: "implementation",
        workspace: testHome,
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(cancel).toHaveBeenCalledTimes(1);
      await expect(runtimes.getAgentRuntimeRun(run.id)).resolves.toMatchObject({
        status: "running",
        output: "partial output\n",
      });
      resolveCompletion({
        output: "partial output\n",
        error: "Claude Code exited with code 1.",
        artifacts: [],
        inputArtifacts: [],
      });
      await vi.runAllTicks();
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
        `${JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "thinking", thinking: "用户" }],
          },
        })}\n`,
      );
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
                  type: "thinking",
                  thinking: "用户说这是 Agents One 联调测试。",
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
                    path: "C:/workspace/agents-one/.sandbox/report.md",
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
                  text: "Successfully wrote 8 bytes to C:/workspace/agents-one/.sandbox/report.md",
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
            "Pi Agent 调用 write：C:/workspace/agents-one/.sandbox/report.md",
          tool: expect.objectContaining({
            name: "write",
            kind: "tool",
            inputSummary: expect.stringContaining(
              "C:/workspace/agents-one/.sandbox/report.md",
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
            "Pi Agent write 结果：Successfully wrote 8 bytes to C:/workspace/agents-one/.sandbox/report.md",
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
    const userThinking = completedPi?.events?.filter(
      (event) => event.type === "progress" && event.summary.startsWith("用户"),
    );
    expect(userThinking).toEqual([
      expect.objectContaining({ summary: "用户说这是 Agents One 联调测试。" }),
    ]);
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
