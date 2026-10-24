# Desktop Updates

Desktop updates are a build-time capability. Unsigned Windows Alpha builds disable in-app updates and direct users to verify manually downloaded packages.

[[src/main/app/updater.ts#resolveDesktopUpdatePolicy]] permits `electron-updater` only for a packaged, non-portable build compiled with `AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD=1`. The main bundle receives that value through [[electron.vite.config.ts]]; changing a runtime environment variable cannot enable an unsigned binary. Missing or corrupt update preferences also default to disabled.

[[src/main/app/updater.ts#setupUpdater]] always registers the version and policy IPC surfaces. When policy denies updates, check/download/install handlers are inert and the updater module is never loaded. [[src/renderer/src/components/settings/AboutPane.tsx#AboutPane]] disables the update controls and shows an unsigned-build or unavailable-build warning.

The release source metadata in `electron-builder.yml` points to `pkulyn/agents-one`, but the Alpha workflow always packages with `--publish never`. Enabling in-app updates later requires a signed release pipeline, verified update metadata/source, an installation-and-upgrade dry run, and a tested rollback path before setting the build-time flag.

## Independent Windows candidate acceptance

Release acceptance binds packaged UI evidence to an immutable source SHA and artifact hashes. Historical passes and successful CI do not replace the candidate's clean-machine installation, Runtime recovery, and data checks.

The [new-computer acceptance prompt](../docs/AGENTS_ONE_NEW_WINDOWS_ACCEPTANCE_PROMPT_20261001.md) specifies installer and portable verification, real Runtime conversations, Gateway reconnection and restart reconciliation, [[backup-recovery#Rollback-safe restore]], schedules, desktop crash recovery, upgrade, uninstall, and rollback. Electron userData isolation does not imply core Hermes data isolation; both paths must be verified before fault tests.

Every required scenario records Pass, Fail, Blocked, N/A, or an explicitly approved waiver with evidence. Missing credentials, UI control, old packages, or test Host permissions remain visible blockers. Repository protection, licensing, release approval, and signed-update policy require maintainer sign-off before the overall release can be Go.

## Cumulative desktop feature acceptance

A replacement desktop must retain accepted mobile access and agent onboarding behavior. A clean branch and passing tests are insufficient when that branch omits cumulative features.

The Windows after-pack hook invokes `scripts/verify-desktop-resource.mjs` against the actual ASAR. It checks the Main chunk imported by the bootstrap, independent Owner workers, projectless permission policies, and the Renderer chunks reachable from HTML. Mobile settings navigation, the web agent opt-in switch, and attachment cards must all be present; unused leftover chunks cannot satisfy the gate. Settings navigation and onboarding component tests bind the feature markers to working controls. This static gate supplements isolated packaged UI checks and real-device acceptance; it does not certify cloud connectivity.

Before promoting any candidate to current, run this verifier from the cumulative workspace, including when the candidate was built in another worktree. Record fresh artifact hashes and source provenance for that candidate. Historical results must not be inherited as current evidence.

## Committed source and independent promotion

Local desktop delivery uses one cumulative source baseline and an independent publisher outside candidate worktrees. A clean but incomplete historical branch cannot replace the accepted application.

Release builds set `AGENTS_ONE_RELEASE_BUILD=1`. `scripts/desktop-source-receipt.mjs` rejects dirty, untracked or ignored build inputs and derives an embedded receipt from Git objects. The independent publisher requires the candidate commit to descend from the accepted baseline, matches the embedded receipt to that clean source and invokes its own retained package verifier. Candidate-side scripts cannot reduce the gate. Ordinary development builds remain usable for development and are not promotion candidates.

The publisher serializes resource-only promotion, refuses running applications and incompatible native sidecars, backs up current data and resources, and records a recoverable transaction. Actual loading and phone acceptance are separate evidence. Successful promotion advances the required baseline; recovery restores only resources and never overwrites newer user data.

## Settings navigation acceptance

Mobile access acceptance verifies a reachable navigation entry and the selected profile pane, independently of the presentation order of general settings.

The navigation component test clicks the mobile entry, checks its active state and verifies the requested profile. Changing the order of appearance, language, voice and data settings must not hide that entry or replace it with an inert feature marker.
