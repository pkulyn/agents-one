# Main Process

The Electron main process keeps the entrypoint small and separates app lifecycle from IPC registration.

## Entrypoint

`src/main/index.ts` performs only pre-ready setup and delegates startup.

[[src/main/index.ts]] applies GPU crash preferences, enables the optional CDP testing port, and calls [[src/main/app/start.ts#startMainProcess]]. This keeps one-off process boot concerns separate from windows, menus, updater wiring, and IPC.

## GPU Fallback

Hardware acceleration is disabled and persisted after a GPU-process crash so machines without a usable GPU avoid an infinite crash → relaunch loop — but only temporarily, so a transient crash can't strand a working GPU on SwiftShader.

[[src/main/gpu-fallback.ts#applyGpuPreferences]] disables hardware acceleration when a crash flag, relaunch sentinel, or `HERMES_DISABLE_GPU` says so, while keeping SwiftShader WebGL available. Persistent GPU-off fallback is honored by default on Windows/Linux, but macOS clears stale flags unless `HERMES_GPU_FALLBACK=1` forces it, protecting the Office tab from permanent software-rendering lag. [[src/main/gpu-fallback.ts#installGpuCrashGuard]] watches fatal GPU-process exits and relaunches with software rendering where the persistent fallback is enabled.

### Flag expiry

The persisted `disable-gpu.flag` is only honored for 24 hours after the crash that wrote it; a stale or unparseable flag is cleared at launch and hardware acceleration is retried.

GPU crashes are often transient (driver update mid-session, a since-removed virtual display adapter, a Chromium blocklist gap for a brand-new GPU), and before the TTL a single crash silently pinned Windows/Linux machines to software rendering forever — a user with an RTX 5060 Ti ran the Office 3D tab at 1 fps on 10+ CPU cores for over a week. If the GPU genuinely still crashes, the re-armed crash guard re-persists a fresh flag, so a broken machine pays at most one crash+relaunch per 24-hour window.

### User preference

Settings → Appearance offers a tri-state hardware-acceleration preference — Auto (crash-guard driven, the default), Always on, Always off — persisted in `gpu-preference.json` beside the crash flag.

The preference lives in `userData`, not renderer settings storage, because [[src/main/gpu-fallback.ts#getGpuPreference]] must read it synchronously before app-ready — the only point where hardware acceleration can still be disabled. Precedence is `HERMES_DISABLE_GPU` env (support escape hatch) > relaunch sentinel (a crash still rescues the current session even under "Always on") > preference > crash flag. Under "Always on" the crash guard relaunches with the sentinel but skips persisting the flag, so every subsequent launch retries hardware acceleration; "Always off" suppresses the crash guard and the Office banner's re-enable button (the banner points at Settings instead). [[src/main/gpu-fallback.ts#setGpuPreference]] writes the file (IPC `set-gpu-preference`, validated in the main process); changes apply after a relaunch via [[src/main/gpu-fallback.ts#relaunchApp]] (IPC `relaunch-app`). The Appearance pane (`src/renderer/src/components/settings/AppearancePane.tsx`) compares the saved preference against the `bootPreference` captured by [[src/main/gpu-fallback.ts#applyGpuPreferences]] so its "restart to apply" prompt survives closing and reopening Settings.

### Renderer visibility and recovery

Software rendering is no longer silent: the Office tab shows a warning banner with a one-click recovery when hardware acceleration is off.

[[src/main/gpu-fallback.ts#getGpuStatus]] reports whether the GPU is disabled, why (`env` / `preference` / `sentinel` / `flag`), and whether the app can recover; [[src/main/gpu-fallback.ts#reenableGpuAndRelaunch]] deletes the flag and relaunches without the GPU-off sentinel (refused when `HERMES_DISABLE_GPU=1` forces software rendering, since a relaunch would inherit it). Both are exposed over IPC (`get-gpu-status`, `reenable-gpu`) via the preload bridge, and the Office screen (`src/renderer/src/screens/Office/Office.tsx`) renders the banner over the 3D view — the one surface where SwiftShader is painfully visible. The one-click re-enable applies only to crash fallbacks: env- and preference-forced software rendering render an informational banner without the button.

## App Lifecycle

Lifecycle code owns Electron windows, global app events, and shutdown cleanup.

[[src/main/app/start.ts#startMainProcess]] registers crash logging, IPC handlers, updater handlers, Electron ready/activate/window-all-closed/before-quit events, CSP headers, security hardening, and the main BrowserWindow.

[[src/main/app/start.ts]] also supports the `HERMES_OPEN_DEVTOOLS=1` diagnostic launch path so packaged builds can expose renderer console errors when startup fails before the UI paints.

The packaged renderer keeps its meta CSP aligned with the production response CSP so file-backed startup assets load consistently from `file://` before the main-process header can help.

Because electron-vite emits a bundled main file at `out/main/index.js`, packaged renderer loading resolves `../renderer/index.html` from `__dirname` to reach `out/renderer/index.html`.

## Remote dashboard URL prefixes

Remote dashboards may sit under a path prefix.

Remote mode can point `RemoteDashboardUrl` at a reverse-proxied base such as `https://host/hermes-dashboard` while the gateway API uses a separate path. [[src/main/dashboard.ts#dashboardWsUrl]] therefore appends `/api/ws` to the normalized dashboard base path instead of replacing the path with root `/api/ws`, so chat probes and dashboard transport use `/hermes-dashboard/api/ws`. [[tests/dashboard-remote.test.ts]] covers this proxied-base regression.

## Multi-agent runtime direction

Hermes Desktop Plus will add a capability-driven runtime registry without changing Hermes Dashboard or legacy-chat fallback semantics.

The planned contract, task ownership, and acceptance gates are recorded in `docs/HERMES_ONE_FIVE_PHASE_PLAN.md`; historical task decomposition remains in `docs/MULTI_AGENT_EXECUTION_PLAN.md` and `docs/MULTI_AGENT_TODOLIST.md`. Hermes One owns the durable control plane, while the user selects a project coordinator Runtime rather than hard-coding Hermes as the only manager. Implementation must add explicit adapters rather than treating Claw3D's read-only OpenClaw board as a task-dispatch API.

The current remote Hermes acceptance matrix is documented in `docs/REMOTE_HERMES_SMOKE_MATRIX.md`; it records the supported management APIs and the same-origin credential fallback used when a stale dashboard token is rejected by a NAS reverse proxy.

All remote dashboard management requests must preserve a reverse-proxy path prefix such as `/hermes-dashboard`. [[src/main/remote-sessions.ts#dashboardApiUrl]] strips leading slashes from the requested API path before resolving it against the configured base; otherwise `new URL("/api/...", base)` silently drops the prefix and sends management calls to the site root, producing 404s even though the dashboard itself is healthy.

The first runtime-registry backend lives in [[src/shared/agent-runtimes.ts]] and [[src/main/agent-runtimes.ts]]. It exposes a protected built-in Hermes runtime plus user-defined non-secret runtimes, rejects secret-looking config fields, and surfaces Electron IPC for listing, saving, removing, probing, starting, querying, and cancelling runtime tasks through [[src/main/ipc/register.ts#registerIpcHandlers]] and the preload bridge.

Runtime capability declarations include `orchestration` and `mailbox` in addition to chat, dispatch, streaming, cancellation, tools, memory, artifacts, and workspace access. They remain explicitly `false` until the controlled Project/TaskEvent APIs exist; task dispatch alone must never be presented as multi-agent coordination capability.

Task-conversation collaboration uses a client-owned control boundary: the coordinator or the deterministic explicit-assignment parser returns a runtime-allow-listed proposal, and Agents One persists and automatically dispatches only those registered runtimes. [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]] treats that valid proposal as a control outcome rather than a completed file operation, so a proposal-only Gateway turn does not need Workspace audit evidence; actual workspace execution remains subject to the existing audit/artifact guard.

For local Codex, Claude Code, and Pi `full_access` runs, [[src/main/runtime-delivery.ts#verifyLocalDeliveryArtifacts]] converts a textual `[交付契约]` into a `file` artifact only after the main process resolves the path inside the selected workspace, verifies that it is a real file, recalculates SHA-256, and matches the declared hash. Missing, escaped, or mismatched files publish no artifact and therefore cannot unlock a later review role.

The OpenClaw bridge client lives in [[src/main/openclaw-runtime.ts]] and is integrated by the runtime registry for remote `openclaw` runtimes. It accepts only non-secret endpoint config, validates http/https URLs and timeouts, probes `/health`, starts `/tasks`, refreshes `/tasks/:id`, and cancels with `POST /tasks/:id/cancel` so cancelled task records remain queryable.

The minimal runtime-management UI lives in [[src/renderer/src/components/settings/AgentRuntimesPane.tsx]] and is mounted under Settings -> Runtimes. It lists built-in and user runtimes, saves only non-secret config fields, supports enable/disable, probes health/capabilities, and removes user runtimes. [[src/renderer/src/components/settings/AgentRuntimesPane.test.tsx]] covers load/probe/save behavior alongside the backend registry tests.

### Codex worktree runtime and scheduled Runtime conversations

The first local coding runtime runs Codex through the permission boundary selected for each task. Scheduled work uses the same Runtime conversation path as an ordinary new task instead of a parallel hidden task system.

[[src/main/codex-runtime.ts]] probes the local Codex CLI and starts `codex exec` with an argument array, `shell: false`, a bounded environment, JSON output, and an explicit read-only or workspace-write sandbox. An implementation task first creates a detached worktree under the active profile's `desktop/worktrees/codex` directory; the original repository is never used as the process working directory. The resulting worktree path, diff summary, capped/redacted output, and diff artifact are surfaced through [[src/main/agent-runtimes.ts]] without auto-committing or auto-merging changes. [[tests/codex-runtime.test.ts]] fixes the noninteractive invocation contract.

The independent Task Center executor and shared Task Center types have been retired. [[src/main/task-schedules.ts#startRun]] directly creates one normal `AgentRuntimeRun` with `conversation=true`, writes its id into the Runtime conversation and schedule run, and reconciles the same run through existing Runtime `get`/`cancel` operations. A process-local run that disappears after desktop restart becomes an explicit failed conversation result instead of remaining indefinitely in `running`. The historical `desktop/task-center.json` file is a frozen rollback archive: current code never reads, rewrites, or deletes it, and managed worktrees referenced by that archive are not cleaned automatically.

Desktop scheduled tasks are restricted to enabled local CLI Runtimes. [[src/main/task-schedules.ts#isEnabledLocalCliRuntime]] enforces that boundary when creating, enabling, manually triggering, and polling schedules; legacy remote-backed records remain stored but are never dispatched. [[src/renderer/src/screens/Schedules/Schedules.tsx#Schedules]] lists only local CLI tasks and no longer reads or manages Hermes server Cron rules, which remote agents can create through their own conversation/runtime capabilities.

Every scheduled execution starts an ordinary Runtime conversation run and stores both ids on the individual schedule run. [[src/renderer/src/screens/RuntimeChat/RuntimeChat.tsx]] resumes `activeRuntimeRunId` when the conversation opens, so the same reasoning, tool, progress, cancellation and terminal rendering used by a manually submitted task appears immediately. Terminal reconciliation remains an idempotent background fallback that appends the cleaned final reply or failure when no renderer is open. The start event refreshes the schedule UI and raises the Windows notification at trigger time; completion only refreshes state and does not send a second system notification. Schedule store v5 ignores the retired `activeTaskCenterTaskId`, keeps completed legacy run summaries and pointers intact, and converts legacy queued/running records into a terminal recovery failure so they cannot block edit, delete, or rerun. It never opens the legacy Task Center archive.

Codex, Claude Code, and Pi emit structured lifecycle output, which is valuable diagnostics but poor review text. [[src/shared/runtime-output.ts#summarizeTaskOutput]] extracts the final agent message, WebSocket-to-HTTPS fallback state, and token summary for both main-process scheduled delivery and native task conversations. [[src/renderer/src/screens/Chat/runtimeOutput.test.ts]] covers this shared presentation boundary.

### Claude Code runtime

Claude Code follows the same isolated-task boundary as Codex while keeping process execution and persisted output constrained.

[[src/main/claude-code-runtime.ts]] starts analysis noninteractively with `plan`; implementation uses `acceptEdits` only after an isolated detached worktree has been created under the active profile. On Windows, user-level `claude.cmd` and `claude.ps1` wrappers are resolved to the installed native `claude.exe` so the main process can keep `shell: false`. The Adapter caps and redacts output, limits inherited environment variables, cancels the whole process tree, records worktree/diff artifacts, and filters Claude SessionStart bootstrap events before task output is persisted. With `stream-json --include-partial-messages`, it retains only thinking and tool partial blocks, accumulates `thinking_delta` into bounded live progress, assembles `input_json_delta`, and reconciles each stable tool call ID with the final assistant/tool-result frames so the transcript is complete without duplicates. [[tests/claude-code-runtime.test.ts]] fixes the invocation and filtering contracts; [[tests/agent-runtimes.test.ts]] covers partial reasoning, tool input reconstruction, result naming, and final-frame deduplication.

## App Chrome Helpers

Menu, updater, and context-menu behavior live in focused modules.

[[src/main/app/menu.ts#buildMenu]] owns the application menu, [[src/main/app/updater.ts#setupUpdater]] owns update IPC and electron-updater events, and [[src/main/app/context-menu.ts#showChatContextMenu]] owns the chat right-click menu.

Release builds keep a Help-menu Developer Tools toggle as a production diagnostics escape hatch without changing renderer sandbox or Node isolation.

## IPC Registry

Renderer IPC handlers are isolated from app bootstrap so the registry can be split by domain.

[[src/main/ipc/register.ts#registerIpcHandlers]] currently preserves the existing handler behavior behind one registration function. It receives app-level callbacks for the main window, model-library notifications, connection-config notifications, external URL opening, and active chat abort handles.

Wallet and token-balance handlers sit in the same registry: `list-wallets`, `create-wallet`, `import-wallet`, `rename-wallet`, `delete-wallet` (backed by [[wallet-token-balances#Wallet Store]]) and `get-token-balances` (backed by [[wallet-token-balances#Token Balances]]).

## Voice transcription IPC

Speech-to-text IPC sends recorded desktop audio through the Hermes API server, not through the active chat model endpoint.

[[src/main/ipc/register.ts#registerIpcHandlers]] exposes `transcribe-audio` for the preload bridge, and [[src/main/hermes.ts#transcribeAudio]] posts a base64 data URL to `/api/audio/transcribe`. If the local gateway lacks that desktop route, it falls back to the Python `tools.transcription_tools.transcribe_audio` dispatcher, so local Whisper, Groq, OpenAI, ElevenLabs, and command/plugin STT providers remain independent from the selected chat model.

## SSH transport (removed)

Hermes SSH tunnel mode was removed (opensource plan D4): remote Hermes now always goes through Gateway v1 (one URL + one token). No-public-IP scenarios are covered by the Gateway v1 outbound Connector mode.

The SSH transport modules (`ssh-remote.ts`, `ssh-tunnel.ts`, `ssh-options.ts`) were deleted, along with the `set-ssh-config` / `test-ssh-connection` / `start-ssh-tunnel` / `stop-ssh-tunnel` / `is-ssh-tunnel-active` IPC handlers, the `HermesRuntimeMode` "ssh" value, and every `conn.mode === "ssh"` branch across main, preload and renderer.

Existing persisted SSH configs are read-only migrated: the old built-in connection (`connectionMode: "ssh"`) is coerced to `remote` and flagged `migratedFromSsh` (ConnectionPane shows a "re-set up on Gateway v1" banner); Agent Runtime configs with `hermes.mode: "ssh"` are coerced to `remote` and marked `needsReauthorization`. Stored `sshConfig` fields are left untouched on disk.
