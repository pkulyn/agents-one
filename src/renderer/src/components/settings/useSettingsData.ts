import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../useI18n";
import {
  CHAT_TRANSPORT_OPTIONS,
  setCachedVersion,
  versionCacheKey,
} from "./settingsHelpers";

export { CHAT_TRANSPORT_OPTIONS };

type DataOperationResult = {
  success: boolean;
  message: string;
  requiresRestart?: boolean;
};

/**
 * Owns every piece of Settings state, the config-load effect, and all the
 * mutation handlers that used to live inside the monolithic `Settings`
 * screen. The settings modal calls this once and shares the result with each
 * pane through `SettingsDataContext`, so the panes stay purely presentational.
 *
 * The return type is intentionally inferred (and re-exported as `SettingsData`
 * via `ReturnType`) — annotating it explicitly would just duplicate ~60 field
 * types and drift out of sync.
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSettingsData(profile?: string) {
  const { t } = useI18n();
  const [hermesHome, setHermesHome] = useState("");

  const [hermesVersion, setHermesVersion] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [doctorOutput, setDoctorOutput] = useState<string | null>(null);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateResult, setUpdateResult] = useState<string | null>(null);
  const [updateResultType, setUpdateResultType] = useState<
    "success" | "error" | null
  >(null);
  const [autoUpgradeEnabled, setAutoUpgradeEnabled] = useState(true);
  const [autoUpgradeSaved, setAutoUpgradeSaved] = useState(false);

  // Connection mode (local-only — plan D5)
  const [connMode] = useState<"local">("local");
  const [connStatus, setConnStatus] = useState<string | null>(null);
  const connLoaded = useRef(false);
  const [apiServerKeyMissing, setApiServerKeyMissing] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // Backup / Import state
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState<DataOperationResult | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<DataOperationResult | null>(
    null,
  );

  // Log viewer state
  const [logContent, setLogContent] = useState("");
  const [logFile, setLogFile] = useState("application.log");
  const [logPath, setLogPath] = useState("");
  const [logsExpanded, setLogsExpanded] = useState(false);

  // Network settings
  const [forceIpv4, setForceIpv4] = useState(false);
  const [httpProxy, setHttpProxy] = useState("");
  const httpProxyRef = useRef("");
  const savedHttpProxyRef = useRef("");
  const [networkSaved, setNetworkSaved] = useState(false);

  // Debug dump
  const [dumpOutput, setDumpOutput] = useState<string | null>(null);
  const [dumpRunning, setDumpRunning] = useState(false);

  // Desktop app (Electron) auto-update — a *separate* update channel from the
  // Hermes Agent engine update above: this ships the desktop shell itself via
  // electron-updater / GitHub releases. Mirrors the sidebar-footer updater so
  // the About pane can check/download/restart on its own.
  const [desktopUpdateState, setDesktopUpdateState] = useState<
    | "available"
    | "downloading"
    | "ready"
    | "error"
    | "checking"
    | "uptodate"
    | null
  >(null);
  const [desktopUpdateVersion, setDesktopUpdateVersion] = useState<
    string | null
  >(null);
  const [desktopUpdatePercent, setDesktopUpdatePercent] = useState<
    number | null
  >(null);
  const [desktopUpdateError, setDesktopUpdateError] = useState<string | null>(
    null,
  );

  const loadConfigRequestRef = useRef(0);

  const loadConfig = useCallback(async (): Promise<void> => {
    const requestId = ++loadConfigRequestRef.current;
    setHermesHome("");
    setHermesVersion(null);

    // Load fast config first (cached in main process)
    const [aVersion, conn, keyStatus, autoUpgrade] = await Promise.all([
      window.agentsOneAPI.getAppVersion(),
      window.agentsOneAPI.getConnectionConfig(),
      window.agentsOneAPI.getApiServerKeyStatus(profile),
      window.agentsOneAPI.getAutoUpgradeEnabled(),
    ]);

    if (requestId !== loadConfigRequestRef.current) return;

    const cacheKey = versionCacheKey(conn, profile);
    setAppVersion(aVersion);
    setApiServerKeyMissing(!keyStatus.hasKey);
    setAutoUpgradeEnabled(autoUpgrade);
    connLoaded.current = true;

    const homeResult = await Promise.resolve()
      .then(() => window.agentsOneAPI.getHermesHome(profile))
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );
    const versionResult = await Promise.resolve()
      .then(() => window.agentsOneAPI.getHermesVersion())
      .then(
        (value) => ({ status: "fulfilled" as const, value }),
        (reason) => ({ status: "rejected" as const, reason }),
      );

    if (requestId !== loadConfigRequestRef.current) return;

    setHermesHome(homeResult.status === "fulfilled" ? homeResult.value : "");
    const version =
      versionResult.status === "fulfilled" ? versionResult.value : null;
    setHermesVersion(version);
    if (version) setCachedVersion(cacheKey, version);

    // Load network settings from config.yaml
    window.agentsOneAPI.getConfig("network.force_ipv4", profile).then((v) => {
      setForceIpv4(v === "true" || v === "True");
    });
    window.agentsOneAPI.getConfig("network.proxy", profile).then((v) => {
      const loadedProxy = v || "";
      setHttpProxy(loadedProxy);
      httpProxyRef.current = loadedProxy;
      savedHttpProxyRef.current = loadedProxy.trim();
    });
  }, [profile]);

  useEffect(() => {
    void Promise.resolve().then(loadConfig);
  }, [loadConfig]);

  useEffect(() => {
    const unsubscribe = window.agentsOneAPI.onConnectionConfigChanged(() => {
      void loadConfig();
    });
    return unsubscribe;
  }, [loadConfig]);

  // Track desktop-app update lifecycle events (the same ones the sidebar-footer
  // upgrade button listens to) so the About pane reflects live progress.
  useEffect(() => {
    const cleanupAvailable = window.agentsOneAPI.onUpdateAvailable((info) => {
      setDesktopUpdateState("available");
      setDesktopUpdateVersion(info.version);
      setDesktopUpdateError(null);
    });
    const cleanupProgress = window.agentsOneAPI.onUpdateDownloadProgress(
      (info) => {
        setDesktopUpdateState("downloading");
        setDesktopUpdatePercent(info.percent);
        setDesktopUpdateError(null);
      },
    );
    const cleanupDownloaded = window.agentsOneAPI.onUpdateDownloaded(() => {
      setDesktopUpdateState("ready");
      setDesktopUpdatePercent(null);
      setDesktopUpdateError(null);
    });
    const cleanupError = window.agentsOneAPI.onUpdateError((message) => {
      setDesktopUpdateState("error");
      setDesktopUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function checkDesktopUpdate(): Promise<void> {
    setDesktopUpdateState("checking");
    setDesktopUpdateError(null);
    try {
      const version = await window.agentsOneAPI.checkForUpdates();
      if (version) {
        setDesktopUpdateState("available");
        setDesktopUpdateVersion(version);
      } else {
        setDesktopUpdateState("uptodate");
      }
    } catch (err) {
      setDesktopUpdateState("error");
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDesktopUpdate(): Promise<void> {
    if (desktopUpdateState === "ready") {
      await window.agentsOneAPI.installUpdate();
      return;
    }
    // "available" or "error" → (re)start the download. Set downloading state
    // immediately to block re-entrancy; `onUpdateDownloaded` flips to "ready".
    setDesktopUpdateState("downloading");
    setDesktopUpdatePercent(null);
    setDesktopUpdateError(null);
    try {
      const ok = await window.agentsOneAPI.downloadUpdate();
      if (!ok) setDesktopUpdateState("error");
    } catch (err) {
      setDesktopUpdateError(err instanceof Error ? err.message : String(err));
      setDesktopUpdateState("error");
    }
  }

  const saveHttpProxy = useCallback(async (): Promise<void> => {
    const trimmed = httpProxyRef.current.trim();
    if (trimmed === savedHttpProxyRef.current) return;
    await window.agentsOneAPI.setConfig("network.proxy", trimmed, profile);
    savedHttpProxyRef.current = trimmed;
    setNetworkSaved(true);
    setTimeout(() => setNetworkSaved(false), 2000);
  }, [profile]);

  useEffect(() => {
    httpProxyRef.current = httpProxy;
  }, [httpProxy]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void saveHttpProxy();
    }, 500);
    return () => clearTimeout(timer);
  }, [httpProxy, saveHttpProxy]);

  useEffect(() => {
    return () => {
      void saveHttpProxy();
    };
  }, [saveHttpProxy]);

  async function handleBackup(): Promise<void> {
    setBackingUp(true);
    setBackupResult(null);
    try {
      const result = await window.agentsOneAPI.exportAgentsOneBackup();
      if (result.canceled) return;
      if (result.success) {
        setBackupResult({
          success: true,
          message: result.path
            ? t("settings.backupExportCompleteAt", { path: result.path })
            : t("settings.backupExportComplete"),
        });
      } else {
        setBackupResult({
          success: false,
          message: result.error || t("settings.backupExportFailed"),
        });
      }
    } catch (error) {
      setBackupResult({
        success: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : t("settings.backupExportFailed"),
      });
    } finally {
      setBackingUp(false);
    }
  }

  async function handleImport(): Promise<void> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".agents-one-backup";
    input.onchange = async (): Promise<void> => {
      const file = input.files?.[0];
      if (!file) return;
      setImporting(true);
      setImportResult(null);
      try {
        const filePath = window.agentsOneAPI.getPathForFile(file);
        if (!filePath) {
          setImportResult({
            success: false,
            message: t("settings.backupFilePathUnavailable"),
          });
          return;
        }

        const inspection =
          await window.agentsOneAPI.inspectAgentsOneBackup(filePath);
        if (!inspection.success) {
          setImportResult({
            success: false,
            message: inspection.error || t("settings.backupInspectionFailed"),
          });
          return;
        }

        const summary = inspection.summary || {};
        const count = (value: number | undefined): string =>
          typeof value === "number" && Number.isFinite(value)
            ? String(value)
            : "—";
        let createdAt = summary.createdAt || "—";
        if (summary.createdAt) {
          const parsedDate = new Date(summary.createdAt);
          if (!Number.isNaN(parsedDate.getTime())) {
            createdAt = parsedDate.toLocaleString();
          }
        }
        const warnings = Array.isArray(summary.warnings)
          ? summary.warnings.filter(
              (warning): warning is string =>
                typeof warning === "string" && warning.trim().length > 0,
            )
          : [];
        const confirmation = [
          t("settings.backupRestoreConfirmTitle"),
          t("settings.backupSummaryCreatedAt", { value: createdAt }),
          t("settings.backupSummaryVersion", {
            value: summary.appVersion || "—",
          }),
          t("settings.backupSummaryCounts", {
            profiles: count(summary.profileCount),
            projects: count(summary.projectCount),
            tasks: count(summary.taskCount),
            chats: count(summary.chatCount),
            collaborations: count(summary.collaborationCount),
          }),
          t("settings.backupSummaryConflicts", {
            count: count(summary.conflictCount),
          }),
          "",
          t("settings.dataExclusions"),
          ...(warnings.length > 0
            ? [
                "",
                t("settings.backupSummaryWarnings"),
                ...warnings.map((warning) => `• ${warning}`),
              ]
            : []),
          "",
          t("settings.backupRestoreConfirmAction"),
        ].join("\n");

        if (!window.confirm(confirmation)) return;

        const result = await window.agentsOneAPI.restoreAgentsOneBackup(filePath);
        if (result.success) {
          const warningCount =
            typeof result.warningCount === "number"
              ? result.warningCount
              : result.warnings?.length || 0;
          const requiresRestart = result.requiresRestart !== false;
          setImportResult({
            success: true,
            requiresRestart,
            message: [
              t("settings.backupRestoreComplete", {
                count: result.restoredFiles ?? 0,
              }),
              warningCount > 0
                ? t("settings.backupRestoreWarnings", {
                    count: warningCount,
                  })
                : null,
              requiresRestart ? t("settings.backupRestartRequired") : null,
            ]
              .filter((line): line is string => Boolean(line))
              .join(" "),
          });
        } else {
          setImportResult({
            success: false,
            message: result.error || t("settings.backupRestoreFailed"),
          });
        }
      } catch (error) {
        setImportResult({
          success: false,
          message:
            error instanceof Error && error.message
              ? error.message
              : t("settings.backupRestoreFailed"),
        });
      } finally {
        setImporting(false);
      }
    };
    input.click();
  }

  async function handleRestartAfterRestore(): Promise<void> {
    try {
      await window.agentsOneAPI.relaunchApp();
    } catch (error) {
      setImportResult({
        success: false,
        message:
          error instanceof Error && error.message
            ? error.message
            : t("settings.backupRestartFailed"),
      });
    }
  }

  async function loadLogs(): Promise<void> {
    const result = await window.agentsOneAPI.readDiagnostics(logFile, 300);
    setLogContent(result.content);
    setLogPath(result.path);
  }

  async function handleDoctor(): Promise<void> {
    setDoctorRunning(true);
    setDoctorOutput(null);
    const output = await window.agentsOneAPI.runHermesDoctor();
    setDoctorOutput(output);
    setDoctorRunning(false);
  }

  // Helper to fetch fresh version, clear backend cache, and update localStorage
  function refreshVersion(): void {
    const requestId = ++loadConfigRequestRef.current;
    setHermesVersion(null);
    window.agentsOneAPI
      .getConnectionConfig()
      .then((conn) => {
        const cacheKey = versionCacheKey(conn, profile);
        return window.agentsOneAPI.refreshHermesVersion().then((version) => ({
          cacheKey,
          version,
        }));
      })
      .then(({ cacheKey, version }) => {
        if (requestId !== loadConfigRequestRef.current) return;
        setHermesVersion(version);
        if (version) setCachedVersion(cacheKey, version);
      });
  }

  async function handleUpdateHermes(): Promise<void> {
    setUpdating(true);
    setUpdateResult(null);
    const result = await window.agentsOneAPI.runHermesUpdate();
    setUpdating(false);
    if (result.success) {
      setUpdateResult(t("settings.updateSuccess"));
      setUpdateResultType("success");
      refreshVersion();
    } else {
      setUpdateResult(result.error || t("settings.updateFailed"));
      setUpdateResultType("error");
    }
  }

  async function handleAutoUpgradeChange(enabled: boolean): Promise<void> {
    setAutoUpgradeEnabled(enabled);
    await window.agentsOneAPI.setAutoUpgradeEnabled(enabled);
    setAutoUpgradeSaved(true);
    setTimeout(() => setAutoUpgradeSaved(false), 2000);
  }

  // Parse "Hermes Agent v0.7.0 (2026.4.3) Project: ... Python: 3.11.15 OpenAI SDK: 2.30.0 Update available: ..."
  const parsedVersion = (() => {
    if (!hermesVersion) return null;
    const v = hermesVersion;
    const version = v.match(/v([\d.]+)/)?.[1] || "";
    const date = v.match(/\(([\d.]+)\)/)?.[1] || "";
    const python = v.match(/Python:\s*([\d.]+)/)?.[1] || "";
    const sdk = v.match(/OpenAI SDK:\s*([\d.]+)/)?.[1] || "";
    const updateMatch = v.match(/Update available:\s*(.+?)(?:\s*—|$)/);
    const updateInfo = updateMatch?.[1]?.trim() || null;
    return { version, date, python, sdk, updateInfo };
  })();

  return {
    profile,
    // version / agent
    hermesHome,
    hermesVersion,
    appVersion,
    parsedVersion,
    doctorOutput,
    doctorRunning,
    updating,
    updateResult,
    updateResultType,
    autoUpgradeEnabled,
    autoUpgradeSaved,
    dumpOutput,
    dumpRunning,
    setDumpOutput,
    setDumpRunning,
    handleUpdateHermes,
    handleDoctor,
    handleAutoUpgradeChange,
    // desktop app (Electron) update — separate channel from the engine update
    desktopUpdateState,
    desktopUpdateVersion,
    desktopUpdatePercent,
    desktopUpdateError,
    checkDesktopUpdate,
    handleDesktopUpdate,
    // migration / community
    // connection (local-only — plan D5)
    connMode,
    connStatus,
    connLoaded,
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    setConnStatus,
    // backup / data
    backingUp,
    backupResult,
    importing,
    importResult,
    handleBackup,
    handleImport,
    handleRestartAfterRestore,
    // logs
    logContent,
    logFile,
    setLogFile,
    logPath,
    setLogContent,
    setLogPath,
    logsExpanded,
    setLogsExpanded,
    loadLogs,
    // network
    forceIpv4,
    setForceIpv4,
    httpProxy,
    setHttpProxy,
    httpProxyRef,
    saveHttpProxy,
    networkSaved,
    setNetworkSaved,  };
}

export type SettingsData = ReturnType<typeof useSettingsData>;
