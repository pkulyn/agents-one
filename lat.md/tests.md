# Agents One data migration

These tests verify that migration and backup restore preserve Agents One data while keeping Hermes native data under its existing owner.

## Preserves app data and Hermes native data

Migration copies Agents One files and desktop-owned database rows into its new data root while leaving Hermes configuration, memories, and native database tables intact.

## Rejects conflicting destination

Migration must stop when the destination already contains conflicting data, leaving both the legacy source and existing destination unchanged.

## Removes incomplete staging after copy failure

If a source file fails the safety checks, migration removes its private partial staging directory and leaves the final data path absent.

## Restores legacy backup into owned data

Importing a legacy backup into the Agents One data root extracts app-owned files and desktop database rows without replacing Hermes native state.

## Round trips owned-data backup

A schema-v2 backup restores the supported Agents One data set and preserves its runtime configuration, profiles, conversations, and attachments.

# Agents One runtime working directories

These tests ensure that a local Runtime without a selected project uses an app-owned, runtime-specific directory instead of a Hermes or system temporary root.

## OpenCode no-project cwd

OpenCode's no-project ACP session uses its profile's Runtime directory under Electron `userData/data`, while explicit project workspaces remain selected by the task.
