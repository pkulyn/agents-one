# Adapter Registry

Agents One resolves Runtime identity, configuration metadata, and adapter availability through a registry so new local or remote agents do not require parallel hard-coded UI lists.

## Registry contract

The renderer-safe contract lives in `src/shared/runtime-adapters.ts`. The main-process registry lives in `src/main/runtime-adapters/registry.ts` and owns unique adapter IDs, manifest lookup, legacy-kind resolution, and future execution hooks.

## Built-in adapters

The initial manifest catalog registers Hermes, Codex, Claude Code, Pi Agent, OpenCode, OpenClaw, and the browser-backed Web Agent. OpenCode supports local CLI/ACP and the first remote Host/Gateway v1 delivery; OpenClaw remains remote Gateway v1.

The OpenCode adapter uses a shell-free local process and ACP JSON-RPC over stdio for initialize, session creation/resume, prompt streaming, permission responses, cancellation, and local diff evidence. ACP `agent_thought_chunk` and `agent_message_chunk` values are deltas: the adapter accumulates thought deltas into bounded snapshots before emitting Runtime progress, while only message deltas contribute to the final answer. OpenCode session `configOptions` and usage updates are normalized into the canonical Run model/usage metadata; local-process redaction preserves token counters while still removing credential fields. Every OpenCode prompt carries a bounded Agents One/OpenCode identity instruction scoped to self-identification, so the underlying model cannot silently present itself as another client while product comparisons remain possible. Workspace diffs contain only relative paths plus bounded size/SHA-256 evidence. A configured workspace is probe-only; task execution uses the explicitly selected conversation workspace, and a workspace-less automatic conversation is read-only. The OpenClaw adapter keeps the desktop boundary on Agents One Gateway v1; vendor-native credentials stay behind the remote Adapter/Connector.

OpenCode ACP `tool_call` and `tool_call_update` events are handled by the OpenCode adapter before generic event normalization. The adapter retains the first stable tool title (completed frames may replace it with a path), correlates updates by `toolCallId`, sanitizes workspace paths to relative paths, preserves bounded input/output summaries, and emits canonical tool call/result/error events. The renderer merges repeated snapshots for one call id, so a tool first appears by name and then gains its arguments without producing duplicate rows. OpenCode 1.x currently reports reasoning deltas but no session-level thinking/reasoning option in ACP `configOptions`; the toolbar therefore displays an explicit `思考 自动` status and explains that the current model controls reasoning. A selectable picker remains reserved for runtimes that return verified levels.

OpenCode assistant chunks are already delivered through the ACP adapter's `onOutput` channel; [[src/main/agent-runtimes.ts#appendOutputEvent]] must not send them through the legacy Hermes JSONL fallback. The main process also merges repeated structured `tool_call` snapshots by `tool.callId`, and [[src/main/runtime-adapters/event-normalizer.ts#normalizeRuntimeEvent]] accepts wrapped ACP payloads as a defense-in-depth path. This protects both the live transcript and the durable Runtime conversation from generic “工具调用已开始”/“Hermes 正在生成回复” pollution. A previously archived generic event has no recoverable ACP payload and is not rewritten retroactively.

## Manifest-driven configuration

Preload exposes serializable manifests; the Runtime form renders declared non-secret fields and stores bounded future values in `adapterOptions`.

## Compatibility and quarantine

Runtime records preserve adapter metadata and unknown future kinds. Legacy records derive metadata on read, while unknown kinds remain visible and probe as unsupported.

Runtime conversation storage applies the same bounded kind validation, so OpenCode, OpenClaw, and future adapter conversations are not dropped during persistence. Runtime execution metadata is persisted with the final OpenCode answer, and incomplete optional artifact records are ignored safely instead of aborting the whole conversation save.

## UI and CLI discovery

`list-agent-runtime-adapters` exposes only serializable manifests through preload. Local CLI detection reads the same manifest catalog, so adding a CLI command does not require another detection list.

## Conformance and verification

Registration rejects malformed identity, route, field, and Secret declarations. Tests cover migration, quarantine, Windows shims, ACP events, Gateway authorization, and main dispatch.

## Remote CLI hosting

Remote CLI execution shares one provider-neutral Host, Gateway v1, and multi-Runtime Connector instead of adding a Relay or pairing stack per CLI.

The first delivery combines the Host and multi-Runtime Connector foundation with the OpenCode ACP remote Adapter implementation. OpenCode remains behind an independent rollout flag until its remote conformance gates pass. Remote Pi RPC, Codex App Server, and Claude Code SDK stay deferred and local-only until separately approved, informed by the OpenCode implementation. No provider may add a dedicated Relay, pairing flow, or Gateway. See `docs/AGENTS_ONE_UNIFIED_RUNTIME_ACCESS_PRD_20260905.md` and [[remote-cli-host]].
