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

SDK tests protect capability truthfulness, terminal ordering, Workspace evidence, request-body compatibility, stable deduplication, artifacts, and CLI stream framing.

`plugins/agents-one-plugin/test/plugin.test.mjs` covers successful and failed terminal refreshes, stable declared flags, relative Workspace metadata, unsafe-path removal, mixed string/Buffer bodies, Artifact round trips, and JSONL records split across chunks.
