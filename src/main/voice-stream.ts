import { randomUUID } from "crypto";
import {
  getVoiceTranscriptionConfig,
  type VoiceTranscriptionConfig,
} from "./hermes";

const CONNECT_TIMEOUT_MS = 10_000;
const STOP_GRACE_MS = 2_000;
const MAX_STREAM_CHUNK_BYTES = 256 * 1024;
const MAX_AUDITED_FINALS = 200;
const MAX_AUDITED_FINAL_TEXT_LENGTH = 2_000;

type VoiceWebSocketRawData = string | Buffer | ArrayBuffer | Buffer[];

interface VoiceWebSocket {
  readonly readyState: number;
  once(event: "open", listener: () => void): this;
  on(
    event: "message",
    listener: (data: VoiceWebSocketRawData, isBinary: boolean) => void,
  ): this;
  on(event: "error", listener: (cause: Error) => void): this;
  on(event: "close", listener: () => void): this;
  send(
    data: Buffer,
    options: { binary: boolean },
    callback?: (cause?: Error) => void,
  ): void;
  close(): void;
}

interface VoiceWebSocketConstructor {
  new (
    address: string,
    options?: { headers?: Record<string, string> },
  ): VoiceWebSocket;
  readonly OPEN: number;
}

// `ws` is a runtime dependency without bundled TypeScript declarations in this
// desktop build. Keep its narrow transport contract local rather than exposing
// the package to renderer types.
const VoiceWebSocket = require("ws") as VoiceWebSocketConstructor;

export type StreamingTranscriptionEvent =
  | { sessionId: string; type: "final"; text: string }
  | { sessionId: string; type: "error"; message: string }
  | { sessionId: string; type: "ended" };

export interface StreamingCaptureAudit {
  capturedChunks: number;
  capturedBytes: number;
  sendFailures: number;
}

interface StreamingAuditState {
  startedAt: number;
  sentChunks: number;
  sentBytes: number;
  finalCount: number;
  finals: Array<{ elapsedMs: number; text: string }>;
  rendererCapture: StreamingCaptureAudit | null;
}

interface StreamingSession {
  socket: VoiceWebSocket;
  senderId: number;
  notify: (event: StreamingTranscriptionEvent) => void;
  stopTimer: ReturnType<typeof setTimeout> | null;
  opened: boolean;
  ended: boolean;
  audit: StreamingAuditState;
}

const sessions = new Map<string, StreamingSession>();

function voiceStreamingAuditEnabled(): boolean {
  return process.env.AGENTS_ONE_VOICE_STREAM_AUDIT === "1";
}

function normalizedAuditCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

export function normalizeStreamingCaptureAudit(
  value: unknown,
): StreamingCaptureAudit | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StreamingCaptureAudit>;
  return {
    capturedChunks: normalizedAuditCount(record.capturedChunks),
    capturedBytes: normalizedAuditCount(record.capturedBytes),
    sendFailures: normalizedAuditCount(record.sendFailures),
  };
}

function emitAudit(sessionId: string, session: StreamingSession): void {
  if (!voiceStreamingAuditEnabled()) return;
  console.info(
    "[voice-stream-audit]",
    JSON.stringify({
      sessionId,
      elapsedMs: Date.now() - session.audit.startedAt,
      renderer: session.audit.rendererCapture,
      main: {
        sentChunks: session.audit.sentChunks,
        sentBytes: session.audit.sentBytes,
      },
      finalCount: session.audit.finalCount,
      finals: session.audit.finals,
      finalsTruncated: session.audit.finalCount > session.audit.finals.length,
    }),
  );
}

function streamingUrl(config: VoiceTranscriptionConfig): string {
  const url = new URL(config.url);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = url.pathname.replace(
    /\/v1\/audio\/transcriptions$/,
    "/v1/audio/transcriptions/stream",
  );
  return url.toString();
}

function messageText(data: VoiceWebSocketRawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf-8");
  if (data instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(data)).toString("utf-8");
  }
  return data.toString("utf-8");
}

function closeSession(sessionId: string, session: StreamingSession): void {
  if (session.ended) return;
  session.ended = true;
  if (session.stopTimer) clearTimeout(session.stopTimer);
  session.stopTimer = null;
  sessions.delete(sessionId);
  emitAudit(sessionId, session);
  session.notify({ sessionId, type: "ended" });
}

