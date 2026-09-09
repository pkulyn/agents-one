import type { AppLocale } from "../shared/i18n/types";
import type { Attachment } from "../shared/attachments";
import type { SessionModelOverride } from "../shared/model-override";
import type { DesktopSessionContinuationItem } from "../shared/session-continuation";
import type { DesktopSessionLocalError } from "../shared/session-continuation";
import type {
  RegistryKind,
  RegistryItem,
  RegistryCatalog,
  RegistryDetail,
  ModelRegistry,
} from "../shared/registry";
import type {
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
} from "../shared/messaging-platforms";
import type { ChatToolEvent } from "../shared/chat-stream";
import type { GpuPreferenceMode, GpuStatus } from "../shared/gpu";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeDiagnostics,
  AgentRuntimeDraft,
  AgentRuntimeAppearance,
  AgentRuntimeProbe,
  AgentRuntimeRun,
  AgentRuntimeTaskInput,
} from "../shared/agent-runtimes";
import type { ConnectPairingPreview } from "../shared/agents-one-connect";
import type {
  RuntimeCommandCatalogSnapshot,
  RuntimeCommandProgress,
  RuntimeCommandRequest,
  RuntimeCommandResult,
} from "../shared/runtime-commands";
import type {
  ProjectFolderRecord,
  ProjectWorkspaceCapability,
  UpdateProjectFolderInput,
} from "../shared/project-folders";
import type { ArchivedItem, ArchiveItemInput } from "../shared/archives";
import type {
  CreateTaskScheduleInput,
  TaskSchedule,
  TaskScheduleRunCompletedEvent,
  TaskScheduleRunStartedEvent,
  TaskScheduleTriggerResult,
  UpdateTaskScheduleInput,
} from "../shared/task-schedules";
import type {
  QuickChatConversation,
  RuntimeConversation,
  RuntimeConversationSummary,
  SaveRuntimeConversationInput,
} from "../shared/runtime-conversations";
import type {
  AgentsOneBackupInspection,
  AgentsOneBackupResult,
  AgentsOneRestoreResult,
} from "../shared/agents-one-backup";
import type { RuntimeSkillDescriptor } from "../shared/runtime-skills";
import type { AgentRuntimeAdapterManifest } from "../shared/runtime-adapters";
import type { TrayMenuAction, TrayMenuData } from "../shared/tray-menu";
import type { TrayCompletionData } from "../shared/tray-completion";

interface ElectronAPI {
  process: {
    platform: NodeJS.Platform;
    versions: {
      chrome: string;
      electron: string;
      node: string;
    };
  };
}

interface InstallStatus {
  installed: boolean;
  configured: boolean;
  hasApiKey: boolean;
  verified: boolean;
  activeProfile?: string;
}

interface InstallProgress {
  step: number;
  totalSteps: number;
  title: string;
  detail: string;
  log: string;
}

interface ConfigHealthIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  detail?: string;
  locations: string[];
  autoFixable: boolean;
  fixDescription?: string;
  fixLocation?: "providers" | "models" | ".env" | "config.yaml" | "setup";
  context?: Record<string, string>;
}

interface ConfigHealthReport {
  ranAt: number;
  profile: string;
  issues: ConfigHealthIssue[];
  summary: { errors: number; warnings: number; infos: number };
}

interface ConfigFixLogEntry {
  ts: number;
  issueCode: string;
  action: "migrate" | "autofix" | "manual-fix";
  from?: string;
  to?: string;
  profile?: string;
  valueMasked?: string;
  detail?: string;
}

interface GatewayStartResult {
  success: boolean;
  running: boolean;
  alreadyRunning?: boolean;
  error?: string;
  logPath?: string;
}

interface DashboardConnection {
  baseUrl: string;
  wsUrl: string;
  token: string;
  mode: "local";
  profile?: string;
  pid?: number;
  port?: number;
  logPath?: string;
  alreadyRunning?: boolean;
}

interface DashboardStatus {
  supported: boolean;
  running: boolean;
  connection?: DashboardConnection;
  error?: string;
  logPath?: string;
}

/**
 * Shape of a credential-pool entry as the upstream engine expects
 * (issue #367). Old entries written by the renderer with just
 * `{key, label}` are still readable via the optional `key` field.
 * New entries written from the UI use the canonical shape.
 */
interface CredentialPoolEntry {
  id?: string;
  label?: string;
  auth_type?: "api_key" | "oauth_device_code" | string;
  priority?: number;
  source?: string;
  access_token?: string;
  refresh_token?: string;
  api_key?: string;
  base_url?: string;
  request_count?: number;
  /** Legacy field for backward compat with old auth.json shapes. */
  key?: string;
}

