import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let resolveCancellation: (() => void) | null = null;
  const cancellation = new Promise<void>((resolve) => {
    resolveCancellation = resolve;
  });
  const app = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, [...(handlers.get(event) || []), handler]);
    }),
    whenReady: vi.fn(() => new Promise<void>(() => undefined)),
    getVersion: vi.fn(() => "0.1.0-test"),
    setAppUserModelId: vi.fn(),
    getPath: vi.fn(() => "synthetic-user-data"),
    isReady: vi.fn(() => true),
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return {
    app,
    handlers,
    windows: [] as Array<{
      destroyed: boolean;
      handlers: Map<string, (...args: unknown[]) => void>;
      hide: ReturnType<typeof vi.fn>;
      show: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
    }>,
    trayAvailable: true,
    cancellation,
    resolveCancellation: () => resolveCancellation?.(),
    stopHealthPolling: vi.fn(),
    stopAllDashboards: vi.fn(),
    cleanupTempMediaFiles: vi.fn(),
    closeDbConnection: vi.fn(),
    registerIpcHandlers: vi.fn(),
    setupUpdater: vi.fn(),
    stopTaskScheduleRunner: vi.fn(),
    stopTaskScheduleRunnerAndWait: vi.fn(async () => true),
    stopAcceptingAgentRuntimeTasks: vi.fn(),
    activeAgentRuntimeTaskCount: vi.fn(() => 1),
    cancelAllAgentRuntimeTasks: vi.fn(async () => {
      await cancellation;
      return 1;
    }),
  };
});

vi.mock("electron", () => ({
  app: mocks.app,
  BrowserWindow: class BrowserWindow {
    destroyed = false;
    handlers = new Map<string, (...args: unknown[]) => void>();
    webContents = {
      on: vi.fn(),
      once: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
    };
    hide = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    isDestroyed = (): boolean => this.destroyed;
    isMinimized = (): boolean => true;
    loadFile = vi.fn();
    on = vi.fn((event: string, handler: (...args: unknown[]) => void) =>
      this.handlers.set(event, handler),
    );
    constructor() {
      mocks.windows.push(this);
    }
    static getAllWindows(): typeof mocks.windows {
      return mocks.windows;
    }
  },
  Notification: class Notification {},
  session: {
    fromPartition: vi.fn(),
    defaultSession: { webRequest: { onHeadersReceived: vi.fn() } },
  },
  safeStorage: { isEncryptionAvailable: vi.fn(() => false) },
  shell: { openExternal: vi.fn() },
}));
vi.mock("@electron-toolkit/utils", () => ({
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false },
}));
vi.mock("../resources/icon.png?asset", () => ({ default: "icon" }));
vi.mock("../src/main/config", () => ({
  getPublicConnectionConfig: vi.fn(),
  readDesktopConfig: vi.fn(() => ({})),
}));
vi.mock("../src/main/hermes", () => ({
  stopHealthPolling: mocks.stopHealthPolling,
}));
vi.mock("../src/main/dashboard", () => ({
  stopAllDashboards: mocks.stopAllDashboards,
}));
vi.mock("../src/main/media", () => ({
  cleanupTempMediaFiles: mocks.cleanupTempMediaFiles,
}));
vi.mock("../src/main/db", () => ({
  closeDbConnection: mocks.closeDbConnection,
}));
vi.mock("../src/main/agents-one-backup", () => ({
  recoverInterruptedAgentsOneRestore: vi.fn(() => false),
}));
vi.mock("../src/main/restore-write-lock", () => ({
  isAgentsOneRestoreWriteLocked: vi.fn(() => false),
}));
vi.mock("../src/main/security", () => ({
  hardenAttachedWebContents: vi.fn(),
  hardenWebviewPreferences: vi.fn(),
  isAllowedAppNavigationUrl: vi.fn(() => true),
  isAllowedExternalUrl: vi.fn(() => true),
  isAllowedWebviewUrl: vi.fn(() => true),
}));
vi.mock("../src/main/ipc/register", () => ({
  registerIpcHandlers: mocks.registerIpcHandlers,
}));
vi.mock("../src/main/gatewayPrompt", () => ({
  setGatewayPromptParent: vi.fn(),
}));
vi.mock("../src/main/app/context-menu", () => ({
  showChatContextMenu: vi.fn(),
}));
vi.mock("../src/main/app/menu", () => ({ buildMenu: vi.fn() }));
vi.mock("../src/main/app/tray", () => ({
  setupTray: vi.fn(() => ({
    isAvailable: () => mocks.trayAvailable,
    destroy: vi.fn(),
  })),
}));
vi.mock("../src/main/app/updater", () => ({
  setupUpdater: mocks.setupUpdater,
}));
vi.mock("../src/main/task-schedules", () => ({
  onTaskScheduleRunCompleted: vi.fn(),
  onTaskScheduleRunStarted: vi.fn(),
  startTaskScheduleRunner: vi.fn(),
  stopTaskScheduleRunner: mocks.stopTaskScheduleRunner,
  stopTaskScheduleRunnerAndWait: mocks.stopTaskScheduleRunnerAndWait,
}));
vi.mock("../src/main/agent-runtimes", () => ({
  activeAgentRuntimeTaskCount: mocks.activeAgentRuntimeTaskCount,
  cancelAllAgentRuntimeTasks: mocks.cancelAllAgentRuntimeTasks,
  onAgentRuntimeRunFinished: vi.fn(),
  stopAcceptingAgentRuntimeTasks: mocks.stopAcceptingAgentRuntimeTasks,
}));
vi.mock("../src/main/runtime-conversation-store", () => ({
  listRuntimeConversations: vi.fn(() => []),
}));
vi.mock("../src/main/agents-one-logs", () => ({
  logApplicationDiagnostic: vi.fn(),
  logErrorDiagnostic: vi.fn(),
}));

