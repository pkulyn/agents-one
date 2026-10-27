import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    expect(
      screen.queryByText("Privacy and diagnostics"),
    ).not.toBeInTheDocument();
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

  function delayed<T>(): { promise: Promise<T>; resolve(value: T): void } {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
      resolve = yes;
    });
    return { promise, resolve };
  }
  const configA = {
    enabled: true,
    url: "https://a.example.test/__saved__",
    hasApiKey: true,
    configured: true,
  };
  const configB = {
    enabled: true,
    url: "https://b.example.test/__saved__",
    hasApiKey: true,
    configured: true,
  };
  it("does not apply an old profile load to the new profile", async () => {
    const old = delayed<typeof configA>();
    api.getVoiceInputConfig.mockImplementation((profile: string) =>
      profile === "a" ? old.promise : Promise.resolve(configB),
    );
    const view = render(
      <I18nProvider>
        <VoiceInputPane profile="a" />
      </I18nProvider>,
    );
    view.rerender(
      <I18nProvider>
        <VoiceInputPane profile="b" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Voice service URL")).toHaveValue(
        configB.url,
      ),
    );
    await act(async () => old.resolve(configA));
    expect(screen.getByLabelText("Voice service URL")).toHaveValue(configB.url);
  });
  it("does not apply an old profile save result to the new profile", async () => {
    const old = delayed<typeof configA>();
    api.getVoiceInputConfig.mockImplementation((profile: string) =>
      Promise.resolve(profile === "a" ? configA : configB),
    );
    api.saveVoiceInputConfig.mockReturnValue(old.promise);
    const view = render(
      <I18nProvider>
        <VoiceInputPane profile="a" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    view.rerender(
      <I18nProvider>
        <VoiceInputPane profile="b" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Voice service URL")).toHaveValue(
        configB.url,
      ),
    );
    await act(async () => old.resolve(configA));
    expect(screen.getByLabelText("Voice service URL")).toHaveValue(configB.url);
    expect(api.saveVoiceInputConfig).toHaveBeenCalledWith(
      expect.any(Object),
      "a",
    );
  });
  it("keeps controls disabled when loading the profile fails", async () => {
    api.getVoiceInputConfig.mockRejectedValue(
      Error("fixture config unavailable"),
    );
    render(
      <I18nProvider>
        <VoiceInputPane profile="failure" />
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "fixture config unavailable",
      ),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByLabelText("Voice service URL")).toBeDisabled();
  });
});
