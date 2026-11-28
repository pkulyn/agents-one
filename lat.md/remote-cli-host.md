# Remote CLI Host

Remote CLI Host is the shared provider-neutral process boundary for remote structured CLI Runtimes, with OpenCode ACP as the first implemented remote Adapter.

## Shared Gateway and Runtime routing

One Host owns one authenticated Gateway v1 server and registers one or more explicit Runtime IDs; every Run, cancellation, model/usage update, event, Artifact, and whitelisted Runtime command request is dispatched to the selected registered Adapter.

The Host rejects duplicate or malformed Runtime IDs, rejects disabled Runtimes, requires `runtimeId` when more than one Runtime is registered, and never accepts an arbitrary command, executable, shell string, or unrestricted path from a Gateway request. Connect forwards only the Gateway v1 allowlist, including Runtime commands and run approval replies. The production loopback adapter forwards the selected Runtime ID and retains finite SSE snapshots as text. On a multi-Runtime Host, the request route binds a new Run and gates Run reads, cancellation, approvals, and published Artifacts. Legacy Artifact ownership is recovered only when the persisted Run references identify a single Runtime.

Host state may be persisted through `statePath` using the Gateway SDK's atomic snapshot. Idempotency records, provider session identity, terminal Run evidence, model/usage metadata, and bounded journal entries survive a process restart. Queued/running/cancelling Runs enter an explicit reconciliation state on the next query; an Adapter may implement `reconcileRun(vendorRunId, record, context)` to rehydrate provider evidence, otherwise the Host emits a deterministic `host_restart_reconciliation_required` failure instead of silently reporting success.

Before refusing admission on the Runtime concurrency limit, the Host reconciles the blocking records from their adapter, so a run that finished while nobody was polling it frees its slot instead of leaking it; genuinely still-active blockers keep the 429.

Production Hosts should pass `trustedAdapterIds` and `requireAdapterManifest: true`; a manifest ID must match the Runtime registration, and `verifyAdapter` can add signature or local trust-store checks. Runtime-specific `limits.maxConcurrentRuns` is enforced before dispatch. OpenCode only receives the default safe process environment plus explicitly allowlisted keys (`allowedEnv`); arbitrary Gateway input cannot add environment variables, commands, or paths.

A Main-only staging helper validates a remote artifact checksum and filename, uses isolated run and artifact directories, rejects aliases and conflicts, and permits identical retries. A separate fail-closed scope decision treats missing, unmatched, private or ambiguous intervention state as private. For active remote roles, Main rechecks the persisted assignment and scope after authenticated download, verifies the run and download checksums, and stages the file before exposing a relative delivery path. Projectless tasks use a Main-owned directory; project tasks resolve the saved workspace capability or an authorized legacy project root on each delivery. Revoked or unknown project authorization prevents shared staging.

Published Artifact bytes are stored beside the atomic Host state when `statePath` is configured, so completed output remains downloadable after a Host restart. The persisted state contains metadata only; credentials, absolute paths, and raw provider output are not placed in the journal or diagnostic payload.

## User-level Host launcher

The SDK CLI can probe one registered native adapter or serve an explicit set of Runtime descriptors from a local configuration.

The launcher requires a durable absolute state path and workspace roots, binds only to loopback and reads its Gateway credential from the Host process environment. The ready record reports descriptor metadata with no credentials. Hers can remain on its own Gateway and share the Connector with this Host.

## OpenCode ACP remote Adapter

OpenCode ACP is the first remote Adapter implemented on the shared Host.

The Adapter starts the configured executable through shell-free ACP JSON-RPC, creates or resumes sessions, separates assistant deltas from reasoning summaries and tool events, records provider-reported `actualModel` and usage, handles cancellation and permissions, and publishes bounded workspace changes as Artifacts.

Adapter probing performs an ACP `initialize` handshake and reports the detected
OpenCode runtime version; it is not satisfied by a standalone executable
`--version` check. Host workspace paths are realpath-normalized and must remain
inside the configured Host root, including when a requested directory is a
symbolic link.

OpenCode ACP handshake requests use a short deadline; a model turn has a separate five-minute default, configurable by the trusted Host up to one hour. Cancellation remains available while the turn is running.

