# Remote CLI Host

Remote CLI Host is the shared provider-neutral process boundary for remote structured CLI Runtimes, with OpenCode ACP as the first implemented remote Adapter.

## Shared Gateway and Runtime routing

One Host owns one authenticated Gateway v1 server and registers one or more explicit Runtime IDs; every Run, cancellation, model/usage update, event, Artifact, and whitelisted Runtime command request is dispatched to the selected registered Adapter.

The Host rejects duplicate or malformed Runtime IDs, rejects disabled Runtimes, requires `runtimeId` when more than one Runtime is registered, and never accepts an arbitrary command, executable, shell string, or unrestricted path from a Gateway request. Connect forwards only the same Gateway v1 allowlist, including `/commands/catalog` and `/commands/execute`; administrative or proxy paths remain rejected.

Host state may be persisted through `statePath` using the Gateway SDK's atomic snapshot. Idempotency records, provider session identity, terminal Run evidence, model/usage metadata, and bounded journal entries survive a process restart. Queued/running/cancelling Runs enter an explicit reconciliation state on the next query; an Adapter may implement `reconcileRun(vendorRunId, record, context)` to rehydrate provider evidence, otherwise the Host emits a deterministic `host_restart_reconciliation_required` failure instead of silently reporting success.

Production Hosts should pass `trustedAdapterIds` and `requireAdapterManifest: true`; a manifest ID must match the Runtime registration, and `verifyAdapter` can add signature or local trust-store checks. Runtime-specific `limits.maxConcurrentRuns` is enforced before dispatch. OpenCode only receives the default safe process environment plus explicitly allowlisted keys (`allowedEnv`); arbitrary Gateway input cannot add environment variables, commands, or paths.

Published Artifact bytes are stored beside the atomic Host state when `statePath` is configured, so completed output remains downloadable after a Host restart. The persisted state contains metadata only; credentials, absolute paths, and raw provider output are not placed in the journal or diagnostic payload.

## OpenCode ACP remote Adapter

OpenCode ACP is the first remote Adapter implemented on the shared Host.

The Adapter starts the configured executable through shell-free ACP JSON-RPC, creates or resumes sessions, separates assistant deltas from reasoning summaries and tool events, records provider-reported `actualModel` and usage, handles cancellation and permissions, and publishes bounded workspace changes as Artifacts.

Adapter probing performs an ACP `initialize` handshake and reports the detected
OpenCode runtime version; it is not satisfied by a standalone executable
`--version` check. Host workspace paths are realpath-normalized and must remain
inside the configured Host root, including when a requested directory is a
symbolic link.

Analysis-only runs cancel permission requests; file or tool runs require the Host's configured workspace and keep workspace evidence relative, bounded, and hashable. The Adapter does not expose raw chain of thought, credentials, environment variables, absolute paths, or an unregistered executable.

## Multi-Runtime Connector contract

A Connector can publish multiple explicitly authorized Runtimes through one versioned tunnel.

It advertises a Runtime list in the Connect hello and forwards the selected `runtimeId`; legacy single-Runtime credentials and hello messages remain readable, while the server authorizes and routes each listed Runtime independently.

Connect device status exposes only the non-secret Connector version, protocol,
online state, and last-seen timestamp. The Settings diagnostics view combines
that status with Desktop/Gateway/Host/Adapter/Provider and last-Run metadata;
tokens, private keys, full paths, and model text remain excluded.

The desktop persists the primary and additional claimed Runtime descriptors separately, retaining the Runtime-scoped managed credential and explicit Connect route for each Runtime. Pairing responses may include a legacy aggregate token for backward compatibility, but new desktop Runtime records use the scoped token and never expose either token to Renderer. Artifact requests carry the same Runtime identity through a restricted header so a shared Host cannot accidentally dispatch them to its primary Adapter.

## Verification

Tests cover the ACP boundary, event separation, metadata, Artifacts, and two-Runtime routing.

Connector contract tests inject a deterministic Windows credential protector on
Windows CI, so the non-interactive runner profile cannot make the transport
suite flaky. The real current-user DPAPI round trip is a separate explicit
interactive-Windows acceptance command: `npm --prefix
plugins/agents-one-connector run test:dpapi`. The production protector remains
bounded by `DPAPI_TIMEOUT_MS` (60 seconds) to tolerate a cold user-profile
initialization without waiting indefinitely or exposing child-process output.

Production rollout still requires real OpenCode versions, provider login, Windows/Linux, reconnect, and Connect E2E gates from the unified Runtime PRD.

## First-phase rollout gate

Remote OpenCode has an independent rollout gate; Pi, Codex, and Claude Code remain local-only.

The gate is `AGENTS_ONE_REMOTE_OPENCODE_V1`. Tests and development enable it by default; packaged environments keep it disabled unless deployment explicitly sets the flag to `1`. The registry removes the remote location/transport when disabled, and Main rejects save, probe, and task dispatch for an existing remote OpenCode Runtime.
