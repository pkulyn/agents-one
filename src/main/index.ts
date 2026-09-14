import { app } from "electron";
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { applyGpuPreferences, installGpuCrashGuard } from "./gpu-fallback";

function configurePortableUserData(): void {
  // electron-builder's portable launcher marks the extracted app with this
  // variable. Keep its desktop state separate from the installed build so
  // portable use neither reads nor holds the installed app's single-instance
  // profile lock. An explicit test/admin override always wins.
  if (
    process.platform !== "win32" ||
    !process.env.PORTABLE_EXECUTABLE_DIR?.trim() ||
    process.env.AGENTS_ONE_USER_DATA_DIR?.trim() ||
    process.env.HERMES_DESKTOP_USER_DATA_DIR?.trim() ||
    process.argv.some((argument) => argument.startsWith("--user-data-dir="))
  )
    return;
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) return;
  try {
    app.setPath("userData", join(localAppData, "agents-one-portable"));
  } catch {
    // Fall back to Electron's default if this happens unexpectedly late.
  }
}

configurePortableUserData();
const hasSingleInstanceLock = app.requestSingleInstanceLock();

function migrateLegacyUserData(): void {
  // The product name is part of Electron's default userData path. Keep the
  // rename from silently dropping small desktop-level preferences such as the
  // selected Hermes home, GPU fallback and update settings. Core agent data
  // stays in HERMES_HOME and is deliberately not moved.
  if (
    process.env.AGENTS_ONE_USER_DATA_DIR?.trim() ||
    process.env.HERMES_DESKTOP_USER_DATA_DIR?.trim()
  )
    return;

  try {
    const current = resolve(app.getPath("userData"));
    const appData = app.getPath("appData");
    const migrationMarker = join(current, ".agents-one-brand-migration-v1");
    if (existsSync(migrationMarker)) return;
    const legacyDirectories = [
      join(appData, "Hermes One"),
      join(appData, "hermes-desktop"),
    ];

    for (const legacy of legacyDirectories) {
      if (resolve(legacy) === current || !existsSync(legacy)) continue;
      mkdirSync(current, { recursive: true });
      for (const entry of readdirSync(legacy)) {
        const destination = join(current, entry);
        if (existsSync(destination)) continue;
        cpSync(join(legacy, entry), destination, {
          recursive: true,
          errorOnExist: false,
        });
      }
      break;
    }
    writeFileSync(migrationMarker, "completed\n", "utf8");
  } catch {
    // A failed preference migration must never prevent the application from
    // starting. HERMES_HOME data remains available independently.
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  migrateLegacyUserData();

  applyGpuPreferences();
  installGpuCrashGuard();

  if (process.env.ENABLE_CDP === "1") {
    app.commandLine.appendSwitch(
      "remote-debugging-port",
      process.env.CDP_PORT || "9222",
    );
  }

  void import("./app/start").then(({ startMainProcess }) => startMainProcess());
}
