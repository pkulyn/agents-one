# Changelog

Notable changes to Agents One are recorded here. Versions follow Semantic Versioning.

## [Unreleased]

Further Runtime and platform compatibility work is tracked in [known issues](KNOWN_ISSUES.md).

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

[Unreleased]: https://github.com/pkulyn/agents-one/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pkulyn/agents-one/releases/tag/v0.1.0
