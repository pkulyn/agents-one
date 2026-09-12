# Sidebar recent sessions

The sidebar starts with New Chat, keeps app destinations pinned, then gives conversations and projects their own scroll area.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders the pinned Schedules, Chat, and Agents actions, then renders [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] inside a flexible `.sidebar-chat-section`. New Chat is active when the visible Chat view has no session id yet. The standalone `sessions` view is still absent from the `View` union; the full list opens from the Cmd/Ctrl+K menu action.

## Collapse toggle brand mark

The sidebar header's collapse control doubles as the brand mark: collapsed it preserves the compact rounded gradient mark that swaps to the expand icon on hover; expanded it shows the integrated Agents One wordmark beside the collapse icon.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders `.sidebar-collapse-toggle`. Collapsed, it holds a fixed-size `.sidebar-collapse-swap` box stacking the existing `.sidebar-collapse-mark` rounded gradient square over the `PanelLeftOpen` icon; only opacity toggles on hover/focus, so the button never reflows. Expanded, `src/renderer/src/assets/agents-one-wordmark.svg` renders `AGENTS`, then the dawn ring directly as the `O` in `ONE`, with no white tile, next to the `PanelLeftClose` icon. The collapsed affordance deliberately remains independent from the expanded wordmark geometry.

## Infinite sidebar list

The inline list lazily loads cached sessions in pages as the user scrolls, so the sidebar can expose the full chat history without a fixed inline cap.