function failSession(
  sessionId: string,
  session: StreamingSession,
  message: string,
): void {
  if (session.ended) return;
  session.notify({ sessionId, type: "error", message });
  try {
    session.socket.close();
  } catch {
    // The close event below finalizes state even if the socket is already gone.
  }
}

export async function startStreamingTranscription(
  senderId: number,
  notify: (event: StreamingTranscriptionEvent) => void,
  profile?: string,
): Promise<string> {
  const config = getVoiceTranscriptionConfig(profile);
  const sessionId = randomUUID();
  const socket = new VoiceWebSocket(streamingUrl(config), {
    headers: config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : undefined,
  });
  const session: StreamingSession = {
    socket,
    senderId,
    notify,
    stopTimer: null,
    opened: false,
    ended: false,
    audit: {
      startedAt: Date.now(),
      sentChunks: 0,
      sentBytes: 0,
      finalCount: 0,
      finals: [],
      rendererCapture: null,
    },
  };
  sessions.set(sessionId, session);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const connectTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      failSession(sessionId, session, "Voice service connection timed out.");
      reject(new Error("Voice service connection timed out."));
    }, CONNECT_TIMEOUT_MS);
    const rejectStart = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimeout);
      reject(new Error(message));
    };

    socket.once("open", () => {
      if (session.ended) return;
      session.opened = true;
      if (!settled) {
        settled = true;
        clearTimeout(connectTimeout);
        resolve(sessionId);
      }
    });
    socket.on("message", (data, isBinary) => {
      if (isBinary || session.ended) return;
      let message: { type?: unknown; text?: unknown; message?: unknown };
      try {
        message = JSON.parse(messageText(data)) as typeof message;
      } catch {
        failSession(
          sessionId,
          session,
          "Voice service returned an invalid streaming response.",
        );
        return;
      }
      if (message.type === "final" && typeof message.text === "string") {
        session.audit.finalCount += 1;
        if (
          voiceStreamingAuditEnabled() &&
          session.audit.finals.length < MAX_AUDITED_FINALS
        ) {
          session.audit.finals.push({
            elapsedMs: Date.now() - session.audit.startedAt,
            text: message.text.slice(0, MAX_AUDITED_FINAL_TEXT_LENGTH),
          });
        }
        session.notify({
          sessionId,
          type: message.type,
          text: message.text,
        });
        return;
      }
      if (message.type === "error") {
        failSession(
          sessionId,
          session,
          typeof message.message === "string"
            ? message.message
            : "Voice service streaming failed.",
        );
      }
    });
    socket.on("error", (cause: Error) => {
      const message = cause.message || "Voice service streaming failed.";
      if (!session.opened) rejectStart(message);
      failSession(sessionId, session, message);
    });
    socket.on("close", () => {
      clearTimeout(connectTimeout);
      if (!session.opened) rejectStart("Voice service connection closed.");
      closeSession(sessionId, session);
    });
  });
}

export function sendStreamingAudio(
  sessionId: string,
  senderId: number,
  audio: Uint8Array,
): void {
  const session = sessions.get(sessionId);
  if (!session || session.ended || session.senderId !== senderId) {
    throw new Error("Voice streaming session is no longer available.");
  }
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) return;
  if (audio.byteLength > MAX_STREAM_CHUNK_BYTES) {
    throw new Error("Voice streaming audio chunk is too large.");
  }
  if (session.socket.readyState !== VoiceWebSocket.OPEN) {
    throw new Error("Voice streaming connection is not open.");
  }
  session.audit.sentChunks += 1;
  session.audit.sentBytes += audio.byteLength;
  session.socket.send(Buffer.from(audio), { binary: true }, (cause) => {
    if (cause) {
      failSession(
        sessionId,
        session,
        cause.message || "Voice service streaming failed.",
      );
    }
  });
}

export function stopStreamingTranscription(
  sessionId: string,
  senderId: number,
  captureAudit?: StreamingCaptureAudit,
): void {
  const session = sessions.get(sessionId);
  if (!session || session.ended || session.senderId !== senderId) return;
  session.audit.rendererCapture = normalizeStreamingCaptureAudit(captureAudit);
  if (session.socket.readyState !== VoiceWebSocket.OPEN) {
    try {
      session.socket.close();
    } catch {
      // Socket close is best-effort during application teardown.
    }
    return;
  }
  session.socket.send(Buffer.alloc(0), { binary: true }, () => {
    session.stopTimer = setTimeout(() => {
      try {
        session.socket.close();
      } catch {
        // Closing an already closed socket is harmless.
      }
    }, STOP_GRACE_MS);
  });
}