interface AgentsOneAPI {
  // Installation
  checkInstall: () => Promise<InstallStatus>;
  verifyInstall: () => Promise<boolean>;
  startInstall: () => Promise<{ success: boolean; error?: string }>;
  inspectInstallTarget: () => Promise<{
    hermesHome: string;
    repoPath: string;
    state: "fresh" | "update" | "replace";
  }>;
  discoverHermesInstallations: () => Promise<
    Array<{
      home: string;
      repoPath: string;
      pythonPath: string;
      scriptPath: string;
      source: "active-home" | "environment" | "default-home" | "path";
      valid: boolean;
      executableAvailable: boolean;
      configState: "configured" | "missing" | "invalid";
      apiState: "unknown" | "healthy" | "unreachable" | "not-running";
      version?: string;
    }>
  >;
  selectHermesHome: () => Promise<string | null>;
  validateHermesHome: (dir: string) => Promise<boolean>;
  adoptHermesHome: (dir: string) => Promise<boolean>;
  quitApp: () => Promise<void>;
  closeTrayComposer: () => void;
  resizeTrayComposer: (height: number) => void;
  getTrayMenuData: () => Promise<TrayMenuData>;
  onTrayMenuData: (callback: (data: TrayMenuData) => void) => () => void;
  sendTrayMenuAction: (action: TrayMenuAction) => void;
  resizeTrayMenu: (width: number, height: number) => void;
  getGpuStatus: () => Promise<GpuStatus>;
  reenableGpu: () => Promise<boolean>;
  setGpuPreference: (mode: GpuPreferenceMode) => Promise<boolean>;
  relaunchApp: () => Promise<void>;
  onInstallProgress: (
    callback: (progress: InstallProgress) => void,
  ) => () => void;

  // Hermes engine info
  getHermesVersion: () => Promise<string | null>;
  refreshHermesVersion: () => Promise<string | null>;
  runHermesDoctor: () => Promise<string>;
  runHermesUpdate: () => Promise<{ success: boolean; error?: string }>;

  // OpenClaw migration

  getLocale: () => Promise<AppLocale>;
  setLocale: (locale: AppLocale) => Promise<AppLocale>;

  // Configuration (profile-aware)
  getEnv: (profile?: string) => Promise<Record<string, string>>;
  setEnv: (key: string, value: string, profile?: string) => Promise<boolean>;
  getVoiceInputConfig: (profile?: string) => Promise<{
    enabled: boolean;
    url: string;
    hasApiKey: boolean;
    configured: boolean;
  }>;
  saveVoiceInputConfig: (
    input: {
      enabled: boolean;
      url: string;
      apiKey?: string;
      clearApiKey?: boolean;
    },
    profile?: string,
  ) => Promise<{
    enabled: boolean;
    url: string;
    hasApiKey: boolean;
    configured: boolean;
  }>;
  testVoiceInputService: (
    input: {
      url: string;
      apiKey?: string;
    },
    profile?: string,
  ) => Promise<{
    ok: boolean;
    message: string;
    version?: string;
    streamBackend?: string;
  }>;
  validateChatReadiness: (profile?: string) => Promise<{
    ok: boolean;
    code?:
      | "NO_ACTIVE_MODEL"
      | "NO_PROVIDER"
      | "NO_BASE_URL"
      | "MISSING_API_KEY"
      | "GATEWAY_DOWN";
    message?: string;
    fixLocation?: "providers" | "models" | "gateway" | "setup";
    expectedEnvKey?: string;
  }>;

  // Config-health audit (Diagnose section)
  getConfigHealth: (profile?: string) => Promise<ConfigHealthReport>;
  rerunConfigHealth: (profile?: string) => Promise<ConfigHealthReport>;
  autofixConfigIssue: (
    code: string,
    profile?: string,
    context?: Record<string, string>,
  ) => Promise<{ ok: boolean; message?: string }>;
  getConfigFixLog: (maxEntries?: number) => Promise<ConfigFixLogEntry[]>;
  getConfig: (key: string, profile?: string) => Promise<string | null>;
  setConfig: (key: string, value: string, profile?: string) => Promise<boolean>;
  getHermesHome: (profile?: string) => Promise<string>;
  getModelConfig: (
    profile?: string,
  ) => Promise<{ provider: string; model: string; baseUrl: string }>;
  getAuxiliaryConfig: (
    profile?: string,
  ) => Promise<
    { task: string; provider: string; model: string; baseUrl: string }[]
  >;
  setAuxiliaryTask: (
    task: string,
    cfg: { provider: string; model: string; baseUrl: string },
    profile?: string,
  ) => Promise<boolean>;
  resetAuxiliaryConfig: (profile?: string) => Promise<boolean>;
  setModelConfig: (
    provider: string,
    model: string,
    baseUrl: string,
    profile?: string,
  ) => Promise<boolean>;

