# Desktop Updates

Desktop update behavior is governed by a build-time release policy. The first public Agents One Alpha is an unsigned Windows x64 build, so automatic and manual in-app updates are disabled. The About pane displays this boundary and directs users to download packages manually and verify `SHA256SUMS.txt`.

[[src/main/app/updater.ts#resolveDesktopUpdatePolicy]] permits `electron-updater` only for a packaged, non-portable build compiled with `AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD=1`. The main bundle receives that value through [[electron.vite.config.ts]]; changing a runtime environment variable cannot enable an unsigned binary. Missing or corrupt update preferences also default to disabled.

[[src/main/app/updater.ts#setupUpdater]] always registers the version and policy IPC surfaces. When policy denies updates, check/download/install handlers are inert and the updater module is never loaded. [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] disables the update controls and shows an unsigned-build or unavailable-build warning.

The release source metadata in [[electron-builder.yml]] points to `pkulyn/agents-one`, but the Alpha workflow always packages with `--publish never`. Enabling in-app updates later requires a signed release pipeline, verified update metadata/source, an installation-and-upgrade dry run, and a tested rollback path before setting the build-time flag.
