import { dialog } from "electron";
import { join } from "path";
import { readDesktopConfig } from "../config";
import { agentsOneDataRoot } from "../agents-one-data-root";

/** Validate after migration/recovery, before creating windows or background work. */
export function verifyDesktopConfigurationAtStartup(): boolean {
  try {
    readDesktopConfig();
    return true;
  } catch {
    const message = [
      "Agents One 无法读取桌面配置，已停止启动并保留原文件。",
      "Desktop configuration is invalid or unreadable. The original file was preserved.",
      join(agentsOneDataRoot(), "desktop.json"),
      "请先备份故障文件、检查访问权限，并从可信备份恢复有效配置后重新启动。不要删除原文件来绕过此提示。",
      "Preserve the file, check access permissions, restore a valid trusted backup, then restart.",
    ].join("\n\n");
    try {
      dialog.showErrorBox(
        "Agents One — 配置恢复 / Configuration recovery",
        message,
      );
    } catch {
      console.error(
        "[CONFIG] Desktop configuration recovery required; startup stopped.",
      );
    }
    return false;
  }
}
