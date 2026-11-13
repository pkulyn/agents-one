/** Portable launches never adopt another application's state automatically. */
export function automaticLegacyImportAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !env.PORTABLE_EXECUTABLE_DIR?.trim();
}
