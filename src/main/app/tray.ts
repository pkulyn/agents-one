import { BrowserWindow, ipcMain, nativeImage, screen, Tray } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import icon from "../../../resources/icon.png?asset";
import { listCachedSessions } from "../session-cache";
import { listRuntimeConversations } from "../runtime-conversation-store";
import { listProjectFolders } from "../project-folders";
import type {
  TrayMenuAction,
  TrayMenuData,
  TrayMenuTask,
} from "../../shared/tray-menu";
import {
  TRAY_MENU_COLLAPSED_WIDTH,
  TRAY_MENU_EXPANDED_WIDTH,
} from "../../shared/tray-menu";
import {
  groupTrayTasks,
  trayProjectName,
  trayTaskDisplay,
  type TrayTaskGroups,
} from "./tray-task-list";
import type { TrayCompletionData } from "../../shared/tray-completion";

const QUICK_COMPOSER_WIDTH = 560;
const QUICK_COMPOSER_HEIGHT = 96;
const QUICK_COMPOSER_MAX_HEIGHT = 420;
const TRAY_MENU_MIN_HEIGHT = 310;
const TRAY_MENU_MAX_HEIGHT = 720;
const COMPLETION_TOAST_WIDTH = 436;
const COMPLETION_TOAST_HEIGHT = 148;

interface TrayDeps {
  getMainWindow: () => BrowserWindow | null;
  getActiveChatTasks: () => ActiveTrayTask[];
  getRunningTaskCount: () => number;
  onQuitRequest: () => void;
}

export interface ActiveTrayTask {
  id: string;
  title: string;
  projectName?: string;
  updatedAt: number;
}

export interface TrayController {
  hideQuickComposer: () => void;
  showTaskCompletion: (data: TrayCompletionData) => void;
  destroy: () => void;
}

