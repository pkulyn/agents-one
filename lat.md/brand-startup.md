# Agents One startup brand

The startup surface and expanded sidebar share one wordmark rule: the dawn ring is the letter `O` in `ONE`, never a separate white-tile icon beside the product name.

## Startup brand animation

The startup animates transparent robot and human foregrounds over one fixed hand-free background.

The foreground uses smaller hand bodies with continued forearms, preserving bright silver surfaces, natural skin and rounded tips. The robot retains its original transparent plate and safe layer split. The human uses one complete square transparent image from fingertip through forearm, with no separate continuation, clip or blend mask. A 0.96 image calibration about its measured tip matches the approved small-hand composition. A contact-centered hand group allows proportional size adjustment without scaling the background or wordmark. The hand-free background has no baked contact highlight. No darkening filter is applied; a gentle vignette preserves the design's brightness.

[[src/renderer/src/screens/SplashScreen/SplashScreen.tsx#SplashScreen]] fills the entire window with an independent background and vignette, avoiding letterbox bars. The foreground retains the approved small-hand composition inside a wide coordinate frame without viewport-cover enlargement. A separate inner image-coordinate canvas keeps 6% edge allowance. The frame allows overflow so the continuous human forearm reaches the window boundary. Measured half-alpha contours at robot `(836,457)` in its 1672×941 plate and human `(628,369)` in its 1254×1254 plate meet at the original shared anchor `(847,467.5)`. Human coordinates are normalized to the shared 1672-unit width before wrapper translation; square-image height is not stretched to the wide frame. The positions and travel distances come from [[src/renderer/src/screens/SplashScreen/startup-scene.ts#STARTUP_SCENE]], so window resizing cannot separate the tips or move the burst away from contact.

Over 1.65 seconds, the robot moves from upper left to lower right and the human hand moves symmetrically from lower right to upper left along the same diagonal axis. Only after contact does a 0.86-second burst begin: a white-blue core produces two short peaks, then expands and fades. `src/renderer/src/assets/agents-one-splash.svg` starts 0.14 seconds after contact so it does not cover the first flash.

[[src/renderer/src/App.tsx#App]] keeps the startup surface visible for at least 2.9 seconds. The wordmark starts at 1.79 seconds and enters over 0.7 seconds while connection checks continue in parallel.

The splash keeps loading status and the delayed local-mode escape hatch outside the decorative stage. `prefers-reduced-motion` disables scene, burst, and logo animations and immediately shows the aligned final scene and wordmark.

### Startup contact geometry regression

The real component and splash CSS run in Chromium at wide, square and tall window sizes, including DPR 2 and resizing.

Both measured fingertip contours must meet the burst anchor before any flash or wordmark appears, with source image edges outside the visible artwork frame. Hand-group scaling must preserve this contact anchor.

The visible artwork must retain its original aspect ratio and fit within both window dimensions. Inward hand motion keeps source edges outside this artwork frame, rather than using an oversized viewport-cover scene that enlarges the hands in taller windows.

### Startup full-window background regression

The background and vignette must cover the entire viewport across tall, square and wide windows, while the transparent foreground frame preserves the approved hand size and contact alignment.

This catches the former contained background and opaque frame, which produced broad top and bottom bars even though fingertip alignment passed.

### Startup foreground integrity regression

The decoded robot foreground must retain opaque metal at the damaged surface locations and a nearly transparent gap around its layer split.

Both measured fingertip contour pixels must exist, preventing an eroded matte or a cut through a fingertip from passing validation.

### Startup forearm continuation regression

The entire human hand and forearm must render from one unmasked image, preventing a blended continuation from introducing a texture seam or contour kink.

Across approach and contact, the continuous image extends beyond the wide frame and retains opaque skin below the former join. Samples along the lower alpha contour must change slope smoothly across that region. Neither the human image nor the frame may apply a fade mask or clip. Reduced motion disables the human motion wrapper as well as the robot animation; measured tips remain aligned after the image-size calibration.

### Startup reduced motion regression

Reduced motion must show the same aligned final hands and visible wordmark without a flash. Loading status remains available, and the component regression preserves readiness and the delayed local-mode escape control.

## Wordmark assets

The navigation and startup variants share the same Dawn Ring geometry and Oxanium 700 SVG letterforms without a white background tile.

The expanded sidebar selects `agents-one-wordmark.svg` on light themes and `agents-one-wordmark-on-dark.svg` on every theme registered with `appearance: "dark"`. Only the solid letter color changes; the Dawn Ring gradient remains unchanged. Storing letters as paths avoids external or system-font dependencies during startup.

`src/renderer/src/assets/agents-one-wordmark.svg` is the dark-text persistent-navigation variant. `src/renderer/src/assets/agents-one-splash.svg` is the white-text startup variant. The standalone `src/renderer/src/assets/agents-one-mark.svg` remains valid for icon-only contexts such as About and window chrome.

## Windows executable icon

Windows shortcuts and taskbar entries must resolve the rainbow-ring icon embedded in the packaged executable, even when unsigned builds disable the standard resource-edit and signing helper.

`applyWindowsExecutableIcon` in `scripts/after-pack-windows-icon.mjs` runs after packaging and uses the locked `resedit` dependency to embed the existing multi-size ICO in JavaScript. An icon edit failure aborts packaging. It changes only the new output executable, preserving non-icon PE resources and leaving Runtime settings, window identity, installed applications and Windows icon caches untouched.

### Embedded icon frames

A real Electron exe copy starts with the default atom; after the hook, an independent PE reader verifies every brand ICO frame in its primary group and unchanged non-icon resources, detecting omitted editing, missing sizes or damaged metadata.

### Other platform isolation

The Windows-only resource hook must return without accessing package paths or starting a resource editor for other platforms.

### Output path boundary

An executable name that resolves outside the package output must be rejected before resource editing, preventing a packaging error from changing another file.

## Legacy product-brand migration

Agents One removes the former desktop product identity while preserving Hermes Agent as an optional Runtime and keeping user preferences recoverable across upgrades.

The preload bridge is exposed as `window.agentsOneAPI`; `window.hermesAPI` remains a deprecated alias for older automation during a migration window. Renderer preferences use versioned `agents-one.*` keys and copy old values on first read without deleting them, so rollback remains safe. New window events use the `agents-one:` namespace while listeners accept old event names temporarily.

Desktop-only environment variables prefer `AGENTS_ONE_*` and `VITE_AGENTS_ONE_*`, with former names retained only as read fallbacks. Windows taskbar and notification identity matches the packaged `com.pkulyn.agents-one` app id in both development and packaged runs: [[src/main/app/start.ts#startMainProcess]] calls Electron's native `app.setAppUserModelId` before readiness because the toolkit helper deliberately substitutes `electron.exe` during development, which would restore the Electron atom taskbar icon. The main BrowserWindow keeps using `resources/icon.png`, while packaging uses the multi-size `build/icon.ico`; both are generated from the same rainbow dawn-ring mark. Old Electron user-data directories are read once as migration sources and are never deleted; `.hermes`, `HERMES_HOME`, Runtime ids, CLI commands, Dashboard headers, and gateway events remain unchanged because they belong to the Hermes Agent Runtime contract.

## Packaged license notices

Desktop packages include the MIT project license, inherited third-party notices and the licenses for bundled fonts.

The build resource list copies the root license and third-party notices into resources/notices. Cairo and Manrope retain their embedded copyright notices and SIL OFL 1.1 terms; the Oxanium-derived wordmark notice is included separately. These files are build inputs and must exist in a clean checkout. Project MIT metadata does not replace dependency or asset licenses.

## Packaged dependency notices

Desktop builds preserve production dependency notices separately from the project MIT license. The inventory binds installed versions to the lockfile and identifies missing standalone notices.

The build collector emits build assets copied to resources/notices by electron-builder. Missing required packages or version drift stop generation; commercial SDK terms remain distinct. [[tests/dependency-notices.test.ts]] checks preservation, reproducibility and refusal of incomplete build inputs.

## Windows direct npm collection

Windows packaging runs npm dependency collection through the active Node executable and its adjacent npm CLI. The build hook preserves the collector arguments and waits for process close and file flush before parsing JSON.

This build-only compatibility hook avoids dependence on a PowerShell shim. It leaves the application Runtime and production dependency graph unchanged. [[tests/windows-npm-collection.test.ts]] verifies real large child output, literal arguments and expected npm-list error handling.

The real portable npm integration test allows 30 seconds for Windows process startup and collection under a full-suite workload. This test deadline does not change production collector arguments or error handling.

## Windows process product identity

Packaged Windows executables identify themselves as Agents One in native file descriptions and product metadata instead of retaining the Electron distribution name.

The existing Windows resource hook writes the configured application name, executable identity and application versions alongside the icon, without external signing helpers. Electron copyright and unrelated resources remain intact. This applies to newly packaged executables; an app.asar-only update cannot replace old EXE metadata. The real-EXE packaging regression verifies all language tables and preservation of other resources.
