import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  Menu,
  dialog,
  clipboard,
  type SaveDialogOptions,
} from "electron";
import { basename, extname, join } from "path";
import { randomUUID } from "crypto";
import { mkdir, open as openFile, readdir, readFile, stat } from "fs/promises";
import type { Attachment } from "../../shared/attachments";
import type { SessionModelOverride } from "../../shared/model-override";
import type { AppLocale } from "../../shared/i18n/types";
import type {
  TrayCompletionData,
  TrayCompletionStatus,
} from "../../shared/tray-completion";
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
  getSessionContextWorkspace,
  setSessionContextFolder,
  setSessionContextWorkspace,
  clearSessionContextFolderPath,
  clearSessionContextWorkspaceId,
  getRecentSessionContextFolders,
  getRecentSessionContextWorkspaces,
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
  isAuthorizedMediaPath,
  isAuthorizedProjectPath,
  normalizeMediaPath,
} from "../media";
import { openTerminalInDirectory } from "../terminal-launcher";
import {
  authorizeUserSelectedWorkspace,
  resolveAuthorizedWorkspaceId,
  resolveAuthorizedWorkspaceRelativePath,
  isAuthorizedWorkspacePath,
  isAuthorizedWorkspaceRoot,
} from "../workspace-authority";
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
  discoverHermesInstallations,
  validateHermesHome,
  setHermesHomeOverride,
  getHermesVersion,
  clearVersionCache,
  runHermesDoctor,
  runHermesUpdate,
  runHermesDump,
  discoverMemoryProviders,
  type InstallProgress,
} from "../installer";
import { readAgentsOneLogs } from "../agents-one-logs";
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
  getVoiceInputPublicConfig,
  saveVoiceInputConfig,
  testVoiceInputService,
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
  sendStreamingAudio,
  startStreamingTranscription,
  stopStreamingTranscription,
  type StreamingCaptureAudit,
} from "../voice-stream";
import {
  createDashboardWorkspaceSession,
  getDashboardStatus,
  setDashboardWorkspaceCwd,
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
  getPublicConnectionConfig,
  getPlatformEnabled,
  setPlatformEnabled,
  getApiServerKeyStatus,
  invalidateSecretsCache,
} from "../config";
import {
  getAuxiliaryConfig,
  setAuxiliaryTask,
  resetAuxiliaryToAuto,
} from "../auxiliary-config";
import {
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
  forkRuntimeConversation,
  getRuntimeConversation,
  listQuickChats,
  listRuntimeConversations,
  saveQuickChats,
  saveRuntimeConversation,
  updateRuntimeConversationTitle,
  clearRuntimeConversationWorkspace,
  clearRuntimeConversationWorkspaceId,
} from "../runtime-conversation-store";
import { detectLocalCliPaths } from "../local-cli-detect";
import { listRuntimeAdapterManifests } from "../runtime-adapters/registry";
import { discoverRuntimeSkills } from "../runtime-skills";
import { homedir } from "os";
import {
  activeAgentRuntimeTaskCount,
  cancelAgentRuntimeTask,
  cancelAllAgentRuntimeTasks,
  clearWebAgentRuntimeLogin,
  executeAgentRuntimeCommand,
  stopAcceptingAgentRuntimeTasks,
  getAgentRuntimeCredentialStatus,
  getAgentRuntimeDiagnostics,
  getAgentRuntimeRun,
  getAgentRuntimeCommandCatalog,
  listAgentRuntimes,
  openWebAgentRuntime,
  probeAgentRuntime,
  probeAgentRuntimeDraft,
  retryAgentRuntimeArtifact,
  resumeWebAgentRuntimeRun,
  resolveAgentRuntimeArtifactPath,
  removeAgentRuntime,
  saveAgentRuntime,
  saveAgentRuntimeAppearance,
  setAgentRuntimeBearerToken,
  setAgentRuntimeWorkspaceGatewayToken,
  startAgentRuntimeTask,
  toRendererAgentRuntimeRun,
  updateWebAgentPolicy,
  webAgentPolicyStatus,
} from "../agent-runtimes";
import { getPiModelContextWindow } from "../pi-runtime";
import type {
  AgentRuntimeDraft,
  AgentRuntimeAppearance,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import type { RuntimeCommandRequest } from "../../shared/runtime-commands";
import {
  createAgentsOneConnectPairingSession,
  getAgentsOneConnectPairingStatus,
  consumeAgentsOneConnectPairingSession,
  claimAgentsOneConnectPairingCode,
  previewAgentsOneConnectPairingCode,
  completeAgentsOneConnectPairingPreview,
} from "../agents-one-connect";
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
  listProjectWorkspaceCapabilities,
  projectWorkspaceCapability,
  registerProjectFolder,
  removeProjectFolder,
  removeProjectWorkspace,
  resolveProjectFolderPath,
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
  readLocalGatewayPlatformStates,
  testDesktopMessagingPlatform,
} from "../messaging-platforms";
import { getAppLocale, setAppLocale } from "../locale";

