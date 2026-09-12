import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { t as translate } from "../../../../shared/i18n";

const { voiceToggle } = vi.hoisted(() => ({ voiceToggle: vi.fn() }));
const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
    locale: i18nTestState.locale,
    setLocale: vi.fn(),
  }),
}));

vi.mock("../Chat/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    supported: true,
    recording: false,
    elapsedSeconds: 0,
    recordingLimitSeconds: null,
    transcribing: false,
    error: null,
    toggle: voiceToggle,
  }),
}));

import QuickComposer from "./QuickComposer";

afterEach(() => vi.restoreAllMocks());

const runtimes: AgentRuntimeDefinition[] = [
  {
    id: "hermes-main",
    name: "默认智能体",
    kind: "hermes",
    location: "local",
    enabled: true,
    managed: "builtin",
    config: { transport: "http", agent: "default" },
  },
  {
    id: "codex-local",
    name: "代码助手",
    kind: "codex",
    location: "local",
    enabled: true,
    managed: "user",
    config: { transport: "cli" },
  },
];

describe("QuickComposer", () => {
  const resizeTrayComposer = vi.fn();
  const selectFolder = vi.fn();
  const registerProjectWorkspace = vi.fn();
  const startAgentRuntimeTask = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    resizeTrayComposer.mockReset();
    selectFolder.mockReset();
    registerProjectWorkspace.mockReset();
    startAgentRuntimeTask.mockReset();
    voiceToggle.mockReset();
    i18nTestState.locale = "zh-CN";
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        listAgentRuntimes: vi.fn().mockResolvedValue(runtimes),
        resizeTrayComposer,
        closeTrayComposer: vi.fn(),
        selectFolder,
        registerProjectWorkspace,
        sendMessage: vi.fn().mockResolvedValue({ response: "ok" }),
        abortChat: vi.fn().mockResolvedValue(undefined),
        startAgentRuntimeTask: startAgentRuntimeTask.mockResolvedValue({
          id: "runtime-run-1",
          runtimeId: "codex-local",
          status: "running",
          startedAt: Date.now(),
        }),
        cancelAgentRuntimeTask: vi.fn().mockResolvedValue(true),
      },
    });
  });

  it("uses the compact agent-first controls and switches the task runtime", async () => {
    render(<QuickComposer />);

    const trigger = await screen.findByRole("button", {
      name: "当前智能体：默认智能体",
    });
    expect(screen.queryByText("模型")).not.toBeInTheDocument();
    expect(screen.queryByText("思考")).not.toBeInTheDocument();
    expect(screen.queryByTitle("网页搜索")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /代码助手/ }));

    expect(screen.getByPlaceholderText("交给代码助手…")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("交给代码助手…"), {
      target: { value: "检查项目" },
    });
    fireEvent.keyDown(screen.getByPlaceholderText("交给代码助手…"), {
      key: "Enter",
    });

    await waitFor(() =>
      expect(startAgentRuntimeTask).toHaveBeenCalledWith(
        "codex-local",
        expect.objectContaining({
          prompt: "检查项目",
          mode: "analysis",
          conversation: true,
        }),
      ),
    );
  });

  it("offers file upload and an authorized project folder from the paperclip", async () => {
    selectFolder.mockResolvedValue("D:\\work\\demo");
    registerProjectWorkspace.mockResolvedValue({
      id: "workspace-1",
      name: "demo",
      path: "D:\\work\\demo",
    });
    render(<QuickComposer />);

    await screen.findByRole("button", { name: "当前智能体：默认智能体" });
    fireEvent.click(
      screen.getByRole("button", { name: "添加文件或项目文件夹" }),
    );

    expect(screen.getByRole("menuitem", { name: /上传文件/ })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", { name: /添加项目文件夹/ }));

    await waitFor(() => {
      expect(selectFolder).toHaveBeenCalledWith({
        title: "添加项目文件夹",
        buttonLabel: "添加此项目",
      });
      expect(registerProjectWorkspace).toHaveBeenCalledWith("D:\\work\\demo");
    });
  });

  it("expands the BrowserWindow before showing an upward agent menu", async () => {
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const height = this.classList.contains("has-agent-menu") ? 402 : 96;
        return {
          x: 0,
          y: 0,
          width: 560,
          height,
          top: 0,
          right: 560,
          bottom: height,
          left: 0,
          toJSON: () => undefined,
        };
      });
    render(<QuickComposer />);

    const trigger = await screen.findByRole("button", {
      name: "当前智能体：默认智能体",
    });
    resizeTrayComposer.mockClear();
    fireEvent.click(trigger);

    await waitFor(() => expect(resizeTrayComposer).toHaveBeenCalledWith(402));
    expect(screen.getByRole("menu")).toHaveClass("tray-composer-agent-menu");
    rectSpy.mockRestore();
  });

  it("reuses the main composer voice control and Ctrl+M shortcut", async () => {
    render(<QuickComposer />);

    await screen.findByRole("button", { name: "当前智能体：默认智能体" });
    expect(screen.getByRole("button", { name: "语音输入" })).toBeVisible();

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    expect(voiceToggle).toHaveBeenCalledTimes(1);
  });

  it("renders the tray composer entry points in English", async () => {
    i18nTestState.locale = "en";
    render(<QuickComposer />);

    const trigger = await screen.findByRole("button", {
      name: "Current agent: 默认智能体",
    });
    expect(screen.getByLabelText("Agents One quick task")).toBeVisible();
    expect(screen.getByPlaceholderText("Ask 默认智能体…")).toBeVisible();

    fireEvent.click(trigger);
    expect(screen.getByText("Switch agent")).toBeVisible();
    expect(screen.getAllByText("Local", { exact: false })).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Add files or a project folder" }),
    );
    expect(
      screen.getByRole("menuitem", { name: /Upload files/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: /Add project folder/ }),
    ).toBeVisible();
  });
});