describe("main-process graceful shutdown", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("waits for Runtime cancellation once before allowing the app to quit", async () => {
    const { startMainProcess } = await import("../src/main/app/start");
    startMainProcess();

    const beforeQuit = mocks.handlers.get("before-quit")?.[0];
    expect(beforeQuit).toBeTypeOf("function");
    const firstEvent = { preventDefault: vi.fn() };
    const secondEvent = { preventDefault: vi.fn() };

    beforeQuit?.(firstEvent);
    beforeQuit?.(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.stopAcceptingAgentRuntimeTasks).toHaveBeenCalledOnce();
    expect(mocks.stopTaskScheduleRunner).toHaveBeenCalledOnce();
    expect(mocks.stopTaskScheduleRunnerAndWait).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(mocks.cancelAllAgentRuntimeTasks).toHaveBeenCalledOnce();
    });
    expect(mocks.app.quit).not.toHaveBeenCalled();
    expect(mocks.closeDbConnection).not.toHaveBeenCalled();

    mocks.resolveCancellation();
    await vi.waitFor(() => {
      expect(mocks.cleanupTempMediaFiles).toHaveBeenCalledOnce();
      expect(mocks.closeDbConnection).toHaveBeenCalledOnce();
      expect(mocks.app.quit).toHaveBeenCalledOnce();
    });
  }, 15000);

  it("sets the stable Agents One Windows identity before app readiness", async () => {
    const { startMainProcess } = await import("../src/main/app/start");
    startMainProcess();

    if (process.platform === "win32") {
      expect(mocks.app.setAppUserModelId).toHaveBeenCalledWith(
        "com.pkulyn.agents-one",
      );
      expect(
        mocks.app.setAppUserModelId.mock.invocationCallOrder[0],
      ).toBeLessThan(mocks.app.whenReady.mock.invocationCallOrder[0]);
    } else {
      expect(mocks.app.setAppUserModelId).not.toHaveBeenCalled();
    }
  }, 15000);
});

vi.mock("../src/main/desktop-secret-store", () => ({
  configureDesktopSecretStore: vi.fn(),
  DesktopSecretStore: class {},
}));
vi.mock("../src/main/agents-one-data-migration", () => ({
  migrateLegacyAgentsOneData: vi.fn(() => false),
}));
vi.mock("../src/main/app/desktop-config-startup", () => ({
  verifyDesktopConfigurationAtStartup: vi.fn(() => true),
}));
vi.mock("../src/main/mobile-control/desktop-owner", () => ({
  startDesktopMobileOwner: vi.fn(),
}));
vi.mock("../src/main/installer", () => ({ HERMES_HOME: "synthetic-hermes" }));

describe("main window recovery", () => {
  beforeEach(() => vi.clearAllMocks());
  // @lat: [[main-process#Tray failure recovery]]
  it.each([true, false])(
    "uses a reachable close path when tray availability is %s",
    async (available) => {
      vi.resetModules();
      mocks.handlers.clear();
      mocks.windows.length = 0;
      mocks.trayAvailable = available;
      mocks.app.whenReady.mockResolvedValueOnce(undefined);
      const { startMainProcess } = await import("../src/main/app/start");
      startMainProcess();
      await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));
      const event = { preventDefault: vi.fn() };
      mocks.windows[0].handlers.get("close")?.(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      if (available) {
        expect(mocks.windows[0].hide).toHaveBeenCalledOnce();
        expect(mocks.app.quit).not.toHaveBeenCalled();
      } else {
        expect(mocks.windows[0].hide).not.toHaveBeenCalled();
        expect(mocks.app.quit).toHaveBeenCalledOnce();
      }
    },
  );
  it("restores a hidden window and recreates a destroyed main window on a second instance", async () => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.windows.length = 0;
    mocks.trayAvailable = true;
    mocks.app.whenReady.mockResolvedValueOnce(undefined);
    const { startMainProcess } = await import("../src/main/app/start");
    startMainProcess();
    await vi.waitFor(() => expect(mocks.windows).toHaveLength(1));
    const secondInstance = mocks.handlers.get("second-instance")?.[0];
    secondInstance?.();
    expect(mocks.windows[0].restore).toHaveBeenCalledOnce();
    expect(mocks.windows[0].show).toHaveBeenCalledOnce();
    expect(mocks.windows[0].focus).toHaveBeenCalledOnce();
    mocks.windows[0].destroyed = true;
    secondInstance?.();
    expect(mocks.windows).toHaveLength(2);
  });
});
