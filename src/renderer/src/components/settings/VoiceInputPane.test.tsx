import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../I18nProvider";
import VoiceInputPane from "./VoiceInputPane";

const api = {
  getVoiceInputConfig: vi.fn(),
  saveVoiceInputConfig: vi.fn(),
  testVoiceInputService: vi.fn(),
};

describe("VoiceInputPane", () => {
  beforeEach(() => {
    Object.defineProperty(window, "agentsOneAPI", {
      value: api,
      configurable: true,
      writable: true,
    });
    api.getVoiceInputConfig.mockReset();
    api.saveVoiceInputConfig.mockReset();
    api.testVoiceInputService.mockReset();
    api.getVoiceInputConfig.mockResolvedValue({
      enabled: false,
      url: "",
      hasApiKey: false,
      configured: false,
    });
  });

  function renderPane(): void {
    render(
      <I18nProvider>
        <VoiceInputPane profile="default" />
      </I18nProvider>,
    );
  }

  it("shows only key status and never its saved value", async () => {
    api.getVoiceInputConfig.mockResolvedValue({
      enabled: true,
      url: "https://voice.example.test/voice",
      hasApiKey: true,
      configured: true,
    });
    renderPane();

    const keyInput = await screen.findByLabelText("API key (optional)");
    expect(keyInput).toHaveValue("");
    expect(keyInput).toHaveAttribute(
      "placeholder",
      "Configured (leave blank to retain the current key)",
    );
    expect(screen.queryByText("Privacy and diagnostics")).not.toBeInTheDocument();
  });

  it("tests a draft endpoint without saving it", async () => {
    api.testVoiceInputService.mockResolvedValue({
      ok: true,
      message: "语音服务连接正常。",
      version: "1.4.0",
      streamBackend: "qwen3",
    });
    renderPane();

    fireEvent.change(await screen.findByLabelText("Voice service URL"), {
      target: { value: "https://voice.example.test/voice" },
    });
    fireEvent.change(screen.getByLabelText("API key (optional)"), {
      target: { value: "draft-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(api.testVoiceInputService).toHaveBeenCalledWith(
        { url: "https://voice.example.test/voice", apiKey: "draft-key" },
        "default",
      );
    });
    expect(api.saveVoiceInputConfig).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("qwen3");
  });

  it("saves the enablement, endpoint, and a replacement key", async () => {
    api.saveVoiceInputConfig.mockResolvedValue({
      enabled: true,
      url: "https://voice.example.test/voice",
      hasApiKey: true,
      configured: true,
    });
    renderPane();

    fireEvent.click(await screen.findByLabelText("Enable voice"));
    fireEvent.change(screen.getByLabelText("Voice service URL"), {
      target: { value: "https://voice.example.test/voice" },
    });
    fireEvent.change(screen.getByLabelText("API key (optional)"), {
      target: { value: "replacement-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(api.saveVoiceInputConfig).toHaveBeenCalledWith(
        {
          enabled: true,
          url: "https://voice.example.test/voice",
          apiKey: "replacement-key",
          clearApiKey: false,
        },
        "default",
      );
    });
  });
});
