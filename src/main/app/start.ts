import { app, BrowserWindow, safeStorage, session, shell } from "electron";
import { join } from "path";
import { optimizer, is } from "@electron-toolkit/utils";
import icon from "../../../resources/icon.png?asset";
import { getPublicConnectionConfig } from "../config";
import { stopHealthPolling } from "../hermes";
import { stopAllDashboards } from "../dashboard";
import { cleanupTempMediaFiles } from "../media";
import { closeDbConnection } from "../db";
import { recoverInterruptedAgentsOneRestore } from "../agents-one-backup";
import { isAgentsOneRestoreWriteLocked } from "../restore-write-lock";
import {
  hardenAttachedWebContents,
  hardenWebviewPreferences,
  isAllowedAppNavigationUrl,
  isAllowedExternalUrl,
  isAllowedWebviewUrl,
} from "../security";
import { registerIpcHandlers, type ActiveChatRun } from "../ipc/register";
import { setGatewayPromptParent } from "../gatewayPrompt";
import { showChatContextMenu } from "./context-menu";
import { buildMenu } from "./menu";
import { setupTray, type TrayController } from "./tray";
import { setupUpdater } from "./updater";
import {
  onTaskScheduleRunCompleted,
  onTaskScheduleRunStarted,
  startTaskScheduleRunner,
  stopTaskScheduleRunner,
  stopTaskScheduleRunnerAndWait,
} from "../task-schedules";
import {
  activeAgentRuntimeTaskCount,
  cancelAllAgentRuntimeTasks,
  onAgentRuntimeRunFinished,
  stopAcceptingAgentRuntimeTasks,
} from "../agent-runtimes";
import { listRuntimeConversations } from "../runtime-conversation-store";
import {
  logApplicationDiagnostic,
  logErrorDiagnostic,
} from "../agents-one-logs";
import {
  configureDesktopSecretStore,
  DesktopSecretStore,
} from "../desktop-secret-store";

const APP_NAME =
  process.env.AGENTS_ONE_APP_NAME?.trim() ||
  process.env.HERMES_DESKTOP_APP_NAME?.trim() ||
  "Agents One";
const APP_USER_MODEL_ID = "com.pkulyn.agents-one";
const OPEN_DEVTOOLS_ON_START =
  process.env.AGENTS_ONE_OPEN_DEVTOOLS === "1" ||
  process.env.HERMES_OPEN_DEVTOOLS === "1" ||
  process.env.HERMES_DESKTOP_OPEN_DEVTOOLS === "1";

let mainWindow: BrowserWindow | null = null;
const activeRuns = new Map<string, ActiveChatRun>();
let removeTaskScheduleRunListener: (() => void) | null = null;
let removeTaskScheduleStartedListener: (() => void) | null = null;
let removeAgentRuntimeFinishedListener: (() => void) | null = null;
let shutdownInProgress: Promise<void> | null = null;
let shutdownComplete = false;
let quitRequested = false;
let trayController: TrayController | null = null;

async function gracefulMainProcessShutdown(): Promise<void> {
  logApplicationDiagnostic("app.shutdown.started");
  stopAcceptingAgentRuntimeTasks();
  stopHealthPolling();
  stopTaskScheduleRunner();
  removeTaskScheduleRunListener?.();
  removeTaskScheduleRunListener = null;
  removeTaskScheduleStartedListener?.();
  removeTaskScheduleStartedListener = null;
  removeAgentRuntimeFinishedListener?.();
  removeAgentRuntimeFinishedListener = null;
  for (const run of activeRuns.values()) run.abort();
  activeRuns.clear();

  const scheduleStopped = await stopTaskScheduleRunnerAndWait();
  if (!scheduleStopped) {
    console.error(
      "[SHUTDOWN] Timed out waiting for the schedule runner to quiesce.",
    );
    logErrorDiagnostic("app.shutdown.schedule-timeout");
  }
  const activeRuntimeCount = activeAgentRuntimeTaskCount();
  const cancelled = await cancelAllAgentRuntimeTasks();
  if (cancelled < activeRuntimeCount || !scheduleStopped) {
    console.error(
      "[SHUTDOWN] Runtime or schedule work may still be active; shutdown diagnostics were recorded.",
    );
    logErrorDiagnostic("app.shutdown.incomplete", {
      activeRuntimeCount,
      cancelled,
      scheduleStopped,
    });
  }

  cleanupTempMediaFiles();
  stopAllDashboards();
  closeDbConnection();
  logApplicationDiagnostic("app.shutdown.completed");
}

