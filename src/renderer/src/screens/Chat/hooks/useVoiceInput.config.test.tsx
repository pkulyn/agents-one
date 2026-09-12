import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t as translate } from "../../../../../shared/i18n";

vi.mock("../../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, "zh-CN", options),
  }),
}));

import { useVoiceInput } from "./useVoiceInput";

describe("useVoiceInput service configuration gate", () => {
  const getUserMedia = vi.fn();

  beforeEach(() => {
    Object.defineProperty(window, "AudioContext", {
      value: class AudioContext {},
      configurable: true,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia },
      configurable: true,
    });
    Object.defineProperty(window, "agentsOneAPI", {
      value: {
        getVoiceInputConfig: vi.fn().mockResolvedValue({
          enabled: false,
          configured: false,
          url: "",
          hasApiKey: false,
        }),
        onStreamingTranscriptionEvent: vi.fn(() => () => undefined),
      },
      configurable: true,
      writable: true,
    });
    getUserMedia.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not request microphone permission when voice input is disabled", async () => {
    // @lat: [[voice-input#Main-process service routing]]
    const { result } = renderHook(() => useVoiceInput(vi.fn()));

    result.current.toggle();

    await waitFor(() => {
      expect(result.current.error).toContain("语音输入尚未配置");
    });
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
