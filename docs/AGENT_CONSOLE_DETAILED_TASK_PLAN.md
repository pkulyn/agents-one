# Agent Console Detailed Task Plan

Date: 2026-07-11

This plan turns the Hermes Desktop Plus multi-agent direction into executable task packages. The current strategy is to keep Hermes Desktop Plus as the product base, stabilize the remote Hermes baseline, then add OpenClaw, Codex, and Claude Code through explicit runtime adapters.

> Current canonical roadmap: [Agents One Five-Phase Implementation Plan](./HERMES_ONE_FIVE_PHASE_PLAN.md). The execution backlog for projects and tasks is [Agents One Project and Task Execution Plan](./AGENTS_ONE_PROJECT_TASK_EXECUTION_PLAN.md). It supersedes the fixed-Hermes coordinator assumption: Agents One is the durable control plane, while the user may select Hermes, Codex, Claude Code, OpenClaw, or manual coordination as the project coordinator. The frozen Phase 3/4 schema and state-machine contract is [Project Coordination Contract](./PROJECT_COORDINATION_CONTRACT.md).

## Current Baseline

| Area | Status | Notes |
| --- | --- | --- |
| Remote Hermes chat | Done | Remote conversation and task flow are working through the existing Hermes connection. |
| Remote dashboard management | Partial | Sessions, models, tools, skills, memory, and MCP have remote paths. Gateway messaging management may be unavailable on some remote dashboards and must degrade to read-only. |
| Runtime Registry backend | Done | Shared runtime types, protected built-in Hermes runtime, user runtime persistence, probe, start/get/cancel IPC are implemented. |
| OpenClaw adapter backend | Done for mock | HTTP bridge client and registry integration are implemented with mock coverage. Real bridge integration is pending. |
| Agent Runtimes UI | Done minimal | Settings -> Runtimes supports list, add, save, enable/disable, probe, and remove. |
| Build/test chain | Restored | 2026-07-11 validation passed: typecheck, targeted tests, and production build. The earlier Windows/esbuild `spawn EPERM` did not reproduce after stale preview checks. |

## Priority Rules

| Priority | Rule |
| --- | --- |
| P0 | Keep existing Hermes Desktop behavior working. No adapter work may break chat, sessions, settings, gateway, tools, memory, or skills. |
| P1 | Secrets must not enter renderer-visible runtime config, logs, screenshots, docs, fixtures, or Git. |
| P2 | Every new runtime capability needs a mock test before live integration. |
| P3 | Prefer explicit read-only degradation over remote/local silent fallback. |
| P4 | Subagents may implement focused task packages, but Codex owns orchestration, integration, tests, and acceptance. |

## Task Packages

### Phase A: Baseline Stabilization

| ID | Task | Owner | Inputs | Deliverables | Acceptance |
| --- | --- | --- | --- | --- | --- |
| A-01 | Restore local validation chain | Codex | Current repo, Windows Node/Electron environment | Root cause note for `spawn EPERM`; passing `typecheck`; passing targeted tests; passing build or documented blocker | `npm.cmd run typecheck`; targeted tests; `npm.cmd run build` |
| A-02 | Re-run remote Hermes smoke without secrets | Codex | Existing remote connection config only, no token disclosure | Updated `REMOTE_HERMES_SMOKE_MATRIX.md` with current API availability and fallback behavior | Chat works; dashboard APIs classified as available/read-only/unavailable |
| A-03 | Freeze current baseline | Codex | Dirty worktree | Change summary grouped by domain; rollback notes; known test debt | No unrelated user changes reverted; all current changes explained |
| A-04 | Gateway remote read-only polish | Codex | Recent `/api/messaging/platforms` HTML fallback error | Remote gateway page does not crash when messaging API is absent; controls disabled when catalog is read-only | Typecheck; gateway remote test when Vitest starts successfully |

### Phase B: OpenClaw Live Integration