export function startMainProcess(): void {
  // electron-toolkit intentionally substitutes process.execPath in dev mode,
  // which makes Windows group the window under electron.exe and display the
  // Electron atom in the taskbar. Keep the same Agents One identity in dev and
  // packaged builds so the BrowserWindow rainbow-ring icon is used.
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  logApplicationDiagnostic("app.starting", { version: app.getVersion() });
  process.on("uncaughtException", (err) => {
    console.error("[MAIN UNCAUGHT]", err);
    logErrorDiagnostic("main.uncaught-exception", err);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[MAIN UNHANDLED REJECTION]", reason);
    logErrorDiagnostic("main.unhandled-rejection", reason);
  });

  registerIpcHandlers({
    activeRuns,
    getMainWindow: () => mainWindow,
    notifyConnectionConfigChanged,
    notifyModelLibraryChanged,
    openExternalUrl,
    onChatRunFinished: (data) => {
      if (!quitRequested) trayController?.showTaskCompletion(data);
    },
  });

  setupUpdater({ getMainWindow: () => mainWindow });

  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    const backend =
      process.platform === "linux"
        ? safeStorage.getSelectedStorageBackend()
        : process.platform === "win32"
          ? "dpapi"
          : "keychain";
    const available =
      safeStorage.isEncryptionAvailable() && backend !== "basic_text";
    configureDesktopSecretStore(
      new DesktopSecretStore(
        join(app.getPath("userData"), "protected-secrets.json"),
        {
          available,
          backend,
          ...(available
            ? {}
            : {
                warning:
                  backend === "basic_text"
                    ? "No Linux keyring is available; credentials remain in the legacy restricted file until a secure backend is configured."
                    : "Operating-system credential protection is unavailable; credentials remain in the legacy restricted file.",
              }),
          encrypt: (value) => safeStorage.encryptString(value),
          decrypt: (value) => safeStorage.decryptString(value),
        },
      ),
    );
    // A durable restore journal is replayed before any window, scheduler or
    // writable database connection can observe a partially replaced snapshot.
    try {
      if (recoverInterruptedAgentsOneRestore()) {
        console.warn("[BACKUP] Recovered an interrupted Agents One restore.");
        logApplicationDiagnostic("backup.restore-recovered");
      }
    } catch (error) {
      console.error("[BACKUP] Failed to recover interrupted restore", error);
      logErrorDiagnostic("backup.restore-recovery-failed", error);
      app.exit(1);
      return;
    }
    logApplicationDiagnostic("app.ready");
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window);
    });

    app.on("web-contents-created", (_event, contents) => {
      if (contents.getType() === "webview") {
        // The web preview webview is the only one allowed to load remote HTTPS.
        // Identify it reliably by its session: a <webview partition="web-preview">
        // shares the singleton in-memory session returned by fromPartition().
        // The partition session is the only dependable signal available in
        // web-contents-created — without it, post-attach redirects/navigations
        // (e.g. google.com -> www.google.com) are wrongly blocked.
        const isWebPreview =
          contents.session === session.fromPartition("web-preview");
        hardenAttachedWebContents(contents, isWebPreview);
      }
    });

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; " +
              "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob: file: https:; " +
              "media-src 'self' data: blob: file: https:; " +
              "connect-src 'self' blob: http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* https: wss:; " +
              "font-src 'self' data:; " +
              "frame-src 'self' https: http://127.0.0.1:* http://localhost:*; " +
              "object-src 'none'; " +
              "base-uri 'self';",
          ],
        },
      });
    });

    createWindow();
    trayController = setupTray({
      getMainWindow: () => mainWindow,
      getActiveChatTasks: () =>
        [...activeRuns.entries()].map(([id, run]) => ({
          id: `chat-${id}`,
          title: run.title,
          projectName: run.projectName,
          updatedAt: run.startedAt,
        })),
      getRunningTaskCount: () =>
        activeRuns.size + activeAgentRuntimeTaskCount(),
      onQuitRequest: () => {
        quitRequested = true;
        app.quit();
      },
    });
    // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
    removeTaskScheduleStartedListener = onTaskScheduleRunStarted((event) => {
      mainWindow?.webContents.send("task-schedule-run-started", event);
      if (quitRequested) return;
      trayController?.showTaskCompletion({
        id: `schedule-started-${event.runId}`,
        title: event.scheduleName,
        status: "scheduled_started",
        runtimeName: event.runtimeName,
        runtimeKind: event.runtimeKind,
        runtimeAvatar: event.runtimeAvatar,
        ...(event.conversationId ? { taskId: event.conversationId } : {}),
        completedAt: event.triggeredAt,
      });
    });
    removeTaskScheduleRunListener = onTaskScheduleRunCompleted((event) => {
      mainWindow?.webContents.send("task-schedule-run-completed", event);
    });
    startTaskScheduleRunner();
    removeAgentRuntimeFinishedListener = onAgentRuntimeRunFinished((event) => {
      if (quitRequested) return;
      const conversation = (() => {
        try {
          return listRuntimeConversations(event.profile, 200).find(
            (item) => item.activeRuntimeRunId === event.runId,
          );
        } catch {
          return undefined;
        }
      })();
      trayController?.showTaskCompletion({
        id: `runtime-finished-${event.runId}`,
        title: conversation?.title || event.title,
        status: event.status,
        ...(event.error
          ? {
              detail: event.error.replace(/\s+/g, " ").trim().slice(0, 120),
            }
          : {}),
        runtimeName: event.runtimeName,
        runtimeKind: event.runtimeKind,
        runtimeAvatar: event.runtimeAvatar,
        ...(conversation?.id ? { taskId: conversation.id } : {}),
        completedAt: event.completedAt,
      });
    });
    buildMenu({ getMainWindow: () => mainWindow, openExternalUrl });

    app.on("activate", () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (
      process.platform !== "darwin" &&
      quitRequested &&
      !isAgentsOneRestoreWriteLocked()
    ) {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    quitRequested = true;
    if (shutdownComplete) return;
    event.preventDefault();
    if (shutdownInProgress) return;
    shutdownInProgress = gracefulMainProcessShutdown()
      .catch((error) => {
        console.error("[SHUTDOWN] Graceful shutdown failed", error);
        logErrorDiagnostic("app.shutdown.failed", error);
      })
      .finally(() => {
        trayController?.destroy();
        trayController = null;
        shutdownComplete = true;
        app.quit();
      });
  });
}