export interface ActiveChatRun {
  abort: () => void;
  notifyCancelled: () => void;
  title: string;
  projectName: string;
  startedAt: number;
}

export interface IpcContext {
  activeRuns: Map<string, ActiveChatRun>;
  getMainWindow: () => BrowserWindow | null;
  notifyConnectionConfigChanged: () => void;
  notifyModelLibraryChanged: () => void;
  openExternalUrl: (rawUrl: unknown) => void;
  onChatRunFinished?: (data: TrayCompletionData) => void;
}

function legacyChatFailureStatus(error: string): TrayCompletionStatus {
  if (/cancel|abort|取消|中止/i.test(error)) return "cancelled";
  if (/tim(?:e|ed)[ -]?out|timeout|deadline|超时/i.test(error)) {
    return "timed_out";
  }
  return "failed";
}

function compactTrayCompletionDetail(detail: string): string {
  return detail.replace(/\s+/g, " ").trim().slice(0, 120);
}

function activeChatProjectName(
  contextWorkspaceId?: string,
  contextFolder?: string,
): string {
  const registered = contextWorkspaceId
    ? listProjectFolders().find((folder) => folder.id === contextWorkspaceId)
    : undefined;
  const value = registered?.name || contextFolder?.trim() || "";
  if (!value) return "未关联项目";
  return basename(value.replace(/[\\/]+$/, "")) || value;
}

type ClaimedConnectPairing = Awaited<
  ReturnType<typeof claimAgentsOneConnectPairingCode>
>;

function saveClaimedConnectRuntime(
  draft: AgentRuntimeDraft,
  claimed: ClaimedConnectPairing,
): ReturnType<typeof saveAgentRuntime> {
  const saved = saveAgentRuntime({
    ...draft,
    connectionProfile: "managed-connect",
    id: draft.id.trim() || claimed.runtimeId,
    name: draft.name.trim() || claimed.displayName,
    location: "remote",
    config: {
      ...draft.config,
      endpoint: claimed.connectEndpoint,
      remoteGateway: { protocol: "agents-one-v1" },
      connect: {
        endpoint: claimed.connectEndpoint,
        runtimeId: claimed.runtimeId,
        ...(claimed.deviceId ? { deviceId: claimed.deviceId } : {}),
      },
      transport: "http",
      agentTransport: "gateway-v1",
    },
  });
  setAgentRuntimeBearerToken(
    saved.id,
    claimed.runtimeTokens?.[claimed.runtimeId] || claimed.gatewayToken,
  );
  // A v1.1 Connector may publish more than one Runtime. Keep the primary
  // Runtime bound to the current wizard draft, and materialize the remaining
  // advertised identities as separate definitions with explicit routes.
  for (const descriptor of claimed.runtimes || []) {
    if (descriptor.runtimeId === claimed.runtimeId) continue;
    const additional = saveAgentRuntime({
      ...draft,
      connectionProfile: "managed-connect",
      id: descriptor.runtimeId,
      name: descriptor.displayName,
      kind: descriptor.kind || draft.kind,
      adapterId: descriptor.adapterId || draft.adapterId,
      adapterVersion: descriptor.adapterVersion || draft.adapterVersion,
      location: "remote",
      enabled: descriptor.enabled !== false,
      config: {
        ...draft.config,
        endpoint: claimed.connectEndpoint,
        remoteGateway: { protocol: "agents-one-v1" },
        connect: {
          endpoint: claimed.connectEndpoint,
          runtimeId: descriptor.runtimeId,
          ...(claimed.deviceId ? { deviceId: claimed.deviceId } : {}),
        },
        transport: "http",
        agentTransport: "gateway-v1",
      },
    });
    if (claimed.runtimeTokens?.[descriptor.runtimeId]) {
      setAgentRuntimeBearerToken(
        additional.id,
        claimed.runtimeTokens[descriptor.runtimeId],
      );
    }
  }
  return saved;
}

async function readMediaForCurrentConnection(
  filePath: string,
): Promise<string | null> {
  const normalizedPath = normalizeMediaPath(filePath);
  return readMediaAsDataUrl(normalizedPath);
}

async function mediaFileExistsForCurrentConnection(
  filePath: string,
): Promise<boolean> {
  const normalizedPath = normalizeMediaPath(filePath);
  return mediaFileExists(normalizedPath);
}

