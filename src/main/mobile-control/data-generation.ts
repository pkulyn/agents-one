import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";

export const MOBILE_DATA_GENERATION_PATH =
  "desktop/mobile-control/data-generation.json";
export const MOBILE_LEGACY_GENERATION = "legacy";
function fail(): never {
  throw Object.assign(Error("owner_unavailable"), {
    code: "owner_unavailable",
    status: 503,
  });
}
/** Local restore identity is never portable authority or a backup payload. */
export function readMobileDataGeneration(home: string): string {
  const root = resolve(home);
  for (const directory of [
    root,
    join(root, "desktop"),
    join(root, "desktop", "mobile-control"),
  ]) {
    const info = lstatSync(directory, { throwIfNoEntry: false });
    if (!info) continue;
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      realpathSync(directory).toLowerCase() !== directory.toLowerCase()
    )
      fail();
  }
  const file = join(root, ...MOBILE_DATA_GENERATION_PATH.split("/"));
  const info = lstatSync(file, { throwIfNoEntry: false });
  if (!info) return MOBILE_LEGACY_GENERATION;
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 4096 ||
    realpathSync(file).toLowerCase() !== file.toLowerCase()
  )
    fail();
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (
      !value ||
      value.version !== 1 ||
      typeof value.generation !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        value.generation,
      )
    )
      fail();
    return value.generation;
  } catch {
    return fail();
  }
}
/** Preserve existing pre-generation ledgers; restored datasets get a fresh namespace. */
export function mobileOwnerLedgerPath(
  home: string,
  ownerId: string,
  spaceId: string,
  generation: string,
): string {
  const identity =
    generation === MOBILE_LEGACY_GENERATION
      ? [ownerId, spaceId]
      : [ownerId, spaceId, generation];
  const name = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex");
  return join(home, "desktop", "mobile-control", `owner-${name}.json`);
}
