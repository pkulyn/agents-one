import { isAuthorizedIpcSender } from "./sender-scope";
import { BrowserWindow, clipboard, ipcMain, Menu, shell } from "electron";
import { realpathSync, statSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import { extname, isAbsolute } from "node:path";
import { isAuthorizedMediaPath, normalizeMediaPath } from "../media";
import { isAuthorizedWorkspacePath } from "../workspace-authority";

const MAX_COPY_BYTES = 5 * 1024 * 1024;
const DEFAULT_OPEN_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".log",
  ".json",
  ".csv",
  ".tsv",
  ".yaml",
  ".yml",
  ".toml",
  ".pdf",
  ".docx",
  ".doc",
  ".rtf",
  ".xlsx",
  ".xls",
  ".pptx",
  ".ppt",
  ".zip",
  ".odt",
  ".ods",
  ".odp",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
  ".ico",
  ".mp3",
  ".wav",
  ".ogg",
  ".m4a",
  ".flac",
  ".mp4",
  ".webm",
  ".mov",
]);

function resolveAuthorizedLocalPath(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 32_768 ||
    value.includes("\0")
  )
    return null;
  try {
    const normalized = normalizeMediaPath(value);
    if (!isAbsolute(normalized)) return null;
    const target = realpathSync(normalized);
    return isAuthorizedMediaPath(target) || isAuthorizedWorkspacePath(target)
      ? target
      : null;
  } catch {
    return null;
  }
}

export function canOpenDocument(target: string): boolean {
  try {
    return (
      DEFAULT_OPEN_EXTENSIONS.has(extname(target).toLowerCase()) &&
      statSync(target).isFile()
    );
  } catch {
    return false;
  }
}

/** Native association opening is a document capability, never a script launcher. */
export async function openAuthorizedLocalFile(
  value: unknown,
): Promise<boolean> {
  const target = resolveAuthorizedLocalPath(value);
  if (!target || !canOpenDocument(target)) return false;
  try {
    return !(await shell.openPath(target));
  } catch {
    return false;
  }
}

async function copyAuthorizedContent(target: string): Promise<void> {
  if (resolveAuthorizedLocalPath(target) !== target) return;
  try {
    const handle = await open(target, "r");
    try {
      const before = await handle.stat({ bigint: true });
      if (!before.isFile() || before.size > BigInt(MAX_COPY_BYTES)) return;
      const buffer = Buffer.alloc(MAX_COPY_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(
          buffer,
          length,
          buffer.length - length,
          null,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (
        length > MAX_COPY_BYTES ||
        resolveAuthorizedLocalPath(target) !== target
      )
        return;
      const current = await stat(target, { bigint: true });
      const after = await handle.stat({ bigint: true });
      if (
        current.dev !== before.dev ||
        current.ino !== before.ino ||
        after.size !== before.size ||
        after.mtimeNs !== before.mtimeNs ||
        after.size > BigInt(MAX_COPY_BYTES) ||
        resolveAuthorizedLocalPath(target) !== target
      )
        return;
      clipboard.writeText(buffer.subarray(0, length).toString("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    /* Missing, replaced or unreadable files never reach the clipboard. */
  }
}

export function registerArtifactFileMenuIpc(
  getMainWindow: () => BrowserWindow | null,
): void {
  ipcMain.on(
    "show-file-menu",
    async (
      event,
      filePath: unknown,
      labels: {
        open: string;
        copyPath: string;
        copyContent: string;
        reveal: string;
      },
    ) => {
      if (!isAuthorizedIpcSender(event, "show-file-menu", getMainWindow))
        return;
      const win =
        BrowserWindow.fromWebContents(event.sender) || getMainWindow();
      if (!win || win.isDestroyed()) return;
      const target = resolveAuthorizedLocalPath(filePath);
      if (!target) return;
      const label = (key: keyof typeof labels, fallback: string): string =>
        typeof labels?.[key] === "string"
          ? labels[key].slice(0, 120)
          : fallback;
      let copyContentEnabled = false;
      try {
        const info = statSync(target);
        copyContentEnabled = info.isFile() && info.size <= MAX_COPY_BYTES;
      } catch {
        return;
      }
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: label("open", "Open"),
          enabled: canOpenDocument(target),
          click: () => {
            void openAuthorizedLocalFile(target);
          },
        },
        { type: "separator" },
        {
          label: label("copyPath", "Copy path"),
          click: () => {
            if (resolveAuthorizedLocalPath(target) === target)
              clipboard.writeText(target);
          },
        },
        {
          label: label("copyContent", "Copy content"),
          enabled: copyContentEnabled,
          click: () => copyAuthorizedContent(target),
        },
        {
          label: label("reveal", "Reveal in folder"),
          click: () => {
            if (resolveAuthorizedLocalPath(target) === target)
              shell.showItemInFolder(target);
          },
        },
      ];
      Menu.buildFromTemplate(template).popup({ window: win });
    },
  );
}
