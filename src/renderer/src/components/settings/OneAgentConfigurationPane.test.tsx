import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  listOneProviderModels: ReturnType<typeof vi.fn>;
  saveOneAgentAgentsMd: ReturnType<typeof vi.fn>;
  listRuntimeSkills: ReturnType<typeof vi.fn>;
  listProjectWorkspaces: ReturnType<typeof vi.fn>;
  getOneRuntimeMemory: ReturnType<typeof vi.fn>;
  getOneProjectMemory: ReturnType<typeof vi.fn>;
  saveOneRuntimeMemory: ReturnType<typeof vi.fn>;
  saveOneProjectMemory: ReturnType<typeof vi.fn>;
  importOneSkill: ReturnType<typeof vi.fn>;
  removeOneSkill: ReturnType<typeof vi.fn>;
} {
  const runtime = createRuntime();
  const api = {
    listAgentRuntimes: vi.fn().mockResolvedValue([runtime]),
    getAgentRuntimeCredentialStatus: vi.fn().mockResolvedValue({
      configured: false,
      source: "none",
    }),
    getOneProviderCredentialStatus: vi.fn().mockResolvedValue({
      configured: false,
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
    listOneProviderModels: vi.fn().mockResolvedValue([]),
    getOneAgentAgentsMd: vi
      .fn()
      .mockResolvedValue("# One\nOriginal instructions"),
    saveOneAgentAgentsMd: vi.fn().mockResolvedValue(undefined),
    listRuntimeSkills: vi.fn().mockResolvedValue([]),
    listProjectWorkspaces: vi.fn().mockResolvedValue([]),
    getOneRuntimeMemory: vi.fn().mockResolvedValue(""),
    getOneProjectMemory: vi.fn().mockResolvedValue(""),
    saveOneRuntimeMemory: vi.fn().mockResolvedValue(undefined),
    saveOneProjectMemory: vi.fn().mockResolvedValue(undefined),
    importOneSkill: vi.fn().mockResolvedValue({
      id: "one:doc-reader",
      name: "doc-reader",
    }),
    removeOneSkill: vi.fn().mockResolvedValue(undefined),
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

  it("configures the default blank One directly without creating an agent", async () => {
    const api = installAPI();
    const runtime = createRuntime();
    runtime.config = { agentTransport: "local-sdk", endpoint: "", model: "" };
    render(
      <OneAgentConfigurationPane
        runtime={runtime}
        section="model"
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
    expect(screen.queryByLabelText("智能体 ID")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://models.example.test/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加模型/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("模型 ID"), {
      target: { value: "my-model" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    fireEvent.click(screen.getByRole("button", { name: /保存模型设置/ }));
    await waitFor(() =>
      expect(api.saveAgentRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          id: runtime.id,
          config: expect.objectContaining({
            endpoint: "https://models.example.test/v1",
            model: "my-model",
          }),
        }),
      ),
    );
  });

  it("renders provider settings and model choices without runtime identity fields", async () => {
    installAPI();
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
    expect(screen.getAllByText("当前使用").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("智能体 ID")).toBeNull();
    expect(screen.queryByLabelText("位置")).toBeNull();
  });

  it("adds a model through the model sheet and saves the catalog", async () => {
    const api = installAPI();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="model"
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /添加模型/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("模型 ID"), {
      target: { value: "doubao-seed-2.1-pro" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    const modelRadio = await screen.findByRole("radio", {
      name: "将 doubao-seed-2.1-pro 设为当前模型",
    });
    fireEvent.click(modelRadio);
    fireEvent.click(screen.getByRole("button", { name: /保存模型设置/ }));

    await waitFor(() => expect(api.saveAgentRuntime).toHaveBeenCalledTimes(1));
    expect(api.saveAgentRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "one-agent",
        config: expect.objectContaining({
          model: "doubao-seed-2.1-pro",
          oneProviders: expect.arrayContaining([
            expect.objectContaining({
              models: expect.arrayContaining([
                "doubao-seed-2.0-mini",
                "doubao-seed-2.1-pro",
              ]),
            }),
          ]),
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
  });

  it("adds a second provider and switches the current model to it", async () => {
    const api = installAPI();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="model"
        onChanged={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /添加供应商/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /OpenAI/ }));
    expect(within(dialog).getByLabelText("供应商名称")).toHaveValue("OpenAI");
    fireEvent.click(within(dialog).getByRole("button", { name: "添加" }));

    fireEvent.click(
      await screen.findByRole("button", { name: /OpenAI.*个模型/ }),
    );
    expect(await screen.findByText("gpt-6-astra")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /保存模型设置/ }));

    await waitFor(() => expect(api.saveAgentRuntime).toHaveBeenCalled());
    expect(api.saveAgentRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          oneActiveProviderId: expect.any(String),
          oneProviders: expect.arrayContaining([
            expect.objectContaining({ name: "OpenAI" }),
          ]),
        }),
      }),
    );
  });

  it("keeps plugin and MCP tabs separate from the skills destination", async () => {
    installAPI();
    const onSectionChange = vi.fn();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="plugins"
        onChanged={() => {}}
        onSectionChange={onSectionChange}
      />,
    );

    expect(await screen.findByText("本机 · One")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /插件/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.queryByRole("tab", { name: /技能/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /MCP/ }));
    expect(onSectionChange).toHaveBeenCalledWith("mcp");
  });

  it("lists personal and project memory and saves an edit", async () => {
    const api = installAPI();
    api.listProjectWorkspaces.mockResolvedValue([
      { id: "project-test", name: "test" },
    ]);
    api.getOneRuntimeMemory.mockResolvedValue("personal memory");
    api.getOneProjectMemory.mockResolvedValue("project memory");
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="memory"
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByText("MEMORY.md")).toBeTruthy();
    expect(await screen.findByText("test.md")).toBeTruthy();
    expect(screen.getByText("2 条记录")).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
    fireEvent.change(screen.getByLabelText("编辑 MEMORY.md"), {
      target: { value: "updated memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api.saveOneRuntimeMemory).toHaveBeenCalledWith(
        "one-agent",
        "updated memory",
      ),
    );
  });

  it("loads and saves One AGENTS.md in personalization settings", async () => {
    const api = installAPI();
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="personality"
        onChanged={() => {}}
      />,
    );
    const editor = await screen.findByLabelText("AGENTS.md");
    expect(editor).toHaveValue("# One\nOriginal instructions");
    fireEvent.change(editor, {
      target: { value: "# One\nEdited instructions" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(api.saveOneAgentAgentsMd).toHaveBeenCalledWith(
        "one-agent",
        "# One\nEdited instructions",
      ),
    );
  });

  // @lat: [[main-process#Main Process#One session resume reconciliation#One per-agent skill selection#Persists enabled and disabled local skills on One]]
  it("saves enabled and disabled local skills to the One runtime", async () => {
    const api = installAPI();
    api.listRuntimeSkills.mockResolvedValue([
      {
        id: "doc-reader",
        name: "doc-reader",
        description: "Read Office documents",
        location: "C:/Users/test/.codex/skills/doc-reader/SKILL.md",
        source: "user",
      },
    ]);
    render(
      <OneAgentConfigurationPane
        runtime={createRuntime()}
        section="skills"
        onChanged={() => {}}
      />,
    );

    const addSkill = await screen.findByRole("switch", {
      name: "添加技能 doc-reader",
    });
    fireEvent.click(addSkill);
    await waitFor(() =>
      expect(api.saveAgentRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ oneSkills: ["one:doc-reader"] }),
        }),
      ),
    );
    expect(api.importOneSkill).toHaveBeenCalledWith("one-agent", "doc-reader");

    fireEvent.click(
      await screen.findByRole("switch", { name: "启用技能 doc-reader" }),
    );
    await waitFor(() =>
      expect(api.saveAgentRuntime).toHaveBeenLastCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({ oneSkills: [] }),
        }),
      ),
    );
  });
});

