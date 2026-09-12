# Voice input

Voice input turns one recorded utterance into an editable composer draft while preserving the existing task, attachment, persistence, and send paths.

## Shared composer behavior

The shared composer owns the microphone UI, so both native Hermes chat and every Runtime task conversation receive the same behavior without duplicating send logic.

[[src/renderer/src/screens/Chat/ChatInput.tsx#ChatInput]] places the microphone directly to the right of the web-preview globe in the composer toolbar; click it or press `Ctrl+M` to start and stop. It snapshots the existing draft when recording starts. [[src/renderer/src/screens/Chat/hooks/useVoiceInput.ts#useVoiceInput]] converts microphone samples to 16kHz PCM and sends them continuously while Osaka ASR v1.4 returns only punctuated sentence-level final text after a natural pause. It appends each whole sentence to the draft, exposes an elapsed timer with no upper bound, and never auto-submits transcript text. Failures leave draft text and attachments intact.

Provider error details are shown verbatim when present; platform-authored unsupported, configuration, start, transport, transcription, and stop fallbacks follow the active application locale.

## Main-process service routing

The main process owns the transcription endpoint and optional Bearer credential so remote page code cannot read them.

[[src/renderer/src/components/settings/VoiceInputPane.tsx#VoiceInputPane]] lets each Profile opt into a self-hosted or trusted compatible service. Its URL and enabled state are validated in [[src/main/hermes.ts#saveVoiceInputConfig]], while the optional key is accepted only for saving/testing and never returned to Renderer. New installations have no default service URL, so [[src/main/hermes.ts#getVoiceTranscriptionConfig]] rejects voice capture until the user explicitly enables a configured endpoint. [[src/main/voice-stream.ts#startStreamingTranscription]] then derives a `ws:`/`wss:` `/v1/audio/transcriptions/stream` endpoint, owns the WebSocket and optional Bearer credential, verifies the IPC sender for every audio chunk, and relays only validated v1.4 `final`, error, and end events through [[src/main/ipc/register.ts#registerIpcHandlers]]. The legacy file-upload [[src/main/hermes.ts#transcribeAudio]] remains available for API compatibility but composer voice input uses the stream. No Runtime, conversation, project, or history schema is modified.

## Transport and privacy boundary

Recording is an explicit user action, but transport security remains a deployment responsibility.

The v1.4 service is streaming and single-connection serial, so renderer audio capture and service responses run independently rather than retranscribing cumulative recordings. It uses a 0.8-second pause to return whole punctuated sentences instead of partial frames. Streaming removes the 120-second and 25 MB whole-clip bounds; each IPC audio chunk is capped at 256 KiB as a transport sanity check. `AGENTS_ONE_VOICE_STREAM_AUDIT=1` adds an opt-in, in-memory connection summary to Main logs: Renderer capture counts, Main WebSocket counts, and final-text sequence with timestamps. It never writes the audit to chat history, task/project data, or configuration, and must be disabled after testing because the opt-in log contains transcript text. While recording, the composer renders an accessible sound-wave status and elapsed-time counter above itself; it disappears when capture stops. New open-source installs send no audio until a user enables a specific service from Settings; the health-only connection test uploads no audio. Production deployments must use HTTPS/WSS before enabling Bearer authentication because an HTTP/WS endpoint exposes both audio and credentials in transit. The operational setup lives in `docs/AGENTS_ONE_VOICE_INPUT.md`.