| ID | Task | Owner | Inputs | Deliverables | Acceptance |
| --- | --- | --- | --- | --- | --- |
| B-01 | Collect OpenClaw bridge contract | User + Codex | Endpoint, auth mode, sample non-secret request/response | [Bridge integration request](./OPENCLAW_BRIDGE_INTEGRATION_REQUEST.md) | Contract includes health, capabilities, task create, task get, cancel, errors |
| B-02 | Live OpenClaw probe | Codex | Real OpenClaw bridge endpoint | Probe result in Settings -> Runtimes; capability classification | Health and capabilities return expected states |
| B-03 | Live OpenClaw task dispatch | Codex | Safe test prompt | One real OpenClaw task with status/output/error captured | Task reaches succeeded/failed with safe diagnostic; no secret logs |
| B-04 | OpenClaw regression pack | Subagent, reviewed by Codex | Mock server + live observations | Additional tests for any live protocol differences | Mock tests pass; live differences documented |

### Phase C: Local Codex Runtime

| ID | Task | Owner | Inputs | Deliverables | Acceptance |
| --- | --- | --- | --- | --- | --- |
| C-01 | Codex CLI preflight | Subagent | Local PATH and workspace | Adapter can discover executable, version, auth/readiness, workspace access | No task execution; preflight unit tests |
| C-02 | Codex read-only task adapter | Subagent | Frozen CLI invocation policy | Start/get/cancel for a read-only analysis task | Uses argument arrays, no `shell: true`, timeout/cancel tested |
| C-03 | Codex runtime UI path | Codex | Existing Runtimes UI | Runtime can be added/probed from Settings -> Runtimes | Typecheck + targeted UI/backend tests |

### Phase D: Local Claude Code Runtime

| ID | Task | Owner | Inputs | Deliverables | Acceptance |
| --- | --- | --- | --- | --- | --- |
| D-01 | Claude Code CLI preflight | Subagent | Local PATH and workspace | Adapter can discover executable, version, auth/readiness, workspace access | No task execution; preflight unit tests |
| D-02 | Claude Code read-only task adapter | Subagent | Frozen CLI invocation policy | Start/get/cancel for a read-only analysis task | Uses argument arrays, no `shell: true`, timeout/cancel tested |
| D-03 | Claude runtime UI path | Codex | Existing Runtimes UI | Runtime can be added/probed from Settings -> Runtimes | Typecheck + targeted UI/backend tests |

### Phase E: Task Orchestration UI

| ID | Task | Owner | Inputs | Deliverables | Acceptance |
| --- | --- | --- | --- | --- | --- |
| E-01 | Task data model | Subagent | Runtime Registry run model | Task, assignment, event, artifact schema | Migration/unit tests; no runtime-specific leakage |
| E-02 | Manual dispatch screen | Subagent, reviewed by Codex | Existing runtime list and start/get/cancel IPC | UI for selecting runtime, submitting prompt, viewing status/output | Desktop and compact viewport checks; targeted UI tests |
| E-03 | Observability timeline | Subagent | Task events and run output | Timeline/log view with safe diagnostics | Failed/cancelled/timed-out states visible |
| E-04 | Cross-runtime smoke | Codex | Hermes + one external runtime | End-to-end Hermes + OpenClaw or Hermes + Codex workflow | One real/manual smoke recorded without secrets |

## Immediate TodoList

| Order | ID | Action | Status |
| --- | --- | --- | --- |
| 1 | A-01 | Stop/clear stale preview locks if present, then rerun typecheck, targeted tests, and build. | Done |
| 2 | A-02 | Update remote Hermes smoke matrix to mark Gateway messaging management as read-only when dashboard returns HTML. | Done |
| 3 | A-04 | Verify the new read-only Gateway fallback once Vitest/build starts normally again. | Done |
| 4 | B-01 | Ask for or confirm the real OpenClaw bridge endpoint and non-secret protocol sample. | Next |
| 5 | B-02 | Add the real OpenClaw runtime in Settings -> Runtimes and run probe. | Pending |
| 6 | B-03 | Dispatch one safe OpenClaw task and capture result. | Pending |
| 7 | C-01 | Assign Codex CLI preflight package to subagent after baseline is green. | Pending |
| 8 | D-01 | Assign Claude Code CLI preflight package after Codex preflight pattern is accepted. | Pending |

