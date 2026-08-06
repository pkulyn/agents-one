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

function installHermesAPI(runtimes: AgentRuntimeDefinition[]): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  saveAgentRuntime: ReturnType<typeof vi.fn>;
  saveAgentRuntimeAppearance: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
  probeAgentRuntimeDraft: ReturnType<typeof vi.fn>;
  setAgentRuntimeBearerToken: ReturnType<typeof vi.fn>;
  setAgentRuntimeDashboardToken: ReturnType<typeof vi.fn>;
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
    runtimeId: "openclaw-remote",
    state: "healthy",
    capabilities,
    checkedAt: Date.now(),
    message: "OpenClaw bridge ready",
  };
  const probeAgentRuntime = vi.fn(async () => probe);
  const probeAgentRuntimeDraft = vi.fn(async () => probe);
  const setAgentRuntimeBearerToken = vi.fn(async () => ({ configured: true as const }));
  const setAgentRuntimeDashboardToken = vi.fn(async () => ({ configured: true as const }));

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
      setAgentRuntimeDashboardToken,
      probeAgentRuntime,
      probeAgentRuntimeDraft,
    },
  });

  return {
    listAgentRuntimes,
    saveAgentRuntime,
    saveAgentRuntimeAppearance,
    probeAgentRuntime,
    probeAgentRuntimeDraft,
    setAgentRuntimeBearerToken,
    setAgentRuntimeDashboardToken,
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
        id: "openclaw-remote",
        name: "OpenClaw Remote",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/openclaw",
          transport: "http",
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
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("openclaw-remote");
    });
    expect(screen.queryByText("未检测")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByText("OpenClaw Remote")[0]);
    fireEvent.click(screen.getByRole("button", { name: "检测" }));

    await waitFor(() => {
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("openclaw-remote");
    });
    expect(
      (await screen.findAllByText("OpenClaw bridge ready")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("健康").length).toBeGreaterThan(0);
  });

  it("saves a new remote OpenClaw runtime without embedding credentials", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByPlaceholderText("https://host.example/bridge"), {
      target: { value: "https://example.test/bridge" },
    });
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(api.probeAgentRuntimeDraft).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.saveAgentRuntime).toHaveBeenCalled();
    });
    expect(api.saveAgentRuntime.mock.calls[0][0]).toMatchObject({
      id: "openclaw-remote",
      name: "OpenClaw Remote",
      kind: "openclaw",
      location: "remote",
      enabled: true,
      config: {
        endpoint: "https://example.test/bridge",
        transport: "http",
        timeoutMs: 10000,
      },
    });
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toMatch(
      /apiKey|token|secret/i,
    );
  });

  it("configures custom Hermes connection modes and keeps both tokens outside the runtime definition", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "hermes" },
    });
    fireEvent.change(screen.getByLabelText("远程服务器地址"), {
      target: { value: "https://hermes.example/bridge" },
    });
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: "hermes-api-key" },
    });
    fireEvent.change(screen.getByLabelText("远程 Dashboard 地址"), {
      target: { value: "https://hermes.example/dashboard" },
    });
    fireEvent.change(screen.getByLabelText("远程 Dashboard 令牌"), {
      target: { value: "dashboard-session-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Dashboard" }));
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));

    await waitFor(() =>
      expect(api.probeAgentRuntimeDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "hermes-remote-custom",
          kind: "hermes",
          config: expect.objectContaining({
            endpoint: "https://hermes.example/bridge",
            hermes: {
              mode: "remote",
              dashboardUrl: "https://hermes.example/dashboard",
              chatTransport: "dashboard",
            },
          }),
        }),
        "hermes-api-key",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "hermes-remote-custom",
        "hermes-api-key",
      ),
    );
    expect(api.setAgentRuntimeDashboardToken).toHaveBeenCalledWith(
      "hermes-remote-custom",
      "dashboard-session-token",
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toContain(
      "hermes-api-key",
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls[0][0])).not.toContain(
      "dashboard-session-token",
    );
  });

  it("offers local, remote, and SSH tunnel modes for a custom Hermes runtime", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "hermes" },
    });

    expect(screen.getByRole("button", { name: "本地" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "远程" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "SSH 隧道" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "自动" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "基础模式" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SSH 隧道" }));
    expect(screen.getByLabelText("SSH 主机")).toBeInTheDocument();
    expect(screen.getByLabelText("SSH 用户名")).toBeInTheDocument();
    expect(screen.getByLabelText("远程 API 端口")).toBeInTheDocument();
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

  it("saves an OpenClaw Bridge token through IPC without adding it to runtime config", async () => {
    const api = installHermesAPI([
      {
        id: "openclaw-remote",
        name: "OpenClaw Remote",
        kind: "openclaw",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://example.test/openclaw",
          transport: "http",
          timeoutMs: 10000,
        },
      },
    ]);
    render(<AgentRuntimesPane />);

    await screen.findByRole("button", { name: /OpenClaw Remote/i });
    fireEvent.change(screen.getByLabelText("Bridge Token"), {
      target: { value: "bridge-test-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存 Token" }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "openclaw-remote",
        "bridge-test-token",
      ),
    );
    expect(JSON.stringify(api.saveAgentRuntime.mock.calls)).not.toContain(
      "bridge-test-token",
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
