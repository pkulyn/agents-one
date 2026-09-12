import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";
import { BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS } from "../../../../shared/runtime-adapters";
import type { WebAgentPolicyStatus } from "../../../../shared/web-agent";

const activeLocale = vi.hoisted(() => ({ value: "zh-CN" as "en" | "zh-CN" }));

vi.mock("../useI18n", async () => {
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
  initialWebPolicy: WebAgentPolicyStatus = {
    available: true,
    enabled: true,
    killSwitchActive: false,
  },
): {
  listAgentRuntimes: ReturnType<typeof vi.fn>;
  saveAgentRuntime: ReturnType<typeof vi.fn>;
  saveAgentRuntimeAppearance: ReturnType<typeof vi.fn>;
  probeAgentRuntime: ReturnType<typeof vi.fn>;
  probeAgentRuntimeDraft: ReturnType<typeof vi.fn>;
  setAgentRuntimeBearerToken: ReturnType<typeof vi.fn>;
  previewAgentsOneConnectPairingCode: ReturnType<typeof vi.fn>;
  completeAgentsOneConnectPairingPreview: ReturnType<typeof vi.fn>;
  claimAgentsOneConnectPairingCode: ReturnType<typeof vi.fn>;
  detectLocalCliPaths: ReturnType<typeof vi.fn>;
  discoverHermesInstallations: ReturnType<typeof vi.fn>;
  selectHermesHome: ReturnType<typeof vi.fn>;
  validateHermesHome: ReturnType<typeof vi.fn>;
  adoptHermesHome: ReturnType<typeof vi.fn>;
  relaunchApp: ReturnType<typeof vi.fn>;
  listAgentRuntimeAdapters: ReturnType<typeof vi.fn>;
  getWebAgentPolicyStatus: ReturnType<typeof vi.fn>;
  setWebAgentPolicyEnabled: ReturnType<typeof vi.fn>;
} {
  let current = [...runtimes];
  let webPolicy = { ...initialWebPolicy };
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
  const setAgentRuntimeBearerToken = vi.fn(async () => ({
    configured: true as const,
  }));
  const previewAgentsOneConnectPairingCode = vi.fn(
    async (_code, runtimeId) => ({
      sessionId: "pair_preview",
      runtimeId: runtimeId || "hermes-gateway",
      displayName: "Hers",
      expiresAt: Date.now() + 300_000,
      deviceFingerprint: "sha256:0123456789abcdef",
      runtimes: [
        {
          runtimeId: runtimeId || "hermes-gateway",
          displayName: "Hers",
          kind: "hermes",
          adapterId: "hermes",
          capabilityDigest:
            "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      ],
    }),
  );
  const completeAgentsOneConnectPairingPreview = vi.fn(
    async (_sessionId, draft) => {
      const saved = {
        ...draft,
        managed: "user" as const,
        config: {
          ...draft.config,
          endpoint: "https://example.test/agents-one/v1",
          transport: "http" as const,
          remoteGateway: { protocol: "agents-one-v1" as const },
        },
      };
      current = [
        ...current.filter((runtime) => runtime.id !== saved.id),
        saved,
      ];
      return saved;
    },
  );
  const claimAgentsOneConnectPairingCode = vi.fn(async (_code, draft) => {
    const saved = {
      ...draft,
      managed: "user" as const,
      config: {
        ...draft.config,
        endpoint: "https://example.test/agents-one/v1",
        transport: "http" as const,
        remoteGateway: { protocol: "agents-one-v1" as const },
      },
    };
    current = [...current.filter((runtime) => runtime.id !== saved.id), saved];
    return saved;
  });
  const detectLocalCliPaths = vi.fn(async () => detected);
  const discoverHermesInstallations = vi.fn(async () => []);
  const selectHermesHome = vi.fn(async () => null);
  const validateHermesHome = vi.fn(async () => true);
  const adoptHermesHome = vi.fn(async () => true);
  const relaunchApp = vi.fn(async () => undefined);
  const listAgentRuntimeAdapters = vi.fn(async () =>
    BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS.map((manifest) =>
      manifest.adapterId === "opencode"
        ? {
            ...manifest,
            locations: ["local", "remote"] as const,
            transports: ["local-cli", "gateway-v1"] as const,
          }
        : manifest,
    ),
  );
  const getWebAgentPolicyStatus = vi.fn(async () => webPolicy);
  const setWebAgentPolicyEnabled = vi.fn(
    async (enabled: boolean, acknowledgedRisk = false) => {
      if (enabled && !acknowledgedRisk) {
        throw new Error("启用网页 Provider 前必须确认实验性风险。");
      }
      webPolicy = { ...webPolicy, enabled };
      return webPolicy;
    },
  );

  Object.defineProperty(window, "agentsOneAPI", {
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
      previewAgentsOneConnectPairingCode,
      completeAgentsOneConnectPairingPreview,
      claimAgentsOneConnectPairingCode,
      probeAgentRuntime,
      probeAgentRuntimeDraft,
      detectLocalCliPaths,
      discoverHermesInstallations,
      selectHermesHome,
      validateHermesHome,
      adoptHermesHome,
      relaunchApp,
      listAgentRuntimeAdapters,
      getWebAgentPolicyStatus,
      setWebAgentPolicyEnabled,
    },
  });

  return {
    listAgentRuntimes,
    saveAgentRuntime,
    saveAgentRuntimeAppearance,
    probeAgentRuntime,
    probeAgentRuntimeDraft,
    setAgentRuntimeBearerToken,
    previewAgentsOneConnectPairingCode,
    completeAgentsOneConnectPairingPreview,
    claimAgentsOneConnectPairingCode,
    detectLocalCliPaths,
    discoverHermesInstallations,
    selectHermesHome,
    validateHermesHome,
    adoptHermesHome,
    relaunchApp,
    listAgentRuntimeAdapters,
    getWebAgentPolicyStatus,
    setWebAgentPolicyEnabled,
  };
}

async function openNewAgentWizard(
  type: "local" | "remote" | "web" = "remote",
  step: 2 | 3 = 3,
): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: "接入" }));
  const label =
    type === "local"
      ? "本地智能体"
      : type === "web"
        ? "网页智能体"
        : "远程智能体";
  fireEvent.click(screen.getByText(label).closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  if (step === 3)
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
}

