import { BrowserWindow, clipboard, dialog, Menu, shell } from "electron";
import { copyFile, open } from "node:fs/promises";
import { join, extname } from "node:path";
import { execFile } from "node:child_process";
import type {
  ConversationFileAction,
  ConversationFileRef,
} from "../../shared/conversation-files";
import { resolveConversationFile } from "../conversation-files";
import { canOpenDocument } from "./local-file-actions";
import { createScopedIpcMain } from "./sender-scope";

type Labels = Record<string, string>;
export function registerConversationFileIpc(
  getMainWindow: () => BrowserWindow | null,
  rawIpcMain: Electron.IpcMain,
): void {
  const ipc = createScopedIpcMain(rawIpcMain, getMainWindow);
  ipc.handle("conversation-file-info", (_event, ref: ConversationFileRef) =>
    resolveConversationFile(ref),
  );
  ipc.handle(
    "conversation-file-action",
    async (
      event,
      ref: ConversationFileRef,
      action: ConversationFileAction,
      labels: Labels = {},
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const execute = async (
        operation: ConversationFileAction,
      ): Promise<boolean | string> => {
        const file = await resolveConversationFile(ref);
        if (!file) return false;
        const target = file.path;
        if (operation === "open")
          return canOpenDocument(target) && !(await shell.openPath(target));
        if (operation === "open-with") {
          if (process.platform !== "win32" || !canOpenDocument(target))
            return false;
          return new Promise((resolve) =>
            execFile(
              join(
                process.env.SystemRoot || "C:\\Windows",
                "System32",
                "rundll32.exe",
              ),
              ["shell32.dll,OpenAs_RunDLL", target],
              { windowsHide: false },
              (error) => resolve(!error),
            ),
          );
        }
        if (operation === "copy-path" || operation === "copy-relative") {
          clipboard.writeText(
            operation === "copy-path" ? target : file.relativePath || file.name,
          );
          return true;
        }
        if (operation === "reveal") {
          shell.showItemInFolder(target);
          return true;
        }
        if (operation === "save") {
          const result = await dialog.showSaveDialog(win || getMainWindow()!, {
            defaultPath: file.name,
          });
          if (result.canceled || !result.filePath) return false;
          const current = await resolveConversationFile(ref);
          if (!current || current.path !== target) return false;
          await copyFile(target, result.filePath);
          return true;
        }
        if (
          operation === "image" &&
          file.image &&
          file.size <= 25 * 1024 * 1024
        ) {
          const handle = await open(target, "r");
          let bytes: Buffer;
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > 25 * 1024 * 1024) return false;
            const buffer = Buffer.alloc(info.size + 1);
            let length = 0;
            while (length < buffer.length) {
              const read = await handle.read(
                buffer,
                length,
                buffer.length - length,
                null,
              );
              if (!read.bytesRead) break;
              length += read.bytesRead;
            }
            if (
              length !== info.size ||
              (await handle.stat()).mtimeMs !== info.mtimeMs
            )
              return false;
            bytes = buffer.subarray(0, length);
          } finally {
            await handle.close();
          }
          const mime = extname(target)
            .slice(1)
            .toLowerCase()
            .replace(/^jpg$/, "jpeg")
            .replace(/^svg$/, "svg+xml");
          return "data:image/" + mime + ";base64," + bytes.toString("base64");
        }
        if (operation === "menu" && win) {
          const label = (key: string, fallback: string): string =>
            typeof labels?.[key] === "string"
              ? labels[key].slice(0, 120)
              : fallback;
          const item = (
            op: ConversationFileAction,
            key: string,
            fallback: string,
          ): Electron.MenuItemConstructorOptions => ({
            label: label(key, fallback),
            click: () => {
              void execute(op).catch(() => undefined);
            },
          });
          Menu.buildFromTemplate([
            {
              ...item("open", "open", "Open"),
              enabled: canOpenDocument(target),
            },
            {
              ...item("open-with", "openWith", "Open with…"),
              enabled: process.platform === "win32" && canOpenDocument(target),
            },
            item("save", "saveAs", "Save as…"),
            { type: "separator" },
            item("copy-path", "copyPath", "Copy absolute path"),
            item("copy-relative", "copyRelative", "Copy relative path"),
            item("reveal", "reveal", "Show in folder"),
          ]).popup({ window: win });
          return true;
        }
        return false;
      };
      try {
        return await execute(action);
      } catch {
        return false;
      }
    },
  );
}
