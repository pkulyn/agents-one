# Agents One startup brand

The startup surface and expanded sidebar share one wordmark rule: the dawn ring is the letter `O` in `ONE`, never a separate white-tile icon beside the product name.

## Startup brand animation

The startup composes one photograph into a continuous base and two independently moving, feather-masked hand layers.

[[src/renderer/src/screens/SplashScreen/SplashScreen.tsx#SplashScreen]] renders `src/renderer/src/assets/startup-hands.jpeg`. The animation in `src/renderer/src/assets/main.css` moves the foreground layers from opposite directions for 1.1 seconds until their fingertips meet at the shared `50% / 44%` anchor, reveals a short contact burst there, then emits `src/renderer/src/assets/agents-one-splash.svg` from the same point. The dim continuity base prevents translated masks from exposing a diagonal seam.

[[src/renderer/src/App.tsx#App]] keeps the startup surface visible for at least 2.9 seconds. The wordmark starts near 1.2 seconds, enters over 0.7 seconds, and remains stable for roughly one second while connection checks continue in parallel.

The splash keeps loading status and the delayed local-mode escape hatch outside the decorative stage. `prefers-reduced-motion` disables hand, burst, and logo animations and immediately shows the aligned final scene and wordmark.

## Wordmark assets

The navigation and startup variants share the same Dawn Ring geometry and Oxanium 700 SVG letterforms without a white background tile.

The expanded sidebar selects `agents-one-wordmark.svg` on light themes and `agents-one-wordmark-on-dark.svg` on every theme registered with `appearance: "dark"`. Only the solid letter color changes; the Dawn Ring gradient remains unchanged. Storing letters as paths avoids external or system-font dependencies during startup.

`src/renderer/src/assets/agents-one-wordmark.svg` is the dark-text persistent-navigation variant. `src/renderer/src/assets/agents-one-splash.svg` is the white-text startup variant. The standalone `src/renderer/src/assets/agents-one-mark.svg` remains valid for icon-only contexts such as About and window chrome.
