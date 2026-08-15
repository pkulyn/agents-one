import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";
import AgentRuntimesPane from "./AgentRuntimesPane";

const capabilities = {
  chat: true,
  taskDispatch: true,
  streaming: true,
  cancellation: true,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
};

function installHermesAPI(
  runtimes: AgentRuntimeDefinition[],
  detected: Record<string, string | null> = {},
): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  saveAgentRuntime: ReturnType<typeof vi.fn>;
  saveAgentRuntimeAppearance: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
  probeAgentRuntimeDraft: ReturnType<typeof vi.fn>;
  setAgentRuntimeBearerToken: ReturnType<typeof vi.fn>;
  detectLocalCliPaths: ReturnType<typeof vi.fn>;
} {
  let current = [...runtimes];
  const listAgentRuntimes = vi.fn(async () => current);
  const saveAgentRuntime = vi.fn(async (draft) => {
    const saved = { ...draft, managed: "user" as const };
    current = [...current.filter((runtime) => runtime.id !== saved.id), saved];
    return saved;
  });
  const saveAgentRuntimeAppearance = vi.fn(async (id, appearance) => {
    const runtime = current.find((item) => item.id === id);
    if (!runtime) throw new Error("Runtime was not found.");
    const saved = { ...runtime, ...appearance };
    current = current.map((item) => (item.id === id ? saved : item));
    return saved;
  });
  const probe: AgentRuntimeProbe = {
    runtimeId: "hermes-gateway",
    state: "healthy",
    capabilities,
    checkedAt: Date.now(),
    message: "Gateway ready",
  };
  const probeAgentRuntime = vi.fn(async () => probe);
  const probeAgentRuntimeDraft = vi.fn(async () => probe);
  const setAgentRuntimeBearerToken = vi.fn(async () => ({ configured: true as const }));
  const detectLocalCliPaths = vi.fn(async () => detected);

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      listAgentRuntimes,
      saveAgentRuntime,
      saveAgentRuntimeAppearance,
      removeAgentRuntime: vi.fn(async () => true),
      getAgentRuntimeCredentialStatus: vi.fn(async () => ({
        required: true,
        configured: false,
      })),
      setAgentRuntimeBearerToken,
      probeAgentRuntime,
      probeAgentRuntimeDraft,
      detectLocalCliPaths,
    },
  });

  return {
    listAgentRuntimes,
    saveAgentRuntime,
    saveAgentRuntimeAppearance,
    probeAgentRuntime,
    probeAgentRuntimeDraft,
    setAgentRuntimeBearerToken,
    detectLocalCliPaths,
  };
}