## 2026-07-11 Validation Log

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd test -- tests/messaging-platforms-remote.test.ts tests/agent-runtimes.test.ts tests/openclaw-runtime.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx` | Passed: 4 files, 17 tests |
| `npm.cmd run build` | Passed |
| Windows/esbuild `spawn EPERM` | Not reproduced after checking for stale project preview processes |

## 2026-07-12 Hermes + Codex Milestone

| Item | Status | Notes |
| --- | --- | --- |
| Remote runtime notices | Implemented | Tool-call limits and process exit notices render as collapsed system events with secret-like values redacted. |
| Codex local Runtime | Implemented | Settings runtime probe supports local Codex; analysis uses a read-only sandbox and implementation creates a detached worktree. |
| Task Center | Implemented | Independent manual-dispatch page persists task lifecycle, output, artifacts, review state, cancellation, and worktree opening. |
| OpenClaw real Bridge | Done | Bearer credential stays in the secrets provider; live health probe, Task Center success task, and running-task cancellation completed without credential exposure. |
| Claude Code Runtime | Done | Local CLI probe, safe process adapter, Windows script-wrapper resolution, worktree execution, cancellation, artifacts, and Task Center selection are implemented. |

### Runtime Smoke Notes

- The user-level Codex CLI was updated from `0.142.3` to `0.144.1`. A read-only `codex exec --json --sandbox read-only` smoke completed successfully after the update, although WebSocket transport retried and fell back to HTTPS before the final response.
- The earlier temporary detached-worktree Codex smoke exited with Windows code `-1073741819` before model execution. The Windows `.cmd` launch fix is now covered by unit tests and a subsequent `workspace-write` implementation smoke created only its specified file inside a temporary detached worktree. The original repository had no matching file or write; the temporary worktree was removed after verification.
- Claude Code `2.1.185` passed both a real `plan` probe and an `acceptEdits` implementation smoke in a temporary detached worktree. The test file was confined to that worktree, and the worktree was removed after verification.

### Current Validation Commands

```powershell
npm.cmd run typecheck
npm.cmd test -- src/renderer/src/screens/Chat/dashboardEventAdapter.test.ts src/renderer/src/screens/TaskCenter/TaskCenter.test.tsx tests/codex-runtime.test.ts tests/agent-runtimes.test.ts tests/openclaw-runtime.test.ts
npm.cmd run build
```

## Validation Commands

Use the portable Node path first on this Windows workstation:

```powershell
$env:PATH='D:\efunds\nodejs22;' + $env:PATH
$env:NODE_OPTIONS='--use-system-ca'
npm.cmd run typecheck
npm.cmd test -- tests/messaging-platforms-remote.test.ts tests/agent-runtimes.test.ts tests/openclaw-runtime.test.ts src/renderer/src/components/settings/AgentRuntimesPane.test.tsx
npm.cmd run build
```

If `spawn EPERM` appears before tests run, record it as an environment/process-lock issue, then check for stale project preview processes and retry after stopping only this project's Electron/preview process.

## Open Questions

| Question | Needed For | Owner |
| --- | --- | --- |
| What real OpenClaw bridge endpoint should be used for live testing? | B-02/B-03 | User |
| Does the remote Hermes NAS plan to expose `/api/messaging/platforms`? | Gateway remote management | User + remote Hermes agent |
| Should Codex/Claude Code local adapters run only in disposable worktrees by default? | C/D safety policy | Codex + User |
| Which task screen should host manual dispatch: existing Chat sidebar, new Tasks tab, or Settings-linked runtime detail? | E-02 UI scope | User + Codex |

## Current Definition of Done

The next project checkpoint is complete when:

1. Typecheck, targeted runtime tests, and production build pass again.
2. Remote Hermes smoke matrix reflects the current Gateway messaging API limitation.
3. Settings -> Runtimes remains usable for Hermes and OpenClaw runtimes.
4. A real OpenClaw bridge can be probed, or its blocking condition is documented with exact non-secret error details.
