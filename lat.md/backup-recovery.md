# Agents One backup and recovery

Agents One owns a portable, versioned backup path for moving desktop configuration and durable work data without depending on the optional Hermes installation.

## Portable backup format

`*.agents-one-backup` is a gzip-compressed tar archive with a versioned manifest, an allowlisted payload, per-file size metadata, and SHA-256 hashes.

[[src/main/agents-one-backup.ts]] inventories every Agents One profile and includes safe application preferences, Runtime display definitions, project registrations, tasks and schedules, Runtime/Quick Chat/native conversations, collaboration records, SQLite session state, memories, skills, attachments, and Runtime input evidence. Project directory contents, worktrees, logs, caches, raw credential stores, `.env`, wallet material, API keys, login tokens, machine executable paths, SSH key paths, remote authorization, and proxy endpoints are excluded or sanitized. Export also rejects a skill text file with a high-confidence hardcoded Bearer/API credential and reports only its path, so the user can move that value to protected configuration without silently losing the skill.

SQLite files are staged with `VACUUM INTO` so committed WAL data is captured in one portable database. Export pauses the local scheduler, rejects active chat or Runtime work, closes the desktop database, stages all source files, creates the archive beside the chosen destination, validates that archive through the same import path, and only then atomically replaces an older backup.

Import treats the archive as untrusted input. It rejects oversized archives, unsafe tar entry types, path traversal, Windows device/ADS names, duplicate paths, undeclared payload files, invalid manifests, hash mismatches, malformed core JSON stores, unsafe portable configuration, and invalid SQLite databases before the target data directory is changed.

## Rollback-safe restore

Restore replaces the allowlisted, profile-scoped Agents One data set while preserving target-only credential files, unknown files, raw `config.yaml` secrets, and profiles that are not present in the backup.

Before writing, the app's single-instance lock prevents a second Agents One process from opening the same data set, and the main process destroys the old renderer as a global write gate. It then stops schedulers, active runs, dashboards, profile gateways, and database connections; core writers also reject mutations while the gate is held. Every affected target file, including SQLite sidecars and managed files that will be removed, is copied below a durable `.restore-transaction` journal. Writes use same-directory temporary files and renames; an in-process failure replays the snapshot, while startup replays any prepared journal left by a crash or power loss before opening a window or writer. A rollback failure retains the rescue directory for manual recovery.

Portable configuration is merged into the target's existing `config.yaml` so credentials and unknown keys survive. New or changed remote endpoints are disabled and marked for reauthorization, local executable/workspace paths are cleared when they do not match the target, and proxy endpoints never migrate. Legacy SSH connections in a restored archive are read-only coerced to the unified remote mode (see [[main-process#SSH transport (removed)]]). Restored schedules are disabled with no queued or active run, restored conversations do not retain an in-process run id, and only explicit `attachments[*].path` references to manifest-owned `desktop-staging` files are rebound to the target data home. The app relaunches after quiescing so every store and Runtime reopens against one consistent snapshot.

Backups are integrity-checked but not encrypted or authenticated. Users should import only trusted archives and store them securely because conversations, memories, skills, attachments, and tool evidence can contain sensitive user-supplied content.
