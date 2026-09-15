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

## Regression coverage

SDK tests protect capability truthfulness, terminal ordering, Workspace evidence, request-body compatibility, stable deduplication, artifacts, CLI stream framing, and isolation between a completed SSE response and the next Run request.

`plugins/agents-one-plugin/test/plugin.test.mjs` covers successful and failed terminal refreshes, stable declared flags, relative Workspace metadata, unsafe-path removal, mixed string/Buffer bodies, Artifact round trips, JSONL records split across chunks, and a second `POST /runs` over an independent connection immediately after consuming `GET /runs/{id}/events`.

The public diagnostic `scripts/diagnose-gateway-sse-post.mjs` selects the Agents One Gateway v1 object-input/`id` contract for `/agents-one/v1` endpoints and the native Hermes v1 string-input/`run_id` contract for `/v1` endpoints. Its regression server exercises both forms, preventing a request-shape mismatch from being misreported as an SSE or proxy failure.
