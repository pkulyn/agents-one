import { useCallback, useEffect, useRef, useState } from "react";

const STREAM_SAMPLE_RATE = 16_000;

export interface UseVoiceInput {
  supported: boolean;
  recording: boolean;
  elapsedSeconds: number;
  recordingLimitSeconds: number | null;
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
}

interface AudioCapture {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  stream: MediaStream;
}

interface StreamingCaptureAudit {
  capturedChunks: number;
  capturedBytes: number;
  sendFailures: number;
}

function pcm16k(samples: Float32Array, sourceSampleRate: number): Uint8Array {
  const ratio = sourceSampleRate / STREAM_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Int16Array(outputLength);
  for (let index = 0; index < outputLength; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let sampleIndex = start; sampleIndex < Math.max(start + 1, end); sampleIndex += 1) {
      total += samples[sampleIndex] || 0;
    }
    const average = total / Math.max(1, end - start);
    const normalized = Math.max(-1, Math.min(1, average));
    output[index] = normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff;
  }
  return new Uint8Array(output.buffer);
}

/**
 * Captures microphone PCM for the configured streaming ASR service. The
 * service owns pause-based sentence finalization; the client only converts
 * Chromium's float samples to its required 16kHz, mono, signed-16-bit wire
 * format.
 */
export function useVoiceInput(
  onResult: (text: string, isFinal: boolean) => void,
  profile?: string,
): UseVoiceInput {
  // @lat: [[voice-input#Shared composer behavior]]
  const [recording, setRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const recordingStartedAtRef = useRef<number | null>(null);
  const completedTextRef = useRef("");
  const captureAuditRef = useRef<StreamingCaptureAudit>({
    capturedChunks: 0,
    capturedBytes: 0,
    sendFailures: 0,
  });
  const disposedRef = useRef(false);
  const startingRef = useRef(false);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const supported =
    typeof window.AudioContext !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  const stopCapture = useCallback((): void => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    capture.processor.onaudioprocess = null;
    try {
      capture.source.disconnect();
      capture.processor.disconnect();
      capture.sink.disconnect();
    } catch {
      // Nodes can already be disconnected during renderer teardown.
    }
    capture.stream.getTracks().forEach((track) => track.stop());
    void capture.context.close().catch(() => undefined);
  }, []);

  const captureAudit = useCallback((): StreamingCaptureAudit => {
    return { ...captureAuditRef.current };
  }, []);

  const publishTranscript = useCallback((isFinal: boolean): void => {
    const text = completedTextRef.current.trim();
    if (text) onResultRef.current(text, isFinal);
  }, []);

  useEffect(() => {
    return window.agentsOneAPI.onStreamingTranscriptionEvent((event) => {
      if (event.sessionId !== sessionIdRef.current || disposedRef.current) {
        return;
      }
      if (event.type === "final") {
        const finalText = (event.text || "").trim();
        if (finalText) completedTextRef.current += finalText;
        // v1.4 returns whole, punctuated sentences after a natural pause.
        // Immediately reflect the accumulating sentence list in the draft.
        publishTranscript(false);
        return;
      }
      if (event.type === "error") {
        sessionIdRef.current = null;
        recordingStartedAtRef.current = null;
        stopCapture();
        setRecording(false);
        setTranscribing(false);
        setError(event.message || "语音转写失败，请稍后重试。");
        return;
      }

      sessionIdRef.current = null;
      recordingStartedAtRef.current = null;
      stopCapture();
      setRecording(false);
      setTranscribing(false);
      publishTranscript(true);
    });
  }, [publishTranscript, stopCapture]);

  const start = useCallback(async (): Promise<void> => {
    if (!supported) {
      setError("当前环境不支持实时语音输入。");
      return;
    }
    if (startingRef.current) return;
    startingRef.current = true;

    let stream: MediaStream | null = null;
    let sessionId: string | null = null;
    try {
      const voiceConfig = await window.agentsOneAPI.getVoiceInputConfig(profile);
      if (!voiceConfig.enabled || !voiceConfig.configured) {
        throw new Error("语音输入尚未配置，请在设置中的“语音输入”完成服务接入。");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      sessionId = await window.agentsOneAPI.startStreamingTranscription(profile);
      if (disposedRef.current) {
        await window.agentsOneAPI.stopStreamingTranscription(sessionId, captureAudit());
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      sessionIdRef.current = sessionId;
      completedTextRef.current = "";
      captureAuditRef.current = {
        capturedChunks: 0,
        capturedBytes: 0,
        sendFailures: 0,
      };

      const context = new AudioContext({ sampleRate: STREAM_SAMPLE_RATE });
      const source = context.createMediaStreamSource(stream);
      // 4096 samples is ~256ms at 16kHz, within the service's 200–500ms
      // recommendation. A muted sink keeps ScriptProcessor active.
      const processor = context.createScriptProcessor(4096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      processor.onaudioprocess = (audioEvent): void => {
        const activeSessionId = sessionIdRef.current;
        if (!activeSessionId || disposedRef.current) return;
        const samples = audioEvent.inputBuffer.getChannelData(0);
        const audio = pcm16k(samples, audioEvent.inputBuffer.sampleRate);
        captureAuditRef.current.capturedChunks += 1;
        captureAuditRef.current.capturedBytes += audio.byteLength;
        void window.agentsOneAPI
          .sendStreamingAudio(activeSessionId, audio)
          .catch((cause: Error) => {
            captureAuditRef.current.sendFailures += 1;
            if (!disposedRef.current) {
              setError(cause.message || "实时语音音频发送失败。");
            }
          });
      };
      await context.resume();
      captureRef.current = { context, source, processor, sink, stream };
      stream = null;
      setError(null);
      recordingStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      setRecording(true);
    } catch (cause) {
      if (sessionId) {
        void window.agentsOneAPI.stopStreamingTranscription(sessionId, captureAudit());
      }
      sessionIdRef.current = null;
      stream?.getTracks().forEach((track) => track.stop());
      stopCapture();
      if (!disposedRef.current) {
        setRecording(false);
        setTranscribing(false);
        setError(
          (cause as Error).message || "无法启动实时语音输入，请检查麦克风和服务连接。",
        );
      }
    } finally {
      startingRef.current = false;
    }
  }, [captureAudit, profile, stopCapture, supported]);

  const stop = useCallback((): void => {
    const sessionId = sessionIdRef.current;
    stopCapture();
    recordingStartedAtRef.current = null;
    setRecording(false);
    if (!sessionId) return;
    setTranscribing(true);
    void window.agentsOneAPI.stopStreamingTranscription(sessionId, captureAudit()).catch((cause: Error) => {
      if (!disposedRef.current) {
        sessionIdRef.current = null;
        setTranscribing(false);
        setError(cause.message || "无法结束实时语音输入。");
      }
    });
  }, [captureAudit, stopCapture]);

  const toggle = useCallback((): void => {
    if (recording) {
      stop();
      return;
    }
    if (!transcribing) void start();
  }, [recording, start, stop, transcribing]);

  useEffect(() => {
    if (!recording) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = (): void => {
      const startedAt = recordingStartedAtRef.current;
      if (!startedAt) return;
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    };
    updateElapsed();
    const interval = setInterval(updateElapsed, 250);
    return () => clearInterval(interval);
  }, [recording]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      stopCapture();
      if (sessionId) {
        void window.agentsOneAPI.stopStreamingTranscription(sessionId, captureAudit());
      }
    };
  }, [captureAudit, stopCapture]);

  return {
    supported,
    recording,
    elapsedSeconds,
    recordingLimitSeconds: null,
    transcribing,
    error,
    toggle,
  };
}