describe("AgentRuntimesPane", () => {
  it("loads runtimes and probes the selected runtime", async () => {
    const api = installHermesAPI([
      {
        id: "hermes-default",
        name: "Current Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "builtin",
        config: { transport: "http", timeoutMs: 10000 },
      },
      {
        id: "hermes-gateway",
        name: "Hermes Gateway",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/agents-one/v1",
          transport: "http",
          remoteGateway: { protocol: "agents-one-v1" },
          timeoutMs: 10000,
        },
      },
    ]);

    render(<AgentRuntimesPane />);

    expect((await screen.findAllByText("Current Hermes")).length).toBeGreaterThan(
      0,
    );
    await waitFor(() => {
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("hermes-default");
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("hermes-gateway");
    });
    expect(screen.queryByText("未检测")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Hermes Gateway")[0]);
    fireEvent.click(screen.getByRole("button", { name: "检测" }));

    await waitFor(() => {
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("hermes-gateway");
    });
    expect(
      (await screen.findAllByText("Gateway ready")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("健康").length).toBeGreaterThan(0);
  });

  it("saves a new remote Hermes Gateway runtime without embedding credentials", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(
      screen.getByPlaceholderText("https://gateway.example.com/agents-one/v1"),
      { target: { value: "https://example.test/agents-one/v1" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(api.probeAgentRuntimeDraft).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.saveAgentRuntime).toHaveBeenCalled();
    });
    expect(api.saveAgentRuntime.mock.calls[0][0]).toMatchObject({
      id: "hermes-gateway",
      name: "Hermes",
      kind: "hermes",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://example.test/agents-one/v1",
        transport: "http",
        remoteGateway: { protocol: "agents-one-v1" },
        timeoutMs: 10000,
      },
    });
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toMatch(
      /apiKey|token|secret/i,
    );
  });

  it("configures a custom Hermes Gateway and keeps the token outside the runtime definition", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "hermes" },
    });
    fireEvent.change(screen.getByLabelText("Gateway 地址"), {
      target: { value: "https://hermes.example/agents-one/v1" },
    });
    fireEvent.change(screen.getByLabelText("Gateway Token"), {
      target: { value: "gateway-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));

    await waitFor(() =>
      expect(api.probeAgentRuntimeDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "hermes-gateway",
          kind: "hermes",
          config: expect.objectContaining({
            endpoint: "https://hermes.example/agents-one/v1",
            remoteGateway: { protocol: "agents-one-v1" },
          }),
        }),
        "gateway-token",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "hermes-gateway",
        "gateway-token",
      ),
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toContain(
      "gateway-token",
    );
  });

  it("offers only remote Gateway and local modes for a custom Hermes runtime", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "hermes" },
    });

    expect(screen.getByRole("button", { name: "远程" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "本地" })).toBeInTheDocument();
    // SSH 隧道与兼容模式均已移除（远程统一走 Gateway v1）
    expect(
      screen.queryByRole("button", { name: "SSH 隧道" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "兼容模式" }),
    ).not.toBeInTheDocument();
  });

  it("offers Pi Agent CLI as a configurable local runtime template", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "pi" } });
    expect(screen.getByLabelText("名称")).toHaveValue("Pi Agent");
    expect(screen.getByLabelText("智能体 ID")).toHaveValue("pi-agent");
    expect(screen.getByLabelText("可执行文件")).toHaveValue("pi");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "我的 Pi" } });
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(api.probeAgentRuntimeDraft).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.saveAgentRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "pi-agent",
          name: "我的 Pi",
          kind: "pi",
          location: "local",
          config: expect.objectContaining({ executablePath: "pi", transport: "cli" }),
        }),
      );
    });
  });

  it("auto-fills a PATH-detected local CLI path and derives location/transport for new agents", async () => {
    const api = installHermesAPI([], { pi: "C:\\tools\\pi.cmd" });
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), { target: { value: "pi" } });

    // PATH detection (plan 1.5) prefills the executable path.
    expect(screen.getByLabelText("可执行文件")).toHaveValue("C:\\tools\\pi.cmd");
    expect(
      screen.getByText("已在 PATH 检测到：C:\\tools\\pi.cmd"),
    ).toBeInTheDocument();
    // Location and transport are derived from the template for new agents.
    expect(screen.getByRole("button", { name: "本地" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "远程" })).toBeDisabled();
    expect(screen.getByLabelText("连接方式")).toBeDisabled();
    expect(api.detectLocalCliPaths).toHaveBeenCalled();
  });

  it("saves a Gateway token through IPC without adding it to runtime config", async () => {
    const api = installHermesAPI([
      {
        id: "hermes-gateway",
        name: "Hermes Gateway",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/agents-one/v1",
          transport: "http",
          remoteGateway: { protocol: "agents-one-v1" },
          timeoutMs: 10000,
        },
      },
    ]);
    render(<AgentRuntimesPane />);

    await screen.findByRole("button", { name: /Hermes Gateway/i });
    fireEvent.change(screen.getByLabelText("Gateway Token"), {
      target: { value: "gateway-test-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Gateway Token" }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "hermes-gateway",
        "gateway-test-token",
      ),
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls)).not.toContain(
      "gateway-test-token",
    );
  });

  it("saves built-in runtime display information without changing its connection config", async () => {
    const api = installHermesAPI([
      {
        id: "hermes-default",
        name: "Remote Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "builtin",
        config: { transport: "http", timeoutMs: 10000 },
      },
    ]);
    render(<AgentRuntimesPane />);

    const name = await screen.findByLabelText("名称");
    fireEvent.change(name, { target: { value: "项目协调者" } });
    fireEvent.click(screen.getByRole("button", { name: "#3498DB" }));
    fireEvent.click(screen.getByRole("button", { name: "保存显示信息" }));

    await waitFor(() => {
      expect(api.saveAgentRuntimeAppearance).toHaveBeenCalledWith(
        "hermes-default",
        expect.objectContaining({
          name: "项目协调者",
          color: "#3498DB",
        }),
      );
    });
    expect(api.saveAgentRuntime).not.toHaveBeenCalled();
  });
});
