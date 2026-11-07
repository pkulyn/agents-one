import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activeLocale = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));

vi.mock("../../components/useI18n", async () => {
  const { t } = await vi.importActual<typeof import("../../../../shared/i18n")>(
    "../../../../shared/i18n",
  );
  const translate = (key: string, options?: Record<string, unknown>): string =>
    t(key, activeLocale.value, options);
  return {
    useI18n: () => ({ t: translate }),
  };
});

vi.mock("../../components/settings/AgentRuntimesPane", () => ({
  default: (props: {
    initialRuntimeId?: string;
    startNew?: boolean;
  }): React.JSX.Element => (
    <div
      data-testid="agent-runtime-pane"
      data-initial-runtime-id={props.initialRuntimeId || ""}
      data-start-new={props.startNew ? "true" : "false"}
    />
  ),
}));

vi.mock("../../components/settings/OneAgentConfigurationPane", () => ({
  default: (props: {
    runtime: { id: string };
    section: string;
  }): React.JSX.Element => (
    <div
      data-testid="one-agent-config-pane"
      data-runtime-id={props.runtime.id}
      data-section={props.section}
    />
  ),
}));

import { NO_AGENT_RUNTIME_CAPABILITIES } from "../../../../shared/agent-runtimes";
import Agents from "./Agents";

