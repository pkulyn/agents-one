This directory defines the high-level concepts, business logic, and architecture of this project using markdown. It is managed by [lat.md](https://www.npmjs.com/package/lat.md) — a tool that anchors source code to these definitions. Install the `lat` command with `npm i -g lat.md` and run `lat --help`.

> **Agents One** is a community-maintained multi-agent desktop workspace. **Hermes Agent** is one optional Runtime integration; Agents One is not affiliated with, endorsed by, or supported by Nous Research.

- [[chat-commands]] — how typed slash commands are routed through the gateway's `slash.exec`/`command.dispatch` pipeline instead of being sent as prompt text.
- [[chat-performance]] — how chat rendering stays responsive through contained transcript rows, batched textarea resizing, and fixed-row slash-command virtualization.
- [[voice-input]] — how one recorded utterance is transcribed through a main-process service boundary and returned as an editable draft.
- [[runtime-chat]] — how durable runtime conversations become native chat rows while diagnostic error and artifact-publication events stay out of the user-facing transcript.
- [[plugin-sdk]] — how Remote Gateway adapters truthfully declare event capabilities, persist provider evidence before terminal state, and retain redacted Workspace audit metadata.
- [[model-context]] — the per-model context-window override that drives the context gauge and the agent's auto-compaction.
- [[model-selection]] — the session-scoped in-chat model override that switches the model (and provider) for one conversation without touching the global default.
- [[web-preview]] — the in-app split-screen webview and the `partition`-based gate that lets only it load remote HTTPS while staying sandboxed.
- [[web-agent-runtime]] — the planned isolated local-web Runtime for using Doubao from native task conversations with explicit attachments and in-app login takeover.
- [[agent-onboarding]] — the three-step Renderer-only flow for adding local, remote, and browser-backed agents with only the connection data each route needs.
- [[adapter-registry]] — the Registry, Manifest, local OpenCode ACP, and remote OpenClaw Gateway v1 boundaries.
- [[remote-cli-host]] — the shared Remote CLI Host, multi-Runtime routing, and the first OpenCode ACP remote Adapter.
- [[code-blocks]] — collapsible long code blocks, and why expansion state is keyed on source position to survive react-markdown's streaming remounts.
- [[window-chrome]] — the browser-style title bar where open-conversation tabs sit on top of the window drag region, clickable while empty space still drags.
- [[desktop-updates]] — GitHub release checks, startup upgrade button behavior, and the Settings auto-upgrade preference.
- [[repository-presentation]] — the bilingual source homepage, MIT license, inherited notices, and source publication status.
- [[mobile-mac-roadmap]] — the shared mobile contract and Android, iOS, native HarmonyOS, then macOS delivery gates.
- [[sidebar-navigation]] — the recent-sessions list under the Chat nav item, capped at five with a "Show more" button that opens the full session list in a modal.
- [[brand-startup]] — the integrated dawn-ring wordmark and layered human/robot startup animation.
- [[context-folder]] — the per-session linked working folder, persisted in a desktop-owned state.db table so a re-opened conversation restores its folder.
- [[main-process]] — the Electron main-process entrypoint, app lifecycle modules, and centralized IPC registry.
- [[backup-recovery]] — the versioned Agents One backup archive, strict import validation, credential-preserving merge, managed snapshot restore, and rollback boundary for reinstall or device migration.
- [[task-schedules]] — the desktop scheduler boundary shared by local CLI, Web Agent, and remote Gateway v1 runtimes.