async function resolveMediaForSave(src: string): Promise<string> {
  if (src.startsWith("data:") || /^https?:\/\//i.test(src)) return src;
  const resolved = await readMediaForCurrentConnection(src);
  if (!resolved) throw new Error("媒体路径不在 Agents One 授权目录中。");
  return resolved;
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
    onChatRunFinished,
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
  ipcMain.handle("discover-hermes-installations", () =>
    discoverHermesInstallations(),
  );
  ipcMain.handle("select-hermes-home", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, {
          title: "选择已有 Hermes Agent Runtime 安装目录",
          buttonLabel: "校验此目录",
          properties: ["openDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "选择已有 Hermes Agent Runtime 安装目录",
          buttonLabel: "校验此目录",
          properties: ["openDirectory"],
        });
    return result.canceled || !result.filePaths.length
      ? null
      : result.filePaths[0];
  });
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
    return getHermesVersion();
  });
  ipcMain.handle("refresh-hermes-version", async () => {
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
          title: "Updating Hermes Agent Runtime",
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

  // Configuration (profile-aware)
  ipcMain.handle("get-locale", () => getAppLocale());
  ipcMain.handle("set-locale", (_event, locale: AppLocale) =>
    setAppLocale(locale),
  );

  ipcMain.handle("get-env", (_event, profile?: string) => {
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
    return getConfigValue(key, profile);
  });

  ipcMain.handle(
    "set-config",
    async (_event, key: string, value: string, profile?: string) => {
      setConfigValue(key, value, profile);
      return true;
    },
  );

  ipcMain.handle("get-hermes-home", (_event, profile?: string) => {
    return getHermesHome(profile);
  });

  ipcMain.handle("get-model-config", (_event, profile?: string) => {
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

  // Connection mode (local-only — plan D5)
  ipcMain.handle("is-remote-mode", () => isRemoteMode());
  ipcMain.handle("is-remote-only-mode", () => isRemoteOnlyMode());
  ipcMain.handle("get-connection-config", () => getPublicConnectionConfig());
  ipcMain.handle(
    "agents-one-connect-create-pairing",
    (_event, runtimeId: string, displayName: string) =>
      createAgentsOneConnectPairingSession(runtimeId, displayName),
  );
  ipcMain.handle(
    "agents-one-connect-pairing-status",
    (_event, sessionId: string) => getAgentsOneConnectPairingStatus(sessionId),
  );
  ipcMain.handle(
    "agents-one-connect-preview-pairing-code",
    (_event, pairingCode: string, runtimeId?: string) =>
      previewAgentsOneConnectPairingCode(pairingCode, runtimeId),
  );
  ipcMain.handle(
    "agents-one-connect-complete-pairing-preview",
    async (_event, sessionId: string, draft: AgentRuntimeDraft) => {
      const claimed = await completeAgentsOneConnectPairingPreview(sessionId);
      return saveClaimedConnectRuntime(draft, claimed);
    },
  );
  ipcMain.handle(
    "agents-one-connect-complete-pairing",
    async (_event, sessionId: string, draft: AgentRuntimeDraft) => {
      const status = await getAgentsOneConnectPairingStatus(sessionId);
      if (status.state !== "paired") {
        throw new Error("Connector 尚未完成配对。");
      }
      const material = consumeAgentsOneConnectPairingSession(sessionId);
      if (!material) throw new Error("Connect 配对会话已失效。");
      const saved = saveAgentRuntime({
        ...draft,
        connectionProfile: "managed-connect",
        location: "remote",
        config: {
          ...draft.config,
          endpoint: material.connectEndpoint,
          remoteGateway: { protocol: "agents-one-v1" },
          connect: {
            endpoint: material.connectEndpoint,
            runtimeId: material.runtimeId,
            ...(material.deviceId ? { deviceId: material.deviceId } : {}),
          },
          transport: "http",
          agentTransport: "gateway-v1",
        },
      });
      setAgentRuntimeBearerToken(
        saved.id,
        material.runtimeTokens?.[material.runtimeId] || material.gatewayToken,
      );
      return saved;
    },
  );
  ipcMain.handle(
    "agents-one-connect-claim-pairing-code",
    async (_event, pairingCode: string, draft: AgentRuntimeDraft) => {
      const claimed = await claimAgentsOneConnectPairingCode(
        pairingCode,
        draft.id.trim() || undefined,
      );
      return saveClaimedConnectRuntime(draft, claimed);
    },
  );

  // Agent runtimes deliberately expose only non-secret definitions. Hermes
  // credentials stay in the existing protected connection configuration.
  ipcMain.handle("list-agent-runtimes", () => listAgentRuntimes());
  ipcMain.handle("list-agent-runtime-adapters", () =>
    listRuntimeAdapterManifests(),
  );
  // Local CLI PATH detection (plan 1.5): the "add agent" form auto-lists the
  // Pi / Claude Code / Codex executables found on PATH for one-click paths.
  ipcMain.handle("detect-local-cli-paths", () => detectLocalCliPaths());
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
  ipcMain.handle("get-agent-runtime-diagnostics", (_event, id: string) =>
    getAgentRuntimeDiagnostics(id, app.getVersion()),
  );
  ipcMain.handle(
    "set-agent-runtime-bearer-token",
    (_event, id: string, bearerToken: string) =>
      setAgentRuntimeBearerToken(id, bearerToken),
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
  ipcMain.handle("open-web-agent-runtime", (_event, runtimeId: string) =>
    openWebAgentRuntime(runtimeId),
  );
  ipcMain.handle("clear-web-agent-runtime-login", (_event, runtimeId: string) =>
    clearWebAgentRuntimeLogin(runtimeId),
  );
  ipcMain.handle("resume-web-agent-runtime-run", (_event, runId: string) =>
    resumeWebAgentRuntimeRun(runId),
  );
  ipcMain.handle("get-web-agent-policy-status", () => webAgentPolicyStatus());
  ipcMain.handle(
    "set-web-agent-policy-enabled",
    (_event, enabled: boolean, acknowledged?: boolean) =>
      updateWebAgentPolicy(enabled, acknowledged),
  );
  ipcMain.handle(
    "start-agent-runtime-task",
    async (_event, runtimeId: string, input: AgentRuntimeTaskInput) =>
      toRendererAgentRuntimeRun(await startAgentRuntimeTask(runtimeId, input)),
  );
  ipcMain.handle(
    "get-agent-runtime-command-catalog",
    (_event, runtimeId: string, sessionId?: string) =>
      getAgentRuntimeCommandCatalog(runtimeId, sessionId),
  );
  ipcMain.handle(
    "execute-agent-runtime-command",
    (event, request: RuntimeCommandRequest) =>
      executeAgentRuntimeCommand(request, (progress) =>
        event.sender.send("agent-runtime-command-progress", progress),
      ),
  );
  ipcMain.handle("get-agent-runtime-run", async (_event, runId: string) =>
    toRendererAgentRuntimeRun(await getAgentRuntimeRun(runId)),
  );
  ipcMain.handle("cancel-agent-runtime-task", (_event, runId: string) =>
    cancelAgentRuntimeTask(runId),
  );
  ipcMain.handle(
    "retry-agent-runtime-artifact",
    async (_event, runId: string, artifactId: string) =>
      toRendererAgentRuntimeRun(
        await retryAgentRuntimeArtifact(runId, artifactId),
      ),
  );
  ipcMain.handle(
    "open-agent-runtime-artifact",
    async (_event, runId: string, artifactId: string): Promise<boolean> => {
      const artifact = resolveAgentRuntimeArtifactPath(runId, artifactId);
      if (!artifact) return false;
      return !(await shell.openPath(artifact.path));
    },
  );
  ipcMain.handle(
    "read-agent-runtime-artifact-image",
    (_event, runId: string, artifactId: string): string | null => {
      const artifact = resolveAgentRuntimeArtifactPath(runId, artifactId);
      return artifact ? readMediaAsDataUrl(artifact.path) : null;
    },
  );
  ipcMain.handle(
    "save-agent-runtime-artifact",
    async (event, runId: string, artifactId: string): Promise<boolean> => {
      const artifact = resolveAgentRuntimeArtifactPath(runId, artifactId);
      if (!artifact) return false;
      return saveMedia(
        artifact.path,
        artifact.label,
        BrowserWindow.fromWebContents(event.sender),
      );
    },
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
    (_event, id: string, input: UpdateTaskScheduleInput, profile?: string) =>
      updateTaskSchedule(id, input, profile),
  );
  ipcMain.handle(
    "set-task-schedule-enabled",
    (_event, id: string, enabled: boolean, profile?: string) =>
      setTaskScheduleEnabled(id, enabled, profile),
  );
  ipcMain.handle(
    "trigger-task-schedule",
    async (_event, id: string, profile?: string) => {
      const result = await triggerTaskSchedule(id, profile);
      return {
        ...result,
        ...(result.run ? { run: toRendererAgentRuntimeRun(result.run)! } : {}),
      };
    },
  );
  ipcMain.handle(
    "delete-task-schedule",
    (_event, id: string, profile?: string) => deleteTaskSchedule(id, profile),
  );
  ipcMain.handle("set-connection-config", () => {
    // The built-in Hermes Agent Runtime connection is local-only (plan D5); remote agents go
    // through Gateway v1, so there is no remote connection to persist here.
    notifyConnectionConfigChanged();
    return true;
  });

  ipcMain.handle("set-connection-chat-transports", () => {
    notifyConnectionConfigChanged();
    return true;
  });

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

  ipcMain.handle("get-voice-input-config", (_event, profile?: string) => {
    return getVoiceInputPublicConfig(profile);
  });

  ipcMain.handle("save-voice-input-config", (_event, input, profile?: string) =>
    saveVoiceInputConfig(input, profile),
  );

  ipcMain.handle(
    "test-voice-input-service",
    (_event, input, profile?: string) => {
      return testVoiceInputService(input, profile);
    },
  );

  ipcMain.handle(
    "start-streaming-transcription",
    async (event, profile?: string): Promise<string> =>
      startStreamingTranscription(
        event.sender.id,
        (streamEvent) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("streaming-transcription-event", streamEvent);
          }
        },
        profile,
      ),
  );

  ipcMain.handle(
    "send-streaming-audio",
    (_event, sessionId: string, audio: Uint8Array): void => {
      sendStreamingAudio(sessionId, _event.sender.id, audio);
    },
  );

  ipcMain.handle(
    "stop-streaming-transcription",
    (_event, sessionId: string, captureAudit?: StreamingCaptureAudit): void => {
      stopStreamingTranscription(sessionId, _event.sender.id, captureAudit);
    },
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
      contextWorkspaceId?: string,
    ) => {
      assertAgentsOneWritesAllowed();
      // Each conversation has a stable runId minted by the renderer. Fall back
      // to a generated id for legacy callers so the run is still tracked.
      const chatRunId = runId || `run-${randomUUID()}`;
      if (!isGatewayRunning(profile)) {
        startGateway(profile);
      }

      // Abort only a prior run under the SAME runId (a re-send in the same
      // conversation). Sibling runs — other background sessions / agents —
      // keep streaming untouched.
      const existing = activeRuns.get(chatRunId);
      if (existing) existing.abort();

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
      let terminalNoticeSent = false;
      const notifyChatRunFinished = (
        status: TrayCompletionStatus,
        detail?: string,
      ): void => {
        if (terminalNoticeSent) return;
        terminalNoticeSent = true;
        const finishedAt = Date.now();
        const runtime = listAgentRuntimes().find(
          (item) => item.kind === "hermes" && item.enabled,
        );
        const compactDetail = detail ? compactTrayCompletionDetail(detail) : "";
        onChatRunFinished?.({
          id: `chat-${status}-${chatRunId}-${finishedAt}`,
          title:
            message.replace(/\s+/g, " ").trim().slice(0, 80) || "未命名任务",
          status,
          ...(compactDetail ? { detail: compactDetail } : {}),
          runtimeName: runtime?.name || "Agent",
          runtimeKind: runtime?.kind || "hermes",
          runtimeAvatar: runtime?.avatar,
          completedAt: finishedAt,
        });
      };

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
        activeRuns.get(chatRunId)?.abort();
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
            notifyChatRunFinished("succeeded");
          },
          onSessionStarted: (sessionId) => {
            safeSend("chat-session-started", sessionId);
          },
          onError: (error) => {
            activeRuns.delete(chatRunId);
            safeSend("chat-error", error);
            rejectChat(new Error(error));
            notifyChatRunFinished(legacyChatFailureStatus(error), error);
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
        contextWorkspaceId
          ? resolveAuthorizedWorkspaceId(contextWorkspaceId) || undefined
          : contextFolder,
        modelOverride,
      );

      activeRuns.set(chatRunId, {
        abort: handle.abort,
        notifyCancelled: () =>
          notifyChatRunFinished("cancelled", "任务已由用户取消。"),
        title: message,
        projectName: activeChatProjectName(contextWorkspaceId, contextFolder),
        startedAt: chatStartTime,
      });
      return promise;
    },
  );

  ipcMain.handle("abort-chat", (_event, runId?: string) => {
    // Abort one run when given its id; with no id (legacy callers) abort all.
    if (runId) {
      const run = activeRuns.get(runId);
      run?.notifyCancelled();
      run?.abort();
      activeRuns.delete(runId);
      return;
    }
    for (const run of activeRuns.values()) {
      run.notifyCancelled();
      run.abort();
    }
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
      if (!isUrl && !isData && !isAuthorizedMediaPath(src)) return;
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

  // Gateway (local-only — plan D5)
  ipcMain.handle("start-gateway", async () => {
    return startGatewayDetailed();
  });
  ipcMain.handle("stop-gateway", async () => {
    // No profile argument → stops the active profile's gateway, leaving any
    // other profiles' gateways running.
    stopGateway(undefined, true);
    return true;
  });
  ipcMain.handle("restart-gateway", async (_event, profile?: string) => {
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
  ipcMain.handle(
    "create-dashboard-workspace-session",
    async (
      _event,
      workspaceId: string,
      profile?: string,
      messages?: Array<{ role: "assistant" | "user"; content: string }>,
    ) => {
      const workspacePath = resolveAuthorizedWorkspaceId(workspaceId);
      if (!workspacePath) return null;
      const safeMessages = Array.isArray(messages)
        ? messages
            .filter(
              (
                message,
              ): message is { role: "assistant" | "user"; content: string } =>
                Boolean(
                  message &&
                  (message.role === "assistant" || message.role === "user") &&
                  typeof message.content === "string",
                ),
            )
            .slice(-200)
            .map((message) => ({
              role: message.role,
              content: message.content.slice(0, 100_000),
            }))
        : undefined;
      return createDashboardWorkspaceSession(
        workspacePath,
        profile,
        safeMessages,
      );
    },
  );
  ipcMain.handle(
    "set-dashboard-workspace-cwd",
    async (
      _event,
      workspaceId: string,
      sessionId: string,
      profile?: string,
    ) => {
      const workspacePath = resolveAuthorizedWorkspaceId(workspaceId);
      if (
        !workspacePath ||
        typeof sessionId !== "string" ||
        !sessionId.trim()
      ) {
        return false;
      }
      await setDashboardWorkspaceCwd(workspacePath, sessionId.trim(), profile);
      return true;
    },
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
    return listSessions(limit, offset);
  });

  ipcMain.handle("get-session-messages", (_event, sessionId: string) => {
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
  ipcMain.handle("get-session-context-workspace", (_event, sessionId: string) =>
    getSessionContextWorkspace(sessionId),
  );

  ipcMain.handle(
    "set-session-context-folder",
    (_event, sessionId: string, folder: string | null) => {
      setSessionContextFolder(sessionId, folder);
      return true;
    },
  );
  ipcMain.handle(
    "set-session-context-workspace",
    (
      _event,
      sessionId: string,
      workspace: { workspaceId?: unknown; name?: unknown } | null,
    ) => {
      const workspaceId =
        typeof workspace?.workspaceId === "string"
          ? workspace.workspaceId.trim().slice(0, 128)
          : "";
      const capability = workspaceId
        ? listProjectWorkspaceCapabilities().find(
            (item) => item.id === workspaceId,
          )
        : undefined;
      setSessionContextWorkspace(
        sessionId,
        capability
          ? { workspaceId: capability.id, name: capability.name }
          : null,
      );
      return !workspaceId || Boolean(capability);
    },
  );

  ipcMain.handle(
    "save-task-collaboration",
    (_event, input: SaveTaskCollaborationInput, profile?: string) => {
      if (input.projectWorkspaceId) {
        const capability = listProjectWorkspaceCapabilities().find(
          (item) => item.id === input.projectWorkspaceId,
        );
        // A failed opaque lookup must never degrade to a renderer-provided
        // path. Legacy paths are accepted only when no capability was claimed.
        input = capability
          ? {
              ...input,
              projectWorkspaceId: capability.id,
              projectName: capability.name,
              projectFolder: undefined,
            }
          : {
              ...input,
              projectWorkspaceId: undefined,
              projectName: undefined,
              projectFolder: undefined,
            };
      }
      return saveTaskCollaboration(input, profile);
    },
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
          if (
            !s.contextWorkspaceId &&
            s.contextFolder &&
            !seen.has(s.contextFolder)
          ) {
            seen.add(s.contextFolder);
            folders.push(s.contextFolder);
            if (folders.length >= lim) break;
          }
        }
      }
      return folders;
    },
  );
  ipcMain.handle(
    "list-recent-session-context-workspaces",
    (_event, limit?: number) => {
      const lim = typeof limit === "number" && limit > 0 ? limit : 20;
      const workspaces = getRecentSessionContextWorkspaces(lim);
      const seen = new Set(
        workspaces.map((workspace) => workspace.workspaceId),
      );
      if (workspaces.length < lim) {
        for (const session of listCachedSessions(100)) {
          if (
            session.contextWorkspaceId &&
            session.contextFolder &&
            !seen.has(session.contextWorkspaceId)
          ) {
            seen.add(session.contextWorkspaceId);
            workspaces.push({
              workspaceId: session.contextWorkspaceId,
              name: session.contextFolder,
            });
            if (workspaces.length >= lim) break;
          }
        }
      }
      return workspaces;
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
    return deleteSession(sessionId);
  });

  ipcMain.handle("delete-sessions", (_event, sessionIds: string[]) => {
    const ids = Array.isArray(sessionIds) ? sessionIds : [];
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
    // Persist the selection LOCALLY — the desktop tracks "which profile is
    // active" via the local ~/.hermes/active_profile. Then drop the cached
    // health flag so the next check probes the newly-active profile's gateway,
    // not the previous one's.
    setActiveProfile(name);
    notifyProfileSwitched();
    // Bring the activated profile's own gateway up if it isn't already —
    // without stopping any other profile's gateway (their bots stay online).
    if (!isGatewayRunning(name)) {
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
    return readMemory(profile);
  });
  ipcMain.handle(
    "add-memory-entry",
    (_event, content: string, profile?: string) => {
      return addMemoryEntry(content, profile);
    },
  );
  ipcMain.handle(
    "update-memory-entry",
    (_event, index: number, content: string, profile?: string) => {
      return updateMemoryEntry(index, content, profile);
    },
  );
  ipcMain.handle(
    "remove-memory-entry",
    (_event, index: number, profile?: string) => {
      return removeMemoryEntry(index, profile);
    },
  );
  ipcMain.handle(
    "write-user-profile",
    (_event, content: string, profile?: string) => {
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

  // Skills (local-only — plan D5)
  ipcMain.handle("list-installed-skills", (_event, profile?: string) => {
    return listInstalledSkills(profile);
  });
  ipcMain.handle("list-bundled-skills", () => {
    return listBundledSkills();
  });
  ipcMain.handle("get-skill-content", (_event, skillPath: string) => {
    return getSkillContent(skillPath);
  });
  ipcMain.handle(
    "install-skill",
    (_event, identifier: string, _profile?: string) => {
      return installSkill(identifier, _profile);
    },
  );
  ipcMain.handle(
    "uninstall-skill",
    (_event, name: string, _profile?: string) => {
      return uninstallSkill(name, _profile);
    },
  );

  // Session cache (fast local cache with generated titles)
  ipcMain.handle(
    "list-cached-sessions",
    (_event, limit?: number, offset?: number) => {
      return listCachedSessions(limit, offset);
    },
  );
  ipcMain.handle("sync-session-cache", () => {
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

  ipcMain.handle(
    "fork-runtime-conversation",
    (
      _event,
      parentId: string,
      input: Parameters<typeof forkRuntimeConversation>[1],
      profile?: string,
    ) => forkRuntimeConversation(parentId, input, profile),
  );

  ipcMain.handle("list-runtime-skills", () => [
    ...discoverRuntimeSkills(join(homedir(), ".codex", "skills"), "user"),
    ...discoverRuntimeSkills(
      join(process.cwd(), ".agents", "skills"),
      "project",
    ),
  ]);

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

  // Models (local-only — plan D5)
  ipcMain.handle("list-models", () => {
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
      const addedModel = addModel(
        name,
        provider,
        model,
        baseUrl,
        contextLength,
        providerLabel,
      );
      notifyModelLibraryChanged();
      return addedModel;
    },
  );
  ipcMain.handle("remove-model", async (_event, id: string) => {
    const removed = removeModel(id);
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
      // can't ride inside the string-only `fields`).
      contextLength?: number | null,
    ) => {
      const updated = updateModel(
        id,
        contextLength === undefined ? fields : { ...fields, contextLength },
      );
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
      const selected = result.filePaths[0];
      return authorizeUserSelectedWorkspace(selected) ? selected : null;
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
      return authorizeUserSelectedWorkspace(result.filePath)
        ? result.filePath
        : null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法创建项目文件夹：${detail}`);
    }
  });

  ipcMain.handle("list-project-folders", () => listProjectFolders());
  ipcMain.handle("list-project-workspaces", () =>
    listProjectWorkspaceCapabilities(),
  );
  ipcMain.handle("register-project-folder", (_event, folderPath: string) =>
    isAuthorizedWorkspaceRoot(folderPath)
      ? registerProjectFolder(folderPath)
      : null,
  );
  ipcMain.handle("register-project-workspace", (_event, folderPath: string) =>
    projectWorkspaceCapability(
      isAuthorizedWorkspaceRoot(folderPath)
        ? registerProjectFolder(folderPath)
        : null,
    ),
  );
  ipcMain.handle(
    "update-project-folder",
    (_event, input: UpdateProjectFolderInput) => updateProjectFolder(input),
  );
  ipcMain.handle(
    "update-project-workspace",
    (_event, input: Pick<UpdateProjectFolderInput, "id" | "name" | "pinned">) =>
      projectWorkspaceCapability(
        input?.id && resolveProjectFolderPath(input.id)
          ? updateProjectFolder(input)
          : null,
      ),
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
  ipcMain.handle(
    "remove-project-workspace",
    (_event, workspaceId: string, profile?: string) => {
      if (!resolveProjectFolderPath(workspaceId)) return false;
      clearSessionContextWorkspaceId(workspaceId);
      clearRuntimeConversationWorkspaceId(workspaceId, profile);
      return removeProjectWorkspace(workspaceId);
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
    "archive-project-workspace",
    (_event, workspaceId: string, profile?: string) => {
      const capability = listProjectWorkspaceCapabilities().find(
        (item) => item.id === workspaceId,
      );
      return capability
        ? archiveItem(
            {
              kind: "project",
              targetId: capability.id,
              title: capability.name,
              projectWorkspaceId: capability.id,
            },
            profile,
          )
        : null;
    },
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
          await deleteSession(item.targetId);
        }
      } else {
        // Project deletion means removing Agents One's registration only. Never
        // delete or mutate the user's project directory. Unlink its tasks so
        // they return to Chats instead of recreating a session-derived project.
        if (item.projectWorkspaceId) {
          clearSessionContextWorkspaceId(item.projectWorkspaceId);
          clearRuntimeConversationWorkspaceId(item.projectWorkspaceId, profile);
          removeProjectWorkspace(item.projectWorkspaceId);
        } else {
          clearSessionContextFolderPath(item.targetId);
          clearRuntimeConversationWorkspace(item.targetId, profile);
          removeProjectFolder(item.targetId);
        }
      }
      restoreArchivedItem(id, profile);
      return true;
    },
  );

  ipcMain.handle(
    "prepare-project-context",
    async (_event, folderPath: string) => {
      if (typeof folderPath !== "string" || !folderPath.trim()) return null;
      if (!isAuthorizedWorkspaceRoot(folderPath)) return null;
      return prepareProjectContextAttachment(folderPath);
    },
  );
  ipcMain.handle(
    "prepare-project-workspace-context",
    async (_event, workspaceId: string) => {
      const folderPath = resolveAuthorizedWorkspaceId(workspaceId);
      return folderPath ? prepareProjectContextAttachment(folderPath) : null;
    },
  );

  // Read directory contents for worktree panel
  ipcMain.handle(
    "read-directory",
    async (
      _event,
      dirPath: string,
    ): Promise<{ name: string; isDirectory: boolean }[] | null> => {
      try {
        if (!isAuthorizedWorkspacePath(dirPath)) return null;
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
  ipcMain.handle(
    "read-workspace-directory",
    async (
      _event,
      workspaceId: string,
      relativePath = "",
    ): Promise<{ name: string; isDirectory: boolean }[] | null> => {
      const directory = resolveAuthorizedWorkspaceRelativePath(
        workspaceId,
        relativePath,
      );
      if (!directory) return null;
      try {
        const entries = await readdir(directory, { withFileTypes: true });
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
  ipcMain.handle(
    "read-workspace-file",
    async (
      _event,
      workspaceId: string,
      relativePath: string,
      maxBytes?: number,
    ): Promise<{ content: string; truncated: boolean } | null> => {
      const filePath = resolveAuthorizedWorkspaceRelativePath(
        workspaceId,
        relativePath,
      );
      if (!filePath) return null;
      try {
        const info = await stat(filePath);
        if (!info.isFile()) return null;
        const bytesToRead = Math.max(
          1,
          Math.min(
            typeof maxBytes === "number" ? maxBytes : 1024 * 1024,
            5 * 1024 * 1024,
            info.size,
          ),
        );
        const handle = await openFile(filePath, "r");
        try {
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
  ipcMain.handle(
    "read-workspace-image",
    (_event, workspaceId: string, relativePath: string): string | null => {
      const filePath = resolveAuthorizedWorkspaceRelativePath(
        workspaceId,
        relativePath,
      );
      return filePath ? readMediaAsDataUrl(filePath) : null;
    },
  );
  ipcMain.handle(
    "open-workspace-file",
    async (
      _event,
      workspaceId: string,
      relativePath: string,
    ): Promise<boolean> => {
      const filePath = resolveAuthorizedWorkspaceRelativePath(
        workspaceId,
        relativePath,
      );
      if (!filePath) return false;
      return !(await shell.openPath(filePath));
    },
  );
  ipcMain.handle(
    "open-project-workspace",
    async (_event, workspaceId: string): Promise<boolean> => {
      const folderPath = resolveAuthorizedWorkspaceId(workspaceId);
      return folderPath ? !(await shell.openPath(folderPath)) : false;
    },
  );
  ipcMain.handle(
    "open-workspace-terminal",
    async (_event, workspaceId: string): Promise<boolean> => {
      const directory = resolveAuthorizedWorkspaceRelativePath(workspaceId);
      return directory ? openTerminalInDirectory(directory) : false;
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
        if (
          !isAuthorizedMediaPath(filePath) &&
          !isAuthorizedWorkspacePath(filePath)
        ) {
          return null;
        }
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
      if (
        !isAuthorizedMediaPath(filePath) &&
        !isAuthorizedWorkspacePath(filePath)
      ) {
        return false;
      }
      await shell.openPath(normalizeMediaPath(filePath));
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle("open-terminal", async (_event, dirPath: string) => {
    if (typeof dirPath !== "string" || dirPath.trim().length === 0)
      return false;
    try {
      if (
        !isAuthorizedProjectPath(dirPath) &&
        !isAuthorizedWorkspacePath(dirPath)
      ) {
        return false;
      }
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
        if (
          !isAuthorizedMediaPath(filePath) &&
          !isAuthorizedWorkspacePath(filePath)
        ) {
          return null;
        }
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
  // intentionally independent from the optional Hermes Agent Runtime Python installation.
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
      filters: [{ name: "Agents One 备份", extensions: ["agents-one-backup"] }],
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
      for (const window of BrowserWindow.getAllWindows())
        window.setEnabled(false);
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
  ipcMain.handle("inspect-agents-one-backup", (_event, archivePath: string) =>
    inspectAgentsOneBackup(archivePath),
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
        stopAcceptingAgentRuntimeTasks();
        for (const window of BrowserWindow.getAllWindows()) {
          // Destroying the old renderer is the global write gate: no delayed
          // save/invoke can race the restore. `window-all-closed` is suppressed
          // while the restore lock is active, and this main-process handler
          // continues until it relaunches the application.
          window.destroy();
        }
        for (const run of activeRuns.values()) run.abort();
        activeRuns.clear();
        const activeRuntimeCount = activeAgentRuntimeTaskCount();
        const cancelledRuntimeCount = await cancelAllAgentRuntimeTasks();
        if (
          activeAgentRuntimeTaskCount() > 0 ||
          cancelledRuntimeCount < activeRuntimeCount
        ) {
          return {
            success: false,
            error:
              "仍有 Runtime 进程未确认退出，恢复未开始。请稍后重试或结束对应本地 CLI 进程。",
          };
        }
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
    return discoverMemoryProviders(profile);
  });

  // Agents One diagnostic log viewer
  ipcMain.handle(
    "read-agents-one-diagnostics",
    (_event, logFile?: string, lines?: number) => {
      return readAgentsOneLogs(logFile, lines);
    },
  );
}
