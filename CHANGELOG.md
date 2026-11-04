# Changelog

Notable changes to Agents One are recorded here. Versions follow Semantic Versioning.

## [Unreleased]

Further Runtime and platform compatibility work is tracked in [known issues](KNOWN_ISSUES.md).

## [0.1.2] - 2026-11-04

### Added

- Explicit ordinary/collaboration task modes, platform task dispatch, role presets and compact live collaboration progress.
- Native running text updates for Codex App Server, verified OpenCode 1.19 ACP and Pi RPC, plus ordered follow-ups after the current turn.
- Shared Word (.docx) attachment extraction and distinct file-format icons.
- Completed execution traces fold into a compact summary with a timeline.

### Fixed

- Preserve initial Pi reasoning in long histories.
- Show collaboration execution in the conversation, inherit task permissions, cancel active branches and hide progress after completion.
- Report model/provider failures clearly, try configured alternatives for eligible OpenCode model failures, and consolidate localized cancellation/timeout notices.
- Keep a task running when native input is rejected or unavailable; preserve the submitted text and explain the result.
- Ignore stale Codex completion notifications batched with turn startup and await process cleanup before cancellation returns.

### Distribution

- Windows x64 installer and portable packages remain unsigned and use manual updates. Native input compatibility varies by Runtime version; see [known issues](KNOWN_ISSUES.md).

## [0.1.1] - 2026-10-31

### Added and fixed

- Clickable delivered documents, file cards, Open With, Save As and path-copy actions.
- Inline delivered images and actual revision summaries and diffs.
- Per-deletion approval in automatic mode and projectless full access.
- Keep active ordinary local tasks running beyond five minutes and warn after ten minutes of inactivity.
- Manual GitHub version checks in Settings.

## [0.1.0] - 2026-10-28

### Added

- Unified conversations, tasks, schedules, projects, artifacts, archive, backup and restore.
- Local Pi, Codex, Claude Code and OpenCode adapters, Remote Gateway v1 and the plugin SDK.
- Windows x64 installer and portable packages, source receipts, SHA-256 checksums and third-party notices.

### Fixed

- Packaged task cancellation and subsequent conversation persistence.
- Closing to the notification area, second-instance window recovery and the Windows process display name, Agents One.
- Tray gestures: single left click opens the main window; double left click opens or closes the quick composer.

### Security

- Read-only and automatic modes restrict native tools and reject unsupported opaque terminal execution.
- Private application/configuration directories cannot be selected as restricted Runtime workspaces.
- Sender-bound IPC, workspace, artifact, navigation and backup/restore checks.
- Web providers remain default-off experiments. Unsigned builds keep automatic updates disabled.

### Validation and limitations

- Windows household core acceptance passed, including installer startup, native OpenCode tasks, permissions, cancellation, tray recovery and same-version project-registration backup/restore. The final tray gesture change has additional focused automated regression coverage.
- Cross-version upgrades and downgrades, every Runtime/model combination, macOS and Linux remain unqualified. See [known issues](KNOWN_ISSUES.md).

[Unreleased]: https://github.com/pkulyn/agents-one/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/pkulyn/agents-one/releases/tag/v0.1.2
[0.1.1]: https://github.com/pkulyn/agents-one/releases/tag/v0.1.1
[0.1.0]: https://github.com/pkulyn/agents-one/releases/tag/v0.1.0
