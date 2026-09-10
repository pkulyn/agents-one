# Changelog

All notable changes to Agents One will be documented in this file. The project follows [Semantic Versioning](https://semver.org/) from its first public Alpha onward.

## [Unreleased]

- Complete the remote draft Release and clean-machine RC1 acceptance gates.
- Publish no assets until every G0–G8 release gate in the readiness PRD passes.

## [0.1.0-alpha.1] - Planned

### Added

- Unified conversations, tasks, schedules, projects, artifacts, archive, backup, and restore across registered AI runtimes.
- Local Pi, Codex, and Claude Code runtime adapters plus Remote Gateway v1 and the plugin SDK.
- Windows x64 NSIS and portable candidate packaging with fixed-commit metadata and SHA-256 output.

### Security

- OS-backed desktop secret storage where Electron exposes a secure backend; Windows Connector credentials use current-user DPAPI.
- Explicit workspace, artifact, IPC, WebView, navigation, backup, restore, and diagnostic trust boundaries.
- Built-in web providers are default-off experiments and require local opt-in plus explicit user confirmation.
- Unsigned Alpha builds disable in-app automatic updates.

### Release status

- This version has not been published. The local candidate passed automated and packaged-startup checks; GitHub Actions, draft Release, install, upgrade, uninstall, and rollback acceptance remain pending.

[Unreleased]: https://github.com/pkulyn/agents-one/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/pkulyn/agents-one/releases/tag/v0.1.0-alpha.1