function installHermesAPI(): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
} {
  const api = {
    listAgentRuntimes: vi.fn().mockResolvedValue([]),
    probeAgentRuntime: vi.fn().mockResolvedValue({
      state: "healthy",
      capabilities: {},
      checkedAt: Date.now(),
    }),
  };
  Object.defineProperty(window, "agentsOneAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

function showAccessManagement(): void {
  fireEvent.click(
    screen.getByRole("tab", {
      name: /智能体接入管理|Agent access management/,
    }),
  );
}

describe("Agents", () => {
  beforeEach(() => {
    activeLocale.value = "zh-CN";
  });

  it("opens One configuration by default and keeps connected-agent management separate", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "one-agent",
        name: "One",
        kind: "one",
        location: "local",
        enabled: true,
        managed: "user",
        config: { agentTransport: "local-sdk", model: "doubao-seed-2.0-mini" },
      },
      {
        id: "research-one",
        name: "研究助手",
        kind: "one",
        location: "local",
        enabled: true,
        managed: "user",
        config: { agentTransport: "local-sdk", model: "other-model" },
      },
    ]);

    render(<Agents onChatWithRuntime={() => {}} />);

    const editor = await screen.findByTestId("one-agent-config-pane");
    expect(editor).toHaveAttribute("data-runtime-id", "one-agent");
    expect(screen.getByRole("tab", { name: /智能体配置/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(document.getElementById("agents-configuration-panel")).toBeTruthy();
    expect(document.getElementById("agents-access-panel")).toHaveAttribute(
      "hidden",
    );
    expect(screen.queryByRole("button", { name: /本机.*用户/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "刷新" })).toBeNull();
    expect(screen.getByRole("button", { name: /个性化/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /记忆/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /技能与命令/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /子智能体/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /插件与 MCP/ })).toBeEnabled();
    const memorySection = screen.getByRole("button", { name: /记忆/ });
    fireEvent.click(memorySection);
    expect(memorySection).toHaveClass("is-active");
    expect(screen.getByTestId("one-agent-config-pane")).toHaveAttribute(
      "data-section",
      "memory",
    );

    fireEvent.click(screen.getAllByRole("button", { name: /研究助手/ })[0]);
    await waitFor(() =>
      expect(screen.getByTestId("one-agent-config-pane")).toHaveAttribute(
        "data-runtime-id",
        "research-one",
      ),
    );

    showAccessManagement();
    expect(
      await screen.findByRole("heading", { name: "本地智能体" }),
    ).toBeTruthy();
    expect(document.getElementById("agents-access-panel")).toBeTruthy();
    expect(
      document.getElementById("agents-configuration-panel"),
    ).toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /智能体配置/ }));
    await waitFor(() =>
      expect(screen.getByTestId("one-agent-config-pane")).toHaveAttribute(
        "data-runtime-id",
        "research-one",
      ),
    );
  });

  it("renders the agent dashboard in English", async () => {
    activeLocale.value = "en";
    installHermesAPI();
    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    expect(
      await screen.findByText(
        "Agents, CLIs, or services running on this computer",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Remote Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeTruthy();
  });

  it("shows only the connected-agent location descriptions in access management", async () => {
    installHermesAPI();
    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    expect(
      await screen.findByText("在当前电脑运行的智能体CLI或服务"),
    ).toBeTruthy();
    expect(
      screen.queryByText("配置模型 API 后独立运行，可自定义名称并直接对话"),
    ).toBeNull();
    expect(screen.getByText("连接远端服务器或电脑上的智能体")).toBeTruthy();
    expect(screen.getByText("在隔离浏览器中连接网页端智能体服务")).toBeTruthy();
  });

  it("only shows connected runtimes and not the legacy local Hermes profile", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "pi-local",
        name: "Pi",
        kind: "pi",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
    ]);

    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    await waitFor(() => {
      expect(screen.getByText("Pi")).toBeTruthy();
    });
    expect(screen.queryByText("本地 Hermes 档案（兼容）")).toBeNull();
    expect(screen.queryByText("新建本地档案")).toBeNull();
  });

  it("opens a formal task conversation for the selected runtime", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "codex-local",
        name: "Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
    ]);

    const onChatWithRuntime = vi.fn();
    render(<Agents onChatWithRuntime={onChatWithRuntime} />);
    showAccessManagement();

    await screen.findByText("Codex");
    expect(screen.getByRole("button", { name: "管理" })).toBeTruthy();
    const chatButton = screen.getByRole("button", { name: "对话" });
    await waitFor(() => {
      expect((chatButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(chatButton);
    expect(onChatWithRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: "codex-local" }),
    );
  });

  // @lat: [[sidebar-navigation#Parallel Runtime selection]]
  it("keeps One out of connected-agent management while listing local and remote agents", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "one-main",
        name: "One",
        kind: "one",
        location: "local",
        enabled: true,
        managed: "user",
        config: {},
        lastProbe: {
          state: "unreachable",
          checkedAt: Date.now() - 60_000,
          message: "旧检测结果",
        },
        capabilitySnapshot: {
          ...NO_AGENT_RUNTIME_CAPABILITIES,
          chat: true,
        },
      },
      {
        id: "codex-local",
        name: "Codex",
        kind: "codex",
        location: "local",
        enabled: true,
        managed: "user",
        config: { transport: "cli" },
      },
      {
        id: "hermes-remote",
        name: "Remote Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://gateway.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      },
    ]);

    const onChatWithRuntime = vi.fn();
    render(<Agents onChatWithRuntime={onChatWithRuntime} />);
    showAccessManagement();

    await screen.findByText("Codex");
    await screen.findByText("Remote Hermes");
    expect(screen.getByText("2 个智能体")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "One 智能体" })).toBeNull();
    expect(screen.queryByText("One")).toBeNull();
    await waitFor(() => {
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("codex-local");
      expect(api.probeAgentRuntime).toHaveBeenCalledWith("hermes-remote");
    });
    expect(api.probeAgentRuntime).not.toHaveBeenCalledWith("one-main");

    const localSection = screen
      .getByRole("heading", { name: "本地智能体" })
      .closest("section");
    const remoteSection = screen
      .getByRole("heading", { name: "远程智能体" })
      .closest("section");
    expect(localSection).not.toBeNull();
    expect(remoteSection).not.toBeNull();
    expect(within(localSection as HTMLElement).getByText("Codex")).toBeTruthy();
    expect(
      within(remoteSection as HTMLElement).getByText("Remote Hermes"),
    ).toBeTruthy();
    expect(within(remoteSection as HTMLElement).queryByText("One")).toBeNull();
    for (const [runtimeName, runtimeId] of [
      ["Codex", "codex-local"],
      ["Remote Hermes", "hermes-remote"],
    ]) {
      const card = screen.getByText(runtimeName).closest("article");
      expect(card).not.toBeNull();
      const chatButton = within(card as HTMLElement).getByRole("button", {
        name: "对话",
      });
      await waitFor(() => expect(chatButton).toBeEnabled());
      fireEvent.click(chatButton);
      expect(onChatWithRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: runtimeId }),
      );
    }

    expect(onChatWithRuntime).toHaveBeenCalledTimes(2);
  });

  it("shows the unified transport label and connection hint without capability badges", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "hermes-gateway",
        name: "Hermes Gateway",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://gateway.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      },
    ]);
    api.probeAgentRuntime.mockResolvedValue({
      runtimeId: "hermes-gateway",
      state: "healthy",
      capabilities: {
        chat: true,
        taskDispatch: true,
        tools: true,
        artifacts: false,
        workspaceAccess: true,
      },
      checkedAt: Date.now(),
    });

    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    await screen.findByText("Hermes Gateway");
    // Unified access label (plan 1.1/1.5).
    expect(screen.getByText("Hermes Agent")).toBeTruthy();
    expect(screen.queryByText(/Gateway v1/)).toBeNull();
    // Connection hint shows the Gateway endpoint.
    expect(
      screen.getByText("https://gateway.example/agents-one/v1"),
    ).toBeTruthy();
    expect(document.querySelector(".agents-runtime-capabilities")).toBeNull();
  });

  it("keeps browser-backed runtimes in the dedicated web agent section", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "doubao-web",
        name: "豆包网页版",
        kind: "web-agent",
        location: "local",
        enabled: true,
        managed: "user",
        config: {
          agentTransport: "local-web",
          webAgent: {
            provider: "doubao",
            profileId: "default",
            adapterVersion: "test",
            enabled: true,
          },
        },
      },
    ]);

    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    await screen.findByText("豆包网页版");
    const localSection = screen
      .getByRole("heading", { name: "本地智能体" })
      .closest("section");
    const webSection = screen
      .getByRole("heading", { name: "网页智能体" })
      .closest("section");
    expect(localSection?.textContent).not.toContain("豆包网页版");
    expect(webSection?.textContent).toContain("豆包网页版");
  });

  it("shows the redacted Gateway probe reason and blocks chat", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "hers-remote",
        name: "Hers",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: {
          endpoint: "https://gateway.example/agents-one/v1",
          remoteGateway: { protocol: "agents-one-v1" },
          transport: "http",
        },
      },
    ]);
    api.probeAgentRuntime.mockResolvedValue({
      runtimeId: "hers-remote",
      state: "unreachable",
      capabilities: {},
      checkedAt: Date.now(),
      message: "Gateway Token 无效或无权访问。",
    });

    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    await screen.findByText("Hers");
    await waitFor(() => {
      expect(screen.getByText(/^连接异常/)).toBeTruthy();
    });
    expect(screen.getByText("Gateway Token 无效或无权访问。")).toBeTruthy();
    expect(
      screen.queryByText("连接检测失败，可进入管理页检查网关地址与凭据。"),
    ).toBeNull();
    const chatButton = screen.getByRole("button", { name: "对话" });
    expect((chatButton as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([
    ["degraded", "连接受限"],
    ["unsupported", "暂不支持"],
    ["unknown", "检测异常"],
  ] as const)(
    "shows the web runtime %s state and keeps chat disabled",
    async (state, metaLabel) => {
      const api = installHermesAPI();
      api.listAgentRuntimes.mockResolvedValue([
        {
          id: `doubao-web-${state}`,
          name: "豆包网页版",
          kind: "web-agent",
          location: "local",
          enabled: true,
          managed: "user",
          config: {
            agentTransport: "local-web",
            webAgent: {
              provider: "doubao",
              profileId: "default",
              adapterVersion: "test",
              enabled: true,
            },
          },
        },
      ]);
      api.probeAgentRuntime.mockResolvedValue({
        runtimeId: `doubao-web-${state}`,
        state,
        capabilities: {},
        checkedAt: Date.now(),
        message: "网页会话需要处理",
      });

      render(<Agents onChatWithRuntime={() => {}} />);
      showAccessManagement();

      await screen.findByText("豆包网页版");
      await waitFor(() => {
        expect(
          document.querySelector(".agents-runtime-meta")?.textContent,
        ).toMatch(new RegExp(`^${metaLabel}`));
      });
      expect(
        (screen.getByRole("button", { name: "对话" }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "管理" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    },
  );

  it("surfaces a web probe exception as a visible detection error", async () => {
    const api = installHermesAPI();
    api.listAgentRuntimes.mockResolvedValue([
      {
        id: "chatgpt-web",
        name: "ChatGPT 网页版",
        kind: "web-agent",
        location: "local",
        enabled: true,
        managed: "user",
        config: {
          agentTransport: "local-web",
          webAgent: {
            provider: "chatgpt",
            profileId: "default",
            adapterVersion: "test",
            enabled: true,
          },
        },
      },
    ]);
    api.probeAgentRuntime.mockRejectedValue(new Error("网页窗口启动失败"));

    render(<Agents onChatWithRuntime={() => {}} />);
    showAccessManagement();

    await screen.findByText("ChatGPT 网页版");
    await waitFor(() => {
      expect(
        document.querySelector(".agents-runtime-meta")?.textContent,
      ).toMatch(/^检测异常/);
    });
    expect(
      (screen.getByRole("button", { name: "对话" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