  // Connection mode (local / remote)
  isRemoteMode: () => Promise<boolean>;
  isRemoteOnlyMode: () => Promise<boolean>;
  createAgentsOneConnectPairing: (
    runtimeId: string,
    displayName: string,
  ) => Promise<{
    sessionId: string;
    pairingCode: string;
    runtimeId: string;
    displayName: string;
    expiresAt: number;
    connectEndpoint: string;
    tunnelEndpoint: string;
  }>;
  getAgentsOneConnectPairingStatus: (sessionId: string) => Promise<{
    sessionId: string;
    runtimeId: string;
    displayName: string;
    state: "pending" | "paired" | "expired";
    expiresAt: number;
    deviceId?: string;
  }>;
  completeAgentsOneConnectPairing: (
    sessionId: string,
    draft: AgentRuntimeDraft,
  ) => Promise<AgentRuntimeDefinition>;
  previewAgentsOneConnectPairingCode: (
    pairingCode: string,
    runtimeId?: string,
  ) => Promise<ConnectPairingPreview>;
  completeAgentsOneConnectPairingPreview: (
    sessionId: string,
    draft: AgentRuntimeDraft,
  ) => Promise<AgentRuntimeDefinition>;
  claimAgentsOneConnectPairingCode: (
    pairingCode: string,
    draft: AgentRuntimeDraft,
  ) => Promise<AgentRuntimeDefinition>;
  listAgentRuntimes: () => Promise<AgentRuntimeDefinition[]>;
  listAgentRuntimeAdapters: () => Promise<AgentRuntimeAdapterManifest[]>;
  detectLocalCliPaths: () => Promise<Record<string, string | null>>;
  getAgentRuntimeModelContextWindow: (
    runtimeId: string,
    provider: string,
    model: string,
    profile?: string,
  ) => Promise<number | null>;
  saveAgentRuntime: (
    draft: AgentRuntimeDraft,
  ) => Promise<AgentRuntimeDefinition>;
  saveAgentRuntimeAppearance: (
    id: string,
    appearance: AgentRuntimeAppearance,
  ) => Promise<AgentRuntimeDefinition>;
  removeAgentRuntime: (id: string) => Promise<boolean>;
  getAgentRuntimeCredentialStatus: (
    id: string,
  ) => Promise<{ required: boolean; configured: boolean }>;
  getAgentRuntimeDiagnostics: (id: string) => Promise<AgentRuntimeDiagnostics>;
  setAgentRuntimeBearerToken: (
    id: string,
    bearerToken: string,
  ) => Promise<{ configured: true }>;
  setAgentRuntimeWorkspaceGatewayToken: (
    id: string,
    bearerToken: string,
  ) => Promise<{ configured: true }>;
  probeAgentRuntime: (id: string) => Promise<AgentRuntimeProbe>;
  probeAgentRuntimeDraft: (
    draft: AgentRuntimeDraft,
    bearerToken?: string,
  ) => Promise<AgentRuntimeProbe>;
  openWebAgentRuntime: (runtimeId: string) => Promise<void>;
  clearWebAgentRuntimeLogin: (runtimeId: string) => Promise<void>;
  resumeWebAgentRuntimeRun: (runId: string) => Promise<boolean>;
  startAgentRuntimeTask: (
    runtimeId: string,
    input: AgentRuntimeTaskInput,
  ) => Promise<AgentRuntimeRun>;
  getAgentRuntimeCommandCatalog: (
    runtimeId: string,
    sessionId?: string,
  ) => Promise<RuntimeCommandCatalogSnapshot>;
  executeAgentRuntimeCommand: (
    request: RuntimeCommandRequest,
  ) => Promise<RuntimeCommandResult>;
  onAgentRuntimeCommandProgress: (
    callback: (progress: RuntimeCommandProgress) => void,
  ) => () => void;
  getAgentRuntimeRun: (runId: string) => Promise<AgentRuntimeRun | null>;
  cancelAgentRuntimeTask: (runId: string) => Promise<boolean>;
  retryAgentRuntimeArtifact: (
    runId: string,
    artifactId: string,
  ) => Promise<AgentRuntimeRun | null>;
  openAgentRuntimeArtifact: (
    runId: string,
    artifactId: string,
  ) => Promise<boolean>;
  readAgentRuntimeArtifactImage: (
    runId: string,
    artifactId: string,
  ) => Promise<string | null>;
  saveAgentRuntimeArtifact: (
    runId: string,
    artifactId: string,
  ) => Promise<boolean>;
  listTaskSchedules: (profile?: string) => Promise<TaskSchedule[]>;
  createTaskSchedule: (
    input: CreateTaskScheduleInput,
    profile?: string,
  ) => Promise<TaskSchedule>;
  updateTaskSchedule: (
    id: string,
    input: UpdateTaskScheduleInput,
    profile?: string,
  ) => Promise<TaskSchedule>;
  setTaskScheduleEnabled: (
    id: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<TaskSchedule>;
  triggerTaskSchedule: (
    id: string,
    profile?: string,
  ) => Promise<TaskScheduleTriggerResult>;
  onTaskScheduleRunCompleted: (
    callback: (event: TaskScheduleRunCompletedEvent) => void,
  ) => () => void;
  onTaskScheduleRunStarted: (
    callback: (event: TaskScheduleRunStartedEvent) => void,
  ) => () => void;
  deleteTaskSchedule: (id: string, profile?: string) => Promise<boolean>;
  getConnectionConfig: () => Promise<{
    mode: "local";
  }>;
  setConnectionConfig: () => Promise<boolean>;
  setConnectionChatTransports: () => Promise<boolean>;
  onConnectionConfigChanged: (
    callback: (config: { mode: "local" }) => void,
  ) => () => void;
  testRemoteConnection: (url: string, apiKey?: string) => Promise<boolean>;

  // Chat
  sendMessage: (
    message: string,
    profile?: string,
    resumeSessionId?: string,
    history?: Array<{ role: string; content: string }>,
    attachments?: Attachment[],
    contextFolder?: string,
    runId?: string,
    modelOverride?: SessionModelOverride,
    contextWorkspaceId?: string,
  ) => Promise<{ response: string; sessionId?: string }>;
  abortChat: (runId?: string) => Promise<void>;
  transcribeAudio: (
    audio: Uint8Array,
    mimeType: string,
    profile?: string,
  ) => Promise<string>;
  startStreamingTranscription: (profile?: string) => Promise<string>;
  sendStreamingAudio: (sessionId: string, audio: Uint8Array) => Promise<void>;
  stopStreamingTranscription: (
    sessionId: string,
    captureAudit?: {
      capturedChunks: number;
      capturedBytes: number;
      sendFailures: number;
    },
  ) => Promise<void>;
  onStreamingTranscriptionEvent: (
    callback: (event: {
      sessionId: string;
      type: "final" | "error" | "ended";
      text?: string;
      message?: string;
    }) => void,
  ) => () => void;
  getApiServerKeyStatus: (
    profile?: string,
  ) => Promise<{ hasKey: boolean; providerId?: string; checkedAt?: number }>;
  invalidateSecretsCache: () => Promise<void>;
  generateApiServerKey: (profile?: string) => Promise<{ key: string }>;
  copyToClipboard: (text: string) => Promise<void>;
  onContextMenuCopyChat: (
    callback: (format: "text" | "markdown") => void,
  ) => () => void;
  onContextMenuSelectBubble: (
    callback: (point: { x: number; y: number }) => void,
  ) => () => void;
  readMediaFile: (filePath: string) => Promise<string | null>;
  saveMediaFile: (src: string, name: string) => Promise<boolean>;
  mediaFileExists: (filePath: string) => Promise<boolean>;
  showMediaMenu: (
    src: string,
    name: string,
    labels: { open: string; saveAs: string },
  ) => void;
  showFileMenu: (
    filePath: string,
    labels: {
      open: string;
      copyPath: string;
      copyContent: string;
      reveal: string;
    },
  ) => void;
  getPathForFile: (file: File) => string;
  stageAttachment: (
    sessionId: string,
    filename: string,
    base64Bytes: string,
  ) => Promise<string>;
  clearStagedAttachments: (sessionId: string) => Promise<void>;
  discoverProviderModels: (
    provider: string,
    baseUrl?: string,
    apiKey?: string,
    profile?: string,
  ) => Promise<{
    models: string[];
    status: "ok" | "no-key" | "error" | "unsupported" | "unknown-host";
    cached: boolean;
    /** Subset of `models` flagged as free (Nous Portal today). #367. */
    freeModels?: string[];
  }>;
  getModelContextWindow: (
    provider: string,
    model: string,
    baseUrl?: string,
    profile?: string,
  ) => Promise<number | null>;
  onChatChunk: (callback: (runId: string, chunk: string) => void) => () => void;
  onChatReasoningChunk: (
    callback: (runId: string, chunk: string) => void,
  ) => () => void;
  onChatDone: (
    callback: (runId: string, sessionId?: string) => void,
  ) => () => void;
  onChatSessionStarted: (
    callback: (runId: string, sessionId: string) => void,
  ) => () => void;
  onChatToolProgress: (
    callback: (runId: string, tool: string) => void,
  ) => () => void;
  onChatToolEvent: (
    callback: (runId: string, event: ChatToolEvent) => void,
  ) => () => void;
  onChatUsage: (
    callback: (
      runId: string,
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cost?: number;
        rateLimitRemaining?: number;
        rateLimitReset?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
      },
    ) => void,
  ) => () => void;
  onChatError: (callback: (runId: string, error: string) => void) => () => void;
  onClarifyRequest: (
    callback: (
      runId: string,
      req: {
        requestId: string;
        question: string;
        choices: string[];
      },
    ) => void,
  ) => () => void;
  respondClarify: (requestId: string, answer: string) => Promise<boolean>;

