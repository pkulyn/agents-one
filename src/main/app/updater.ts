import { app, ipcMain, type BrowserWindow } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import type { AppUpdater } from "electron-updater";
import { dirname, join } from "path";
import { updaterLogger } from "../updater-log";

interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
}

export type DesktopUpdatePolicyReason =
  | "development"
  | "portable"
  | "unsigned-build";

export interface DesktopUpdatePolicy {
  enabled: boolean;
  reason: DesktopUpdatePolicyReason | null;
}

let autoUpdaterInstance: AppUpdater | null = null;

function updatePreferencesPath(): string {
  return join(app.getPath("userData"), "update-preferences.json");
}

function getAutoUpgradeEnabled(): boolean {
  const file = updatePreferencesPath();
  if (!existsSync(file)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      autoUpgrade?: unknown;
    };
    return parsed.autoUpgrade === true;
  } catch {
    return false;
  }
}

function setAutoUpgradeEnabled(enabled: boolean): void {
  const file = updatePreferencesPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ autoUpgrade: enabled }, null, 2)}\n`);
}

export function setupUpdater({ getMainWindow }: UpdaterDeps): void {
  const policy = resolveDesktopUpdatePolicy({
    isPackaged: app.isPackaged,
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    signedBuild:
      typeof __AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD__ !== "undefined" &&
      __AGENTS_ONE_SIGNED_AUTO_UPDATE_BUILD__,
  });

  ipcMain.handle("get-app-version", () => app.getVersion());
  ipcMain.handle("get-desktop-update-policy", () => policy);
  ipcMain.handle("get-auto-upgrade-enabled", () =>
    policy.enabled ? getAutoUpgradeEnabled() : false,
  );
  ipcMain.handle("set-auto-upgrade-enabled", (_event, enabled: boolean) => {
    if (!policy.enabled) return false;
    setAutoUpgradeEnabled(enabled);
    if (autoUpdaterInstance) {
      autoUpdaterInstance.autoDownload = enabled;
    }
    return true;
  });

  if (!policy.enabled) {
    autoUpdaterInstance = null;
    ipcMain.handle("check-for-updates", async () => null);
    ipcMain.handle("download-update", () => false);
    ipcMain.handle("install-update", () => {});
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require("electron-updater") as {
    autoUpdater: AppUpdater;
  };

  autoUpdaterInstance = autoUpdater;
  autoUpdater.logger = updaterLogger;
  autoUpdater.autoDownload = getAutoUpgradeEnabled();
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    getMainWindow()?.webContents.send("update-available", {
      version: info.version,
      releaseNotes: info.releaseNotes,
    });
  });
  autoUpdater.on("download-progress", (progress) => {
    getMainWindow()?.webContents.send("update-download-progress", {
      percent: Math.round(progress.percent),
    });
  });
  autoUpdater.on("update-downloaded", () => {
    getMainWindow()?.webContents.send("update-downloaded");
  });
  autoUpdater.on("error", (err) => {
    getMainWindow()?.webContents.send("update-error", err.message);
  });

  ipcMain.handle("check-for-updates", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return result?.updateInfo?.version || null;
    } catch {
      return null;
    }
  });
  ipcMain.handle("download-update", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      getMainWindow()?.webContents.send("update-error", message);
      return false;
    }
  });
  ipcMain.handle("install-update", () => {
    updaterLogger.info(
      "Restart requested by user — calling quitAndInstall(isSilent=false, isForceRunAfter=true)",
    );
    autoUpdater.quitAndInstall(false, true);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

export function resolveDesktopUpdatePolicy({
  isPackaged,
  isPortable,
  signedBuild,
}: {
  isPackaged: boolean;
  isPortable: boolean;
  signedBuild: boolean;
}): DesktopUpdatePolicy {
  if (!isPackaged) return { enabled: false, reason: "development" };
  if (isPortable) return { enabled: false, reason: "portable" };
  if (!signedBuild) return { enabled: false, reason: "unsigned-build" };
  return { enabled: true, reason: null };
}
