<div align="center">

# Agents One

**A native desktop workspace for coordinating conversations, tasks, projects, and artifacts across multiple AI agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#install)

</div>

Agents One is a desktop application that unifies **local CLI agents** (Pi, Codex, Claude Code) and **remote agents** (via the Remote Gateway v1 protocol) behind a single conversation surface — so you can chat, run tasks, schedule work, and manage projects without juggling terminals, dashboards, or per-agent web UIs.

Every agent is registered as a **Runtime** with one connection config and one display model:

- **Remote agents** — one Gateway v1 URL + one bearer token. Capabilities are negotiated over the protocol, not hard-coded per vendor.
- **Local CLI agents** — an executable path on your machine. The app launches them directly with their native CLI semantics (models, tools, permissions, project instructions), and renders their event stream in the unified chat.

> **Project status:** active development. Features may change. Please [open an issue](https://github.com/pkulyn/agents-one/issues) for bugs or ideas — contributions are welcome.

## Features

- **Unified conversation shell** — streaming chat with tool-call cards, thinking summaries, artifacts, cancel/timeout/retry, and native CLI terminal fallback. Hermes and every registered Runtime render through the same adapter-based message model.
- **Agent registry** — add, probe, enable/disable, and remove runtimes. Health and capability badges (chat / task dispatch / tools / artifacts / workspace) come from real probes.
- **Local CLI runtimes** — Pi, Codex, Claude Code discovered on PATH and launched as native CLI processes (argument arrays, no shell wrapping, disposable Git worktrees, native permission modes preserved).
- **Remote Gateway v1** — one URL + one token per remote agent; capability negotiation, run lifecycle, artifact exchange, and short-lived workspace grants instead of per-vendor API keys.
- **Projects** — folder-scoped containers that group sessions and tasks; safe workspace protection (`safe_write`) prevents out-of-scope writes.
- **Tasks & schedules** — conversations double as tasks; scheduled jobs create ordinary runtime conversations at the due time (no hidden execution layer).
- **Multi-agent collaboration** — explicit role assignment (coordinator/implementer/reviewer) with a role timeline and evidence gates; structured handoffs, not raw shared context.
- **Sessions** — searchable, date-grouped history with resume; a Quick Chat panel that is persisted per profile.
- **Archive** — soft-archive tasks and projects without touching underlying messages or artifacts; browse, search, restore, or permanently delete.
- **Backup & restore** — portable `*.agents-one-backup` archives with manifest + SHA-256 verification, credential-safe migration, pre-flight checks, and crash-safe rollback.
- **Plugin SDK** — `plugins/agents-one-plugin` provides the event-stream contract, a Gateway host, and a CLI adapter so new vendors integrate without modifying the desktop app.
- **Experimental web providers** — the built-in Doubao, ChatGPT, and Grok browser adapters remain disabled in public builds unless a developer exposes the local experiment switch and the user explicitly accepts the third-party data and account risks.
- **i18n** — English and Simplified Chinese.

## Quick Start

### Install

Download the latest release from the [Releases](https://github.com/pkulyn/agents-one/releases) page. On first launch Windows SmartScreen may warn that the installer is unsigned — click **More info** → **Run anyway**.

### Add your first agent

1. Open **Agents** (sidebar → 智能体).
2. Click **Add agent**.
3. Choose the agent type:
   - **Remote agent** (e.g. Hermes, OpenClaw, any Gateway v1 implementation) — enter the Gateway URL and a bearer token.
   - **Local CLI** (Pi, Codex, Claude Code) — the app scans PATH and pre-fills the executable path for you.
4. Save and probe. The runtime health pill and capability badges update from the probe result.
5. Open **Chat** and start a conversation, or create a **task** from the dialog.

### Set up a project

Create a project folder from the sidebar. New conversations can attach to it; the project becomes the workspace scope for local CLI runtimes and workspace-granted remote agents.

## How it works

```text
       user
        │
        ▼
  Agents One desktop
  ├─ Agent registry  →  one connection config per runtime
  ├─ Conversation shell →  adapter-based unified message model
  ├─ Schedules / projects / archive / backup
        │
        ├──▶ local CLI runtime (Pi / Codex / Claude Code)
        │         native process, native permissions, event stream → chat
        │
        └──▶ remote agent (Gateway v1)
                  one URL + one token, capability negotiation,
                  run lifecycle, artifacts, workspace grants
```

- **Runtime Adapter contract** — `probe`, `start`, `get`, `cancel`, events, artifacts. Every runtime is represented uniformly at the orchestration layer without lossy translation: unstructured native output is still viewable in the raw record.
- **Remote Gateway v1** — the outer protocol for cross-machine access. Token is bound to a single remote agent and limited scopes; workspace access is a short-lived grant, never a standing file server. See [docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md](docs/AGENTS_ONE_REMOTE_GATEWAY_V1.md).
- **Agent Event Stream v1** — the internal event language for thinking summaries, tools, skills, MCP, artifacts, and handoffs. See [docs/AGENT_EVENT_STREAM_V1.md](docs/AGENT_EVENT_STREAM_V1.md).
- **Plugin SDK** — `plugins/agents-one-plugin` hosts a Gateway and a CLI adapter so a new agent can expose the unified contract without touching the desktop app. See [docs/AGENTS_ONE_PLUGIN_SDK.md](docs/AGENTS_ONE_PLUGIN_SDK.md).

## Preview

> Screenshots are captured from the current build.

|                                                             |                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| <img width="100%" alt="Agents" src="previews/agents.png" /> | <img width="100%" alt="Chat" src="previews/chat.png" /> |

## Data & privacy

- **Credential storage has explicit boundaries.** Remote Gateway tokens entered through the desktop are migrated from `.env` to Electron OS-backed protection after the secure backend becomes available. Windows Connector device tokens and private keys use current-user DPAPI; Connector files on other platforms use user-only permissions. Provider/API credentials may still come from `.env`, process environment variables, or a configured command-based secret provider. On Linux, if Electron reports the insecure `basic_text` fallback, Agents One keeps the legacy restricted-file path and shows a warning instead of claiming the value is OS-protected.
- **Backups exclude credentials.** `.env`, account/credential files, tokens, API keys, SSH key paths, proxies, raw config, desktop protected-secret blobs, and Connector credential files are not exported. The backup format whitelists security config and merges it into the target, keeping the target machine's credentials.
- **Backup** covers profiles, projects, tasks, conversations, collaboration records, SQLite state, memory, skills, attachments, and runtime inputs. Restore runs pre-flight checks, keeps a rollback snapshot, and survives crash mid-restore.
- **Local CLI is not a remote.** Local runtimes keep their native capabilities; the desktop app only adds the workspace scope you choose, run records, and unified rendering.
- **Web providers are default-off experiments.** When explicitly enabled, prompts and selected attachments are sent through the signed-in third-party webpage and the provider controls the account data. Agents One stores each provider/profile in a separate Chromium partition, blocks off-list navigation and browser permissions, and lets you stop all web tasks or clear the isolated login data. The project currently has no written automation permission from Doubao, OpenAI, or xAI; see the [provider compliance record](docs/AGENTS_ONE_WEB_PROVIDER_COMPLIANCE_20260910.md).

See [SECURITY.md](SECURITY.md) for supported versions, private vulnerability reporting, and the trust-boundary model.

## Screens

| Screen                   | Description                                                                    |
| ------------------------ | ------------------------------------------------------------------------------ |
| **聊天 / Chat**          | Unified streaming conversation with tools, artifacts, and runtime events       |
| **智能体 / Agents**      | Runtime registry cards grouped by location, with probe health and capabilities |
| **定时任务 / Schedules** | Schedule ordinary runtime conversations with cron-style triggers               |
| **设置 / Settings**      | Appearance, language, data (backup/restore), archives, about, logs             |

## Development

```powershell
npm.cmd install
npm.cmd run dev       # start the app in dev mode
npm.cmd run typecheck # TypeScript check
npm.cmd test          # vitest suite
npm.cmd run build     # typecheck + production build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [docs/AGENTS_ONE_RUNBOOK.md](docs/AGENTS_ONE_RUNBOOK.md) for operations.

## License

[MIT](LICENSE)
