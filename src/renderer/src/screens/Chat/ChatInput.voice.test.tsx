import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const voiceMock = vi.hoisted(() => ({
  onResult: null as ((text: string, isFinal: boolean) => void) | null,
  toggle: vi.fn(),
  state: {
    supported: true,
    recording: false,
    elapsedSeconds: 0,
    recordingLimitSeconds: null as number | null,
    transcribing: false,
    error: null as string | null,
  },
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "zh-CN",
    setLocale: vi.fn(),
  }),
}));

vi.mock("./hooks/useVoiceInput", () => ({
  useVoiceInput: (
    onResult: (text: string, isFinal: boolean) => void,
  ): unknown => {
    voiceMock.onResult = onResult;
    return { ...voiceMock.state, toggle: voiceMock.toggle };
  },
}));

import { ChatInput } from "./ChatInput";

describe("ChatInput voice transcription", () => {
  beforeEach(() => {
    voiceMock.onResult = null;
    voiceMock.toggle.mockReset();
    voiceMock.state = {
      supported: true,
      recording: false,
      elapsedSeconds: 0,
      recordingLimitSeconds: null,
      transcribing: false,
      error: null,
    };
  });

  afterEach(cleanup);

  it("commits punctuated final sentences to the existing draft without sending", () => {
    // @lat: [[voice-input#Shared composer behavior]]
    const onSubmit = vi.fn();
    render(
      <ChatInput
        isLoading={false}
        hasSession
        onSubmit={onSubmit}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "chat.typeMessage",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "请帮我" } });
    fireEvent.click(screen.getByRole("button", { name: "chat.voiceInput" }));

    expect(voiceMock.toggle).toHaveBeenCalledTimes(1);
    act(() => voiceMock.onResult?.("总结这份文档。", false));
    act(() => voiceMock.onResult?.("总结这份文档。请列出待办事项。", true));

    expect(textarea.value).toBe("请帮我 总结这份文档。请列出待办事项。");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a transcription error without changing the draft", () => {
    voiceMock.state.error = "语音服务暂时不可用";
    render(
      <ChatInput
        isLoading={false}
        hasSession
        onSubmit={vi.fn()}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "语音服务暂时不可用",
    );
  });

  it("shows the animated recording status above the composer", () => {
    voiceMock.state.recording = true;
    voiceMock.state.elapsedSeconds = 17;
    render(
      <ChatInput
        isLoading={false}
        hasSession
        onSubmit={vi.fn()}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-voice-recording-indicator")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "chat.voiceRecording",
    );
    expect(screen.getByRole("status").textContent).toContain("00:17");
    expect(screen.getByRole("status").textContent).not.toContain("02:00");
  });

  it("toggles recording with Ctrl+M", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession
        onSubmit={vi.fn()}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });

    expect(voiceMock.toggle).toHaveBeenCalledTimes(1);
  });

  it("places the microphone directly after toolbar extras such as the globe", () => {
    render(
      <ChatInput
        isLoading={false}
        hasSession
        toolbarExtras={<button aria-label="web globe" type="button" />}
        onSubmit={vi.fn()}
        onQuickAsk={vi.fn()}
        onAbort={vi.fn()}
      />,
    );

    const globe = screen.getByRole("button", { name: "web globe" });
    const microphone = screen.getByRole("button", {
      name: "chat.voiceInput",
    });
    expect(
      globe.compareDocumentPosition(microphone) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