function readTrayTasks(activeChatTasks: ActiveTrayTask[]): TrayTaskGroups {
  const projectNames = (() => {
    try {
      return new Map(
        listProjectFolders().flatMap((folder) =>
          folder.id ? [[folder.id, folder.name] as const] : [],
        ),
      );
    } catch {
      return new Map<string, string>();
    }
  })();
  const projectName = (
    workspaceId: string | null | undefined,
    fallback: string | null | undefined,
  ): string =>
    trayProjectName(
      (workspaceId ? projectNames.get(workspaceId) : undefined) || fallback,
    );

  const runtimeTasks = (() => {
    try {
      return listRuntimeConversations(undefined, 200).map((item) => ({
        id: item.id,
        title: item.title,
        projectName: projectName(item.workspaceId, item.workspace),
        updatedAt: item.updatedAt,
        running: Boolean(item.activeRuntimeRunId),
        openTaskId: item.id,
      }));
    } catch {
      return [];
    }
  })();

  const legacyTasks = (() => {
    try {
      return listCachedSessions(200).map((item) => ({
        id: item.id,
        title: item.title,
        projectName: projectName(item.contextWorkspaceId, item.contextFolder),
        updatedAt: item.startedAt,
        running: false,
        openTaskId: item.id,
      }));
    } catch {
      return [];
    }
  })();

  return groupTrayTasks([
    ...activeChatTasks.map((task) => ({ ...task, running: true })),
    ...runtimeTasks,
    ...legacyTasks,
  ]);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isTrayMenuAction(value: unknown): value is TrayMenuAction {
  if (!value || typeof value !== "object") return false;
  const action = value as { type?: unknown; taskId?: unknown };
  if (action.type === "open-task") {
    return typeof action.taskId === "string" && action.taskId.length > 0;
  }
  return (
    action.type === "close" ||
    action.type === "new-task" ||
    action.type === "open-main" ||
    action.type === "quit"
  );
}

export function setupTray({
  getMainWindow,
  getActiveChatTasks,
  getRunningTaskCount,
  onQuitRequest,
}: TrayDeps): TrayController {
  let tray: Tray | null = null;
  let quickComposer: BrowserWindow | null = null;
  let quickComposerReady = false;
  let pendingQuickShow = false;
  let pendingBounds: Electron.Rectangle | null = null;
  let quickComposerUserMoved = false;
  let trayMenuWindow: BrowserWindow | null = null;
  let trayMenuReady = false;
  let pendingTrayMenuShow = false;
  let trayMenuBounds: Electron.Rectangle | null = null;
  let trayMenuBlurDismissTimer: ReturnType<typeof setTimeout> | null = null;
  let completionWindow: BrowserWindow | null = null;
  let completionWindowReady = false;
  let pendingCompletionShow = false;
  let currentCompletionData: TrayCompletionData | null = null;
  let currentTrayMenuData: TrayMenuData = {
    running: [],
    recent: [],
    more: [],
    runningCount: 0,
  };

  function focusMainWindow(): void {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function openTask(id: string): void {
    focusMainWindow();
    getMainWindow()?.webContents.send("tray-open-task", id);
  }

  function positionCompletionWindow(): void {
    if (!completionWindow || completionWindow.isDestroyed()) return;
    const trayBounds = tray?.getBounds();
    const hasTrayBounds = Boolean(
      trayBounds && trayBounds.width > 0 && trayBounds.height > 0,
    );
    const cursor = screen.getCursorScreenPoint();
    const anchor = hasTrayBounds
      ? (trayBounds as Electron.Rectangle)
      : { x: cursor.x, y: cursor.y, width: 1, height: 1 };
    const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
    const workArea = display.workArea;
    const [width, height] = completionWindow.getContentSize();
    const x = hasTrayBounds
      ? clamp(
          Math.round(anchor.x + anchor.width - width),
          workArea.x + 8,
          workArea.x + Math.max(8, workArea.width - width - 8),
        )
      : workArea.x + Math.max(8, workArea.width - width - 8);
    const above = anchor.y - height - 4;
    const y = hasTrayBounds
      ? clamp(
          above,
          workArea.y + 8,
          workArea.y + Math.max(8, workArea.height - height - 8),
        )
      : workArea.y + Math.max(8, workArea.height - height - 8);
    completionWindow.setPosition(Math.round(x), Math.round(y), false);
  }

  function createCompletionWindow(): BrowserWindow {
    const rendererHtmlPath = join(__dirname, "../renderer/index.html");
    const window = new BrowserWindow({
      width: COMPLETION_TOAST_WIDTH,
      height: COMPLETION_TOAST_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: false,
      focusable: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      title: "Agents One 任务状态",
      icon,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    window.setAlwaysOnTop(true, "floating");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => {
      completionWindowReady = true;
      if (
        !pendingCompletionShow ||
        !currentCompletionData ||
        !completionWindow ||
        completionWindow.isDestroyed()
      ) {
        return;
      }
      positionCompletionWindow();
      completionWindow.webContents.send(
        "tray-completion-data-changed",
        currentCompletionData,
      );
      pendingCompletionShow = false;
      completionWindow.showInactive();
    });
    window.on("closed", () => {
      completionWindow = null;
      completionWindowReady = false;
      pendingCompletionShow = false;
      currentCompletionData = null;
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"]);
      rendererUrl.searchParams.set("trayCompletion", "1");
      void window.loadURL(rendererUrl.toString());
    } else {
      void window.loadFile(rendererHtmlPath, {
        query: { trayCompletion: "1" },
      });
    }
    return window;
  }

  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
  function showTaskCompletion(data: TrayCompletionData): void {
    currentCompletionData = data;
    pendingCompletionShow = true;
    if (!completionWindow || completionWindow.isDestroyed()) {
      completionWindow = createCompletionWindow();
    }
    if (!completionWindowReady || !completionWindow) return;
    positionCompletionWindow();
    completionWindow.webContents.send(
      "tray-completion-data-changed",
      currentCompletionData,
    );
    pendingCompletionShow = false;
    completionWindow.showInactive();
  }

  function hideCompletionWindow(): void {
    pendingCompletionShow = false;
    if (completionWindow && !completionWindow.isDestroyed()) {
      completionWindow.hide();
    }
  }

  function toTrayMenuTask(
    task: TrayTaskGroups["running"][number],
  ): TrayMenuTask {
    return {
      id: task.id,
      ...trayTaskDisplay(task),
      openTaskId: task.openTaskId,
    };
  }

  function readTrayMenuData(): TrayMenuData {
    const { running, recent, more } = readTrayTasks(getActiveChatTasks());
    return {
      running: running.map(toTrayMenuTask),
      recent: recent.map(toTrayMenuTask),
      more: more.map(toTrayMenuTask),
      runningCount: Math.max(getRunningTaskCount(), running.length),
    };
  }

  function estimatedTrayMenuHeight(data: TrayMenuData): number {
    const visibleTaskRows =
      Math.max(1, data.running.length) + Math.max(1, data.recent.length);
    return clamp(
      226 + visibleTaskRows * 34,
      TRAY_MENU_MIN_HEIGHT,
      TRAY_MENU_MAX_HEIGHT,
    );
  }

  function positionTrayMenu(bounds?: Electron.Rectangle): void {
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) return;
    const anchor = bounds || {
      ...screen.getCursorScreenPoint(),
      width: 1,
      height: 1,
    };
    const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
    const workArea = display.workArea;
    const [width, height] = trayMenuWindow.getContentSize();
    const x = clamp(
      Math.round(anchor.x + anchor.width - width),
      workArea.x + 8,
      workArea.x + Math.max(8, workArea.width - width - 8),
    );
    const above = anchor.y - height - 8;
    const below = anchor.y + anchor.height + 8;
    const y =
      above >= workArea.y
        ? above
        : clamp(
            below,
            workArea.y + 8,
            workArea.y + Math.max(8, workArea.height - height - 8),
          );
    trayMenuWindow.setPosition(x, y, false);
  }

  function createTrayMenuWindow(): BrowserWindow {
    const rendererHtmlPath = join(__dirname, "../renderer/index.html");
    const window = new BrowserWindow({
      width: TRAY_MENU_COLLAPSED_WIDTH,
      height: estimatedTrayMenuHeight(currentTrayMenuData),
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      title: "Agents One 任务菜单",
      icon,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    window.setAlwaysOnTop(true, "floating");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => {
      trayMenuReady = true;
      if (
        !pendingTrayMenuShow ||
        !trayMenuWindow ||
        trayMenuWindow.isDestroyed()
      ) {
        return;
      }
      positionTrayMenu(trayMenuBounds || undefined);
      pendingTrayMenuShow = false;
      trayMenuWindow.show();
      trayMenuWindow.focus();
      trayMenuWindow.webContents.send(
        "tray-menu-data-changed",
        currentTrayMenuData,
      );
    });
    window.on("blur", () => {
      // A right click on the tray icon moves focus away before Electron emits
      // the tray event. Deferring the blur dismissal lets that event toggle
      // the already-open menu instead of immediately reopening it.
      if (trayMenuBlurDismissTimer) clearTimeout(trayMenuBlurDismissTimer);
      trayMenuBlurDismissTimer = setTimeout(() => {
        trayMenuBlurDismissTimer = null;
        hideTrayMenu();
      }, 0);
    });
    window.on("closed", () => {
      if (trayMenuBlurDismissTimer) clearTimeout(trayMenuBlurDismissTimer);
      trayMenuBlurDismissTimer = null;
      trayMenuWindow = null;
      trayMenuReady = false;
      pendingTrayMenuShow = false;
      trayMenuBounds = null;
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"]);
      rendererUrl.searchParams.set("trayMenu", "1");
      void window.loadURL(rendererUrl.toString());
    } else {
      void window.loadFile(rendererHtmlPath, { query: { trayMenu: "1" } });
    }
    return window;
  }

  function showTrayMenu(bounds?: Electron.Rectangle): void {
    hideQuickComposer();
    currentTrayMenuData = readTrayMenuData();
    trayMenuBounds = bounds || trayMenuBounds;
    pendingTrayMenuShow = true;
    if (!trayMenuWindow || trayMenuWindow.isDestroyed()) {
      trayMenuWindow = createTrayMenuWindow();
    }
    trayMenuWindow.setContentSize(
      TRAY_MENU_COLLAPSED_WIDTH,
      estimatedTrayMenuHeight(currentTrayMenuData),
      false,
    );
    if (!trayMenuReady) return;
    positionTrayMenu(trayMenuBounds || undefined);
    pendingTrayMenuShow = false;
    trayMenuWindow.webContents.send(
      "tray-menu-data-changed",
      currentTrayMenuData,
    );
    trayMenuWindow.show();
    trayMenuWindow.focus();
  }

  function hideTrayMenu(): void {
    if (trayMenuBlurDismissTimer) clearTimeout(trayMenuBlurDismissTimer);
    trayMenuBlurDismissTimer = null;
    pendingTrayMenuShow = false;
    trayMenuBounds = null;
    if (trayMenuWindow && !trayMenuWindow.isDestroyed()) trayMenuWindow.hide();
  }

  function isTrayMenuOpen(): boolean {
    return Boolean(
      pendingTrayMenuShow ||
      (trayMenuWindow &&
        !trayMenuWindow.isDestroyed() &&
        trayMenuWindow.isVisible()),
    );
  }

  function positionQuickComposer(bounds?: Electron.Rectangle): void {
    if (!quickComposer || quickComposer.isDestroyed()) return;
    const anchor = bounds || {
      ...screen.getCursorScreenPoint(),
      width: 1,
      height: 1,
    };
    const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
    const workArea = display.workArea;
    const [width, height] = quickComposer.getContentSize();
    const x = clamp(
      Math.round(workArea.x + (workArea.width - width) / 2),
      workArea.x + 8,
      workArea.x + Math.max(8, workArea.width - width - 8),
    );
    const above = anchor.y - height - 8;
    const below = anchor.y + anchor.height + 8;
    const y =
      above >= workArea.y
        ? above
        : clamp(
            below,
            workArea.y + 8,
            workArea.y + Math.max(8, workArea.height - height - 8),
          );
    quickComposer.setPosition(x, y, false);
  }

  function createQuickComposer(): BrowserWindow {
    const rendererHtmlPath = join(__dirname, "../renderer/index.html");
    const window = new BrowserWindow({
      width: QUICK_COMPOSER_WIDTH,
      height: QUICK_COMPOSER_HEIGHT,
      useContentSize: true,
      show: false,
      frame: false,
      transparent: true,
      hasShadow: true,
      movable: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      title: "Agents One 快捷任务",
      icon,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });

    window.setAlwaysOnTop(true, "floating");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.once("ready-to-show", () => {
      quickComposerReady = true;
      if (!pendingQuickShow || !quickComposer || quickComposer.isDestroyed()) {
        return;
      }
      positionQuickComposer(pendingBounds || undefined);
      pendingQuickShow = false;
      pendingBounds = null;
      quickComposer.show();
      quickComposer.focus();
    });
    // Unlike `move`, `will-move` is emitted for an interactive drag rather
    // than our own setPosition calls. This keeps the first/default placement
    // centred while preserving a position the user deliberately chose.
    window.on("will-move", () => {
      quickComposerUserMoved = true;
    });
    window.on("closed", () => {
      quickComposer = null;
      quickComposerReady = false;
      pendingQuickShow = false;
      pendingBounds = null;
      quickComposerUserMoved = false;
    });

    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      const rendererUrl = new URL(process.env["ELECTRON_RENDERER_URL"]);
      rendererUrl.searchParams.set("tray", "1");
      void window.loadURL(rendererUrl.toString());
    } else {
      void window.loadFile(rendererHtmlPath, { query: { tray: "1" } });
    }
    return window;
  }

  function showQuickComposer(bounds?: Electron.Rectangle): void {
    hideTrayMenu();
    if (!quickComposer || quickComposer.isDestroyed()) {
      quickComposer = createQuickComposer();
    }
    pendingQuickShow = true;
    pendingBounds = bounds || pendingBounds;
    if (!quickComposerReady || !quickComposer) return;
    if (!quickComposerUserMoved) {
      positionQuickComposer(pendingBounds || undefined);
    }
    pendingQuickShow = false;
    pendingBounds = null;
    quickComposer.show();
    quickComposer.focus();
  }

  function hideQuickComposer(): void {
    pendingQuickShow = false;
    pendingBounds = null;
    if (quickComposer && !quickComposer.isDestroyed()) quickComposer.hide();
  }

  function isQuickComposerOpen(): boolean {
    return Boolean(
      pendingQuickShow ||
      (quickComposer &&
        !quickComposer.isDestroyed() &&
        quickComposer.isVisible()),
    );
  }

  const handleQuickComposerClose = (): void => hideQuickComposer();
  const handleQuickComposerResize = (
    event: Electron.IpcMainEvent,
    height: unknown,
  ): void => {
    if (
      !quickComposer ||
      quickComposer.isDestroyed() ||
      event.sender !== quickComposer.webContents ||
      typeof height !== "number" ||
      !Number.isFinite(height)
    ) {
      return;
    }
    const nextHeight = clamp(
      Math.round(height),
      QUICK_COMPOSER_HEIGHT,
      QUICK_COMPOSER_MAX_HEIGHT,
    );
    const [, currentHeight] = quickComposer.getContentSize();
    if (currentHeight === nextHeight) return;

    const currentBounds = quickComposer.getBounds();
    const display = screen.getDisplayMatching(currentBounds);
    const workArea = display.workArea;
    quickComposer.setContentSize(QUICK_COMPOSER_WIDTH, nextHeight, false);
    const nextY = clamp(
      currentBounds.y - (nextHeight - currentHeight),
      workArea.y + 8,
      workArea.y + Math.max(8, workArea.height - nextHeight - 8),
    );
    quickComposer.setPosition(currentBounds.x, nextY, false);
  };
  const handleTrayMenuAction = (
    event: Electron.IpcMainEvent,
    action: unknown,
  ): void => {
    if (
      !trayMenuWindow ||
      event.sender !== trayMenuWindow.webContents ||
      !isTrayMenuAction(action)
    ) {
      return;
    }
    hideTrayMenu();
    switch (action.type) {
      case "open-task":
        if (action.taskId) openTask(action.taskId);
        break;
      case "new-task":
        focusMainWindow();
        getMainWindow()?.webContents.send("menu-new-chat");
        break;
      case "open-main":
        focusMainWindow();
        break;
      case "quit":
        onQuitRequest();
        break;
      case "close":
        break;
    }
  };
  const handleTrayMenuResize = (
    event: Electron.IpcMainEvent,
    width: number,
    height: number,
  ): void => {
    if (
      !trayMenuWindow ||
      event.sender !== trayMenuWindow.webContents ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      return;
    }
    const nextHeight = clamp(
      Math.ceil(height),
      TRAY_MENU_MIN_HEIGHT,
      TRAY_MENU_MAX_HEIGHT,
    );
    const nextWidth =
      Math.round(width) === TRAY_MENU_EXPANDED_WIDTH
        ? TRAY_MENU_EXPANDED_WIDTH
        : TRAY_MENU_COLLAPSED_WIDTH;
    trayMenuWindow.setContentSize(nextWidth, nextHeight, false);
    positionTrayMenu(trayMenuBounds || undefined);
  };
  const handleCompletionOpen = (event: Electron.IpcMainEvent): void => {
    if (
      !completionWindow ||
      completionWindow.isDestroyed() ||
      event.sender !== completionWindow.webContents
    ) {
      return;
    }
    const taskId = currentCompletionData?.taskId;
    hideCompletionWindow();
    currentCompletionData = null;
    if (taskId) openTask(taskId);
    else focusMainWindow();
  };
  const handleCompletionClose = (event: Electron.IpcMainEvent): void => {
    if (
      !completionWindow ||
      completionWindow.isDestroyed() ||
      event.sender !== completionWindow.webContents
    ) {
      return;
    }
    hideCompletionWindow();
    currentCompletionData = null;
  };
  ipcMain.on("tray-composer-close", handleQuickComposerClose);
  ipcMain.on("tray-composer-resize", handleQuickComposerResize);
  ipcMain.handle("tray-menu-data", (event) =>
    trayMenuWindow && event.sender === trayMenuWindow.webContents
      ? currentTrayMenuData
      : { running: [], recent: [], more: [], runningCount: 0 },
  );
  ipcMain.on("tray-menu-action", handleTrayMenuAction);
  ipcMain.on("tray-menu-resize", handleTrayMenuResize);
  ipcMain.handle("tray-completion-data", (event) =>
    completionWindow && event.sender === completionWindow.webContents
      ? currentCompletionData
      : null,
  );
  ipcMain.on("tray-completion-open", handleCompletionOpen);
  ipcMain.on("tray-completion-close", handleCompletionClose);

  try {
    const trayImage = nativeImage.createFromPath(icon);
    tray = new Tray(trayImage);
    tray.setToolTip("Agents One");
    tray.on("click", (_event, bounds) => {
      if (isQuickComposerOpen()) {
        hideQuickComposer();
        return;
      }
      showQuickComposer(bounds);
    });
    tray.on("right-click", (_event, bounds) => {
      if (isTrayMenuOpen()) {
        hideTrayMenu();
        return;
      }
      showTrayMenu(bounds);
    });
  } catch (error) {
    console.error("[TRAY] Failed to initialize notification-area tray", error);
  }

  return {
    hideQuickComposer,
    showTaskCompletion,
    destroy: () => {
      ipcMain.removeListener("tray-composer-close", handleQuickComposerClose);
      ipcMain.removeListener("tray-composer-resize", handleQuickComposerResize);
      ipcMain.removeHandler("tray-menu-data");
      ipcMain.removeListener("tray-menu-action", handleTrayMenuAction);
      ipcMain.removeListener("tray-menu-resize", handleTrayMenuResize);
      ipcMain.removeHandler("tray-completion-data");
      ipcMain.removeListener("tray-completion-open", handleCompletionOpen);
      ipcMain.removeListener("tray-completion-close", handleCompletionClose);
      if (quickComposer && !quickComposer.isDestroyed())
        quickComposer.destroy();
      quickComposer = null;
      if (trayMenuWindow && !trayMenuWindow.isDestroyed())
        trayMenuWindow.destroy();
      trayMenuWindow = null;
      if (trayMenuBlurDismissTimer) clearTimeout(trayMenuBlurDismissTimer);
      trayMenuBlurDismissTimer = null;
      if (completionWindow && !completionWindow.isDestroyed())
        completionWindow.destroy();
      completionWindow = null;
      tray?.destroy();
      tray = null;
    },
  };
}
