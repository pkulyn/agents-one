import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrayCompletionData } from "../../shared/tray-completion";

const mocks = vi.hoisted(() => ({
  windows: [] as Array<any>,
  trays: [] as Array<any>,
  ipcListeners: new Map<string, (...args: any[]) => void>(),
  ipcHandlers: new Map<string, (...args: any[]) => unknown>(),
}));

vi.mock("electron", () => {
  class MockBrowserWindow {
    options: Record<string, unknown>;
    readyListener?: () => void;
    closedListener?: () => void;
    blurListener?: () => void;
    destroyed = false;
    visible = false;
    webContents = {
      send: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    setAlwaysOnTop = vi.fn();
    setPosition = vi.fn();
    setContentSize = vi.fn((width: number, height: number) => {
      this.options.width = width;
      this.options.height = height;
    });
    show = vi.fn(() => {
      this.visible = true;
    });
    showInactive = vi.fn(() => {
      this.visible = true;
    });
    focus = vi.fn();
    hide = vi.fn(() => {
      this.visible = false;
    });
    destroy = vi.fn(() => {
      this.destroyed = true;
      this.closedListener?.();
    });
    loadURL = vi.fn();
    loadFile = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.windows.push(this);
    }

    once(event: string, listener: () => void): void {
      if (event === "ready-to-show") this.readyListener = listener;
    }

    on(event: string, listener: () => void): void {
      if (event === "closed") this.closedListener = listener;
      if (event === "blur") this.blurListener = listener;
    }

    emitReady(): void {
      this.readyListener?.();
    }

    emitBlur(): void {
      this.blurListener?.();
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isVisible(): boolean {
      return this.visible;
    }

    getContentSize(): [number, number] {
      return [Number(this.options.width), Number(this.options.height)];
    }
  }

  class MockTray {
    handlers = new Map<string, (...args: any[]) => void>();
    setToolTip = vi.fn();
    on = vi.fn((event: string, listener: (...args: any[]) => void) => {
      this.handlers.set(event, listener);
      return this;
    });
    destroy = vi.fn();

    constructor() {
      mocks.trays.push(this);
    }

    emit(event: string, ...args: any[]): void {
      this.handlers.get(event)?.(...args);
    }
    getBounds(): Electron.Rectangle {
      return { x: 1160, y: 760, width: 24, height: 24 };
    }
  }

  return {
    BrowserWindow: MockBrowserWindow,
    Tray: MockTray,
    nativeImage: { createFromPath: vi.fn(() => ({})) },
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 1180, y: 780 })),
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1200, height: 760 },
      })),
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1200, height: 760 },
      })),
    },
    ipcMain: {
      on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
        mocks.ipcListeners.set(channel, listener);
      }),
      removeListener: vi.fn((channel: string) => {
        mocks.ipcListeners.delete(channel);
      }),
      handle: vi.fn((channel: string, handler: (...args: any[]) => unknown) => {
        mocks.ipcHandlers.set(channel, handler);
      }),
      removeHandler: vi.fn((channel: string) => {
        mocks.ipcHandlers.delete(channel);
      }),
    },
  };
});

vi.mock("@electron-toolkit/utils", () => ({ is: { dev: false } }));
vi.mock("../../../resources/icon.png?asset", () => ({ default: "icon.png" }));
vi.mock("../session-cache", () => ({ listCachedSessions: vi.fn(() => []) }));
vi.mock("../runtime-conversation-store", () => ({
  listRuntimeConversations: vi.fn(() => []),
}));
vi.mock("../project-folders", () => ({ listProjectFolders: vi.fn(() => []) }));

describe("tray task completion", () => {
  beforeEach(() => {
    mocks.windows.length = 0;
    mocks.trays.length = 0;
    mocks.ipcListeners.clear();
    mocks.ipcHandlers.clear();
    vi.clearAllMocks();
  });

  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer]]
  it("toggles the matching tray surface when its icon button is clicked again", async () => {
    vi.useFakeTimers();
    try {
      const { setupTray } = await import("./tray");
      setupTray({
        getMainWindow: () => null,
        getActiveChatTasks: () => [],
        getRunningTaskCount: () => 0,
        onQuitRequest: vi.fn(),
      });
      const tray = mocks.trays[0];
      const bounds = { x: 1160, y: 760, width: 24, height: 24 };

      tray.emit("click", {}, bounds);
      const composer = mocks.windows.find(
        (window) => window.options.title === "Agents One 快捷任务",
      );
      tray.emit("click", {}, bounds);
      composer.emitReady();
      expect(composer.isVisible()).toBe(false);

      tray.emit("click", {}, bounds);
      expect(composer.isVisible()).toBe(true);

      composer.hide.mockClear();
      tray.emit("click", {}, bounds);
      expect(composer.hide).toHaveBeenCalledOnce();
      expect(composer.isVisible()).toBe(false);

      tray.emit("right-click", {}, bounds);
      const taskMenu = mocks.windows.find(
        (window) => window.options.title === "Agents One 任务菜单",
      );
      taskMenu.emitReady();
      expect(taskMenu.isVisible()).toBe(true);

      taskMenu.emitBlur();
      tray.emit("right-click", {}, bounds);
      expect(taskMenu.hide).toHaveBeenCalledOnce();
      expect(taskMenu.isVisible()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
  it("shows without focusing and opens the completed task when clicked", async () => {
    const { setupTray } = await import("./tray");
    const mainWindow = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: vi.fn() },
    };
    const controller = setupTray({
      getMainWindow: () => mainWindow as any,
      getActiveChatTasks: () => [],
      getRunningTaskCount: () => 0,
      onQuitRequest: vi.fn(),
    });
    const data: TrayCompletionData = {
      id: "notice-1",
      taskId: "conversation-1",
      title: "整理本周项目进展",
      runtimeName: "Hermes",
      runtimeKind: "hermes",
      status: "succeeded",
      completedAt: Date.now(),
    };

    controller.showTaskCompletion(data);
    const notificationWindow = mocks.windows.find(
      (window) => window.options.title === "Agents One 任务状态",
    );
    expect(notificationWindow).toBeDefined();
    expect(notificationWindow.options.focusable).toBe(false);
    expect(notificationWindow.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      { query: { trayCompletion: "1" } },
    );

    notificationWindow.emitReady();
    expect(notificationWindow.showInactive).toHaveBeenCalledOnce();
    expect(notificationWindow.webContents.send).toHaveBeenCalledWith(
      "tray-completion-data-changed",
      data,
    );

    mocks.ipcListeners.get("tray-completion-open")?.({
      sender: notificationWindow.webContents,
    });
    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.show).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      "tray-open-task",
      "conversation-1",
    );

    controller.destroy();
  });
});
