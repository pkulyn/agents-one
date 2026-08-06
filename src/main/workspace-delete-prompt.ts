import { BrowserWindow, dialog } from "electron";

export async function promptRemoteWorkspaceDelete(
  runtimeName: string,
  relativePath: string,
): Promise<boolean> {
  const window =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const options = {
    type: "warning" as const,
    title: "确认删除项目文件",
    message: `${runtimeName} 请求删除文件`,
    detail: `相对路径：${relativePath}\n\n此授权仅用于本次删除。拒绝后，远程智能体仍可继续本轮对话。`,
    buttons: ["允许本次删除", "拒绝"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
}
