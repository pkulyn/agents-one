import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  dialog,
  clipboard,
  type SaveDialogOptions,
} from "electron";
import { extname, join } from "path";
import { randomUUID } from "crypto";
import { mkdir, open as openFile, readdir, readFile, stat } from "fs/promises";
import { getActiveProfileNameSync } from "../utils";
import type { Attachment } from "../../shared/attachments";
import type { SessionModelOverride } from "../../shared/model-override";
import type { AppLocale } from "../../shared/i18n/types";
import type {
  DesktopSessionContinuationItem,
  DesktopSessionLocalError,
} from "../../shared/session-continuation";
import { stageAttachment, clearStagedAttachments } from "../attachment-staging";
import { prepareProjectContextAttachment } from "../project-context";
import { persistPromptImageAttachments } from "../session-attachment-store";
import {
  discoverProviderModels,
  getModelContextWindow,
} from "../model-discovery";
import {
  persistSessionContinuation,
  persistSessionLocalError,
} from "../session-continuation-store";
import {
  getSessionContextFolder,
  setSessionContextFolder,
  clearSessionContextFolderPath,
  getRecentSessionContextFolders,
} from "../session-context-folder-store";
import {
  getSessionModelOverride,
  setSessionModelOverride,
} from "../session-model-override-store";
import {
  materializeDataUrlToTemp,
  readMediaAsDataUrl,
  saveMedia,
  mediaFileExists,
  normalizeMediaPath,
} from "../media";
import { openTerminalInDirectory } from "../terminal-launcher";
import {
  getGpuStatus,
  reenableGpuAndRelaunch,
  setGpuPreference,
  relaunchApp,
} from "../gpu-fallback";
import type { GpuPreferenceMode } from "../../shared/gpu";
import {
  checkInstallStatus,
  verifyInstall,
  runInstall,
  inspectInstallTarget,
  validateHermesHome,
  setHermesHomeOverride,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  checkOpenClawExists,
  runClawMigrate,
  runHermesDump,
  discoverMemoryProviders,
  readLogs,
  type InstallProgress,
} from "../installer";
import {
  exportAgentsOneBackupTo,
  inspectAgentsOneBackup,
  restoreAgentsOneBackupFrom,
} from "../agents-one-backup";
import {
  assertAgentsOneWritesAllowed,
  beginAgentsOneRestoreWriteLock,
  endAgentsOneTemporaryWriteLock,
} from "../restore-write-lock";
import { closeDbConnection } from "../db";
import { ensureLocalDashboardCompatibility } from "../hermes-agent-compat";
import {
  addMcpServer,
  installMcpCatalogEntry,
  listMcpCatalog,
  listMcpServers,
  removeMcpServer,
  setMcpServerEnabled,
  testMcpServer,
  type McpServerInput,
} from "../mcp-servers";
import {
  isRemoteMode,
  isRemoteOnlyMode,
  sendMessage,
  transcribeAudio,
  startGateway,
  startGatewayDetailed,
  stopGateway,
  stopGatewayAndWait,
  isGatewayRunning,
  testRemoteConnection,
  restartGateway,
  notifyProfileSwitched,
  resolvePendingClarify,
} from "../hermes";
import {
  getDashboardStatus,
  startDashboard,
  stopDashboard,
  stopAllDashboards,
} from "../dashboard";
import {
  getClaw3dStatus,
  setupClaw3d,
  startDevServer,
  stopDevServer,
  startAdapter,
  stopAdapter,
  startAll as startClaw3dAll,
  stopAll as stopClaw3d,
  getClaw3dLogs,
  setClaw3dPort,
  getClaw3dPort,
  setClaw3dWsUrl,
  getClaw3dWsUrl,
  waitForClaw3dReady,
  type Claw3dSetupProgress,
} from "../claw3d";
import { startOfficeStack } from "../office-start";
import {
  readEnv,
  setEnvValue,
  getConfigValue,
  setConfigValue,
  getHermesHome,
  getModelConfig,
  setModelConfig,
  getCredentialPool,
  setCredentialPool,
  addCredentialPoolEntry,
  getConnectionConfig,
  getRemoteDashboardSessionConfig,
  getPublicConnectionConfig,
  normalizeRemoteChatTransport,
  resolveConnectionApiKeyUpdate,
  setConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
  getApiServerKeyStatus,
  invalidateSecretsCache,
  type ConnectionConfig,
} from "../config";
import {
  getAuxiliaryConfig,
  setAuxiliaryTask,
  resetAuxiliaryToAuto,
} from "../auxiliary-config";
import {
  applySessionLocalOverlays,
  listSessions,
  getSessionMessages,
  searchSessions,
  deleteSession,
  deleteSessions,
} from "../sessions";
import {
  syncSessionCache,
  listCachedSessions,
  updateSessionTitle,
} from "../session-cache";
import {
  deleteRuntimeConversation,
  getRuntimeConversation,
  listQuickChats,
  listRuntimeConversations,
  saveQuickChats,
  saveRuntimeConversation,
  updateRuntimeConversationTitle,
  clearRuntimeConversationWorkspace,
} from "../runtime-conversation-store";
import {
  remoteDeleteSession,
  remoteDeleteSessions,
  remoteGetSessionMessages,
  remoteListCachedSessions,
  remoteListSessions,
  remoteReadMediaAsDataUrl,
  remoteSearchSessions,
  remoteUpdateSessionTitle,
  type RemoteSessionConfig,
} from "../remote-sessions";
import {
  remoteGetHermesHome,
  remoteGetHermesVersion,
} from "../remote-metadata";
import {
  remoteGetSkillContent,
  remoteInstallSkill,
  remoteListInstalledSkills,
  remoteUninstallSkill,
} from "../remote-skills";
import {
  remoteAddModel,
  remoteGetModelConfig,
  remoteListModels,
  remoteRemoveModel,
  remoteSetModelConfig,
  remoteUpdateModel,
} from "../remote-models";
import {
  remoteGetConfigValue,
  remoteReadEnv,
  remoteSetConfigValue,
  remoteSetEnvValue,
} from "../remote-config";
import {
  remoteAddMemoryEntry,
  remoteDiscoverMemoryProviders,
  remoteReadMemory,
  remoteRemoveMemoryEntry,
  remoteUpdateMemoryEntry,
  remoteWriteUserProfile,
} from "../remote-memory";
import {
  activeAgentRuntimeTaskCount,
  cancelAgentRuntimeTask,
  cancelAllAgentRuntimeTasks,
  getAgentRuntimeCredentialStatus,
  getAgentRuntimeRun,
  listAgentRuntimes,
  probeAgentRuntime,
  probeAgentRuntimeDraft,
  removeAgentRuntime,
  saveAgentRuntime,
  saveAgentRuntimeAppearance,
  setAgentRuntimeBearerToken,
  setAgentRuntimeDashboardToken,
  setAgentRuntimeWorkspaceGatewayToken,
  startAgentRuntimeTask,
} from "../agent-runtimes";
import { getPiModelContextWindow } from "../pi-runtime";
import type {
  AgentRuntimeDraft,
  AgentRuntimeAppearance,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import type { SaveRuntimeConversationInput } from "../../shared/runtime-conversations";
import type {
  CreateTaskScheduleInput,
  UpdateTaskScheduleInput,
} from "../../shared/task-schedules";
import {
  createTaskSchedule,
  deleteTaskSchedule,
  listTaskSchedules,
  setTaskScheduleEnabled,
  triggerTaskSchedule,
  updateTaskSchedule,
  startTaskScheduleRunner,
  stopTaskScheduleRunnerAndWait,
} from "../task-schedules";
import {
  listProjectFolders,
  registerProjectFolder,
  removeProjectFolder,
  updateProjectFolder,
} from "../project-folders";
import type { UpdateProjectFolderInput } from "../../shared/project-folders";
import {
  archiveItem,
  getArchivedItem,
  listArchivedItems,
  restoreArchivedItem,
} from "../archive-store";
import type { ArchiveItemInput } from "../../shared/archives";
import {
  getTaskCollaboration,
  linkTaskCollaboration,
  listTaskCollaborations,
  saveTaskCollaboration,
  updateTaskCollaborationExecution,
} from "../task-collaboration-store";
import type {
  LinkTaskCollaborationInput,
  SaveTaskCollaborationInput,
  UpdateTaskCollaborationExecutionInput,
} from "../../shared/task-collaboration";
import {
  listModels,
  addModel,
  removeModel,
  updateModel,
  type SavedModel,
} from "../models";
import { validateChatReadiness } from "../validation";
import {
  runConfigHealthCheck,
  autoFixIssue,
  readConfigFixLog,
  type IssueCode,
} from "../config-health";
import {
  listProfiles,
  createProfile,
  deleteProfile,
  setActiveProfile,
} from "../profiles";
import {
  setProfileColor,
  setProfileAvatar,
  removeProfileAvatar,
  setProfileName,
} from "../profile-meta";
import {
  readMemory,
  addMemoryEntry,
  updateMemoryEntry,
  removeMemoryEntry,
  writeUserProfile,
} from "../memory";
import { readSoul, writeSoul, resetSoul } from "../soul";
import {
  getPlatformToolsets,
  getToolsets,
  setMessagingPlatformToolsetEnabled,
  setToolsetEnabled,
} from "../tools";
import {
  fetchRegistry,
  fetchModelRegistry,
  fetchRegistryDetail,
  listInstalledRegistry,
  installRegistryItem,
  type RegistryKind,
  type RegistryItem,
} from "../registry";
import {
  listInstalledSkills,
  listBundledSkills,
  getSkillContent,
  installSkill,
  uninstallSkill,
} from "../skills";
import {
  listCronJobs,
  createCronJob,
  removeCronJob,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "../cronjobs";
import {
  applyMessagingPlatformUpdate,
  buildDesktopMessagingPlatforms,
  fetchRemoteMessagingPlatforms,
  readLocalGatewayPlatformStates,
  testDesktopMessagingPlatform,
  testRemoteMessagingPlatform,
  updateRemoteMessagingPlatform,
} from "../messaging-platforms";
import { getAppLocale, setAppLocale } from "../locale";

export interface IpcContext {
  activeRuns: Map<string, () => void>;
  getMainWindow: () => BrowserWindow | null;
  notifyConnectionConfigChanged: () => void;
  notifyModelLibraryChanged: () => void;
  openExternalUrl: (rawUrl: unknown) => void;
}

const APP_NAME = process.env.HERMES_DESKTOP_APP_NAME?.trim() || "Agents One";

type RemoteSessionBridgeConfig = RemoteSessionConfig;

// Most session/metadata IPC calls don't carry a profile, but the remote
// machine dashboard serves EVERY profile — an unscoped request silently
// returns the DEFAULT profile's data (wrong session list / transcript for a
// named-profile user). Fall back to the locally persisted active profile so
// `dashboardApiUrl` appends `?profile=` ("default" needs no param and is
// skipped there; explicit params like `profile=all` are never overridden).
function activeProfileName(profile?: string): string {
  return profile?.trim() || getActiveProfileNameSync();
}

async function withRemoteDashboard<T>(
  conn: ConnectionConfig,
  dashboardOperation: () => Promise<T>,
  legacyOperation: () => Promise<T> | T,
): Promise<T> {
  if (conn.remoteChatTransport === "legacy") return legacyOperation();
  try {
    return await dashboardOperation();
  } catch (err) {
    if (conn.remoteChatTransport === "auto") return legacyOperation();
    throw err;
  }
}

async function getActiveDashboardMediaConfig(): Promise<RemoteSessionBridgeConfig | null> {
  const conn = getConnectionConfig();
  if (conn.mode === "remote") {
    if (conn.remoteChatTransport === "legacy") return null;
    if (!conn.remoteUrl.trim() || !conn.apiKey.trim()) return null;
    return { remoteUrl: conn.remoteUrl, apiKey: conn.apiKey };
  }
  return null;
}

async function readMediaForCurrentConnection(
  filePath: string,
): Promise<string | null> {
  const normalizedPath = normalizeMediaPath(filePath);
  const local = readMediaAsDataUrl(normalizedPath);
  if (local) return local;
  const remote = await getActiveDashboardMediaConfig();
  return remote ? remoteReadMediaAsDataUrl(remote, normalizedPath) : null;
}

async function mediaFileExistsForCurrentConnection(
  filePath: string,
): Promise<boolean> {
  const normalizedPath = normalizeMediaPath(filePath);
  if (mediaFileExists(normalizedPath)) return true;
  const remote = await getActiveDashboardMediaConfig();
  if (!remote) return false;
  return (await remoteReadMediaAsDataUrl(remote, normalizedPath)) !== null;
}

async function resolveMediaForSave(src: string): Promise<string> {
  if (src.startsWith("data:") || /^https?:\/\//i.test(src)) return src;
  return (await readMediaForCurrentConnection(src)) ?? src;
}

/**
 * Resolve the saved-model library entry for an activated (provider, model) so
 * its `apiMode`/`contextLength` can be mirrored into config.yaml. When several
 * entries share the same provider+model — e.g. two `custom` endpoints exposing
 * the same model id over different transports/base URLs — a bare provider+model
 * `find` would return the wrong one and persist its transport, routing requests
 * over the wrong protocol. Disambiguate by base URL in that case; fall back to
 * the first match when none align (single-entry activations are unaffected).
 */
function resolveLibraryModelEntry(
  provider: string,
  model: string,
  baseUrl: string,
): SavedModel | undefined {
  const matches = listModels().filter(
    (m) => m.provider === provider && m.model === model,
  );
  if (matches.length <= 1) return matches[0];
  const norm = (u: string | undefined): string =>
    (u || "").trim().replace(/\/+$/, "");
  const target = norm(baseUrl);
  return matches.find((m) => norm(m.baseUrl) === target) ?? matches[0];
}

export function registerIpcHandlers(context: IpcContext): void {
  const {
    activeRuns,
    getMainWindow,
    notifyConnectionConfigChanged,
    notifyModelLibraryChanged,
    openExternalUrl,
  } = context;
  const mainWindow = getMainWindow();
  // Installation
  ipcMain.handle("check-install", () => {
    return checkInstallStatus();
  });

  ipcMain.handle("verify-install", () => verifyInstall());

  ipcMain.handle("start-install", async (event) => {
    try {
      await runInstall((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      }, mainWindow);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Pre-install inspection + "use an existing installation" (issue #272).
  ipcMain.handle("inspect-install-target", () => inspectInstallTarget());
  ipcMain.handle("validate-hermes-home", (_event, dir: string) =>
    validateHermesHome(dir),
  );
  ipcMain.handle("adopt-hermes-home", (_event, dir: string) => {
    if (!validateHermesHome(dir)) return false;
    // Persist the choice only. HERMES_HOME is resolved once at module
    // load, so the override takes effect on the next launch — the renderer
    // asks the user to restart. (An app-driven relaunch is unreliable
    // under the dev server, which is torn down with the process.)
    setHermesHomeOverride(dir);
    return true;
  });
  ipcMain.handle("quit-app", () => app.quit());

  // GPU fallback visibility: lets the Office tab explain SwiftShader slowness
  // and offer a one-click recovery instead of silently rendering 3D on the CPU.
  ipcMain.handle("get-gpu-status", () => getGpuStatus());
  ipcMain.handle("reenable-gpu", () => reenableGpuAndRelaunch());
  // Settings → Appearance hardware-acceleration preference. Validated here
  // because the renderer is untrusted for main-process file writes.
  ipcMain.handle("set-gpu-preference", (_event, mode: GpuPreferenceMode) => {
    if (mode !== "auto" && mode !== "on" && mode !== "off") return false;
    return setGpuPreference(mode);
  });
  ipcMain.handle("relaunch-app", () => relaunchApp());

  // Hermes engine info
  ipcMain.handle("get-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetHermesVersion(getRemoteDashboardSessionConfig(conn));
    return getHermesVersion();
  });
  ipcMain.handle("refresh-hermes-version", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetHermesVersion(getRemoteDashboardSessionConfig(conn));
    clearVersionCache();
    return getHermesVersion();
  });
  ipcMain.handle("run-hermes-doctor", () => {
    return runHermesDoctor();
  });
  ipcMain.handle("run-hermes-update", async (event) => {
    try {
      await runHermesUpdate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      const compat = ensureLocalDashboardCompatibility();
      if (!compat.ok) {
        event.sender.send("install-progress", {
          step: 1,
          totalSteps: 1,
          title: "Updating Hermes Agent",
          detail: "Dashboard compatibility check needs attention.",
          log: `Dashboard compatibility warning: ${
            compat.error ? `${compat.detail}: ${compat.error}` : compat.detail
          }\n`,
        });
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // OpenClaw migration
  ipcMain.handle("check-openclaw", () => checkOpenClawExists());
  ipcMain.handle("run-claw-migrate", async (event) => {
    try {
      await runClawMigrate((progress: InstallProgress) => {
        event.sender.send("install-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteReadEnv(getRemoteDashboardSessionConfig(conn, profile));
    return readEnv(profile);
  });

  // Pre-send chat readiness — answers "if Send is clicked right now,
  // will it work?". Fail-open semantics: any uncertain state returns
  // `ok: true`, so the renderer never false-blocks a Send.
  ipcMain.handle("validate-chat-readiness", (_event, profile?: string) => {
    return validateChatReadiness(profile);
  });

  // Config-health audit + per-issue auto-fix. The renderer renders a
  // dismissible banner above the chat input and a full report in the
  // Settings → Diagnose section. Auto-fixes are additive only — never
  // delete; always log to ~/.hermes/logs/config-fixes.log.
  ipcMain.handle("get-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle("rerun-config-health", (_event, profile?: string) => {
    return runConfigHealthCheck(profile);
  });

  ipcMain.handle(
    "autofix-config-issue",
    (
      _event,
      code: IssueCode,
      profile?: string,
      context?: Record<string, string>,
    ) => {
      return autoFixIssue(code, profile, context);
    },
  );

  ipcMain.handle("get-config-fix-log", (_event, maxEntries?: number) => {
    return readConfigFixLog(maxEntries);
  });

  ipcMain.handle(
    "set-env",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return remoteSetEnvValue(
          getRemoteDashboardSessionConfig(conn, profile),
          key,
          value,
        );
      }
      setEnvValue(key, value, profile);
      // Restart gateway so it picks up the new API key.
      // The earlier condition had a precedence bug —
      //   `(isGatewayRunning() && _API_KEY) || _TOKEN || HF_TOKEN`
      // — that triggered a restart for `_TOKEN`/`HF_TOKEN` writes even
      // when no local gateway was running, which in remote mode hit the
      // `startGateway` path with no local install (issue #266).
      // restartGateway() now also self-gates on isRemoteMode(), so this
      // is belt-and-braces, but the condition is fixed too for clarity.
      const looksLikeCredential =
        key.endsWith("_API_KEY") ||
        key.endsWith("_TOKEN") ||
        key === "HF_TOKEN";
      if (isGatewayRunning(profile) && looksLikeCredential) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle("get-config", (_event, key: string, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetConfigValue(
        getRemoteDashboardSessionConfig(conn, profile),
        key,
      );
    return getConfigValue(key, profile);
  });

  ipcMain.handle(
    "set-config",
    async (_event, key: string, value: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return remoteSetConfigValue(
          getRemoteDashboardSessionConfig(conn, profile),
          key,
          value,
        );
      }
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetHermesHome(getRemoteDashboardSessionConfig(conn, profile));
    return getHermesHome(profile);
  });

  ipcMain.handle("get-model-config", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return withRemoteDashboard(
        conn,
        () =>
          remoteGetModelConfig(
            getRemoteDashboardSessionConfig(conn, profile),
          ),
        () => {
          throw new Error("Remote dashboard model config is unavailable.");
        },
      );
    return getModelConfig(profile);
  });

  ipcMain.handle(
    "set-model-config",
    async (
      _event,
      provider: string,
      model: string,
      baseUrl: string,
      profile?: string,
    ) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return withRemoteDashboard(
          conn,
          () =>
            remoteSetModelConfig(
              getRemoteDashboardSessionConfig(conn, profile),
              provider,
              model,
              baseUrl,
            ),
          () => {
            throw new Error("Remote dashboard model config is unavailable.");
          },
        );
      }
      const prev = getModelConfig(profile);
      // Mirror the activated model's context-window override and API-protocol
      // mode (if any) into config.yaml so the gauge, the agent's
      // auto-compaction threshold, and the runtime transport all match the
      // model being activated. Passing `null` when the library entry has none
      // clears any stale value left by a previously-active model — critical for
      // `api_mode`, since a leftover `anthropic_messages`/`chat_completions`
      // would otherwise route the new endpoint over the wrong protocol.
      const libEntry = resolveLibraryModelEntry(provider, model, baseUrl);
      setModelConfig(
        provider,
        model,
        baseUrl,
        profile,
        libEntry?.contextLength ?? null,
        libEntry?.apiMode ?? null,
      );

      // Restart gateway when provider, model, or endpoint changes so it picks up new config
      if (
        isGatewayRunning(profile) &&
        (prev.provider !== provider ||
          prev.model !== model ||
          prev.baseUrl !== baseUrl)
      ) {
        restartGateway(profile);
      }

      return true;
    },
  );

  // Auxiliary (side-task) model routing
  ipcMain.handle("get-auxiliary-config", (_event, profile?: string) => {
    return getAuxiliaryConfig(profile);
  });

  ipcMain.handle(
    "set-auxiliary-task",
    async (
      _event,
      task: string,
      cfg: { provider: string; model: string; baseUrl: string },
      profile?: string,
    ) => {
      setAuxiliaryTask(task, cfg, profile);

      // Restart gateway so it picks up the new auxiliary config
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }

      return true;
    },
  );

  ipcMain.handle("reset-auxiliary-config", async (_event, profile?: string) => {
    resetAuxiliaryToAuto(profile);

    // Restart gateway so it picks up the reset
    if (isGatewayRunning(profile)) {
      restartGateway(profile);
    }

    return true;
  });

  // API_SERVER_KEY management — lets the renderer detect a missing key and
  // generate one with a button click (local mode) or show instructions (remote).
  // Additive shape: `hasKey` stays the required primary field; `providerId` /
  // `checkedAt` are optional extras for a follow-up Settings/Gateway UI.
  ipcMain.handle("get-api-server-key-status", (_event, profile?: string) =>
    getApiServerKeyStatus(profile),
  );

  // Drops the cached secrets-provider values so the next status check re-reads
  // the vault — lets the renderer's "Refresh from vault" button take effect
  // immediately instead of waiting out the cache TTL.
  ipcMain.handle("invalidate-secrets-cache", () => {
    invalidateSecretsCache();
  });

  ipcMain.handle(
    "generate-api-server-key",
    async (_event, profile?: string) => {
      const { randomUUID } = await import("crypto");
      const key = `desk-${randomUUID()}`;
      // Write to both the active profile .env and the default .env so the
      // gateway (which reads the profile .env) and the desktop (which reads
      // the default .env as fallback) both see the same key.
      setEnvValue("API_SERVER_KEY", key, profile);
      if (profile && profile !== "default") {
        setEnvValue("API_SERVER_KEY", key);
      }
      // Restart gateway so it picks up the new key immediately.
      if (isGatewayRunning(profile)) {
        stopGateway(profile, true);
        await new Promise<void>((r) => setTimeout(r, 800));
        startGateway(profile);
      }
      return { key };
    },
  );

  // Connection mode (local / remote)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getPublicConnectionConfig());

  // Agent runtimes deliberately expose only non-secret definitions. Hermes
  // credentials stay in the existing protected connection configuration.
  ipcMain.handle("list-agent-runtimes", () => listAgentRuntimes());
  ipcMain.handle(
    "get-agent-runtime-model-context-window",
    async (
      _event,
      runtimeId: string,
      provider: string,
      model: string,
      profile?: string,
    ) => {
      const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
      if (!runtime || runtime.location !== "local") return null;

      if (runtime.kind === "pi") {
        const piContextWindow = getPiModelContextWindow(provider, model);
        if (piContextWindow) return piContextWindow;
      }

      const savedContextWindow = listModels().find(
        (item) =>
          item.provider.trim().toLowerCase() ===
            provider.trim().toLowerCase() &&
          item.model.trim().toLowerCase() === model.trim().toLowerCase() &&
          typeof item.contextLength === "number" &&
          item.contextLength > 0,
      )?.contextLength;
      if (savedContextWindow) return savedContextWindow;

      return getModelContextWindow(
        provider,
        model,
        undefined,
        undefined,
        profile,
      );
    },
  );
  ipcMain.handle("save-agent-runtime", (_event, draft: AgentRuntimeDraft) =>
    saveAgentRuntime(draft),
  );
  ipcMain.handle(
    "save-agent-runtime-appearance",
    (_event, id: string, appearance: AgentRuntimeAppearance) =>
      saveAgentRuntimeAppearance(id, appearance),
  );
  ipcMain.handle("remove-agent-runtime", (_event, id: string) =>
    removeAgentRuntime(id),
  );
  ipcMain.handle("get-agent-runtime-credential-status", (_event, id: string) =>
    getAgentRuntimeCredentialStatus(id),
  );
  ipcMain.handle(
    "set-agent-runtime-bearer-token",
    (_event, id: string, bearerToken: string) =>
      setAgentRuntimeBearerToken(id, bearerToken),
  );
  ipcMain.handle(
    "set-agent-runtime-dashboard-token",
    (_event, id: string, dashboardToken: string) =>
      setAgentRuntimeDashboardToken(id, dashboardToken),
  );
  ipcMain.handle(
    "set-agent-runtime-workspace-gateway-token",
    (_event, id: string, bearerToken: string) =>
      setAgentRuntimeWorkspaceGatewayToken(id, bearerToken),
  );
  ipcMain.handle("probe-agent-runtime", (_event, id: string) =>
    probeAgentRuntime(id),
  );
  ipcMain.handle(
    "probe-agent-runtime-draft",
    (_event, draft: AgentRuntimeDraft, bearerToken?: string) =>
      probeAgentRuntimeDraft(draft, bearerToken),
  );
  ipcMain.handle(
    "start-agent-runtime-task",
    (_event, runtimeId: string, input: AgentRuntimeTaskInput) =>
      startAgentRuntimeTask(runtimeId, input),
  );
  ipcMain.handle("get-agent-runtime-run", (_event, runId: string) =>
    getAgentRuntimeRun(runId),
  );
  ipcMain.handle("cancel-agent-runtime-task", (_event, runId: string) =>
    cancelAgentRuntimeTask(runId),
  );
  ipcMain.handle("list-task-schedules", (_event, profile?: string) =>
    listTaskSchedules(profile),
  );
  ipcMain.handle(
    "create-task-schedule",
    (_event, input: CreateTaskScheduleInput, profile?: string) =>
      createTaskSchedule(input, profile),
  );
  ipcMain.handle(
    "update-task-schedule",
    (
      _event,
      id: string,
      input: UpdateTaskScheduleInput,
      profile?: string,
    ) => updateTaskSchedule(id, input, profile),
  );
  ipcMain.handle(
    "set-task-schedule-enabled",
    (_event, id: string, enabled: boolean, profile?: string) =>
      setTaskScheduleEnabled(id, enabled, profile),
  );
  ipcMain.handle(
    "trigger-task-schedule",
    (_event, id: string, profile?: string) => triggerTaskSchedule(id, profile),
  );
  ipcMain.handle(
    "delete-task-schedule",
    (_event, id: string, profile?: string) => deleteTaskSchedule(id, profile),
  );
  ipcMain.handle(
    "set-connection-config",
    (
      _event,
      mode: "local" | "remote",
      remoteUrl: string,
      apiKey?: string,
      remoteDashboardUrl?: string,
      remoteDashboardToken?: string,
    ) => {
      const existing = getConnectionConfig();
      setConnectionConfig({
        ...existing,
        mode,
        remoteUrl,
        apiKey: resolveConnectionApiKeyUpdate(
          existing,
          mode,
          remoteUrl,
          apiKey,
        ),
        remoteDashboardUrl:
          remoteDashboardUrl !== undefined
            ? remoteDashboardUrl
            : existing.remoteDashboardUrl,
        remoteDashboardToken:
          remoteDashboardToken !== undefined
            ? remoteDashboardToken
            : existing.remoteDashboardToken,
      });
      notifyConnectionConfigChanged();
      return true;
    },
  );

  ipcMain.handle(
    "set-connection-chat-transports",
    (_event, remoteChatTransport: unknown) => {
      const current = getConnectionConfig();
      setConnectionConfig({
        ...current,
        remoteChatTransport: normalizeRemoteChatTransport(remoteChatTransport),
      });
      notifyConnectionConfigChanged();
      return true;
    },
  );

  ipcMain.handle(
    "test-remote-connection",
    (_event, url: string, apiKey?: string) => testRemoteConnection(url, apiKey),
  );

  // Chat — lazy-start gateway on first message
  ipcMain.handle(
    "transcribe-audio",
    async (
      _event,
      audio: Uint8Array,
      mimeType: string,
      profile?: string,
    ): Promise<string> => transcribeAudio(audio, mimeType, profile),
  );

  ipcMain.handle(
    "send-message",
    async (
      event,
      message: string,
      profile?: string,
      resumeSessionId?: string,
      history?: Array<{ role: string; content: string }>,
      attachments?: Attachment[],
      contextFolder?: string,
      runId?: string,
      modelOverride?: SessionModelOverride,
    ) => {
      assertAgentsOneWritesAllowed();
      // Each conversation has a stable runId minted by the renderer. Fall back
      // to a generated id for legacy callers so the run is still tracked.
      const chatRunId = runId || `run-${randomUUID()}`;
      if (!isRemoteMode() && !isGatewayRunning(profile)) {
        startGateway(profile);
      }

      // Abort only a prior run under the SAME runId (a re-send in the same
      // conversation). Sibling runs — other background sessions / agents —
      // keep streaming untouched.
      const existing = activeRuns.get(chatRunId);
      if (existing) existing();

      let fullResponse = "";
      const chatStartTime = Date.now();
      let resolveChat: (v: { response: string; sessionId?: string }) => void;
      let rejectChat: (reason?: unknown) => void;
      const promise = new Promise<{ response: string; sessionId?: string }>(
        (res, rej) => {
          resolveChat = res;
          rejectChat = rej;
        },
      );

      // Streaming sends to `event.sender` will throw "Object has been
      // destroyed" if the renderer WebContents goes away mid-response
      // (window closed, reloaded, navigated away). Guard every send so a
      // dead sender doesn't crash the IPC handler, and abort the in-flight
      // chat the first time we see one — there's nobody listening anymore.
      // Every event carries the runId as its first arg so the renderer can
      // route it to the right conversation among several running at once.
      const safeSend = (channel: string, payload: unknown): boolean => {
        if (event.sender.isDestroyed()) return false;
        try {
          event.sender.send(channel, chatRunId, payload);
          return true;
        } catch {
          return false;
        }
      };
      const abortThisRun = (): void => {
        activeRuns.get(chatRunId)?.();
      };

      const handle = await sendMessage(
        message,
        {
          onChunk: (chunk) => {
            fullResponse += chunk;
            if (!safeSend("chat-chunk", chunk)) {
              // Renderer is gone — stop generating and resolve with what we
              // have so the awaiting promise doesn't leak.
              abortThisRun();
            }
          },
          onReasoningChunk: (chunk) => {
            // Forward reasoning/thinking tokens on a dedicated channel so
            // the renderer can render the thinking bubble live during the
            // stream rather than waiting for a focus-change refresh (#352).
            // Same renderer-gone abort guard as the content channel.
            if (!safeSend("chat-reasoning-chunk", chunk)) {
              abortThisRun();
            }
          },
          onDone: (sessionId) => {
            activeRuns.delete(chatRunId);
            try {
              persistPromptImageAttachments(sessionId, message, attachments);
            } catch (err) {
              console.warn(
                "[sessions] Failed to persist prompt image attachments:",
                err,
              );
            }
            safeSend("chat-done", sessionId || "");
            resolveChat({ response: fullResponse, sessionId });
            // Desktop notification when window is not focused and response took >10s
            if (
              mainWindow &&
              !mainWindow.isFocused() &&
              Date.now() - chatStartTime > 10000
            ) {
              const preview = fullResponse
                .replace(/[#*_`~\n]+/g, " ")
                .trim()
                .slice(0, 80);
              new Notification({
                title: APP_NAME,
                body: preview || "Response ready",
              }).show();
            }
          },
          onSessionStarted: (sessionId) => {
            safeSend("chat-session-started", sessionId);
          },
          onError: (error) => {
            activeRuns.delete(chatRunId);
            safeSend("chat-error", error);
            rejectChat(new Error(error));
            // Notify on error too if window not focused
            if (mainWindow && !mainWindow.isFocused()) {
              new Notification({
                title: `${APP_NAME} — Error`,
                body: error.slice(0, 100),
              }).show();
            }
          },
          onToolProgress: (tool) => {
            safeSend("chat-tool-progress", tool);
          },
          onToolEvent: (toolEvent) => {
            safeSend("chat-tool-event", toolEvent);
          },
          onUsage: (usage) => {
            safeSend("chat-usage", usage);
          },
          onClarify: (req) => {
            safeSend("chat-clarify-request", req);
          },
        },
        profile,
        resumeSessionId,
        history,
        attachments,
        contextFolder,
        modelOverride,
      );

      activeRuns.set(chatRunId, handle.abort);
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (_event, runId?: string) => {
    // Abort one run when given its id; with no id (legacy callers) abort all.
    if (runId) {
      activeRuns.get(runId)?.();
      activeRuns.delete(runId);
      return;
    }
    for (const abort of activeRuns.values()) abort();
    activeRuns.clear();
  });

  // Renderer's answer to an inline clarify card. Resolves the pending gateway
  // request for this request_id, which forwards the answer to `clarify.respond`.
  ipcMain.handle(
    "clarify-respond",
    (_event, payload: { requestId: string; answer: string }) => {
      return resolvePendingClarify(
        payload?.requestId ?? "",
        payload?.answer ?? "",
      );
    },
  );

  // Renderer-driven clipboard write (issue #298 — "Copy entire chat").
  // Routed through the main process so it doesn't depend on the renderer's
  // document being focused, which the navigator.clipboard API requires.
  ipcMain.handle("copy-to-clipboard", (_event, text: string) => {
    clipboard.writeText(typeof text === "string" ? text : "");
  });

  // Media — render agent-generated images and save them to disk (#299).
  ipcMain.handle("read-media-file", (_event, filePath: string) =>
    readMediaForCurrentConnection(filePath),
  );
  ipcMain.handle("save-media-file", async (event, src: string, name: string) =>
    saveMedia(
      await resolveMediaForSave(src),
      name,
      BrowserWindow.fromWebContents(event.sender),
    ),
  );
  ipcMain.handle("media-file-exists", (_event, filePath: string) =>
    mediaFileExistsForCurrentConnection(filePath),
  );

  // Native right-click menu for a rendered media element (#299): "Open"
  // hands the file to the OS default handler (or a web URL to the browser),
  // "Save as…" writes a copy elsewhere. Labels are passed in from the
  // renderer so the menu honours the active UI locale.
  ipcMain.on(
    "show-media-menu",
    (
      event,
      src: string,
      name: string,
      labels: { open: string; saveAs: string },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || !src) return;
      const isUrl = /^https?:\/\//i.test(src);
      const isData = src.startsWith("data:");
      const template: Electron.MenuItemConstructorOptions[] = [];
      template.push({
        label: labels.open,
        click: () => {
          if (isUrl) {
            openExternalUrl(src);
            return;
          }

          const target = isData ? materializeDataUrlToTemp(src, name) : src;
          if (!target) return;
          shell.openPath(target).then((err) => {
            if (err) console.error("[media] open failed:", err);
          });
        },
      });
      template.push({
        label: labels.saveAs,
        click: () => {
          void saveMedia(src, name, win);
        },
      });
      Menu.buildFromTemplate(template).popup({ window: win });
    },
  );

  // Local delivery artifacts use file semantics, not download semantics.
  // Keep the native menu in the main process so paths and file contents do
  // not need to be materialized into renderer-owned URLs.
  ipcMain.on(
    "show-file-menu",
    async (
      event,
      filePath: string,
      labels: {
        open: string;
        copyPath: string;
        copyContent: string;
        reveal: string;
      },
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const target = typeof filePath === "string" ? filePath.trim() : "";
      if (!win || !target || target.length > 32_768) return;

      let copyContentEnabled = false;
      try {
        const info = await stat(target);
        copyContentEnabled = info.isFile() && info.size <= 5 * 1024 * 1024;
      } catch {
        copyContentEnabled = false;
      }

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: labels.open,
          click: () => {
            void shell.openPath(target).then((error) => {
              if (error) console.error("[artifact] open failed:", error);
            });
          },
        },
        { type: "separator" },
        {
          label: labels.copyPath,
          click: () => clipboard.writeText(target),
        },
        {
          label: labels.copyContent,
          enabled: copyContentEnabled,
          click: () => {
            void readFile(target, "utf8")
              .then((content) => clipboard.writeText(content))
              .catch((error) =>
                console.error("[artifact] copy content failed:", error),
              );
          },
        },
        {
          label: labels.reveal,
          click: () => shell.showItemInFolder(target),
        },
      ];
      Menu.buildFromTemplate(template).popup({ window: win });
    },
  );

  // Attachment staging — for pasted blobs that have no filesystem origin.
  ipcMain.handle(
    "stage-attachment",
    (_event, sessionId: string, filename: string, base64Bytes: string) => {
      return stageAttachment(sessionId, filename, base64Bytes);
    },
  );
  ipcMain.handle("clear-staged-attachments", (_event, sessionId: string) => {
    clearStagedAttachments(sessionId);
  });

  // Model discovery — fetch the provider's /v1/models for autocomplete.
  ipcMain.handle(
    "discover-provider-models",
    (
      _event,
      provider: string,
      baseUrl: string | undefined,
      apiKey: string | undefined,
      profile?: string,
    ) => {
      return discoverProviderModels(provider, baseUrl, apiKey, profile);
    },
  );

  // Authoritative context-window size for the active model (issue #597).
  // Resolves the real `context_length` from the provider's /models catalogue;
  // returns null when unavailable so the renderer falls back to its heuristic.
  ipcMain.handle(
    "get-model-context-window",
    (
      _event,
      provider: string,
      model: string,
      baseUrl: string | undefined,
      profile?: string,
    ) => {
      return getModelContextWindow(
        provider,
        model,
        baseUrl,
        undefined,
        profile,
      );
    },
  );

  // Gateway
  ipcMain.handle("start-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      // The remote server runs its own gateway; nothing to start locally.
      // Without this guard we'd fall through to `startGateway()` and
      // spawn a non-existent local hermes-agent (issue #266).
      return {
        success: false,
        running: false,
        error:
          "Remote mode points at an already-running Hermes server. Start or restart the gateway on that remote host.",
      };
    }
    return startGatewayDetailed();
  });
  ipcMain.handle("stop-gateway", async () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      // No local gateway to stop in pure remote mode.
      return true;
    }
    // No profile argument → stops the active profile's gateway, leaving any
    // other profiles' gateways running.
    stopGateway(undefined, true);
    return true;
  });
  ipcMain.handle("restart-gateway", async (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      return false;
    }
    return restartGateway(profile);
  });
  ipcMain.handle("gateway-status", () => {
    return isGatewayRunning();
  });

  // Dashboard/WebSocket transport probe. This is intentionally separate from
  // the current chat path while we validate the ordered event stream.
  ipcMain.handle("dashboard-status", (_event, profile?: string) =>
    getDashboardStatus(profile),
  );
  ipcMain.handle("start-dashboard", (_event, profile?: string) =>
    startDashboard(profile),
  );
  ipcMain.handle("stop-dashboard", (_event, profile?: string) =>
    stopDashboard(profile),
  );

  // Platform toggles (config.yaml platforms section)
  ipcMain.handle("get-platform-enabled", (_event, profile?: string) => {
    return getPlatformEnabled(profile);
  });
  ipcMain.handle(
    "set-platform-enabled",
    async (_event, platform: string, enabled: boolean, profile?: string) => {
      setPlatformEnabled(platform, enabled, profile);
      // Restart gateway so it picks up the new platform config
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return true;
    },
  );

  ipcMain.handle(
    "get-messaging-platforms",
    async (_event, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return fetchRemoteMessagingPlatforms();
      }
      const running = isGatewayRunning(profile);
      return buildDesktopMessagingPlatforms(
        readEnv(profile),
        getPlatformEnabled(profile),
        running,
        getPlatformToolsets(profile),
        readLocalGatewayPlatformStates(profile, running),
      );
    },
  );

  ipcMain.handle(
    "update-messaging-platform",
    async (_event, platform: string, update, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return updateRemoteMessagingPlatform(platform, update);
      }
      await applyMessagingPlatformUpdate(
        platform,
        update,
        (key, value) => setEnvValue(key, value, profile),
        (key, enabled) => setPlatformEnabled(key, enabled, profile),
        (platformKey, toolsetKey, enabled) =>
          setMessagingPlatformToolsetEnabled(
            platformKey,
            toolsetKey,
            enabled,
            profile,
          ),
      );
      if (isGatewayRunning(profile)) {
        restartGateway(profile);
      }
      return { ok: true, platform };
    },
  );

  ipcMain.handle(
    "test-messaging-platform",
    async (_event, platform: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote") {
        return testRemoteMessagingPlatform(platform);
      }
      const running = isGatewayRunning(profile);
      return testDesktopMessagingPlatform(
        platform,
        buildDesktopMessagingPlatforms(
          readEnv(profile),
          getPlatformEnabled(profile),
          running,
          getPlatformToolsets(profile),
          readLocalGatewayPlatformStates(profile, running),
        ),
      );
    },
  );

  // Sessions
  ipcMain.handle("list-sessions", (_event, limit?: number, offset?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteListSessions(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        limit,
        offset,
      );
    return listSessions(limit, offset);
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetSessionMessages(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        sessionId,
      ).then((items) => applySessionLocalOverlays(sessionId, items));
    return getSessionMessages(sessionId);
  });

  ipcMain.handle(
    "record-session-continuation",
    (_event, sessionId: string, items: DesktopSessionContinuationItem[]) => {
      persistSessionContinuation(sessionId, items);
      return true;
    },
  );

  ipcMain.handle(
    "record-session-local-error",
    (_event, sessionId: string, error: DesktopSessionLocalError) => {
      persistSessionLocalError(sessionId, error?.error, error?.userContent);
      return true;
    },
  );

  // Per-session linked working folder (issue #27): a desktop-only binding
  // persisted in the local state.db so a re-opened session restores its folder.
  ipcMain.handle("get-session-context-folder", (_event, sessionId: string) => {
    return getSessionContextFolder(sessionId);
  });

  ipcMain.handle(
    "set-session-context-folder",
    (_event, sessionId: string, folder: string | null) => {
      setSessionContextFolder(sessionId, folder);
      return true;
    },
  );

  ipcMain.handle(
    "save-task-collaboration",
    (_event, input: SaveTaskCollaborationInput, profile?: string) =>
      saveTaskCollaboration(input, profile),
  );

  ipcMain.handle(
    "get-task-collaboration",
    (_event, taskId: string, profile?: string) =>
      getTaskCollaboration(taskId, profile),
  );

  ipcMain.handle(
    "link-task-collaboration",
    (_event, input: LinkTaskCollaborationInput, profile?: string) =>
      linkTaskCollaboration(input, profile),
  );

  ipcMain.handle(
    "update-task-collaboration-execution",
    (_event, input: UpdateTaskCollaborationExecutionInput, profile?: string) =>
      updateTaskCollaborationExecution(input, profile),
  );

  ipcMain.handle("list-task-collaborations", (_event, profile?: string) =>
    listTaskCollaborations(profile),
  );

  ipcMain.handle(
    "list-recent-session-context-folders",
    (_event, limit?: number) => {
      const lim = typeof limit === "number" && limit > 0 ? limit : 20;
      const folders = getRecentSessionContextFolders(lim);
      if (folders.length < lim) {
        const cached = listCachedSessions(100);
        const seen = new Set(folders);
        for (const s of cached) {
          if (s.contextFolder && !seen.has(s.contextFolder)) {
            seen.add(s.contextFolder);
            folders.push(s.contextFolder);
            if (folders.length >= lim) break;
          }
        }
      }
      return folders;
    },
  );

  // Per-session model/provider selected from the in-chat picker. This is a
  // desktop-only routing binding and intentionally stores no API keys.
  ipcMain.handle("get-session-model-override", (_event, sessionId: string) => {
    return getSessionModelOverride(sessionId);
  });

  ipcMain.handle(
    "set-session-model-override",
    (_event, sessionId: string, override: SessionModelOverride | null) => {
      setSessionModelOverride(sessionId, override);
      return true;
    },
  );

  ipcMain.handle("delete-session", (_event, sessionId: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteDeleteSession(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        sessionId,
      );
    return deleteSession(sessionId);
  });

  ipcMain.handle("delete-sessions", (_event, sessionIds: string[]) => {
    const ids = Array.isArray(sessionIds) ? sessionIds : [];
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteDeleteSessions(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        ids,
      );
    return deleteSessions(ids);
  });

  // Profiles
  ipcMain.handle("list-profiles", async () => {
    return listProfiles();
  });
  ipcMain.handle(
    "create-profile",
    (_event, name: string, cloneFrom: string | null) => {
      return createProfile(name, cloneFrom);
    },
  );
  ipcMain.handle("delete-profile", (_event, name: string) => {
    return deleteProfile(name);
  });
  ipcMain.handle("set-active-profile", async (_event, name: string) => {
    // Persist the selection LOCALLY in every mode — the desktop tracks "which
    // profile is active" via the local ~/.hermes/active_profile. Then drop the
    // cached health flag so the next check probes the newly-active profile's
    // gateway, not the previous one's.
    setActiveProfile(name);
    notifyProfileSwitched();
    // Bring the activated profile's own gateway up if it isn't already —
    // without stopping any other profile's gateway (their bots stay online).
    if (!isRemoteMode() && !isGatewayRunning(name)) {
      startGateway(name);
    }
    return true;
  });

  // Profile appearance (desktop-only avatar + accent colour). Local-only —
  // these write to the local ~/.hermes profile dirs.
  ipcMain.handle("set-profile-color", (_event, name: string, color: string) =>
    setProfileColor(name, color),
  );
  ipcMain.handle("set-profile-name", (_event, id: string, name: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      return {
        success: false,
        error: "Agent renaming is only supported for local profiles",
      };
    }
    return setProfileName(id, name);
  });
  ipcMain.handle(
    "set-profile-avatar",
    (_event, name: string, dataUrl: string) => setProfileAvatar(name, dataUrl),
  );
  ipcMain.handle("remove-profile-avatar", (_event, name: string) =>
    removeProfileAvatar(name),
  );

  // Memory
  ipcMain.handle("read-memory", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteReadMemory(
        getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
      );
    return readMemory(profile);
  });
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteAddMemoryEntry(
          getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
          content,
        );
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteUpdateMemoryEntry(
          getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
          index,
          content,
        );
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteRemoveMemoryEntry(
          getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
          index,
        );
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteWriteUserProfile(
          getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
          content,
        );
      return writeUserProfile(content, profile);
    },
  );

  // Soul
  ipcMain.handle("read-soul", (_event, profile?: string) => {
    return readSoul(profile);
  });
  ipcMain.handle("write-soul", (_event, content: string, profile?: string) => {
    return writeSoul(content, profile);
  });
  ipcMain.handle("reset-soul", (_event, profile?: string) => {
    return resetSoul(profile);
  });

  // Tools
  ipcMain.handle("get-toolsets", (_event, profile?: string) => {
    return getToolsets(profile);
  });
  ipcMain.handle(
    "set-toolset-enabled",
    (_event, key: string, enabled: boolean, profile?: string) => {
      return setToolsetEnabled(key, enabled, profile);
    },
  );

  // Skills. Remote (HTTP) mode routes to the dashboard's /api/skills* —
  // falling through to the local CLI there showed (and mutated) the LOCAL
  // machine's skills while connected to a remote (#578's report). Bundled
  // skills stay local in remote mode: that list is the shipped catalog, not
  // per-machine state.
  ipcMain.handle("list-installed-skills", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteListInstalledSkills(activeProfileName(profile));
    return listInstalledSkills(profile);
  });
  ipcMain.handle("list-bundled-skills", () => {
    return listBundledSkills();
  });
  ipcMain.handle("get-skill-content", (_event, skillPath: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteGetSkillContent(skillPath, activeProfileName());
    return getSkillContent(skillPath);
  });
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteInstallSkill(identifier, activeProfileName(_profile));
      return installSkill(identifier, _profile);
    },
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, _profile?: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteUninstallSkill(name, activeProfileName(_profile));
      return uninstallSkill(name, _profile);
    },
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteListCachedSessions(
          getRemoteDashboardSessionConfig(conn, activeProfileName()),
          limit,
          offset,
        );
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteListCachedSessions(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        50,
      );
    try {
      return syncSessionCache();
    } catch (error) {
      console.error("sync-session-cache failed; using local cache", error);
      return listCachedSessions(50);
    }
  });
  ipcMain.handle(
    "update-session-title",
    (_event, sessionId: string, title: string) => {
      const conn = getConnectionConfig();
      if (conn.mode === "remote")
        return remoteUpdateSessionTitle(
          getRemoteDashboardSessionConfig(conn, activeProfileName()),
          sessionId,
          title,
        );
      return updateSessionTitle(sessionId, title);
    },
  );

  ipcMain.handle(
    "list-runtime-conversations",
    (_event, profile?: string, limit?: number, offset?: number) =>
      listRuntimeConversations(profile, limit, offset),
  );

  ipcMain.handle(
    "get-runtime-conversation",
    (_event, id: string, profile?: string) =>
      getRuntimeConversation(id, profile),
  );

  ipcMain.handle(
    "save-runtime-conversation",
    (_event, input: SaveRuntimeConversationInput) =>
      saveRuntimeConversation(input),
  );

  ipcMain.handle(
    "update-runtime-conversation-title",
    (_event, id: string, title: string, profile?: string) => {
      updateRuntimeConversationTitle(id, title, profile);
      return true;
    },
  );

  ipcMain.handle(
    "delete-runtime-conversation",
    (_event, id: string, profile?: string) => {
      deleteRuntimeConversation(id, profile);
      return true;
    },
  );

  ipcMain.handle("list-quick-chats", (_event, profile?: string) =>
    listQuickChats(profile),
  );
  ipcMain.handle(
    "save-quick-chats",
    (
      _event,
      chats: import("../../shared/runtime-conversations").QuickChatConversation[],
      profile?: string,
    ) => saveQuickChats(chats, profile),
  );

  // Session search
  ipcMain.handle("search-sessions", (_event, query: string, limit?: number) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteSearchSessions(
        getRemoteDashboardSessionConfig(conn, activeProfileName()),
        query,
        limit,
      );
    return searchSessions(query, limit);
  });

  // Credential Pool — profile-aware. When `profile` is omitted, the
  // credential pool helpers default to the currently active profile's
  // auth.json (see config.ts:authFilePath), so the renderer can pass an
  // explicit profile or rely on the active-profile fallback.
  ipcMain.handle("get-credential-pool", (_event, profile?: string) =>
    getCredentialPool(profile),
  );
  ipcMain.handle(
    "set-credential-pool",
    (
      _event,
      provider: string,
      entries: Array<Record<string, unknown>>,
      profile?: string,
    ) => {
      setCredentialPool(provider, entries, profile);
      return true;
    },
  );

  // Append a user-typed key as a properly-shaped credential pool
  // entry. Constructs the full upstream schema (id, label, auth_type,
  // priority, source, access_token, base_url, request_count) so the
  // engine's resolver can read it — issue #367 Bug 3.
  ipcMain.handle(
    "add-credential-pool-entry",
    (
      _event,
      provider: string,
      apiKey: string,
      label: string,
      profile?: string,
    ) => {
      return addCredentialPoolEntry(provider, apiKey, label, profile);
    },
  );

  // Models
  ipcMain.handle("list-models", () => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote") {
      if (conn.remoteChatTransport === "legacy") {
        throw new Error(
          "Remote model library reads require dashboard transport.",
        );
      }
      return remoteListModels(
        getRemoteDashboardSessionConfig(conn, getActiveProfileNameSync()),
      );
    }
    return listModels();
  });
  ipcMain.handle(
    "add-model",
    async (
      _event,
      name: string,
      provider: string,
      model: string,
      baseUrl: string,
      contextLength?: number,
      providerLabel?: string,
    ) => {
      const conn = getConnectionConfig();
      let addedModel: Awaited<ReturnType<typeof addModel>>;
      if (conn.mode === "remote") {
        if (conn.remoteChatTransport === "legacy") {
          throw new Error(
            "Remote model library writes require dashboard transport.",
          );
        }
        // Remote library writes don't carry the context-length override yet
        // (local-mode feature for now); the local branch persists it.
        addedModel = await remoteAddModel(
          getRemoteDashboardSessionConfig(conn, getActiveProfileNameSync()),
          name,
          provider,
          model,
          baseUrl,
        );
      } else {
        addedModel = addModel(
          name,
          provider,
          model,
          baseUrl,
          contextLength,
          providerLabel,
        );
      }
      notifyModelLibraryChanged();
      return addedModel;
    },
  );
  ipcMain.handle("remove-model", async (_event, id: string) => {
    const conn = getConnectionConfig();
    let removed: boolean;
    if (conn.mode === "remote") {
      if (conn.remoteChatTransport === "legacy") {
        throw new Error(
          "Remote model library writes require dashboard transport.",
        );
      }
      removed = await remoteRemoveModel(
        getRemoteDashboardSessionConfig(conn, getActiveProfileNameSync()),
        id,
      );
    } else {
      removed = removeModel(id);
    }
    if (removed) notifyModelLibraryChanged();
    return removed;
  });
  ipcMain.handle(
    "update-model",
    async (
      _event,
      id: string,
      fields: Record<string, string>,
      // Context-length override travels as a separate arg (it's numeric, so it
      // can't ride inside the string-only `fields`). Local-mode only for now.
      contextLength?: number | null,
    ) => {
      const conn = getConnectionConfig();
      let updated: boolean;
      if (conn.mode === "remote") {
        if (conn.remoteChatTransport === "legacy") {
          throw new Error(
            "Remote model library writes require dashboard transport.",
          );
        }
        updated = await remoteUpdateModel(
          getRemoteDashboardSessionConfig(conn, getActiveProfileNameSync()),
          id,
          fields,
        );
      } else {
        updated = updateModel(
          id,
          contextLength === undefined ? fields : { ...fields, contextLength },
        );
      }
      if (updated) notifyModelLibraryChanged();
      return updated;
    },
  );

  // Claw3D
  ipcMain.handle("claw3d-status", () => getClaw3dStatus());

  ipcMain.handle("claw3d-setup", async (event) => {
    try {
      await setupClaw3d((progress: Claw3dSetupProgress) => {
        event.sender.send("claw3d-setup-progress", progress);
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  ipcMain.handle("claw3d-get-port", () => getClaw3dPort());
  ipcMain.handle("claw3d-set-port", (_event, port: number) => {
    setClaw3dPort(port);
    return true;
  });
  ipcMain.handle("claw3d-get-ws-url", () => getClaw3dWsUrl());
  ipcMain.handle("claw3d-set-ws-url", (_event, url: string) => {
    setClaw3dWsUrl(url);
    return true;
  });

  ipcMain.handle("claw3d-start-all", (_event, profile?: string) =>
    startOfficeStack(profile, {
      getConnectionConfig,
      isGatewayRunning,
      startGateway,
      startClaw3dAll,
      stopClaw3dAll: stopClaw3d,
      waitForClaw3dReady,
    }),
  );
  ipcMain.handle("claw3d-stop-all", () => {
    stopClaw3d();
    return true;
  });
  ipcMain.handle("claw3d-get-logs", () => getClaw3dLogs());

  ipcMain.handle("claw3d-start-dev", () => startDevServer());
  ipcMain.handle("claw3d-stop-dev", () => {
    stopDevServer();
    return true;
  });
  ipcMain.handle("claw3d-start-adapter", () => startAdapter());
  ipcMain.handle("claw3d-stop-adapter", () => {
    stopAdapter();
    return true;
  });

  // Cron Jobs
  ipcMain.handle(
    "list-cron-jobs",
    (_event, includeDisabled?: boolean, profile?: string) =>
      listCronJobs(includeDisabled, profile),
  );
  ipcMain.handle(
    "create-cron-job",
    (
      _event,
      schedule: string,
      prompt?: string,
      name?: string,
      deliver?: string,
      profile?: string,
    ) => createCronJob(schedule, prompt, name, deliver, profile),
  );
  ipcMain.handle("remove-cron-job", (_event, jobId: string, profile?: string) =>
    removeCronJob(jobId, profile),
  );
  ipcMain.handle("pause-cron-job", (_event, jobId: string, profile?: string) =>
    pauseCronJob(jobId, profile),
  );
  ipcMain.handle("resume-cron-job", (_event, jobId: string, profile?: string) =>
    resumeCronJob(jobId, profile),
  );
  ipcMain.handle(
    "trigger-cron-job",
    (_event, jobId: string, profile?: string) => triggerCronJob(jobId, profile),
  );

  ipcMain.handle(
    "select-folder",
    async (event, options?: { title?: unknown; buttonLabel?: unknown }) => {
      const title =
        typeof options?.title === "string" && options.title.trim()
          ? options.title.trim().slice(0, 100)
          : "选择项目文件夹";
      const buttonLabel =
        typeof options?.buttonLabel === "string" && options.buttonLabel.trim()
          ? options.buttonLabel.trim().slice(0, 60)
          : "选择文件夹";
      const win = BrowserWindow.fromWebContents(event.sender);
      const result = win
        ? await dialog.showOpenDialog(win, {
            title,
            buttonLabel,
            properties: ["openDirectory", "createDirectory"],
          })
        : await dialog.showOpenDialog({
            title,
            buttonLabel,
            properties: ["openDirectory", "createDirectory"],
          });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    },
  );

  ipcMain.handle("create-project-folder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const dialogOptions: SaveDialogOptions = {
      title: "新建空白项目文件夹",
      buttonLabel: "创建文件夹",
      defaultPath: join(app.getPath("documents"), "新项目"),
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const result = win
      ? await dialog.showSaveDialog(win, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) return null;

    try {
      await mkdir(result.filePath);
      return result.filePath;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法创建项目文件夹：${detail}`);
    }
  });

  ipcMain.handle("list-project-folders", () => listProjectFolders());
  ipcMain.handle("register-project-folder", (_event, folderPath: string) =>
    registerProjectFolder(folderPath),
  );
  ipcMain.handle(
    "update-project-folder",
    (_event, input: UpdateProjectFolderInput) => updateProjectFolder(input),
  );
  ipcMain.handle(
    "remove-project-folder",
    (_event, folderPath: string, profile?: string) => {
      clearSessionContextFolderPath(folderPath);
      clearRuntimeConversationWorkspace(folderPath, profile);
      removeProjectFolder(folderPath);
      return true;
    },
  );
  ipcMain.handle("list-archived-items", (_event, profile?: string) =>
    listArchivedItems(profile),
  );
  ipcMain.handle(
    "archive-item",
    (_event, input: ArchiveItemInput, profile?: string) =>
      archiveItem(input, profile),
  );
  ipcMain.handle(
    "restore-archived-item",
    (_event, id: string, profile?: string) => restoreArchivedItem(id, profile),
  );
  ipcMain.handle(
    "delete-archived-item",
    async (_event, id: string, profile?: string) => {
      const item = getArchivedItem(id, profile);
      if (!item) return false;
      if (item.kind === "task") {
        if (item.runtimeId) deleteRuntimeConversation(item.targetId, profile);
        else {
          const conn = getConnectionConfig();
          if (conn.mode === "remote") {
            await remoteDeleteSession(
              getRemoteDashboardSessionConfig(conn, activeProfileName()),
              item.targetId,
            );
          } else {
            await deleteSession(item.targetId);
          }
        }
      } else {
        // Project deletion means removing Agents One's registration only. Never
        // delete or mutate the user's project directory. Unlink its tasks so
        // they return to Chats instead of recreating a session-derived project.
        clearSessionContextFolderPath(item.targetId);
        clearRuntimeConversationWorkspace(item.targetId, profile);
        removeProjectFolder(item.targetId);
      }
      restoreArchivedItem(id, profile);
      return true;
    },
  );

  ipcMain.handle(
    "prepare-project-context",
    async (_event, folderPath: string) => {
      if (typeof folderPath !== "string" || !folderPath.trim()) return null;
      return prepareProjectContextAttachment(folderPath);
    },
  );

  // Read directory contents for worktree panel
  ipcMain.handle(
    "read-directory",
    async (
      _event,
      dirPath: string,
    ): Promise<{ name: string; isDirectory: boolean }[] | null> => {
      const conn = getConnectionConfig();
      const isLocalWindowsPath =
        /^[a-zA-Z]:[\\/]/.test(dirPath) || /^\\\\/.test(dirPath);
      if (conn.mode === "remote" && !isLocalWindowsPath) {
        return null;
      }
      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        return entries
          .map((entry) => ({
            name: entry.name,
            isDirectory: entry.isDirectory(),
          }))
          .sort(
            (a, b) =>
              Number(b.isDirectory) - Number(a.isDirectory) ||
              a.name.localeCompare(b.name),
          );
      } catch {
        return null;
      }
    },
  );

  // Read file contents for file viewer
  ipcMain.handle(
    "read-file",
    async (
      _event,
      filePath: string,
      maxBytes?: number,
    ): Promise<{ content: string; truncated: boolean } | null> => {
      try {
        const limit =
          typeof maxBytes === "number" &&
          Number.isFinite(maxBytes) &&
          maxBytes > 0
            ? Math.min(Math.floor(maxBytes), 1024 * 1024)
            : 102400; // Default 100KB, hard cap 1MB
        const handle = await openFile(filePath, "r");
        try {
          const info = await handle.stat();
          if (!info.isFile()) return null;
          const bytesToRead = Math.min(info.size, limit);
          const buffer = Buffer.alloc(bytesToRead);
          const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
          return {
            content: buffer.subarray(0, bytesRead).toString("utf-8"),
            truncated: info.size > bytesRead,
          };
        } finally {
          await handle.close();
        }
      } catch {
        return null;
      }
    },
  );

  // Open file in default application
  ipcMain.handle("open-file-in-editor", async (_event, filePath: string) => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("open-terminal", async (_event, dirPath: string) => {
    if (isRemoteOnlyMode()) return false;
    if (typeof dirPath !== "string" || dirPath.trim().length === 0)
      return false;
    try {
      const info = await stat(dirPath);
      if (!info.isDirectory()) return false;
      return await openTerminalInDirectory(dirPath);
    } catch {
      return false;
    }
  });

  // Read image file as data URL for preview
  ipcMain.handle(
    "read-image-file",
    async (_event, filePath: string): Promise<string | null> => {
      try {
        const buffer = await readFile(filePath);
        const ext = extname(filePath).toLowerCase().slice(1);
        const mimeType =
          ext === "png"
            ? "image/png"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : ext === "svg"
                    ? "image/svg+xml"
                    : ext === "bmp"
                      ? "image/bmp"
                      : ext === "ico"
                        ? "image/x-icon"
                        : "application/octet-stream";
        const base64 = buffer.toString("base64");
        return `data:${mimeType};base64,${base64}`;
      } catch {
        return null;
      }
    },
  );
  // Shell
  ipcMain.handle("open-external", (_event, url: string) => {
    openExternalUrl(url);
  });

  // Agents One portable backup / restore. The archive is desktop-owned and
  // intentionally independent from the optional Hermes Python installation.
  ipcMain.handle("export-agents-one-backup", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const stamp = new Date().toISOString().slice(0, 10);
    const options: SaveDialogOptions = {
      title: "导出 Agents One 备份",
      buttonLabel: "导出备份",
      defaultPath: join(
        app.getPath("documents"),
        `Agents-One-Backup-${stamp}.agents-one-backup`,
      ),
      filters: [
        { name: "Agents One 备份", extensions: ["agents-one-backup"] },
      ],
      properties: ["createDirectory", "showOverwriteConfirmation"],
    };
    const selected = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (selected.canceled || !selected.filePath) {
      return { success: false, canceled: true };
    }
    if (!(await stopTaskScheduleRunnerAndWait())) {
      startTaskScheduleRunner();
      return {
        success: false,
        error: "计划任务仍在写入数据，请稍后重试导出。",
      };
    }
    let exportWriteLocked = false;
    try {
      if (activeRuns.size > 0 || activeAgentRuntimeTaskCount() > 0) {
        return {
          success: false,
          error: "仍有聊天或任务正在运行，请等待完成或停止后再导出备份。",
        };
      }
      beginAgentsOneRestoreWriteLock();
      exportWriteLocked = true;
      for (const window of BrowserWindow.getAllWindows()) window.setEnabled(false);
      closeDbConnection();
      return await exportAgentsOneBackupTo(selected.filePath, {
        appVersion: app.getVersion(),
      });
    } finally {
      if (exportWriteLocked) {
        endAgentsOneTemporaryWriteLock();
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.setEnabled(true);
        }
      }
      startTaskScheduleRunner();
    }
  });
  ipcMain.handle(
    "inspect-agents-one-backup",
    (_event, archivePath: string) => inspectAgentsOneBackup(archivePath),
  );
  ipcMain.handle(
    "restore-agents-one-backup",
    async (_event, archivePath: string) => {
      const inspection = await inspectAgentsOneBackup(archivePath);
      if (!inspection.success) return inspection;

      // Stop all desktop and gateway writers before touching profile data.
      if (!(await stopTaskScheduleRunnerAndWait())) {
        startTaskScheduleRunner();
        return {
          success: false,
          error: "计划任务仍在写入数据，恢复未开始。",
        };
      }
      let relaunchRequired = false;
      try {
        relaunchRequired = true;
        beginAgentsOneRestoreWriteLock();
        for (const window of BrowserWindow.getAllWindows()) {
          // Destroying the old renderer is the global write gate: no delayed
          // save/invoke can race the restore. `window-all-closed` is suppressed
          // while the restore lock is active, and this main-process handler
          // continues until it relaunches the application.
          window.destroy();
        }
        for (const abort of activeRuns.values()) abort();
        activeRuns.clear();
        await cancelAllAgentRuntimeTasks();
        stopAllDashboards();
        const profiles = await listProfiles();
        for (const profile of profiles) {
          if (!profile.gatewayRunning) continue;
          if (!(await stopGatewayAndWait(profile.id))) {
            return {
              success: false,
              error: `无法安全停止配置档案 ${profile.name} 的本地网关，恢复未开始。`,
            };
          }
        }
        closeDbConnection();
        return await restoreAgentsOneBackupFrom(archivePath);
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (relaunchRequired) {
          // A fresh process is the only reliable way to reopen every profile
          // database, gateway and Runtime against the restored snapshot.
          setTimeout(() => relaunchApp(), 1_000);
        } else {
          startTaskScheduleRunner();
        }
      }
    },
  );

  // Debug dump
  ipcMain.handle("run-hermes-dump", () => {
    return runHermesDump();
  });

  // MCP servers
  ipcMain.handle("list-mcp-servers", (_event, profile?: string) =>
    listMcpServers(profile),
  );
  ipcMain.handle(
    "add-mcp-server",
    (_event, input: McpServerInput, profile?: string) =>
      addMcpServer(input, profile),
  );
  ipcMain.handle(
    "remove-mcp-server",
    (_event, name: string, profile?: string) => removeMcpServer(name, profile),
  );
  ipcMain.handle(
    "set-mcp-server-enabled",
    (_event, name: string, enabled: boolean, profile?: string) =>
      setMcpServerEnabled(name, enabled, profile),
  );
  ipcMain.handle("test-mcp-server", (_event, name: string, profile?: string) =>
    testMcpServer(name, profile),
  );
  ipcMain.handle("list-mcp-catalog", (_event, profile?: string) =>
    listMcpCatalog(profile),
  );
  ipcMain.handle(
    "install-mcp-catalog-entry",
    (_event, name: string, env?: Record<string, string>, profile?: string) =>
      installMcpCatalogEntry(name, env, profile),
  );

  // Discover marketplace (community registry)
  ipcMain.handle("registry-fetch", (_event, force?: boolean) =>
    fetchRegistry(!!force),
  );
  ipcMain.handle("registry-fetch-models", (_event, force?: boolean) =>
    fetchModelRegistry(!!force),
  );
  ipcMain.handle("registry-list-installed", (_event, profile?: string) =>
    listInstalledRegistry(profile),
  );
  ipcMain.handle(
    "registry-detail",
    (_event, kind: RegistryKind, item: RegistryItem) =>
      fetchRegistryDetail(kind, item),
  );
  ipcMain.handle(
    "registry-install",
    (_event, kind: RegistryKind, item: RegistryItem, profile?: string) =>
      installRegistryItem(kind, item, profile),
  );

  // Memory providers
  ipcMain.handle("discover-memory-providers", (_event, profile?: string) => {
    const conn = getConnectionConfig();
    if (conn.mode === "remote")
      return remoteDiscoverMemoryProviders(
        getRemoteDashboardSessionConfig(conn, activeProfileName(profile)),
      );
    return discoverMemoryProviders(profile);
  });

  // Log viewer
  ipcMain.handle("read-logs", (_event, logFile?: string, lines?: number) => {
    return readLogs(logFile, lines);
  });
}
