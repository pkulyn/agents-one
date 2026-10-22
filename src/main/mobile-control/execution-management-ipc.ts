import { ipcMain, type BrowserWindow } from "electron";
import { prepareAndManageMobileExecutionPolicies } from "./execution-management";
import { manageMobileWriteRecovery } from "./project-write-recovery";

/** Only the desktop settings frame can mutate Owner execution approvals. */
export function registerMobileExecutionPolicyIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.handle("mobile-write-recovery", (event, profile, command) => {
    const assertCurrent = (): void => {
      if (
        event.sender !== getMainWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw Error("scope_denied");
    };
    assertCurrent();
    return manageMobileWriteRecovery(profile, command, assertCurrent);
  });
  ipcMain.handle("mobile-execution-manage", (event, profile, command) => {
    const assertCurrent = (): void => {
      if (
        event.sender !== getMainWindow()?.webContents ||
        event.senderFrame !== event.sender.mainFrame
      )
        throw Error("scope_denied");
    };
    assertCurrent();
    return prepareAndManageMobileExecutionPolicies(
      profile,
      command,
      assertCurrent,
    );
  });
}