function notifyConnectionConfigChanged(): void {
  mainWindow?.webContents.send(
    "connection-config-changed",
    getPublicConnectionConfig(),
  );
}

function notifyModelLibraryChanged(): void {
  mainWindow?.webContents.send("model-library-changed");
}

function openExternalUrl(rawUrl: unknown): void {
  if (!isAllowedExternalUrl(rawUrl)) {
    console.warn("[SECURITY] Blocked unsafe external URL");
    return;
  }
  shell.openExternal(rawUrl).catch((err) => {
    console.error("[SECURITY] Failed to open external URL:", err);
  });
}

function createWindow(): void {
  const rendererHtmlPath = join(__dirname, "../renderer/index.html");
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 850,
    minWidth: 900,
    title: APP_NAME,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : undefined,
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: true,
    },
  });

  mainWindow.on("close", (event) => {
    if (quitRequested || shutdownComplete) return;
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.once("did-finish-load", () => {
    if (OPEN_DEVTOOLS_ON_START) {
      mainWindow?.webContents.openDevTools({ mode: "detach" });
    }
  });

  // Let mid-turn gateway sudo/secret prompts parent their modal to this window.
  setGatewayPromptParent(() => mainWindow);

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(
      "[CRASH] Renderer process gone:",
      details.reason,
      details.exitCode,
    );
    logErrorDiagnostic("renderer.process-gone", details);
  });
  mainWindow.webContents.on("console-message", (details) => {
    // Electron ≥35 passes a single event object (level is now a string);
    // the old positional `(event, level, message, line, sourceId)` signature
    // is deprecated.
    if (details.level === "error") {
      console.error(
        `[RENDERER ERROR] ${details.message} (${details.sourceId}:${details.lineNumber})`,
      );
      logErrorDiagnostic("renderer.console-error", {
        message: details.message,
        sourceId: details.sourceId,
        lineNumber: details.lineNumber,
      });
    }
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription) => {
      console.error("[LOAD FAIL]", errorCode, errorDescription);
      logErrorDiagnostic("renderer.load-failed", {
        errorCode,
        errorDescription,
      });
    },
  );
  mainWindow.webContents.setWindowOpenHandler((details) => {
    openExternalUrl(details.url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (
      isAllowedAppNavigationUrl(
        url,
        rendererHtmlPath,
        is.dev ? process.env["ELECTRON_RENDERER_URL"] : undefined,
      )
    )
      return;
    event.preventDefault();
    openExternalUrl(url);
  });
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      const isWebPreview = params.partition === "web-preview";
      if (!isAllowedWebviewUrl(params.src, isWebPreview)) {
        event.preventDefault();
        console.warn("[SECURITY] Blocked webview attachment for untrusted URL");
        return;
      }
      hardenWebviewPreferences(webPreferences);
    },
  );
  mainWindow.webContents.on("context-menu", (_event, params) => {
    showChatContextMenu(mainWindow, params);
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(rendererHtmlPath);
  }
}
