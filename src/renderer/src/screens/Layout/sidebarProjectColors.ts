// Arranged by hue so adjacent slots in the palette have similar colors.
export const SIDEBAR_PROJECT_PALETTE = [
  "#1272b7",
  "#355bb8",
  "#5046aa",
  "#763eae",
  "#943682",
  "#ad365c",
  "#b84b38",
  "#aa5910",
  "#866508",
  "#607728",
  "#22754d",
  "#167884",
] as const;

const paletteSize: number = SIDEBAR_PROJECT_PALETTE.length;
export const SIDEBAR_PROJECT_COLORS_KEY = "agents-one.sidebar.projectColors";

export function sidebarProjectColorKey(key: string): string {
  if (!/[\\/]/.test(key)) return key;
  // Unregistered folders can still appear in cached tasks. Avoid persisting
  // their raw paths in presentation preferences.
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  }
  return `legacy:${(hash >>> 0).toString(16)}`;
}

export function parseSidebarProjectColors(
  raw: string | null,
): Map<string, number> {
  const assignments = new Map<string, number>();
  if (!raw) return assignments;
  try {
    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return assignments;
    for (const entry of entries) {
      if (!Array.isArray(entry)) continue;
      const [key, slot] = entry;
      if (
        typeof key === "string" &&
        typeof slot === "number" &&
        Number.isInteger(slot) &&
        slot >= 0 &&
        slot < paletteSize
      ) {
        assignments.set(key, slot);
      }
    }
  } catch {
    // An unreadable preference can be rebuilt from the visible projects.
  }
  return assignments;
}

function hueDistance(a: number, b: number): number {
  const difference = Math.abs(a - b);
  return Math.min(difference, paletteSize - difference);
}

export function assignSidebarProjectColors(
  keys: readonly string[],
  saved: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  if (keys.every((key) => saved.has(key))) return saved;

  const assignments = new Map(saved);
  const counts = Array<number>(paletteSize).fill(0);
  for (const slot of saved.values()) counts[slot]++;

  for (const [index, key] of keys.entries()) {
    if (assignments.has(key)) continue;
    const neighbors = [
      assignments.get(keys[index - 1]),
      assignments.get(keys[index + 1]),
    ];
    let bestSlot = 0;
    let bestSetDistance = -1;
    let bestNeighborDistance = -1;

    for (const [slot, count] of counts.entries()) {
      if (count > counts[bestSlot]) continue;
      const setDistance = counts.reduce(
        (distance, used, other) =>
          used ? Math.min(distance, hueDistance(slot, other)) : distance,
        paletteSize,
      );
      let neighborDistance: number = paletteSize;
      for (const neighbor of neighbors) {
        if (neighbor !== undefined) {
          neighborDistance = Math.min(
            neighborDistance,
            hueDistance(slot, neighbor),
          );
        }
      }
      if (
        count < counts[bestSlot] ||
        setDistance > bestSetDistance ||
        (setDistance === bestSetDistance &&
          neighborDistance > bestNeighborDistance)
      ) {
        bestSlot = slot;
        bestSetDistance = setDistance;
        bestNeighborDistance = neighborDistance;
      }
    }

    assignments.set(key, bestSlot);
    counts[bestSlot]++;
  }

  return assignments;
}