[[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] fetches `RECENT_SESSIONS_PAGE_SIZE + 1` rows from the `sessions.json` cache to detect whether another page exists. [[src/renderer/src/screens/Layout/sidebarSessionPagination.ts#consumeNativeSessionPage]] keeps the native-cache offset and `hasMore` decision isolated from Runtime conversations: Runtime rows are merged once during refresh and never counted as a native page. This prevents the fixed Runtime query window from making `hasMore` permanently true, repeating native pages, or resetting an already loaded second page during initial cache synchronization. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] passes the chat scroll container ref down, and the sidebar loads the next native page when that container nears the bottom. The initial sync still refreshes `state.db`, then preserves the already loaded native window instead of collapsing it to page one.

Session titles in the inline list are constrained to the sidebar width and truncate with ellipses, while the chat section only scrolls vertically. This keeps long generated titles from creating a horizontal scrollbar.

The native sidebar scrollbar is hidden to avoid layout shifts. [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] measures the chat scroll container and renders an absolutely positioned overlay thumb only while the user is scrolling, so showing or hiding the scrollbar never changes row width.

## Project grouping

Workspace-linked conversations are grouped under project rows so repository chats stay together without hiding ordinary chats.

[[src/main/session-cache.ts#syncSessionCache]] attaches each row's context folder in one batched [[src/main/session-context-folder-store.ts#getSessionContextFolders]] read and persists `contextFolder` into the `sessions.json` cache. [[src/main/session-cache.ts#listCachedSessions]] stays a DB-free cache read — it returns the persisted `contextFolder` without re-querying the store. The sidebar groups rows with a `contextFolder` under a Projects section by folder basename, while rows without one remain under Chats.

When [[src/renderer/src/screens/Chat/Chat.tsx#Chat]] saves a session context folder, it emits a renderer event that [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] uses to force-refresh the cache. This keeps project grouping visible immediately after a workspace is linked.

Projects and Chats are top-level collapsible sections, and each project folder can also be expanded or collapsed. [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] persists those disclosure states in `localStorage`; the sidebar CSS keeps section and folder rows on the same left rail, keeps disclosure arrows right-aligned, animates each disclosure with grid-row transitions, and removes hidden rows from keyboard tab order.

### Project and task landmarks

Project and task section headings use the same typography and color as the primary sidebar destinations so they remain visible landmarks without changing the list hierarchy or controls.

Only the known Projects and Task section toggles receive the `sidebar-recent-section--projects` / `sidebar-recent-section--tasks` styles in [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]]. `src/renderer/src/assets/main.css` supplies the same 13px regular text scale and focus/hover color as the main navigation; pinned and individual project rows intentionally retain their prior presentation.

The Projects and Task headings each expose a trailing **+** create trigger. Project **+** opens the existing folder-choice card; Task **+** opens a matching card with **New task**, reusing Layout's normal fresh-task action. A project row exposes its own **+** for a new task in that project. Re-clicking a trigger or pressing Escape closes the corresponding card without changing project, task, or session data; Escape also clears focus from the exact trigger (including a project-row **+**) so its focus ring does not remain after dismissal.

Project/task creation, collaboration badges, the empty-project hint, archive fallbacks, and accessible project-operation labels resolve through `navigation.sidebar`. Project names and task titles remain user data and are interpolated rather than translated.

## Row context menu

Each sidebar session row exposes a ChatGPT-style options menu — Pin, Rename, Move to project, Open in File Explorer, Copy conversation ID, Archive, and Delete — opened from a hover-revealed `…` button or by right-clicking the row.

[[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] renders each row as a `div role="button"` (so the trailing `.sidebar-recent-session-options` button is valid nested markup) and tracks the open row in `menuTarget`. [[src/renderer/src/screens/Layout/SidebarSessionMenu.tsx#SidebarSessionMenu]] renders the menu in a `document.body` portal at clamped viewport coordinates so it escapes the sidebar's clipped scroll container, and closes on outside click, Escape, a scroll of the sidebar list's own `scrollContainer`, or window blur. The scroll listener is scoped to that one container (not a global capture listener) so the chat's streaming auto-scroll — which fires window-level scroll events on every chunk — no longer dismisses the menu mid-stream. "Move to project" swaps the menu to a second in-place page listing every distinct context folder (`projectChoices`) plus **New folder…** ([[src/preload/index.ts]] `selectFolder`) and **Remove from project**, rather than a hover flyout.

Transitions are `motion/react`-driven (the same library as [[src/renderer/src/components/modal/AppModal.tsx#AppModal]]): the whole menu fades/scales/blurs from its top-left anchor on open, and an internal `open` flag plays the exit before the parent unmounts it (`AnimatePresence onExitComplete` → `onClose`). Switching between the main and project pages cross-slides them (direction-aware) inside a `.sidebar-session-menu-body` wrapper whose `layout` prop animates the height difference; the wrapper clips the sliding pages. Viewport clamping measures the offset box, not `getBoundingClientRect`, so an in-flight scale/height animation doesn't skew positioning.

Each action calls an existing desktop API with an optimistic local update and rollback on failure: Rename → `updateSessionTitle` (inline `.sidebar-recent-session-rename` input), Move → [[src/main/session-context-folder-store.ts#setSessionContextFolder]] then a `hermes-session-context-folder-changed` event so other surfaces re-group, Open in File Explorer → Electron `shell.openPath` for the task's context folder, Copy conversation ID → the preload clipboard bridge, Delete → a confirmation dialog (portal overlay) then [[src/main/sessions.ts#deleteSessionRows|deleteSession]]. The Explorer action is disabled when a task has no context folder. Deleting the open chat calls `onSessionDeleted`, which [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] uses to drop to a fresh New Chat. Escape is captured by the floating menu, which clears its trigger focus before exiting so the trailing `…` does not retain a focus ring.

Pinned rows are a desktop-only affordance: their ids live in `localStorage` (`hermes.sidebar.pinnedSessions`), and pinned sessions are pulled out of the normal grouping into a collapsible **Pinned** section at the top of the list.

Project rows use [[src/renderer/src/screens/Layout/SidebarProjectMenu.tsx#SidebarProjectMenu]], which deliberately reuses the same portal shell, CSS classes, viewport clamping, animation and dismissal rules as the task menu. It exposes Pin/Unpin, Open in File Explorer, Rename, Archive, and Remove. Project display names and pin state are persisted by [[src/main/project-folders.ts#updateProjectFolder]] without renaming or moving the physical folder. Rename is inline; Escape cancels and suppresses the blur-save emitted during unmount. Remove clears the desktop project registration plus native/Runtime task-to-workspace links, returning those conversations to Chats; it never deletes a conversation, directory, or project file.

## Task and project archives

Archive is a reversible, profile-scoped visibility state rather than deletion.

[[src/main/archive-store.ts]] stores task/project markers in `desktop/archives.json`; it never rewrites conversation history or project files. [[src/renderer/src/screens/Layout/SidebarRecentSessions.tsx]] filters archived tasks from every section and filters an archived project together with its tasks. Task and project menus create markers, and an `agents-one:archives-changed` event keeps open sidebar and Settings views consistent.

[[src/renderer/src/components/settings/ArchivePane.tsx]] is the Settings → Archived items management surface with search and kind filters. Its typography follows the shared Settings scale (13px primary text, 12px supporting text) instead of browser-default heading/control sizes. Archived projects include a task-conversation disclosure that is collapsed by default; the pane pages through both the native session cache and Runtime conversation index, normalizes Windows path separators/case, and lists matching tasks only when expanded. Task titles also participate in archive search without rewriting conversation data.

Both tasks and projects can be restored by removing the marker, or permanently deleted after a kind-specific confirmation. The main-process handler routes Runtime conversations, local sessions and remote sessions through their corresponding stores. Project deletion clears its desktop registration and native/Runtime task-to-project links so retained conversations return to Chats; project directories and files are never deleted or mutated.

## Full-list modal

The Cmd/Ctrl+K menu action opens an 80%×80% modal that reuses the existing Sessions screen rather than a separate route.

The modal in [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders [[src/renderer/src/screens/Sessions/Sessions.tsx]] inside a `.sessions-modal` over the shared `.models-modal-overlay` backdrop. Resuming a session or starting a new chat from the modal closes it; Esc and a backdrop click also close it. Because the Sessions screen owns its own fetching gated on `visible`, it loads only while the modal is open.

## Profile switch and active chat

The footer profile switcher keeps the selected shell profile aligned with the visible chat run, while preserving older conversations under their original profiles.

[[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]] persists the selected profile through main-process profile switching, then [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] applies [[src/renderer/src/screens/Layout/chatRuns.ts#selectProfileRunTransition]] before rendering Chat. If the active chat is blank, it is re-homed to the selected profile; if it already belongs to another profile, the shell activates an existing blank run for the selected profile or creates a fresh one. This prevents the footer, Settings, recent sessions, and chat transport from disagreeing about which agent is active.

Opening a sidebar session after switching profiles consumes that blank selected-profile run instead of appending beside it. [[src/renderer/src/screens/Layout/chatRuns.ts#openSessionRunTransition]] replaces the active scratch run when it belongs to the same profile as the resumed session, so the tab strip shows the previous session without an extra "New conversation" tab.

The switcher trigger preserves the old app-brand label for an unrenamed default profile: when `listProfiles` returns the fallback `name === id === "default"`, the button shows `common.appName`; once a custom name is stored, it shows that user-facing name.

### Remote profile routing (SSH removed)

SSH tunnel mode was removed; remote Hermes now always goes through Gateway v1.

There is no per-profile tunnel retargeting anymore. The former `ssh-remote.ts` / `ssh-tunnel.ts` launcher hook, per-profile port, and CLI-path resolution were removed with it; see [[main-process#SSH transport (removed)]].

### Remote-mode skills routing

In remote (HTTP) mode the Skills surface must read and mutate the REMOTE machine's skills — the handlers used to fall through to the local CLI, showing (and installing into!) the wrong machine's skills.

The skills IPC handlers are local-only (plan D5): the legacy `remote-skills.ts` dashboard routing was removed with the old remote transport, and remote agents now go through Gateway v1.

Two deliberate asymmetries: bundled skills stay local in remote mode (that list is the shipped catalog, not per-machine state), and the hub install/uninstall endpoints SPAWN the CLI on the remote and return `{ok, pid}` immediately — success means "started", not "completed", unlike the local paths which await and classify the CLI output.

## Profiles page

The Profiles page lists every workspace as table-style rows and creates new ones from a modal that can clone a chosen source profile.

[[src/renderer/src/screens/Agents/Agents.tsx]] lists the Agent Runtime registry in three stable categories: 本地智能体、远程智能体和网页智能体. Browser-backed `web-agent` runtimes are kept in the web category even though their persisted location is local; other runtimes are classified by their local/remote location. Each card shows a 34×34px square rounded avatar frame, the user-facing name, unified transport label (from [[src/shared/agent-runtimes.ts#deriveAgentTransport]] → Gateway v1 / 本地 CLI / 本地 API / 内嵌网页), a connection summary, a health pill from `probeAgentRuntime`, an enabled badge, and a remote-only diagnostic notice when the probe reports an unreachable Gateway. When health is unreachable, the bottom status changes to **连接异常** and the **对话** button is disabled until the next successful probe. Web health states are surfaced as **连接受限** / **暂不支持** / **检测异常** with a matching guidance notice; any non-healthy state keeps **对话** disabled while **管理** remains available for login, verification, or configuration repair. **管理** opens the embedded [[src/renderer/src/components/settings/AgentRuntimesPane.tsx]] in an [[src/renderer/src/components/modal/AppModal.tsx#AppModal]]; **对话** starts a Runtime conversation through `onChatWithRuntime`. The list refreshes from `listAgentRuntimes` and re-probes enabled runtimes on load and after any manager change.

The profile modal's inline name editor saves on Enter/blur, but Escape is a real cancel path: it restores the current saved name and suppresses the blur-save that browsers fire as the input unmounts.

## Profile detail modal

A single global modal (80vw × 80vh) with a left-section nav views and edits a profile, opened from anywhere via a context hook so future profile features share one surface.

[[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] mounts [[src/renderer/src/components/profile/ProfileModal.tsx#ProfileModal]] at the app root and exposes `openProfile(id, opts)` through [[src/renderer/src/components/profile/ProfileModalContext.ts#useProfileModal]]. The sidebar popover's active profile (a button in [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]]) and each profile row's edit control in [[src/renderer/src/screens/Agents/Agents.tsx]] both call `openProfile`, passing `onChanged` to refresh their lists and `onDeleted` to fall back to the default profile when the active one is removed. The header shows the profile avatar and user-facing name; the icon'd left nav (`PROFILE_SECTIONS`) exposes a single **Profile** pane (inline name editing in the identity title, avatar upload/remove, colour, and lucide provider/model/skills/gateway chips) plus the delete danger zone — remote persona/memory/wallet APIs are not exposed through this desktop (plan D5 cleanup), so no separate Persona/Memory/Wallet sections exist. Every profile — including default — is editable; only the default profile can't be deleted. The modal self-loads via `listProfiles()` and re-reads after every mutation, replacing the former inline `agents-appearance` modal.

Agent names are desktop metadata in `profile-meta.json`, surfaced as `ProfileInfo.name` from [[src/main/profiles.ts#listProfiles]] and mutated through [[src/main/profile-meta.ts#setProfileName]]. They do not rename the stable profile id or directory, so profile-scoped memory, sessions, active profile selection, and gateway routing continue to use `profile.id`. If the save IPC rejects, the inline editor remains open, clears its Saving tag, and shows the name-update error instead of trapping the user in a pending state.

Legacy renderer state can still contain a run without a profile id during upgrades. Profile avatars and the active-session strip treat a missing profile as `default`, and profile-name IPC handlers accept omitted names as an empty value, so stale state cannot trip a `.trim()` exception and black-screen the app.

### Shared modal shell

Reusable modals use a single animated shell so dialogs open and close consistently.

[[src/renderer/src/components/modal/AppModal.tsx#AppModal]] wraps Radix Dialog with Motion's `AnimatePresence`, keeping focus trapping, escape/outside-close behavior, and exit transitions in one memoized component. The shell keeps its Radix portal present through the exit phase and animates the backdrop plus content with visible fade, scale, slide, and blur. Profile modal is the first consumer: [[src/renderer/src/components/profile/ProfileModalProvider.tsx#ProfileModalProvider]] keeps its target profile mounted until `AppModal` finishes the close animation, then clears the modal state.

## Footer action row

The sidebar footer keeps the profile switcher and an update affordance at the bottom, out of the conversation nav.

The default-agent picker localizes its role/location metadata, selection labels, empty guidance, and trigger description while preserving configured Runtime names and availability. Active conversation chips use the same locale for their live-processing accessible label.

[[src/renderer/src/screens/Layout/Layout.tsx#Layout]] renders an update button (when a newer GitHub release is available) and [[src/renderer/src/screens/Layout/ProfileSwitcher.tsx#ProfileSwitcher]] in `.sidebar-footer`. The switcher's manage button opens the global settings modal (below), and the legacy footer actions for Providers/Gateway/Tools/Memory were removed with their screens (plan D5 cleanup); the icon-only rails are gone. When the sidebar is collapsed the footer stays a compact rail with no divider line above it.

## Settings modal

A single global modal (80vw × 80vh) with a grouped left nav presents every app/agent setting, opened from anywhere rather than as a sidebar tab.

[[src/renderer/src/components/settings/SettingsModalProvider.tsx#SettingsModalProvider]] mounts [[src/renderer/src/components/settings/SettingsModal.tsx]] at the app root (inside `ProfileModalProvider`) and exposes `openSettings(section?, { profile })` through [[src/renderer/src/components/settings/SettingsModalContext.ts#useSettingsModal]]. Three entry points call it: the sidebar-footer gear, the `/settings` command's `onOpenDiagnose` path, and a global **Cmd/Ctrl+,** keydown handler in [[src/renderer/src/screens/Layout/Layout.tsx#Layout]] — each passes the active profile so the modal reads/writes the right config. The modal reuses the shared [[src/renderer/src/components/modal/AppModal.tsx#AppModal]] shell (see [[sidebar-navigation#Profile detail modal#Shared modal shell]]).

The left nav is a single **General** group — Appearance, Language, Data (backup/restore), Archives, About, Logs — and `SETTINGS_NAV`/`resolveSection` in [[src/renderer/src/components/settings/SettingsModal.tsx]] map ids to panes; `resolveSection` aliases legacy `/settings <name>` arguments. Network settings (Force IPv4 + proxy) are not a settings tab: they shape every local gateway connection, so they live in [[src/renderer/src/components/settings/ConnectionPane.tsx]] which is embedded in the runtime management surface ([[src/renderer/src/components/settings/AgentRuntimesPane.tsx]]). All shared state, the config-load effect, and the mutation handlers live in [[src/renderer/src/components/settings/useSettingsData.ts#useSettingsData]] (relocated wholesale from the former `Settings` screen) and reach each pane through [[src/renderer/src/components/settings/SettingsDataContext.ts#useSettings]], so the panes (`AppearancePane`, `DataPane`, `ArchivePane`, `AboutPane`, …) stay purely presentational. One exception: `AppearancePane`'s hardware-acceleration field reads `getGpuStatus` from the preload bridge directly, because GPU state is per-launch main-process state rather than profile config (see [[main-process#GPU Fallback#User preference]]). The modal's chrome is `user-select: none` (drag-selection highlighting nav labels and field captions read as broken UI); form fields and `pre`/`code` output — notably the Logs pane — opt back into text selection so they stay copyable.

The Appearance theme cards follow the order of [[src/renderer/src/constants.ts#THEMES]]: Dark, Light, GitHub Light, and Solarized Light form the first four-card row, followed by the remaining dark themes. The order is presentation-only; stored theme IDs and all color definitions remain unchanged.

## Provisional fresh sessions

Fresh chat session ids are provisional until a turn produces output or completes successfully, so provider errors do not create visible recent-session rows.

The main-process transports still send a generated `X-Hermes-Session-Id` on fresh requests to avoid gateway fingerprint collisions, but [[src/main/hermes.ts#sendMessageViaApi]] and the runs transport announce that id to the renderer only after visible output, tool/reasoning activity, or successful completion. Resumed sessions are announced immediately because the renderer already knows they are existing conversations. This keeps [[src/renderer/src/screens/Chat/hooks/useChatIPC.ts#useChatIPC]] from binding a failed first turn to a new sidebar entry.
