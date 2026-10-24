import { dialog, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { isAbsolute } from "node:path";
import type { AppLocale } from "../../shared/i18n/types";
import type { AgentsOneRestoreResult } from "../../shared/agents-one-backup";
let restoring = false;
export async function runConfirmedBackupRestore(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
  archivePath: unknown,
  locale: AppLocale,
  restore: () => Promise<AgentsOneRestoreResult>,
): Promise<AgentsOneRestoreResult> {
  const window = getMainWindow();
  const trusted = (): boolean =>
    Boolean(
      window &&
      !window.isDestroyed() &&
      getMainWindow() === window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame,
    );
  if (!trusted()) return { success: false, error: "scope_denied" };
  if (
    typeof archivePath !== "string" ||
    !isAbsolute(archivePath) ||
    archivePath.length > 32768 ||
    archivePath.includes("\0")
  )
    return { success: false, error: "invalid_backup_path" };
  if (restoring) return { success: false, error: "restore_in_progress" };
  restoring = true;
  let confirmed = false;
  try {
    const chinese = locale.startsWith("zh");
    const choice = await dialog.showMessageBox(window!, {
      type: "warning",
      title: chinese ? "恢复 Agents One 备份" : "Restore Agents One backup",
      message: chinese
        ? "恢复将替换现有配置与会话数据，并停止任务、重启应用。"
        : "Restore replaces existing settings and conversations, stops tasks and restarts the app.",
      detail: archivePath,
      buttons: chinese
        ? ["恢复并重启", "取消"]
        : ["Restore and restart", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response !== 0)
      return {
        success: false,
        error: chinese ? "恢复已取消。" : "Restore cancelled.",
      };
    if (!trusted()) return { success: false, error: "scope_denied" };
    confirmed = true;
    return await restore();
  } catch {
    return {
      success: false,
      error: confirmed ? "restore_failed" : "restore_confirmation_failed",
    };
  } finally {
    restoring = false;
  }
}
