import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const activeLocale = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));

vi.mock("../../components/useI18n", async () => {
  const { t } = await vi.importActual<typeof import("../../../../shared/i18n")>(
    "../../../../shared/i18n",
  );
  return {
    useI18n: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        t(key, activeLocale.value, options),
    }),
  };
});

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

describe("Agents", () => {
  beforeEach(() => {
    activeLocale.value = "zh-CN";
  });

  it("renders the agent dashboard in English", async () => {
    activeLocale.value = "en";
    installHermesAPI();
    render(<Agents onChatWithRuntime={() => {}} />);

    expect(
      await screen.findByText(
        "Agents, CLIs, or services running on this computer",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Remote Agents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Agent" })).toBeTruthy();
  });

  it("uses the shared runtime-location descriptions for all three agent domains", async () => {
    installHermesAPI();
    render(<Agents onChatWithRuntime={() => {}} />);

    expect(
      await screen.findByText("在当前电脑运行的智能体CLI或服务"),
    ).toBeTruthy();
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

    await screen.findByText("Hermes Gateway");
    // Unified access label (plan 1.1/1.5).
    expect(screen.getByText(/Gateway v1/)).toBeTruthy();
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
