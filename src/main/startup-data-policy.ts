import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PORTABLE_MARKER_NAME = "agents-one-portable.json";

/** Only folder ZIPs contain this marker; installed packages do not. */
export function isPortableLaunch(
  env: Record<string, string | undefined> = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: string = process.platform,
): boolean {
  if (env.PORTABLE_EXECUTABLE_DIR?.trim()) return true;
  if (platform !== "win32" || !resourcesPath) return false;
  try {
    const marker = JSON.parse(
      readFileSync(join(resourcesPath, PORTABLE_MARKER_NAME), "utf8"),
    );
    return marker.schema === 1 && marker.mode === "agents-one-portable";
  } catch {
    return false;
  }
}

/** Portable launches never adopt another application's state automatically. */
export function automaticLegacyImportAllowed(
  env: Record<string, string | undefined> = process.env,
  resourcesPath: string | undefined = process.resourcesPath,
  platform: string = process.platform,
): boolean {
  return !isPortableLaunch(env, resourcesPath, platform);
}