describe("One-owned skill lifecycle", () => {
  it("keeps healthy owned copies enabled when cleaning missing skills", async () => {
    const runtime = createRuntime();
    runtime.config.oneSkills = ["one:demo", "one:missing"];
    const api = installAPI();
    api.listRuntimeSkills.mockResolvedValue([
      {
        id: "one:demo",
        name: "demo",
        source: "user",
        description: "owned",
        location: "owned",
      },
    ]);
    render(
      <OneAgentConfigurationPane
        runtime={runtime}
        section="skills"
        onChanged={() => {}}
      />,
    );
    expect(await screen.findByRole("switch", { name: /demo/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /移除不可用技能/ }));
    await waitFor(() => expect(api.saveAgentRuntime).toHaveBeenCalled());
    expect(
      api.saveAgentRuntime.mock.calls.at(-1)?.[0].config.oneSkills,
    ).toEqual(["one:demo"]);
  });
  it("re-enables an owned copy without importing or replacing it", async () => {
    const runtime = createRuntime();
    runtime.config.oneSkills = [];
    const api = installAPI();
    api.listRuntimeSkills.mockResolvedValue([
      {
        id: "one:demo",
        name: "demo",
        source: "user",
        description: "owned",
        location: "owned",
      },
    ]);
    render(
      <OneAgentConfigurationPane
        runtime={runtime}
        section="skills"
        onChanged={() => {}}
      />,
    );
    const toggle = await screen.findByRole("switch", { name: /demo/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    await waitFor(() => expect(api.saveAgentRuntime).toHaveBeenCalled());
    expect(api.importOneSkill).not.toHaveBeenCalled();
    expect(
      api.saveAgentRuntime.mock.calls.at(-1)?.[0].config.oneSkills,
    ).toEqual(["one:demo"]);
  });
});

it("shows standalone skills alphabetically without extension tabs", async () => {
  const api = installAPI();
  api.listRuntimeSkills.mockResolvedValue(
    ["youtube2obsidian", "bili2obsidian", "agent-browser"].map((name) => ({
      id: "one:" + name,
      name,
      description: "Description for " + name,
      source: "user",
      location: "C:/skills/" + name,
    })),
  );
  const { container } = render(
    <OneAgentConfigurationPane
      runtime={createRuntime()}
      section="skills"
      onChanged={() => {}}
    />,
  );
  await screen.findByRole("switch", { name: "启用技能 agent-browser" });
  expect(screen.queryByRole("tablist")).toBeNull();
  const names = Array.from(
    container.querySelectorAll(
      ".agent-one-ext-skill-list strong, .agent-one-ext-row strong",
    ),
  ).map((e) => e.textContent);
  expect(names).toEqual(["agent-browser", "bili2obsidian", "youtube2obsidian"]);
});
