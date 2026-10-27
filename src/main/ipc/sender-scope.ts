import {
  app,
  type BrowserWindow,
  type IpcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import { isAllowedAppNavigationUrl } from "../security";

type SenderEvent = Pick<
  IpcMainEvent | IpcMainInvokeEvent,
  "sender" | "senderFrame"
>;
export type AuxiliaryIpcRole =
  | "quick-composer"
  | "tray-menu"
  | "tray-completion";
const auxiliaryWindows = new WeakMap<
  WebContents,
  { role: AuxiliaryIpcRole; url: string }
>();
const COMMON = new Set(["get-locale", "set-locale"]);
const CHANNELS: Record<AuxiliaryIpcRole, Set<string>> = {
  "tray-menu": new Set([
    "tray-menu-data",
    "tray-menu-action",
    "tray-menu-resize",
  ]),
  "tray-completion": new Set([
    "tray-completion-data",
    "tray-completion-open",
    "tray-completion-close",
  ]),
  "quick-composer": new Set([
    "tray-composer-close",
    "tray-composer-resize",
    "tray-composer-start-runtime-task",
    "list-agent-runtimes",
    "select-folder",
    "register-project-workspace",
    "send-message",
    "abort-chat",
    "cancel-agent-runtime-task",
    "stage-attachment",
    "clear-staged-attachments",
    "show-file-menu",
    "show-media-menu",
    "open-file-in-editor",
    "open-agent-runtime-artifact",
    "save-media-file",
    "get-voice-input-config",
    "transcribe-audio",
    "start-streaming-transcription",
    "send-streaming-audio",
    "stop-streaming-transcription",
  ]),
};
function devServerUrl(): string | undefined {
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) return undefined;
  try {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}
/** Only native window creation can enroll a role; URL flags alone grant nothing. */
export function registerAuxiliaryIpcWindow(
  contents: WebContents,
  role: AuxiliaryIpcRole,
  rendererHtmlPath: string,
  serverUrl?: string,
): void {
  const url = new URL(serverUrl || pathToFileURL(rendererHtmlPath).href);
  const query = {
    "quick-composer": "tray",
    "tray-menu": "trayMenu",
    "tray-completion": "trayCompletion",
  }[role];
  url.searchParams.set(query, "1");
  auxiliaryWindows.set(contents, { role, url: normalizedUrl(url.href) });
  contents.once("destroyed", () => auxiliaryWindows.delete(contents));
}
export function isAuthorizedIpcSender(
  event: SenderEvent,
  channel: string,
  getMainWindow: () => BrowserWindow | null,
): boolean {
  try {
    if (
      !event.sender ||
      event.sender.isDestroyed() ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    )
      return false;
    const main = getMainWindow();
    if (main && !main.isDestroyed() && event.sender === main.webContents) {
      return isAllowedAppNavigationUrl(
        event.senderFrame.url,
        join(__dirname, "../renderer/index.html"),
        devServerUrl(),
      );
    }
    const auxiliary = auxiliaryWindows.get(event.sender);
    return (
      !!auxiliary &&
      normalizedUrl(event.senderFrame.url) === auxiliary.url &&
      (COMMON.has(channel) || CHANNELS[auxiliary.role].has(channel))
    );
  } catch {
    return false;
  }
}
/** Guard before invoking any listener; event-listener removal retains its original identity. */
export function createScopedIpcMain(
  raw: IpcMain,
  getMainWindow: () => BrowserWindow | null,
): Pick<IpcMain, "handle" | "on" | "removeListener" | "removeHandler"> {
  type SendListener = Parameters<IpcMain["on"]>[1];
  const listeners = new Map<string, Map<SendListener, SendListener>>();
  return {
    handle(channel, listener) {
      raw.handle(channel, (event, ...args) => {
        if (!isAuthorizedIpcSender(event, channel, getMainWindow))
          throw Error("scope_denied");
        return listener(event, ...args);
      });
    },
    on(channel, listener) {
      const guarded = (event: IpcMainEvent, ...args: unknown[]): void => {
        if (isAuthorizedIpcSender(event, channel, getMainWindow))
          listener(event, ...args);
      };
      let channelListeners = listeners.get(channel);
      if (!channelListeners) {
        channelListeners = new Map();
        listeners.set(channel, channelListeners);
      }
      channelListeners.set(listener, guarded);
      return raw.on(channel, guarded);
    },
    removeListener(channel, listener) {
      const guarded = listeners.get(channel)?.get(listener);
      listeners.get(channel)?.delete(listener);
      return raw.removeListener(channel, guarded || listener);
    },
    removeHandler(channel) {
      raw.removeHandler(channel);
    },
  };
}
