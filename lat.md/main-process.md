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

Normal shutdown is a quiescing transition, not a best-effort synchronous cleanup. [[src/main/app/start.ts]] first closes admission for new Runtime tasks, stops and waits for schedule ticks, aborts legacy active requests, and awaits [[src/main/agent-runtimes.ts#cancelAllAgentRuntimeTasks]] before closing temporary media, dashboards, and SQLite. The `before-quit` event is prevented until this ordering completes, avoiding a normal app exit racing a local CLI process that can still write its workspace. The same Runtime quiet gate is applied before backup restore replaces profile data in [[src/main/ipc/register.ts#registerIpcHandlers]].

[[src/main/app/start.ts]] supports the `AGENTS_ONE_OPEN_DEVTOOLS=1` diagnostic launch path so packaged builds can expose renderer console errors when startup fails before the UI paints; the former variable remains a temporary compatibility fallback.

The packaged renderer keeps its meta CSP aligned with the production response CSP so file-backed startup assets load consistently from `file://` before the main-process header can help.

Because electron-vite emits a bundled main file at `out/main/index.js`, packaged renderer loading resolves `../renderer/index.html` from `__dirname` to reach `out/renderer/index.html`.

### Notification-area tray and quick task composer

On Windows and other supported desktop platforms, closing the main window hides it instead of quitting the process.

[[src/main/app/tray.ts#setupTray]] owns the notification-area icon and positions two frameless utility windows above it: the left-click quick composer and the right-click task menu. The task menu reads existing Runtime conversations and session caches through a sender-bound, read-only IPC; running tasks and the three newest completed tasks are direct rows. Hovering or focusing `More` expands the same window leftward while keeping the main panel anchored on the right, exposing the remaining completed tasks in reverse chronological order as a separate scrollable panel. The compact main/history panels meet at a zero-gap shared edge and use one shell shadow; the collapsed/expanded widths are allow-listed by the main process. Its renderer uses a real two-column grid so long titles can ellipsize without hiding the fixed, right-aligned project-name column; unassociated tasks leave that column blank. Task titles and project names share one explicit Windows typography contract—`Microsoft YaHei UI` first, 12px size, 400 weight and 18px line height—and differ only through semantic color and alignment, preventing mixed Chinese/Latin fallback from producing mismatched visual sizes. This replaces the native menu accelerator-column workaround because Windows drops arbitrary non-shortcut accelerator text. The full-app `New Task` action reuses the existing `menu-new-chat` event. Escape, window blur, and leaving the combined menu surface dismiss auxiliary content without changing task data.

A second left click toggles the quick composer closed and a second right click toggles the task menu closed. The same state check also covers a surface waiting for its first `ready-to-show`, so repeated clicks cancel a pending reveal rather than letting it appear after the user has already dismissed it; clicking the other button still switches surfaces as before.

On Windows, a tray right click can blur the task menu before Electron delivers the tray callback. Its blur dismissal is therefore deferred by one event turn: the callback can still recognize an open menu and close it on a second right click, while ordinary focus loss retains the existing automatic dismissal.

[[src/main/app/tray-task-list.ts#groupTrayTasks]] keeps grouping, deduplication, title compaction and folder-name-only display independent from Electron. Legacy active chats add only transient title/project metadata to their existing in-memory abort records; no prompt, project path or task state is added to persisted conversation files.

The tray's left-click surface loads the regular renderer with `?tray=1`, which [[src/renderer/src/screens/QuickComposer/QuickComposer.tsx]] routes to a 560px agent-first capsule. It reuses [[src/renderer/src/screens/Chat/ChatInput.tsx]] for safe attachment staging and the same voice capture, recording timer and `Ctrl+M` shortcut as the main composer; in recording state the status bar overlaps the capsule by one pixel to remove the seam and is inset 36px on each side, aligning with the straight top edge between the capsule's rounded corners. One paperclip menu offers file upload and authorized project-folder registration. The selected enabled Runtime receives the task without changing persisted Runtime configuration. Agent, attachment, voice-status and attachment-strip DOM changes explicitly remeasure the transparent frameless window through a sender-bound 96–420px resize IPC; the main process preserves the bottom edge so popovers open upward and the closed surface has no empty footer. The first position is horizontally centred in the tray icon's display and vertically above the taskbar; a dedicated drag region marks only interactive `will-move` events, so programmatic resize/reposition cannot suppress default centring and later tray clicks preserve a user-chosen in-process position. The right-click surface uses `?trayMenu=1` and [[src/renderer/src/screens/TrayMenu/TrayMenu.tsx]]; its narrow preload methods only read prepared display rows, resize/close auxiliary windows, or forward existing open/new/quit actions. Neither surface adds a second persistence path.

#### Task completion toast

Every terminal task outcome raises one non-focusing, tray-anchored status card so background work remains visible without taking keyboard focus.

[[src/main/agent-runtimes.ts#onAgentRuntimeRunFinished]] emits presentation-only terminal metadata after a Runtime run finishes; the event is process-local and does not add fields to persisted run, Runtime, or conversation records. [[src/main/app/start.ts#startMainProcess]] forwards successful, failed, cancelled and timed-out outcomes, resolves an existing Runtime conversation by its active run id when available, and passes bounded title/error detail, task id, Runtime identity and configured avatar to [[src/main/app/tray.ts#setupTray]]. Legacy Hermes chat uses the same in-memory path: explicit aborts produce one cancelled outcome, timeout-shaped errors are classified as timed out, other errors are failed, and a per-run guard prevents an abort's later error callback from raising a duplicate card. The previous native error notification is removed so one terminal outcome has one status surface. Task-schedule start events also carry the selected Runtime's display identity and raise a `scheduled_started` card after the tray controller exists; clicking it opens the newly created Runtime conversation when available, and the later Runtime terminal event still reports its final outcome.

The tray controller loads `?trayCompletion=1` in a fixed transparent BrowserWindow, aligns it above the real tray bounds, and uses `showInactive()` with `focusable: false` so the card cannot steal keyboard focus. [[src/renderer/src/screens/TrayCompletionToast/TrayCompletionToast.tsx]] renders the approved Agents One header plus agent speech bubble and uses the same rainbow dawn-ring SVG as the app favicon; it must not fall back to the legacy yellow Hermes icon. The task avatar still falls back to a generic agent icon when no Runtime avatar is configured. Status combines icon, explicit text and semantic color rather than relying on color alone: purple/play for a scheduled start, green/check for success, red/cross for failure, grey/stop for cancellation and orange/clock for timeout. Failure and timeout cards include one compact reason line. All five statuses pause dismissal while hovered and otherwise close after 3 seconds. The full card opens the matched Runtime conversation when a task id exists; contexts without a durable conversation safely open the main window. IPC data/action handlers are sender-bound to the completion window, and shutdown removes the listener and destroys the window without changing user data.

## Remote dashboard URL prefixes

Remote dashboards may sit under a path prefix.

Remote mode can point `RemoteDashboardUrl` at a reverse-proxied base such as `https://host/hermes-dashboard` while the gateway API uses a separate path. [[src/main/dashboard.ts#dashboardWsUrl]] therefore appends `/api/ws` to the normalized dashboard base path instead of replacing the path with root `/api/ws`, so chat probes and dashboard transport use `/hermes-dashboard/api/ws`. [[tests/dashboard-remote.test.ts]] covers this proxied-base regression.

## Multi-agent runtime direction

Agents One uses a capability-driven Runtime registry without changing Hermes Agent Runtime Dashboard or legacy-chat fallback semantics.

The planned contract, task ownership, and acceptance gates are recorded in `docs/AGENTS_ONE_FIVE_PHASE_PLAN.md`; historical task decomposition remains in `docs/MULTI_AGENT_EXECUTION_PLAN.md` and `docs/MULTI_AGENT_TODOLIST.md`. Agents One owns the durable control plane, while the user selects a project coordinator Runtime rather than hard-coding Hermes as the only manager. Implementation must add explicit adapters rather than treating Claw3D's read-only OpenClaw board as a task-dispatch API.

The current remote Hermes acceptance matrix is documented in `docs/REMOTE_HERMES_SMOKE_MATRIX.md`; it records the supported management APIs and the same-origin credential fallback used when a stale dashboard token is rejected by a NAS reverse proxy.

All remote dashboard management requests must preserve a reverse-proxy path prefix such as `/hermes-dashboard` (the old `remote-sessions.ts` dashboard API was removed with the legacy remote transport — plan D5; remote agents now go through Gateway v1).

The first runtime-registry backend lives in [[src/shared/agent-runtimes.ts]] and [[src/main/agent-runtimes.ts]]. It exposes a protected built-in Hermes runtime plus user-defined non-secret runtimes, rejects secret-looking config fields, and surfaces Electron IPC for listing, saving, removing, probing, starting, querying, and cancelling runtime tasks through [[src/main/ipc/register.ts#registerIpcHandlers]] and the preload bridge.

Runtime capability declarations include `orchestration` and `mailbox` in addition to chat, dispatch, streaming, cancellation, tools, memory, artifacts, and workspace access. They remain explicitly `false` until the controlled Project/TaskEvent APIs exist; task dispatch alone must never be presented as multi-agent coordination capability.

Task-conversation collaboration uses a client-owned control boundary: the coordinator or the deterministic explicit-assignment parser returns a runtime-allow-listed proposal, and Agents One persists and automatically dispatches only those registered runtimes. [[src/main/agent-runtimes.ts#hasRemoteWorkspaceOutcome]] treats that valid proposal as a control outcome rather than a completed file operation, so a proposal-only Gateway turn does not need Workspace audit evidence; actual workspace execution remains subject to the existing audit/artifact guard.

For local Codex, Claude Code, and Pi `full_access` runs, [[src/main/runtime-delivery.ts#verifyLocalDeliveryArtifacts]] converts a textual `[交付契约]` into a `file` artifact only after the main process resolves the path inside the selected workspace, verifies that it is a real file, recalculates SHA-256, and matches the declared hash. Missing, escaped, or mismatched files publish no artifact and therefore cannot unlock a later review role.

The legacy remote OpenClaw bridge client was removed (plan D5): remote agents now connect through Gateway v1 via [[src/main/remote-workspace-gateway.ts]] and [[src/main/agents-one-remote-gateway.ts]].

The minimal runtime-management UI lives in [[src/renderer/src/components/settings/AgentRuntimesPane.tsx]] and is mounted under Settings -> Runtimes. It lists built-in and user runtimes, saves only non-secret config fields, supports enable/disable, probes health/capabilities, and removes user runtimes. [[src/renderer/src/components/settings/AgentRuntimesPane.test.tsx]] covers load/probe/save behavior alongside the backend registry tests.

### Registration form (plan 1.5)

The add-agent form has two shapes: a remote Gateway v1 URL plus token, or a local executable path.

For a new agent the location and transport come from the selected kind template (Hermes → remote Gateway HTTP; Pi/Codex/Claude Code → local CLI), so the form cannot produce old inconsistent combinations. [[src/main/local-cli-detect.ts#detectLocalCliPaths]] scans PATH for `pi` / `claude` / `codex` (including Windows wrapper extensions) and prefills the path through `detect-local-cli-paths`. [[src/main/local-cli-detect.test.ts]] fixes this resolution contract.

### Codex worktree runtime and scheduled Runtime conversations

The first local coding runtime runs Codex through the permission boundary selected for each task. Scheduled work uses the same Runtime conversation path as an ordinary new task instead of a parallel hidden task system.

[[src/main/codex-runtime.ts]] probes the local Codex CLI and starts `codex exec` with an argument array, `shell: false`, a bounded environment, JSON output, and an explicit read-only or workspace-write sandbox. An implementation task first creates a detached worktree under the active profile's `desktop/worktrees/codex` directory; the original repository is never used as the process working directory. The resulting worktree path, diff summary, capped/redacted output, and diff artifact are surfaced through [[src/main/agent-runtimes.ts]] without auto-committing or auto-merging changes. [[tests/codex-runtime.test.ts]] fixes the noninteractive invocation contract.

Local Codex, Claude Code, and Pi adapters expose a cancellable completion contract: `cancel()` starts whole-tree termination and resolves only after the child `close` handler has completed cleanup. [[src/main/agent-runtimes.ts]] therefore keeps a cancelling or timed-out run `running` until that confirmation, then records the requested terminal state; a bounded 15-second wait produces an explicit failed diagnostic rather than falsely reporting a confirmed cancellation. [[tests/agent-runtimes.test.ts]] covers the pending-close timeout race.

`safe_write` snapshots original regular files through [[src/main/workspace-protection.ts#protectWorkspaceFromRemoval]]. Its restore path never follows a symbolic-link target or a symbolic-link parent introduced while the Runtime ran: a replaced file symlink is removed and the protected original restored, while a symlinked parent is refused. This preserves the original workspace without writing through a late path redirection; [[tests/workspace-protection.test.ts]] verifies the replacement-symlink case.

Media IPC treats a local path as a main-process capability. [[src/main/media.ts#isAuthorizedMediaPath]] resolves symlinks and permits only the Agents One temporary-media store or a user-registered project root; [[src/main/ipc/register.ts#registerIpcHandlers]] applies the same guard to read, existence, Save As, and context-menu open operations. An arbitrary absolute path mentioned by a connector is therefore not readable by the renderer, while Gateway artifacts materialized into the temp store and verified local workspace deliveries remain usable.

The independent Task Center executor and shared Task Center types have been retired. [[src/main/task-schedules.ts#startRun]] directly creates one normal `AgentRuntimeRun` with `conversation=true`, writes its id into the Runtime conversation and schedule run, and reconciles the same run through existing Runtime `get`/`cancel` operations. A process-local run that disappears after desktop restart becomes an explicit failed conversation result instead of remaining indefinitely in `running`. The historical `desktop/task-center.json` file is a frozen rollback archive: current code never reads, rewrites, or deletes it, and managed worktrees referenced by that archive are not cleaned automatically.

Desktop scheduled tasks accept enabled local CLI, Web Agent, and remote Gateway v1 Runtimes. [[src/shared/task-schedules.ts#isTaskScheduleRuntimeEligible]] defines the shared Renderer/main-process boundary used when creating, enabling, manually triggering, and polling schedules; unavailable targets remain stored without dispatch. [[src/renderer/src/screens/Schedules/Schedules.tsx#Schedules]] manages all three categories in one panel and still does not read or manage the retired Hermes server Cron rules. Web plans are analysis-only without a workspace, while remote plans use the existing Gateway v1 conversation path.

Scheduled project affinity persists both the selected folder and its opaque project capability, so editing a schedule can restore its folder while dispatch still validates the capability. Runtime conversations resolve an opaque capability only to its safe display name, and the sidebar canonicalizes legacy path-bound sessions to the registered project before grouping. The schedule editor exposes a per-task 10-minute to 24-hour hard timeout; [[src/main/agent-runtimes.ts#validatedTaskInput]] preserves the finite ceiling and existing cancellation flow rather than allowing unbounded runs.

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

## Voice transcription IPC

Speech-to-text IPC keeps remote endpoint selection and optional credentials in the main process, not in the renderer or active chat model.

[[src/main/ipc/register.ts#registerIpcHandlers]] retains `transcribe-audio` for file-upload compatibility and adds sender-bound streaming start/audio/stop channels plus result events. It also exposes a narrow Voice Input settings API: public enabled/URL/key-present status, validated Profile save, and a health-only connection test. New installs are disabled with no default service URL; `AGENTS_ONE_VOICE_ENABLED=1`, `AGENTS_ONE_VOICE_API_URL`, and an optional `AGENTS_ONE_VOICE_API_KEY` (or configured secret provider) enable an explicitly chosen compatible service. [[src/main/voice-stream.ts]] derives the WebSocket stream endpoint and keeps the credential out of the renderer. [[voice-input]] defines PCM capture, recording feedback, and privacy boundary.

## SSH transport (removed)

Hermes SSH tunnel mode was removed (opensource plan D4): remote Hermes now always goes through Gateway v1 (one URL + one token). No-public-IP scenarios are covered by the Gateway v1 outbound Connector mode.

The SSH transport modules (`ssh-remote.ts`, `ssh-tunnel.ts`, `ssh-options.ts`) were deleted, along with the `set-ssh-config` / `test-ssh-connection` / `start-ssh-tunnel` / `stop-ssh-tunnel` / `is-ssh-tunnel-active` IPC handlers, the `HermesRuntimeMode` "ssh" value, and every `conn.mode === "ssh"` branch across main, preload and renderer.

Existing persisted SSH configs are read-only migrated: the old built-in connection (`connectionMode: "ssh"`) is coerced to `remote` and flagged `migratedFromSsh` (ConnectionPane shows a "re-set up on Gateway v1" banner); Agent Runtime configs with `hermes.mode: "ssh"` are coerced to `remote` and marked `needsReauthorization`. Stored `sshConfig` fields are left untouched on disk.
