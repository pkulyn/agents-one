# Agents One startup brand

The startup surface and expanded sidebar share one wordmark rule: the dawn ring is the letter `O` in `ONE`, never a separate white-tile icon beside the product name.

## Startup brand animation

The startup animates transparent robot and human foregrounds over one fixed hand-free background.

The layers come from the confirmed contact composition rather than rectangular crops or complete generated scene frames. This preserves the intended approach while preventing ghost fingertips, moving background seams, truncated fingers, and camera drift.

[[src/renderer/src/screens/SplashScreen/SplashScreen.tsx#SplashScreen]] renders the three independent layers. Both the foreground mattes and the fixed background exclude the baked contact highlight, so no fingertip or floating contact glow appears during the approach. Over 1.65 seconds, the robot moves from upper left to lower right and the human hand moves from lower right to upper left along the same contact axis. The motions are symmetric and end at the shared contact point; there is no common camera lift or independent vertical drift. Only when both hands reach that final position does a 0.86-second contact burst begin: a bright white-blue core produces two short peaks separated by a brief opacity dip, then expands and fades. `src/renderer/src/assets/agents-one-splash.svg` starts 0.14 seconds after contact so it does not cover the first flash. The shared glow/wordmark anchor is `50.7% / 47.3%`, calibrated in the Electron renderer's CSS viewport.

[[src/renderer/src/App.tsx#App]] keeps the startup surface visible for at least 2.9 seconds. The wordmark starts near 1.2 seconds, enters over 0.7 seconds, and remains stable for roughly one second while connection checks continue in parallel.

The splash keeps loading status and the delayed local-mode escape hatch outside the decorative stage. `prefers-reduced-motion` disables scene, burst, and logo animations and immediately shows the aligned final scene and wordmark.

## Wordmark assets

The navigation and startup variants share the same Dawn Ring geometry and Oxanium 700 SVG letterforms without a white background tile.

The expanded sidebar selects `agents-one-wordmark.svg` on light themes and `agents-one-wordmark-on-dark.svg` on every theme registered with `appearance: "dark"`. Only the solid letter color changes; the Dawn Ring gradient remains unchanged. Storing letters as paths avoids external or system-font dependencies during startup.

`src/renderer/src/assets/agents-one-wordmark.svg` is the dark-text persistent-navigation variant. `src/renderer/src/assets/agents-one-splash.svg` is the white-text startup variant. The standalone `src/renderer/src/assets/agents-one-mark.svg` remains valid for icon-only contexts such as About and window chrome.

## Legacy product-brand migration

Agents One removes the former desktop product identity while preserving Hermes Agent as an optional Runtime and keeping user preferences recoverable across upgrades.

The preload bridge is exposed as `window.agentsOneAPI`; `window.hermesAPI` remains a deprecated alias for older automation during a migration window. Renderer preferences use versioned `agents-one.*` keys and copy old values on first read without deleting them, so rollback remains safe. New window events use the `agents-one:` namespace while listeners accept old event names temporarily.

Desktop-only environment variables prefer `AGENTS_ONE_*` and `VITE_AGENTS_ONE_*`, with former names retained only as read fallbacks. Windows taskbar and notification identity matches the packaged `com.pkulyn.agents-one` app id in both development and packaged runs: [[src/main/app/start.ts#startMainProcess]] calls Electron's native `app.setAppUserModelId` before readiness because the toolkit helper deliberately substitutes `electron.exe` during development, which would restore the Electron atom taskbar icon. The main BrowserWindow keeps using `resources/icon.png`, while packaging uses the multi-size `build/icon.ico`; both are generated from the same rainbow dawn-ring mark. Old Electron user-data directories are read once as migration sources and are never deleted; `.hermes`, `HERMES_HOME`, Runtime ids, CLI commands, Dashboard headers, and gateway events remain unchanged because they belong to the Hermes Agent Runtime contract.
