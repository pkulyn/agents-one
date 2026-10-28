import type { CSSProperties } from "react";

// Coordinates belong to the transparent foreground plate, not the viewport.
// Both contours are measured at their half-alpha edge. The split is in the
// completely transparent gap (rows 406–420), clear of either rounded fingertip.
export const STARTUP_SCENE = {
  width: 1672,
  height: 941,
  robotTip: { x: 849, y: 396 },
  humanTip: { x: 888, y: 435 },
  contact: { x: 868.5, y: 415.5 },
  splitY: 413,
  approachDistance: 134,
} as const;

const percent = (value: number, extent: number): string =>
  `${(value / extent) * 100}%`;

export const startupSceneStyle = {
  "--splash-scene-ratio": STARTUP_SCENE.width / STARTUP_SCENE.height,
  "--splash-contact-x": percent(STARTUP_SCENE.contact.x, STARTUP_SCENE.width),
  "--splash-contact-y": percent(STARTUP_SCENE.contact.y, STARTUP_SCENE.height),
  "--splash-hand-split": percent(STARTUP_SCENE.splitY, STARTUP_SCENE.height),
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