Analysis-only runs cancel permission requests; file or tool runs require the Host's configured workspace and keep workspace evidence relative, bounded, and hashable. The Adapter does not expose raw chain of thought, credentials, environment variables, absolute paths, or an unregistered executable.

## Codex App Server protocol pilot

The home-side Codex adapter runs App Server turns in an approved workspace and supports opt-in structured patch approval and artifact publication.

The adapter binds events and cancellation to the native thread and turn IDs, validates the workspace on resume, and uses JSONL to keep streamed answer and tool events separate. The Host advertises analysis by default. With the local `allowWorkspaceWrites` option it also supports automatic mode for native file-change requests. Each proposed path is checked within the approved workspace; directory-wide grants and command escalation are declined. Deletion uses per-Run Gateway confirmation, and only confirmed completed writes can become bounded artifacts. The desktop pilot accepts Codex Gateway registrations only when `AGENTS_ONE_REMOTE_CODEX_APP_SERVER_V1` is explicitly enabled and offers automatic mode only after the Gateway explicitly reports it through its permission capability. The desktop keeps the pilot under its own manifest ID and forwards the paired Connect Runtime ID even if the desktop record has a different ID. The desktop verifies the selected Runtime has advertised automatic mode before forwarding a write. Native login and real-provider acceptance remain pending.

The adapter follows the T3 Code (MIT) policy mapping instead of named permission profiles: analysis runs the native read-only sandbox with never-ask approvals, and safe_write runs the native workspace-write sandbox with on-request approvals, so Codex confines its own writes and every escalation reaches the Host permission gate. OS-enforced read scopes are deliberately not requested because the unelevated Windows restricted-token backend cannot enforce them and fails closed ([upstream implementation](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/windows.rs)); the capability boundary states reads are not OS-confined. The probe verifies the read-only pair with an ephemeral thread.

## Claude Agent SDK protocol pilot

The home-side Claude adapter validates the SDK tool-policy handshake, binds native session IDs to the configured workspace, and provides read and structured write tool modes.

The pilot permits Read, Glob and Grep within a registered workspace, with Write and Edit added in automatic mode. The SDK must confirm the pre-tool hook before the Host sends the prompt. Approval and unrestricted tools are absent from the advertised capability. Completed SDK write hooks identify artifacts, which are rechecked and size-bounded before publication. Native login and cross-network desktop rollout require real-host verification.

### Cancellation acknowledgement does not wait for SDK cleanup

Claude cancellation acknowledges the abort request promptly while query iterator cleanup completes asynchronously and the Host reports the eventual terminal state.

### Consistent remote trace presentation

Every remote CLI adapter emits the same Event Stream v1 vocabulary so the desktop trace reads identically per runtime.

Thinking streams become `reasoning.summary`; tool execution uses the declared `tool.started`/`tool.completed`/`tool.failed` types (never the legacy `tool.call` names that the durable journal drops); `assistant.completed` carries the model and usage metadata the native run actually provides. Adapters advertise `reasoningSummaries` and `usageMetadata` only after they emit them.

## Pi RPC protocol pilot

The Pi adapter starts a local JSONL RPC process and requires proof of the trusted workspace extension before sending a task. Pi native session files stay in a workspace-specific Host directory.

The Host starts Pi with discovery of user extensions disabled and enables only the configured read or structured write tools. A supplied native session ID can resume a single local session file within the selected workspace's private bucket. Confirmed write results are eligible for bounded artifact delivery. The desktop pilots for Claude and Pi use separate disabled-by-default flags and discover the available permission modes through Gateway v1. Native CLI verification requires the real-host acceptance stage.

Cancellation is bounded: the adapter sends a short native abort, tears the process down through the shared shutdown guard, and frees the Runtime concurrency slot within a fixed grace window even if the executor stalls, while native settlement frames (for example an aborted `agent_end`) still converge the turn.

## Antigravity CLI protocol pilot

The Antigravity adapter drives the Google Antigravity CLI's ACP server mode (`agy acp`) through the shared ACP client machinery.

