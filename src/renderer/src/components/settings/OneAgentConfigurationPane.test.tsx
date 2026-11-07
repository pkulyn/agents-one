import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  NO_AGENT_RUNTIME_CAPABILITIES,
  type AgentRuntimeDefinition,
} from "../../../../shared/agent-runtimes";

vi.mock("../useI18n", async () => {
  const { t } = await vi.importActual<typeof import("../../../../shared/i18n")>(
    "../../../../shared/i18n",
  );
  return {
    useI18n: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        t(key, "zh-CN", options),
    }),
  };
});

import OneAgentConfigurationPane from "./OneAgentConfigurationPane";

function createRuntime(): AgentRuntimeDefinition {
  return {
    id: "one-agent",
    name: "One",
    kind: "one",
    location: "local",
    enabled: true,
    managed: "user",
    config: {
      agentTransport: "local-sdk",
      endpoint: "https://ark.cn-beijing.volces.com/api/plan/v3",
      oneApiType: "openai-completions",
      model: "doubao-seed-2.0-mini",
      oneModels: ["doubao-seed-2.0-mini"],
    },
  };
}

function installAPI(): {
  saveAgentRuntime: ReturnType<typeof vi.fn>;
  setAgentRuntimeBearerToken: ReturnType<typeof vi.fn>;
  probeAgentRuntimeDraft: ReturnType<typeof vi.fn>;
} {
  const runtime = createRuntime();
  const api = {
    getAgentRuntimeCredentialStatus: vi.fn().mockResolvedValue({
      configured: false,
      source: "none",
    }),
    saveAgentRuntime: vi.fn(async (draft) => draft),
    setAgentRuntimeBearerToken: vi.fn().mockResolvedValue({
      storage: { backend: "credential-vault" },
    }),
    probeAgentRuntimeDraft: vi.fn().mockResolvedValue({
      runtimeId: runtime.id,
      state: "healthy",
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt: Date.now(),
    }),
    getAgentRuntimeDiagnostics: vi.fn().mockResolvedValue({
      connection: { state: "healthy" },
      provider: { requestedModel: "doubao-seed-2.0-mini" },
      host: {},
    }),
  };
  Object.defineProperty(window, "agentsOneAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("OneAgentConfigurationPane", () => {
  beforeEach(() => {
    installAPI();
  });

  it("renders provider settings and model choices without runtime identity fields", async () => {
    const api = installAPI();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="model"
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByLabelText("Base URL")).toHaveValue(
      "https://ark.cn-beijing.volces.com/api/plan/v3",
    );
    expect(screen.getByLabelText("API 协议")).toHaveValue("openai-completions");
    expect(screen.getByText("doubao-seed-2.0-mini")).toBeTruthy();
    expect(screen.queryByLabelText("智能体 ID")).toBeNull();
    expect(screen.queryByLabelText("位置")).toBeNull();

    fireEvent.change(screen.getByLabelText("模型 ID"), {
      target: { value: "doubao-seed-2.1-pro" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加模型/ }));
    fireEvent.click(
      screen.getByRole("radio", {
        name: "将 doubao-seed-2.1-pro 设为默认模型",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /保存模型配置/ }));

    await waitFor(() => expect(api.saveAgentRuntime).toHaveBeenCalledTimes(1));
    expect(api.saveAgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "one-agent",
        config: expect.objectContaining({
          model: "doubao-seed-2.1-pro",
          oneModels: ["doubao-seed-2.0-mini", "doubao-seed-2.1-pro"],
        }),
      }),
    );
  });

  it("stores the API key separately from the runtime configuration", async () => {
    const api = installAPI();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="model"
        onChanged={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "secret-test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保存密钥/ }));

    await waitFor(() =>
      expect(api.setAgentRuntimeBearerToken).toHaveBeenCalledWith(
        "one-agent",
        "secret-test-key",
      ),
    );
    expect(api.saveAgentRuntime).not.toHaveBeenCalled();
    expect(api.setAgentRuntimeBearerToken.mock.calls[0][1]).toBe(
      "secret-test-key",
    );
  });
});
