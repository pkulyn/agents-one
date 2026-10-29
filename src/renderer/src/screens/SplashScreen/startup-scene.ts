import type { CSSProperties } from "react";

// Coordinates use the original plate width, not the viewport. The robot keeps
// its original half-alpha contour; the continuous square human plate's native
// (628,369) contour is normalized to this shared width before positioning.
export const STARTUP_SCENE = {
  width: 1672,
  height: 941,
  robotTip: { x: 836, y: 457 },
  humanTip: { x: (628 * 1672) / 1254, y: (369 * 1672) / 1254 },
  contact: { x: 847, y: 467.5 },
  splitY: 467,
  approachDistance: 134,
} as const;

const percent = (value: number, extent: number): string =>
  `${(value / extent) * 100}%`;

export const startupSceneStyle = {
  "--splash-scene-ratio": STARTUP_SCENE.width / STARTUP_SCENE.height,
  "--splash-contact-x": percent(STARTUP_SCENE.contact.x, STARTUP_SCENE.width),
  "--splash-contact-y": percent(STARTUP_SCENE.contact.y, STARTUP_SCENE.height),
  "--splash-hand-split": percent(STARTUP_SCENE.splitY, STARTUP_SCENE.height),
  "--splash-human-origin-x": percent(
    STARTUP_SCENE.humanTip.x,
    STARTUP_SCENE.width,
  ),
  "--splash-human-origin-y": percent(
    STARTUP_SCENE.humanTip.y,
    STARTUP_SCENE.width,
  ),
  "--splash-travel-x": percent(
    STARTUP_SCENE.approachDistance,
    STARTUP_SCENE.width,
  ),
  "--splash-travel-y": percent(
    STARTUP_SCENE.approachDistance,
    STARTUP_SCENE.height,
  ),
  "--splash-robot-end-x": percent(
    STARTUP_SCENE.contact.x - STARTUP_SCENE.robotTip.x,
    STARTUP_SCENE.width,
  ),
  "--splash-robot-end-y": percent(
    STARTUP_SCENE.contact.y - STARTUP_SCENE.robotTip.y,
    STARTUP_SCENE.height,
  ),
  "--splash-human-end-x": percent(
    STARTUP_SCENE.contact.x - STARTUP_SCENE.humanTip.x,
    STARTUP_SCENE.width,
  ),
  "--splash-human-end-y": percent(
    STARTUP_SCENE.contact.y - STARTUP_SCENE.humanTip.y,
    STARTUP_SCENE.height,
  ),
} as CSSProperties;