One workspace-confined process per run; ACP session updates map onto the shared event vocabulary, and the CLI's advertised session modes (resume/load/list) provide continuation. Credentials follow the T3 Code (MIT) isolation for the 1.5 CLI: it keeps Google sign-ins in one OS keyring entry unless it believes it runs over SSH, so the adapter sets a nominal `SSH_CONNECTION`, forcing the file-stored token under the default CLI home that service and interactive sessions read alike; ambient Google variables are stripped and auto-update disabled. The one-time sign-in runs through `agy acp --login` on the host machine; sign-in debt surfaces as a sign-in-required run error. The desktop pilot stays behind `AGENTS_ONE_REMOTE_ANTIGRAVITY_ACP_V1`; real-host verification requires the actual logged-in CLI.

## Multi-Runtime Connector contract

A Connector can publish multiple explicitly authorized Runtimes through one versioned tunnel.

It advertises a Runtime list in the Connect hello and forwards the selected `runtimeId`; legacy single-Runtime credentials and hello messages remain readable, while the server authorizes and routes each listed Runtime independently.

A pilot Connector can set `AGENTS_ONE_CONNECTOR_DIR` to an absolute directory for its own pairing and credentials. Each runtime handler can bind its own local Gateway endpoint and token while the existing connector retains its default credential directory.

Connect device status exposes only the non-secret Connector version, protocol,
online state, and last-seen timestamp. The Settings diagnostics view combines
that status with Desktop/Gateway/Host/Adapter/Provider and last-Run metadata;
tokens, private keys, full paths, and model text remain excluded.

The desktop recognizes the Host OpenCode ACP identity as the existing desktop OpenCode adapter when persisting a remote Runtime. A new pairing preview discovers the Connector’s primary identity without constraining it to the desktop draft ID, and registration preserves the approved upstream Runtime identity. The desktop persists the primary and additional claimed Runtime descriptors separately, retaining the Runtime-scoped managed credential and explicit Connect route for each Runtime. Pairing responses may include a legacy aggregate token for backward compatibility, but new desktop Runtime records use the scoped token and never expose either token to Renderer. Artifact requests carry the same Runtime identity through a restricted header so a shared Host cannot accidentally dispatch them to its primary Adapter.

Connector-first pairing completion and device revocation use the user-level protected credential store when the CLI calls them without options. An empty store returns the relevant pairing-state error.

## Verification

Tests cover the ACP boundary, event separation, metadata, Artifacts, multi-Runtime routing, and consecutive requests across the Connector tunnel.

The Connector end-to-end case pairs an OpenCode ACP process fixture and a Hers Gateway fixture through one Connector using the production loopback forwarder. It exercises separate Runtime credentials, a completed SSE snapshot followed by reconnection and another Run, approval replies, and Hers conversation continuation. A scoped GET event request can carry a non-negative `afterSequence`; the loopback adapter sends it as `Last-Event-ID` and the Gateway returns later events. A Host regression verifies that a published Artifact retains its Runtime scope after a restart.

Connector contract tests inject a deterministic Windows credential protector on
Windows CI, so the non-interactive runner profile cannot make the transport
suite flaky. The real current-user DPAPI round trip is a separate explicit
interactive-Windows acceptance command: `npm --prefix
plugins/agents-one-connector run test:dpapi`. The production protector remains
bounded by `DPAPI_TIMEOUT_MS` (60 seconds) to tolerate a cold user-profile
initialization without waiting indefinitely or exposing child-process output.

Production rollout still requires real OpenCode versions, provider login, Windows/Linux, reconnect, and Connect E2E gates from the unified Runtime PRD.

## Remote CLI rollout gates

Each remote CLI adapter is enabled by default in packaged builds, so the add-agent flow lists every remote type without a separate setup.

| Adapter     | Gate                                    |
| ----------- | --------------------------------------- |
| OpenCode    | `AGENTS_ONE_REMOTE_OPENCODE_V1`         |
| Codex       | `AGENTS_ONE_REMOTE_CODEX_APP_SERVER_V1` |
| Claude Code | `AGENTS_ONE_REMOTE_CLAUDE_AGENT_SDK_V1` |
| Pi          | `AGENTS_ONE_REMOTE_PI_RPC_V1`           |
| Antigravity | `AGENTS_ONE_REMOTE_ANTIGRAVITY_ACP_V1`  |

An explicitly set rollout environment value still overrides the default: `1`/`true`/`on` keeps the adapter enabled, while any other non-empty value hides it for deployment, tests, or emergency rollback. When a gate is off, the registry removes the remote location/transport and Main rejects save, probe, and task dispatch for that adapter.
