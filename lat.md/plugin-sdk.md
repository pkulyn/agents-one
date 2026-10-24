# Plugin SDK

The Plugin SDK hosts provider adapters behind Remote Gateway v1 while preserving truthful capability discovery, durable event ordering, and redacted operational evidence.

## Stable event capabilities

Event-stream enhancement flags describe Adapter support at process startup; they do not change based on which event types happened to appear in recent runs.

`plugins/agents-one-plugin/src/remote-gateway-plugin.mjs` reads the Adapter's `capabilities.eventStream` object once and normalizes it through `eventStreamCapability` in `src/event-stream.mjs`. Undeclared reasoning, tool, model, or usage flags remain absent, so basic adapters keep working without claiming telemetry they cannot produce.

## Provider evidence before terminal state

Provider events must be appended before the SDK synthesizes `run.completed` or `run.failed`, keeping final answers and operational evidence inside the run boundary.

The Gateway plugin refreshes output, artifacts, model, usage, and Adapter events before applying terminal status. Connector adapters return `assistant.completed`, tool, and Workspace events through the standard `getRun().events` array instead of mutating the SDK's internal journal.

## Redacted workspace evidence

Durable Workspace events retain only safe operation metadata and Grant-relative paths, while tool timing and stable call identifiers remain available for audit.

`EventJournal` accepts the v1 Workspace operations, drops absolute or parent-traversal paths, keeps stable event IDs, and preserves non-negative tool duration fields. Its existing text sanitization continues to redact credentials and absolute paths in summaries.

## Request body compatibility

Gateway request decoding accepts Buffer, typed-array, and string chunks because Connector and proxy implementations do not all expose Node HTTP bodies in the same representation.

`readJsonBody` normalizes every chunk to a Buffer before concatenation and JSON parsing, preventing string chunks from crashing `Buffer.concat`.

## Proxy-safe SSE responses

SSE responses leave hop-by-hop connection negotiation to Node and the reverse proxy, preventing a completed event stream from poisoning the next pooled Gateway request.

`plugins/agents-one-plugin/src/remote-gateway-plugin.mjs` does not emit an explicit `Connection` response header. It disables intermediary transformation and nginx buffering while allowing incoming `Connection: close` and ordinary HTTP/1.1 requests to keep their native socket semantics.

## Regression coverage

SDK tests protect capability truthfulness, terminal ordering, Workspace evidence, body compatibility, stable deduplication, artifacts, CLI framing, and isolation between completed SSE responses and later Run requests through a pooled reverse proxy.

`plugins/agents-one-plugin/test/plugin.test.mjs` covers successful and failed terminal refreshes, stable declared flags, relative Workspace metadata, unsafe-path removal, mixed string/Buffer bodies, Artifact round trips, JSONL records split across chunks, and three consecutive `POST /runs` requests after consuming SSE through a one-socket reverse-proxy pool in both default and `Connection: close` modes.

SSE resume accepts either a numeric sequence or a previously emitted stable event ID in `Last-Event-ID`; only later journal entries are replayed. Five alternating numeric/stable reconnects protect against proxy-state pollution and intermittent HTTP 400 responses. Production and release-acceptance Gateway deployments must also provide a durable `statePath`. Without it, the SDK remains suitable only for ephemeral development because a process restart cannot reconcile an in-memory Run.

The public diagnostic `scripts/diagnose-gateway-sse-post.mjs` selects the Agents One Gateway v1 object-input/`id` contract for `/agents-one/v1` endpoints and the native Hermes v1 string-input/`run_id` contract for `/v1` endpoints. Its regression server exercises both forms, preventing a request-shape mismatch from being misreported as an SSE or proxy failure.

## Conversation and provider identities

Gateway conversation identity is stable from the first adapter request; provider session identity remains separate and is recovered from durable Runs within the same Runtime.

The SDK passes the generated or supplied conversationId to `adapter.startRun`, preserving the original request fingerprint for idempotency. Follow-up requests receive the latest provider sessionId for that conversation from the persisted Run journal. Older clients that saved a provider ID can resolve that alias within the same Runtime, without rewriting history. Desktop Gateway runs retain conversationId before sessionId so later requests continue using the canonical Gateway identity. `test/conversation.test.mjs` covers first-turn binding, retry idempotency, process restart, Runtime isolation and legacy aliases; `tests/agent-runtimes.test.ts` covers four dispatches with distinct Gateway/provider identities.

## ACP continuation and replay

OpenCode restores existing native sessions using advertised ACP v1 capabilities and suppresses loaded history so previous answers do not appear as new output.

Local and remote adapters accept object or boolean `resume` capabilities, prefer `session/resume`, and otherwise use `session/load` when `loadSession` is true. An empty restore result retains the requested native sessionId. Missing capabilities or restore errors fail explicitly without creating another session. `tests/opencode-acp.test.ts` and `test/opencode-continuation.test.mjs` protect capability variants, empty responses, replay suppression and restoration failure. Controlled protocol regressions do not replace real Runtime conversations against the fixed candidate.

## Diagnostic terminal reconciliation

The SSE diagnostic refreshes every Run to a terminal state before starting another request, preventing the diagnostic itself from exhausting concurrency slots.

`scripts/diagnose-gateway-sse-post.mjs` consumes both event streams and polls each Run with a bounded deadline. `tests/gateway-sse-diagnostic.test.ts` uses one active slot released only by GET reconciliation for both supported contracts, so missing reconciliation fails the regression.

## ACP turn deadlines

Local ACP turns require a task deadline distinct from the handshake deadline, and cancellation must allow the native agent to finish stopping tools before its process is cleaned up.

### Long prompt completion

A real ACP child takes more than thirty seconds to finish a prompt within the Runtime deadline; the caller must receive the complete response instead of a handshake timeout.

### Cancellation preserves continuation

A real ACP child acknowledges tool cancellation after a delay and persists its state; the next process restores the same native session and successfully responds, detecting premature process termination.

### Configured deadline remains bounded

A short configured Runtime deadline aborts a longer prompt after successful initialization, ensuring the extended default cannot bypass the user's task limit.

### Unresponsive cancellation cleanup

An ACP child that ignores cancellation is forcibly cleaned up after a bounded grace window, ensuring graceful cancellation cannot indefinitely block the desktop or leave its process running.