describe("AgentRuntimesPane", () => {
  beforeEach(() => {
    activeLocale.value = "zh-CN";
  });

  it("renders the connection manager and onboarding wizard in English", async () => {
    activeLocale.value = "en";
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    expect(
      screen.getByRole("heading", { name: "Choose the agent to connect" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Remote Agent")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

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

    expect(
      (await screen.findAllByText("Current Hermes")).length,
    ).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Hermes Gateway/ }),
      ).toHaveTextContent("手动直连");
    });
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

  it("pairs a new remote runtime without mixing in self-hosted Gateway fields", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard();
    expect(
      screen.getByRole("button", { name: "校验码配对（推荐）" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Gateway 地址")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway Token")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("输入接入校验码"), {
      target: { value: "ABCD234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认配对" }));

    await waitFor(() => {
      expect(api.previewAgentsOneConnectPairingCode).toHaveBeenCalledWith(
        "ABCD234567",
        "hermes-gateway",
      );
    });
    expect(
      screen.getByTestId("agent-runtime-pairing-preview"),
    ).toHaveTextContent("sha256:0123456789abcdef");
    fireEvent.click(screen.getByRole("button", { name: "确认接入" }));
    await waitFor(() => {
      expect(api.completeAgentsOneConnectPairingPreview).toHaveBeenCalledWith(
        "pair_preview",
        expect.objectContaining({
          id: "hermes-gateway",
          name: "Hermes",
          kind: "hermes",
          location: "remote",
        }),
      );
    });
  });

  it("keeps self-hosted Gateway credentials in their own remote onboarding flow", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard();
    expect(screen.getByText("校验码配对")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway 地址")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway Token")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "自托管 Gateway（高级）" }),
    );
    expect(screen.getByLabelText("Gateway 地址")).toBeInTheDocument();
    expect(screen.getByLabelText("Gateway Token")).toBeInTheDocument();
    expect(screen.getByLabelText("连接超时（秒）")).toHaveValue(300);
  });

  it("starts with three runtime domains and keeps custom remote agents on Gateway v1", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));

    expect(
      screen.getByText("本地智能体").closest("button"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("远程智能体").closest("button"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("网页智能体").closest("button"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("远程智能体").closest("button")!);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByText("校验码配对")).toBeInTheDocument();
    expect(screen.getByLabelText("输入接入校验码")).toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway 地址")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway Token")).not.toBeInTheDocument();
    // SSH 隧道与兼容模式均已移除（远程统一走 Gateway v1）
    expect(
      screen.queryByRole("button", { name: "SSH 隧道" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "兼容模式" }),
    ).not.toBeInTheDocument();
  });

  it("keeps web providers unavailable in a public build", async () => {
    installHermesAPI(
      [],
      {},
      {
        available: false,
        enabled: false,
        killSwitchActive: false,
        reasonCode: "public-build-disabled",
        reason: "公开构建默认关闭网页 Provider；当前没有第三方书面自动化许可。",
      },
    );
    render(<AgentRuntimesPane />);

    expect(
      await screen.findByText(/公开构建默认关闭网页 Provider/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "接入" }));
    expect(screen.getByText("网页智能体").closest("button")).toBeDisabled();
  });

  it("requires risk confirmation and supports one-click web provider disable", async () => {
    const api = installHermesAPI(
      [],
      {},
      {
        available: true,
        enabled: false,
        killSwitchActive: false,
      },
    );
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AgentRuntimesPane />);

    fireEvent.click(
      await screen.findByRole("button", { name: "了解风险并启用" }),
    );
    await waitFor(() => {
      expect(api.setWebAgentPolicyEnabled).toHaveBeenCalledWith(true, true);
      expect(
        screen.getByRole("button", { name: "一键停用网页 Provider" }),
      ).toBeInTheDocument();
    });
    expect(confirmSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "一键停用网页 Provider" }),
    );
    await waitFor(() => {
      expect(api.setWebAgentPolicyEnabled).toHaveBeenLastCalledWith(
        false,
        false,
      );
      expect(screen.getByText(/活动网页任务和窗口已关闭/)).toBeInTheDocument();
    });
    confirmSpy.mockRestore();
  });

  it("shows a clear selection state, icon preview, and cancel action on step one", async () => {
    installHermesAPI([]);
    const onCancel = vi.fn();
    render(<AgentRuntimesPane onCancel={onCancel} />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    expect(screen.queryByText("推荐")).not.toBeInTheDocument();
    expect(
      screen.getByText("在当前电脑运行的智能体CLI或服务"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("连接远端服务器或电脑上的智能体"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("在隔离浏览器中连接网页端智能体服务"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("基础信息：头像、名称、智能体 ID"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("远程连接：校验码配对或自托管 Gateway"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();

    const local = screen.getByText("本地智能体").closest("button")!;
    fireEvent.click(local);
    expect(local).toHaveClass("is-selected");
    expect(local.querySelector("i")).toHaveTextContent("✓");

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("hides the legacy local Agent and ACP fields on every onboarding step", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    fireEvent.click(screen.getByText("本地智能体").closest("button")!);
    const expectLegacyFieldsHidden = (): void => {
      expect(screen.queryByText("默认 Agent（可选）")).not.toBeInTheDocument();
      expect(screen.queryByText("ACP 参数（可选）")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("模型覆盖")).not.toBeInTheDocument();
    };

    expectLegacyFieldsHidden();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expectLegacyFieldsHidden();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expectLegacyFieldsHidden();
  });

  it("keeps the cancel action only on the type-selection page", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane onCancel={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "接入" }));
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      screen.queryByRole("button", { name: "取消" }),
    ).not.toBeInTheDocument();
  });

  it("offers Pi Agent CLI as a configurable local runtime template", async () => {
    const api = installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("local", 2);
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "pi" },
    });
    expect(screen.getByLabelText("名称")).toHaveValue("Pi Agent");
    expect(screen.getByLabelText("智能体 ID")).toHaveValue("pi-agent");
    fireEvent.change(screen.getByLabelText("名称"), {
      target: { value: "我的 Pi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByLabelText("可执行文件")).toHaveValue("pi");
    fireEvent.click(screen.getByRole("button", { name: "连接测试" }));
    await waitFor(() => expect(api.probeAgentRuntimeDraft).toHaveBeenCalled());
    expect(screen.getByLabelText("连接超时（秒）")).toHaveValue(300);
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(api.saveAgentRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "pi-agent",
          name: "我的 Pi",
          kind: "pi",
          location: "local",
          config: expect.objectContaining({
            executablePath: "pi",
            transport: "cli",
          }),
        }),
      );
    });
  });

  it("offers OpenCode as the first remote Host runtime template", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("remote", 2);
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "opencode" },
    });
    expect(screen.getByLabelText("名称")).toHaveValue("OpenCode");
    expect(screen.getByLabelText("智能体 ID")).toHaveValue("opencode-gateway");
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(screen.getByText("校验码配对")).toBeInTheDocument();
    expect(screen.queryByLabelText("可执行文件")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Gateway 地址")).not.toBeInTheDocument();
  });

  it("discovers and adopts an existing local Hermes installation without reinstalling it", async () => {
    const api = installHermesAPI([]);
    const candidate = {
      home: "C:\\Users\\tester\\.hermes",
      repoPath: "C:\\Users\\tester\\.hermes\\hermes-agent",
      pythonPath:
        "C:\\Users\\tester\\.hermes\\hermes-agent\\venv\\Scripts\\python.exe",
      scriptPath:
        "C:\\Users\\tester\\.hermes\\hermes-agent\\venv\\Scripts\\hermes.exe",
      source: "default-home" as const,
      valid: true,
      executableAvailable: true,
      configState: "configured" as const,
      apiState: "healthy" as const,
      version: "0.1.2",
    };
    api.discoverHermesInstallations.mockResolvedValue([candidate]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("local", 2);
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "hermes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(
      screen.getByText("采用已有 Hermes Agent Runtime 安装"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(api.discoverHermesInstallations).toHaveBeenCalled(),
    );
    expect(screen.getByText(candidate.home)).toBeInTheDocument();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "使用此安装" }));
    await waitFor(() => {
      expect(api.validateHermesHome).toHaveBeenCalledWith(candidate.home);
      expect(api.adoptHermesHome).toHaveBeenCalledWith(candidate.home);
      expect(api.relaunchApp).toHaveBeenCalled();
    });
    expect(api.saveAgentRuntime).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("auto-fills a PATH-detected local CLI path and derives location/transport for new agents", async () => {
    const api = installHermesAPI([], { pi: "C:\\tools\\pi.cmd" });
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("local", 2);
    fireEvent.change(screen.getByLabelText("类型"), {
      target: { value: "pi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    // PATH detection (plan 1.5) prefills the executable path.
    expect(screen.getByLabelText("可执行文件")).toHaveValue(
      "C:\\tools\\pi.cmd",
    );
    expect(
      screen.getByText("已在 PATH 检测到：C:\\tools\\pi.cmd"),
    ).toBeInTheDocument();
    // The selected domain derives the local CLI connection; no location or transport
    // control is exposed in the new-agent flow.
    expect(screen.queryByLabelText("连接方式")).toBeNull();
    expect(api.detectLocalCliPaths).toHaveBeenCalled();
  });

  it("uses a 300-second timeout by default for web agents", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("web");
    expect(screen.getByLabelText("连接超时（秒）")).toHaveValue(300);
  });

  it("offers Grok as a web provider and applies its default display name", async () => {
    installHermesAPI([]);
    render(<AgentRuntimesPane />);

    await openNewAgentWizard("web");
    expect(screen.getByRole("option", { name: "Grok" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("网页 Provider"), {
      target: { value: "grok" },
    });

    expect(screen.getByText(/当前 Provider：Grok/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一步" }));
    expect(screen.getByLabelText("名称")).toHaveValue("Grok 网页版");
    expect(screen.getByLabelText("智能体 ID")).toHaveValue("grok-web");
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
