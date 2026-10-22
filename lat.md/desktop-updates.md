# Desktop Updates

Desktop updates are a build-time capability. Unsigned Windows Alpha builds disable in-app updates and direct users to verify manually downloaded packages.

[[src/main/app/updater.ts#resolveDesktopUpdatePolicy]] permits `electron-updater` only for a packaged, non-portable build compiled with `AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD=1`. The main bundle receives that value through [[electron.vite.config.ts]]; changing a runtime environment variable cannot enable an unsigned binary. Missing or corrupt update preferences also default to disabled.

[[src/main/app/updater.ts#setupUpdater]] always registers the version and policy IPC surfaces. When policy denies updates, check/download/install handlers are inert and the updater module is never loaded. [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] disables the update controls and shows an unsigned-build or unavailable-build warning.

The release source metadata in `electron-builder.yml` points to `pkulyn/agents-one`, but the Alpha workflow always packages with `--publish never`. Enabling in-app updates later requires a signed release pipeline, verified update metadata/source, an installation-and-upgrade dry run, and a tested rollback path before setting the build-time flag.

## Immutable candidate dependency gate

Every rebuilt Windows candidate uses a fixed commit and its lockfile, and must pass the current dependency audit before packaging or artifact upload.

A previously passing candidate can fail a later rebuild when new advisories affect its locked dependencies. Compatible dependency fixes create a new candidate SHA; they do not change the original candidate or waive the release gate. The Windows clean runner repeats all three gate rounds and packaged-app smoke checks before uploading that candidate. Artifact upload alone does not approve RC1 or publish a Release.

## Packaged profile-data verification

Packaged profile-data changes are verified from the tested source commit through a cold start using existing user data.

When a desktop change reads or writes profile-scoped data, run its path regression tests and build the package from the same clean source commit. Verify the resolver is present in the packaged archive, then launch the candidate through the stable desktop entry with the existing user-data directory and confirm the expected profile records appear after a cold start. Record the source commit, package hashes, and before/after data-file hash. A successful source build alone does not prove that the installed package contains the fix or reads the intended user data.
