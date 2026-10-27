import { dialog } from "electron";
import type { AppLocale } from "../../shared/i18n/types";
import type { AgentsOneRestoreResult } from "../../shared/agents-one-backup";
import { redactSensitiveText } from "../../shared/redaction";
/** Complete a restore after old Renderers have been retired. */
export async function completeBackupRestore(
  operation: () => Promise<AgentsOneRestoreResult>,
  locale: AppLocale,
  scheduleRelaunch: () => void,
): Promise<AgentsOneRestoreResult> {
  let result: AgentsOneRestoreResult;
  try {
    result = await operation();
  } catch (error) {
    result = {
      success: false,
      error:
        redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        ).slice(0, 4000) || "restore_failed",
    };
  }
  try {
    if (!result.success) {
      const chinese = locale.startsWith("zh");
      const title = chinese
        ? "Agents One 恢复未完成"
        : "Agents One restore did not complete";
      const message = chinese
        ? "恢复未完成。应用重启后将检查恢复状态，请保留原备份文件。"
        : "Restore did not complete. The app will check recovery state after restarting. Keep the original backup.";
      const detail = redactSensitiveText(
        result.error || "restore_failed",
      ).slice(0, 4000);
      try {
        await dialog.showMessageBox({
          type: "error",
          title,
          message,
          detail,
          buttons: [chinese ? "关闭并重启" : "Close and restart"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch {
        try {
          dialog.showErrorBox(title, message + "\n" + detail);
        } catch {
          console.error(
            "[backup] native_restore_failure_notification_unavailable",
          );
        }
      }
    }
    return result;
  } finally {
    scheduleRelaunch();
  }
}
