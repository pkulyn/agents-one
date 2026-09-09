import { afterEach, describe, expect, it, vi } from "vitest";

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
    quit: vi.fn(),
    exit: vi.fn(),
  };
  return {
    app,
    handlers,
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
    static getAllWindows(): [] {
      return [];
    }
  },
  Notification: class Notification {},
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}));
vi.mock("@electron-toolkit/utils", () => ({
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false },
}));
vi.mock("../resources/icon.png?asset", () => ({ default: "icon" }));
vi.mock("../src/main/config", () => ({ getPublicConnectionConfig: vi.fn() }));
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
vi.mock("../src/main/app/tray", () => ({ setupTray: vi.fn() }));
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
  });

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
  });
});