  // Gateway
  startGateway: () => Promise<GatewayStartResult>;
  stopGateway: () => Promise<boolean>;
  restartGateway: (profile?: string) => Promise<boolean>;
  gatewayStatus: () => Promise<boolean>;
  dashboardStatus: (profile?: string) => Promise<DashboardStatus>;
  startDashboard: (profile?: string) => Promise<DashboardStatus>;
  createDashboardWorkspaceSession: (
    workspaceId: string,
    profile?: string,
    messages?: Array<{ role: "assistant" | "user"; content: string }>,
  ) => Promise<{
    sessionId: string;
    storedSessionId: string;
  } | null>;
  setDashboardWorkspaceCwd: (
    workspaceId: string,
    sessionId: string,
    profile?: string,
  ) => Promise<boolean>;
  stopDashboard: (profile?: string) => Promise<boolean>;

  // Platform toggles
  getPlatformEnabled: (profile?: string) => Promise<Record<string, boolean>>;
  setPlatformEnabled: (
    platform: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;
  getMessagingPlatforms: (
    profile?: string,
  ) => Promise<MessagingPlatformsResponse>;
  updateMessagingPlatform: (
    platform: string,
    update: MessagingPlatformUpdate,
    profile?: string,
  ) => Promise<{ ok: boolean; platform: string }>;
  testMessagingPlatform: (
    platform: string,
    profile?: string,
  ) => Promise<MessagingPlatformTestResponse>;

  // Sessions
  listSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
    Array<{
      id: string;
      source: string;
      startedAt: number;
      endedAt: number | null;
      messageCount: number;
      model: string;
      title: string | null;
      preview: string;
    }>
  >;
  getSessionMessages: (sessionId: string) => Promise<
    Array<
      | {
          kind: "user";
          id: number;
          content: string;
          timestamp: number;
          attachments?: Attachment[];
        }
      | {
          kind: "assistant";
          id: number;
          content: string;
          timestamp: number;
          error?: string;
          attachments?: Attachment[];
        }
      | {
          kind: "reasoning";
          id: number;
          assistantId: number;
          text: string;
          timestamp: number;
        }
      | {
          kind: "tool_call";
          id: number;
          assistantId: number;
          callId: string;
          name: string;
          args: string;
          timestamp: number;
        }
      | {
          kind: "tool_result";
          id: number;
          callId: string;
          name: string;
          content: string;
          timestamp: number;
          attachments?: Attachment[];
        }
    >
  >;
  recordSessionContinuation: (
    sessionId: string,
    items: DesktopSessionContinuationItem[],
  ) => Promise<boolean>;
  recordSessionLocalError: (
    sessionId: string,
    error: DesktopSessionLocalError,
  ) => Promise<boolean>;
  getSessionContextFolder: (sessionId: string) => Promise<string | null>;
  getSessionContextWorkspace: (sessionId: string) => Promise<{
    workspaceId?: string;
    name: string;
    legacyPath?: string;
  } | null>;
  setSessionContextFolder: (
    sessionId: string,
    folder: string | null,
  ) => Promise<boolean>;
  setSessionContextWorkspace: (
    sessionId: string,
    workspace: { workspaceId: string; name: string } | null,
  ) => Promise<boolean>;
  listRecentSessionContextFolders: (limit?: number) => Promise<string[]>;
  listRecentSessionContextWorkspaces: (
    limit?: number,
  ) => Promise<Array<{ workspaceId: string; name: string }>>;
  getSessionModelOverride: (
    sessionId: string,
  ) => Promise<SessionModelOverride | null>;
  setSessionModelOverride: (
    sessionId: string,
    override: SessionModelOverride | null,
  ) => Promise<boolean>;

  // Profiles
  listProfiles: () => Promise<
    Array<{
      /** Stable internal profile id used for CLI, paths, and routing. */
      id: string;
      /** User-facing agent/profile name. */
      name: string;
      path: string;
      isDefault: boolean;
      isActive: boolean;
      model: string;
      provider: string;
      hasEnv: boolean;
      hasSoul: boolean;
      skillCount: number;
      gatewayRunning: boolean;
      /** Resolved accent colour; absent on remote profiles. */
      color?: string;
      /** Avatar data URL, or null/absent when none is set. */
      avatar?: string | null;
    }>
  >;
  createProfile: (
    name: string,
    cloneFrom: string | null,
  ) => Promise<{ success: boolean; error?: string; id?: string }>;
  deleteProfile: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setActiveProfile: (name: string) => Promise<boolean>;
  setProfileColor: (
    name: string,
    color: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setProfileName: (
    id: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setProfileAvatar: (
    name: string,
    dataUrl: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeProfileAvatar: (
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  // Memory
  readMemory: (profile?: string) => Promise<{
    memory: { content: string; exists: boolean; lastModified: number | null };
    user: { content: string; exists: boolean; lastModified: number | null };
    stats: { totalSessions: number; totalMessages: number };
  }>;

  addMemoryEntry: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  updateMemoryEntry: (
    index: number,
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeMemoryEntry: (index: number, profile?: string) => Promise<boolean>;
  writeUserProfile: (
    content: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Soul
  readSoul: (profile?: string) => Promise<string>;
  writeSoul: (content: string, profile?: string) => Promise<boolean>;
  resetSoul: (profile?: string) => Promise<string>;

  // Tools
  getToolsets: (
    profile?: string,
  ) => Promise<
    Array<{ key: string; label: string; description: string; enabled: boolean }>
  >;
  setToolsetEnabled: (
    key: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<boolean>;

  // Skills
  listInstalledSkills: (
    profile?: string,
  ) => Promise<
    Array<{ name: string; category: string; description: string; path: string }>
  >;
  listBundledSkills: () => Promise<
    Array<{
      name: string;
      description: string;
      category: string;
      source: string;
      installed: boolean;
    }>
  >;
  getSkillContent: (skillPath: string) => Promise<string>;
  installSkill: (
    identifier: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  uninstallSkill: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Session cache
  listCachedSessions: (
    limit?: number,
    offset?: number,
  ) => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      /** Opaque project id for capability-backed session context. */
      contextWorkspaceId?: string | null;
      /** Display name for capability-backed context, legacy path otherwise. */
      contextFolder: string | null;
    }>
  >;
  syncSessionCache: () => Promise<
    Array<{
      id: string;
      title: string;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      /** Opaque project id for capability-backed session context. */
      contextWorkspaceId?: string | null;
      /** Display name for capability-backed context, legacy path otherwise. */
      contextFolder: string | null;
    }>
  >;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (
    sessionIds: string[],
  ) => Promise<{ requested: number; deleted: number }>;
  saveTaskCollaboration: (
    input: import("../shared/task-collaboration").SaveTaskCollaborationInput,
    profile?: string,
  ) => Promise<import("../shared/task-collaboration").TaskCollaborationRecord>;
  getTaskCollaboration: (
    taskId: string,
    profile?: string,
  ) => Promise<
    import("../shared/task-collaboration").TaskCollaborationRecord | null
  >;
  linkTaskCollaboration: (
    input: import("../shared/task-collaboration").LinkTaskCollaborationInput,
    profile?: string,
  ) => Promise<import("../shared/task-collaboration").TaskCollaborationRecord>;
  updateTaskCollaborationExecution: (
    input: import("../shared/task-collaboration").UpdateTaskCollaborationExecutionInput,
    profile?: string,
  ) => Promise<import("../shared/task-collaboration").TaskCollaborationRecord>;
  listTaskCollaborations: (
    profile?: string,
  ) => Promise<
    import("../shared/task-collaboration").TaskCollaborationRecord[]
  >;
  listRuntimeConversations: (
    profile?: string,
    limit?: number,
    offset?: number,
  ) => Promise<RuntimeConversationSummary[]>;
  getRuntimeConversation: (
    id: string,
    profile?: string,
  ) => Promise<RuntimeConversation | null>;
  saveRuntimeConversation: (
    input: SaveRuntimeConversationInput,
  ) => Promise<RuntimeConversation>;
  updateRuntimeConversationTitle: (
    id: string,
    title: string,
    profile?: string,
  ) => Promise<boolean>;
  deleteRuntimeConversation: (id: string, profile?: string) => Promise<boolean>;
  forkRuntimeConversation: (
    parentId: string,
    input: {
      id: string;
      forkedFromMessageId?: string;
      branchLabel?: string;
      branchSummary?: string;
      implementation?: boolean;
      worktreeId?: string;
    },
    profile?: string,
  ) => Promise<RuntimeConversation>;
  listRuntimeSkills: () => Promise<RuntimeSkillDescriptor[]>;
  listQuickChats: (profile?: string) => Promise<QuickChatConversation[]>;
  saveQuickChats: (
    chats: QuickChatConversation[],
    profile?: string,
  ) => Promise<QuickChatConversation[]>;

  // Session search
  searchSessions: (
    query: string,
    limit?: number,
  ) => Promise<
    Array<{
      sessionId: string;
      title: string | null;
      startedAt: number;
      source: string;
      messageCount: number;
      model: string;
      snippet: string;
    }>
  >;

  // Credential Pool (profile-aware) — entries follow the upstream
  // engine schema (issue #367). See `CredentialPoolEntry` below.
  getCredentialPool: (
    profile?: string,
  ) => Promise<Record<string, Array<CredentialPoolEntry>>>;
  setCredentialPool: (
    provider: string,
    entries: Array<CredentialPoolEntry>,
    profile?: string,
  ) => Promise<boolean>;
  addCredentialPoolEntry: (
    provider: string,
    apiKey: string,
    label: string,
    profile?: string,
  ) => Promise<Array<CredentialPoolEntry>>;
  invalidateSecretsCache: () => Promise<void>;

  // Models
  listModels: () => Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      model: string;
      baseUrl: string;
      providerLabel?: string;
      createdAt: number;
    }>
  >;
  addModel: (
    name: string,
    provider: string,
    model: string,
    baseUrl: string,
    contextLength?: number,
    providerLabel?: string,
  ) => Promise<{
    id: string;
    name: string;
    provider: string;
    model: string;
    baseUrl: string;
    contextLength?: number;
    providerLabel?: string;
    createdAt: number;
  }>;
  removeModel: (id: string) => Promise<boolean>;
  updateModel: (
    id: string,
    fields: Record<string, string>,
    contextLength?: number | null,
  ) => Promise<boolean>;
  onModelLibraryChanged: (callback: () => void) => () => void;

  // Claw3D
  claw3dStatus: () => Promise<{
    cloned: boolean;
    installed: boolean;
    devServerRunning: boolean;
    adapterRunning: boolean;
    port: number;
    portInUse: boolean;
    wsUrl: string;
    running: boolean;
    error: string;
  }>;
  claw3dSetup: () => Promise<{ success: boolean; error?: string }>;
  onClaw3dSetupProgress: (
    callback: (progress: {
      step: number;
      totalSteps: number;
      title: string;
      detail: string;
      log: string;
    }) => void,
  ) => () => void;
  claw3dGetPort: () => Promise<number>;
  claw3dSetPort: (port: number) => Promise<boolean>;
  claw3dGetWsUrl: () => Promise<string>;
  claw3dSetWsUrl: (url: string) => Promise<boolean>;
  claw3dStartAll: (
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  claw3dStopAll: () => Promise<boolean>;
  claw3dGetLogs: () => Promise<string>;
  claw3dStartDev: () => Promise<boolean>;
  claw3dStopDev: () => Promise<boolean>;
  claw3dStartAdapter: () => Promise<boolean>;
  claw3dStopAdapter: () => Promise<boolean>;

  // Updates
  checkForUpdates: () => Promise<string | null>;
  downloadUpdate: () => Promise<boolean>;
  installUpdate: () => Promise<void>;
  getAppVersion: () => Promise<string>;
  getAutoUpgradeEnabled: () => Promise<boolean>;
  setAutoUpgradeEnabled: (enabled: boolean) => Promise<boolean>;
  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes: string }) => void,
  ) => () => void;
  onUpdateDownloadProgress: (
    callback: (info: { percent: number }) => void,
  ) => () => void;
  onUpdateDownloaded: (callback: () => void) => () => void;
  onUpdateError: (callback: (message: string) => void) => () => void;

  // Menu events
  onMenuNewChat: (callback: () => void) => () => void;
  onMenuSearchSessions: (callback: () => void) => () => void;
  onTrayOpenTask: (callback: (sessionId: string) => void) => () => void;
  getTrayCompletionData: () => Promise<TrayCompletionData | null>;
  onTrayCompletionData: (
    callback: (data: TrayCompletionData) => void,
  ) => () => void;
  openTrayCompletion: () => void;
  closeTrayCompletion: () => void;

  // Cron Jobs
  listCronJobs: (
    includeDisabled?: boolean,
    profile?: string,
  ) => Promise<
    Array<{
      id: string;
      name: string;
      schedule: string;
      prompt: string;
      state: "active" | "paused" | "completed";
      enabled: boolean;
      next_run_at: string | null;
      last_run_at: string | null;
      last_status: string | null;
      last_error: string | null;
      repeat: { times: number | null; completed: number } | null;
      deliver: string[];
      skills: string[];
      script: string | null;
    }>
  >;
  createCronJob: (
    schedule: string,
    prompt?: string,
    name?: string,
    deliver?: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  pauseCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  resumeCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  triggerCronJob: (
    jobId: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  selectFolder: (options?: {
    title?: string;
    buttonLabel?: string;
  }) => Promise<string | null>;
  createProjectFolder: () => Promise<string | null>;
  listProjectFolders: () => Promise<ProjectFolderRecord[]>;
  listProjectWorkspaces: () => Promise<ProjectWorkspaceCapability[]>;
  registerProjectFolder: (
    folderPath: string,
  ) => Promise<ProjectFolderRecord | null>;
  registerProjectWorkspace: (
    folderPath: string,
  ) => Promise<ProjectWorkspaceCapability | null>;
  updateProjectFolder: (
    input: UpdateProjectFolderInput,
  ) => Promise<ProjectFolderRecord | null>;
  updateProjectWorkspace: (
    input: Pick<UpdateProjectFolderInput, "id" | "name" | "pinned">,
  ) => Promise<ProjectWorkspaceCapability | null>;
  removeProjectFolder: (
    folderPath: string,
    profile?: string,
  ) => Promise<boolean>;
  removeProjectWorkspace: (
    workspaceId: string,
    profile?: string,
  ) => Promise<boolean>;
  listArchivedItems: (profile?: string) => Promise<ArchivedItem[]>;
  archiveItem: (
    input: ArchiveItemInput,
    profile?: string,
  ) => Promise<ArchivedItem>;
  archiveProjectWorkspace: (
    workspaceId: string,
    profile?: string,
  ) => Promise<ArchivedItem | null>;
  restoreArchivedItem: (id: string, profile?: string) => Promise<boolean>;
  deleteArchivedItem: (id: string, profile?: string) => Promise<boolean>;
  prepareProjectContext: (folderPath: string) => Promise<Attachment | null>;
  prepareProjectWorkspaceContext: (
    workspaceId: string,
  ) => Promise<Attachment | null>;
  readDirectory: (
    dirPath: string,
  ) => Promise<{ name: string; isDirectory: boolean }[] | null>;
  readWorkspaceDirectory: (
    workspaceId: string,
    relativePath?: string,
  ) => Promise<{ name: string; isDirectory: boolean }[] | null>;
  readWorkspaceFile: (
    workspaceId: string,
    relativePath: string,
    maxBytes?: number,
  ) => Promise<{ content: string; truncated: boolean } | null>;
  readWorkspaceImage: (
    workspaceId: string,
    relativePath: string,
  ) => Promise<string | null>;
  openWorkspaceFile: (
    workspaceId: string,
    relativePath: string,
  ) => Promise<boolean>;
  openProjectWorkspace: (workspaceId: string) => Promise<boolean>;
  openWorkspaceTerminal: (workspaceId: string) => Promise<boolean>;
  readFile: (
    filePath: string,
    maxBytes?: number,
  ) => Promise<{ content: string; truncated: boolean } | null>;
  openFileInEditor: (filePath: string) => Promise<boolean>;
  openTerminal: (dirPath: string) => Promise<boolean>;
  readImageFile: (filePath: string) => Promise<string | null>;
  // Shell
  openExternal: (url: string) => Promise<void>;

  // Agents One backup / restore
  exportAgentsOneBackup: () => Promise<AgentsOneBackupResult>;
  inspectAgentsOneBackup: (
    archivePath: string,
  ) => Promise<AgentsOneBackupInspection>;
  restoreAgentsOneBackup: (
    archivePath: string,
  ) => Promise<AgentsOneRestoreResult>;

  // Debug dump
  runHermesDump: () => Promise<string>;

  // Memory providers
  discoverMemoryProviders: (profile?: string) => Promise<
    Array<{
      name: string;
      description: string;
      installed: boolean;
      active: boolean;
      envVars: string[];
    }>
  >;

  // MCP servers
  listMcpServers: (profile?: string) => Promise<
    Array<{
      name: string;
      type: "http" | "stdio" | "unknown";
      transport: "http" | "stdio" | "unknown";
      enabled: boolean;
      detail: string;
      url?: string;
      command?: string;
      args: string[];
      env: Record<string, string>;
      auth?: string;
      tools?: unknown;
    }>
  >;
  addMcpServer: (
    input: {
      name: string;
      type: "http" | "stdio";
      url?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      auth?: string;
    },
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  removeMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  setMcpServerEnabled: (
    name: string,
    enabled: boolean,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  testMcpServer: (
    name: string,
    profile?: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    tools?: Array<{ name: string; description: string }>;
  }>;
  listMcpCatalog: (profile?: string) => Promise<{
    entries: Array<{
      name: string;
      description: string;
      source: string;
      transport: "http" | "stdio" | "unknown";
      authType: string;
      requiredEnv: Array<{ name: string; prompt: string; required: boolean }>;
      needsInstall: boolean;
      installed: boolean;
      enabled: boolean;
    }>;
    diagnostics: unknown[];
    error?: string;
  }>;
  installMcpCatalogEntry: (
    name: string,
    env?: Record<string, string>,
    profile?: string,
  ) => Promise<{
    success: boolean;
    error?: string;
    background?: boolean;
    action?: string;
  }>;

  // Discover marketplace (community registry)
  fetchRegistry: (
    force?: boolean,
  ) => Promise<RegistryCatalog & { error?: string }>;
  fetchModelRegistry: (force?: boolean) => Promise<ModelRegistry>;
  listInstalledRegistry: (
    profile?: string,
  ) => Promise<{ skills: string[]; mcps: string[]; workflows: string[] }>;
  fetchRegistryDetail: (
    kind: RegistryKind,
    item: RegistryItem,
  ) => Promise<RegistryDetail>;
  installRegistryItem: (
    kind: RegistryKind,
    item: RegistryItem,
    profile?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Agents One diagnostic log viewer
  readDiagnostics: (
    logFile?: string,
    lines?: number,
  ) => Promise<{ content: string; path: string }>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    agentsOneAPI: AgentsOneAPI;
    /** @deprecated Use agentsOneAPI. Kept temporarily for older automation. */
    hermesAPI: AgentsOneAPI;
  }
}
