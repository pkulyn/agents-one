import type { Attachment } from "./attachments";
import type {
  AgentEventStreamModel,
  AgentEventStreamSupport,
  AgentEventStreamTool,
  AgentEventStreamUsage,
} from "./agent-event-stream";
import type {
  WebAgentRuntimeSettings,
  WebAgentUserActionRequired,
} from "./web-agent";

export const AGENT_RUNTIME_KINDS = [
  "hermes",
  "codex",
  "claude-code",
  "pi",
  "opencode",
  "openclaw",
  "web-agent",
] as const;

/**
 * Built-in kinds remain a closed, discoverable list for the current UI while
 * persisted Runtime records accept namespaced future kinds. This lets an
 * installed adapter be added without making old desktop configs unreadable.
 */
export type AgentRuntimeKind =
  | (typeof AGENT_RUNTIME_KINDS)[number]
  | (string & {});
export type AgentRuntimeLocation = "local" | "remote";
/** How a Runtime obtained its remote/local execution authority. */
export type AgentRuntimeConnectionProfile =
  | "local"
  | "managed-connect"
  | "self-hosted-gateway";

/** A persisted Runtime whose explicit access method disagrees with its
 * legacy location/config fields. The record stays readable, but must not be
 * silently rewritten by a Settings save. */
export interface AgentRuntimeConfigurationIssue {
  code: "connection-profile-conflict";
  explicitProfile: AgentRuntimeConnectionProfile;
  inferredProfile: AgentRuntimeConnectionProfile;
  message: string;
}
/** Hermes runtimes are local-only: remote Hermes now always goes through
 * Gateway v1, and SSH mode was removed (plan D4/D5). */
export type HermesRuntimeMode = "local";

/**
 * Agents One Remote Gateway is deliberately separate from legacy Hermes and
 * OpenClaw transports.  A v1 gateway exposes one public base URL and keeps
 * all vendor-specific endpoints and credentials on the remote side.
 */
export interface AgentsOneRemoteGatewayConfig {
  protocol: "agents-one-v1";
}

export interface HermesRuntimeConnectionConfig {
  mode: HermesRuntimeMode;
  dashboardUrl?: string;
}
export type AgentRuntimeHealthState =
  | "healthy"
  | "degraded"
  | "unreachable"
  | "unsupported"
  | "unknown";

/** Optional plugin identity announced by a compatible Gateway during probe. */
export interface AgentRuntimePluginInfo {
  id: string;
  version?: string;
  kind?: "remote-gateway" | "cli-adapter";
}

/** A serializable snapshot written after a successful or degraded probe. */
export interface AgentRuntimeLastProbe {
  checkedAt: number;
  state: AgentRuntimeHealthState;
  message?: string;
  gatewayProtocolVersion?: string;
  hostVersion?: string;
}

export interface AgentRuntimeCapabilities {
  chat: boolean;
  taskDispatch: boolean;
  streaming: boolean;
  cancellation: boolean;
  tools: boolean;
  memory: boolean;
  /** Can propose and manage project/task plans through the controlled API. */
  orchestration: boolean;
  /** Can enforce a server-side no-tools planning policy. */
  readOnlyPlanning: boolean;
  /** Can send and receive structured task handoff events. */
  mailbox: boolean;
  /** Can expose redacted, project-scoped security audit events. */
  securityEvents: boolean;
  artifacts: boolean;
  /** Whether the runtime accepts user attachments through the Artifact API. */
  artifactUpload?: boolean;
  workspaceAccess: boolean;
  /** Gateway control-plane support, discovered from the live handshake. */
  commands?: boolean;
  modelSelection?: boolean;
  compaction?: "native" | "platform" | "none";
  /** Optional richer provider telemetry. Legacy runtimes remain compatible. */
  eventStream?: AgentEventStreamSupport;
  /** Optional SDK identity. This is probe metadata, not persisted configuration. */
  plugin?: AgentRuntimePluginInfo;
  /** Mid-run steering mode discovered from the Runtime. `follow_up` may be a
   * platform queue when the provider itself has no native steering API. */
  steering?: "native" | "cancel_resume" | "follow_up" | "none";
  /** Native provider session branching, if explicitly reported. */
  branching?: "native" | "platform" | "none";
}

export interface AgentRuntimeConfig {
  endpoint?: string;
  /** When present, `endpoint` is an Agents One Remote Gateway v1 base URL. */
  remoteGateway?: AgentsOneRemoteGatewayConfig;
  /** Optional managed Agents One Connect transport. The bearer token remains
   * in the protected secret store; only the public Connect endpoint/runtime
   * identity is persisted here. */
  connect?: {
    endpoint: string;
    runtimeId: string;
    /** Non-secret Connect device identity used for status diagnostics. */
    deviceId?: string;
  };
  /** Optional full HTTPS URL of a separately hosted outbound workspace gateway.
   * When omitted, the gateway is discovered below the Runtime endpoint. */
  workspaceGatewayEndpoint?: string;
  transport?: "http" | "cli";
  /** Canonical connection transport (Agents One unified model).
   * `gateway-v1` = remote via one URL + one token; `local-cli` = local
   * executable path (Pi/Claude Code/Codex); `local-api` = local HTTP API
   * (built-in Hermes).  Derived from legacy fields when absent, so old
   * persisted configs keep working without a data migration.
   */
  agentTransport?: "gateway-v1" | "local-cli" | "local-api" | "local-web";
  /** Browser-backed provider settings. Credentials remain in Chromium's
   * encrypted profile, never in desktop.json or the renderer. */
  webAgent?: WebAgentRuntimeSettings;
  executablePath?: string;
  /** Optional argument override for protocol-backed local adapters. */
  acpArgs?: string[];
  /** Optional provider-native agent/profile selector. */
  agent?: string;
  /** Forward-compatible non-secret values declared by an Adapter Manifest. */
  adapterOptions?: Record<string, string | number | boolean>;
  /** Optional CLI model override. Empty keeps the CLI's own default. */
  model?: string;
  workspace?: string;
  timeoutMs?: number;
  /** Present only for independently configured Hermes agents. Secrets remain
   * in the protected store and are never embedded here. */
  hermes?: HermesRuntimeConnectionConfig;
}

export interface AgentRuntimeDefinition {
  id: string;
  name: string;
  /** Desktop-only display metadata. It never changes remote runtime config. */
  color?: string;
  avatar?: string | null;
  kind: AgentRuntimeKind;
  /** Explicit connection provenance; legacy records derive this on read. */
  connectionProfile?: AgentRuntimeConnectionProfile;
  configurationIssue?: AgentRuntimeConfigurationIssue;
  /** Stable Registry key. Optional for legacy records and derived on read. */
  adapterId?: string;
  /** Vendor namespace used for diagnostics and future plugin ownership. */
  vendorId?: string;
  /** Adapter contract version selected when this Runtime was saved. */
  adapterVersion?: string;
  /** Reference into the protected Secret Store; never a credential value. */
  authRef?: string;
  /** Last live capability result. It is cache/telemetry, not an authority. */
  capabilitySnapshot?: AgentRuntimeCapabilities;
  lastProbe?: AgentRuntimeLastProbe;
  location: AgentRuntimeLocation;
  enabled: boolean;
  /** Restored remote endpoints stay blocked until a fresh credential is saved. */
  needsReauthorization?: boolean;
  managed: "builtin" | "user";
  config: AgentRuntimeConfig;
}

/**
 * Derive connection provenance without changing persisted legacy records.
 * Direct Gateway v1 access is intentionally not considered paired.
 */
export function deriveAgentRuntimeConnectionProfile(
  runtime: Pick<
    AgentRuntimeDefinition,
    "location" | "config" | "connectionProfile"
  >,
): AgentRuntimeConnectionProfile {
  if (runtime.connectionProfile) return runtime.connectionProfile;
  if (runtime.location === "local") return "local";
  if (runtime.config.connect) return "managed-connect";
  return "self-hosted-gateway";
}

export interface AgentRuntimeAppearance {
  name?: string;
  color?: string;
  avatar?: string | null;
}

export interface AgentRuntimeProbe {
  runtimeId: string;
  state: AgentRuntimeHealthState;
  capabilities: AgentRuntimeCapabilities;
  checkedAt: number;
  message?: string;
  gatewayProtocolVersion?: string;
  hostVersion?: string;
}

/**
 * Redacted, layer-aware status returned by the Settings diagnostics view.
 * It deliberately contains references and summaries only; credential values,
 * full filesystem paths, and provider prompt/output bodies are excluded.
 */
export interface AgentRuntimeDiagnostics {
  generatedAt: number;
  desktopVersion?: string;
  gatewayProtocolVersion?: string;
  runtime: {
    id: string;
    name: string;
    kind: AgentRuntimeKind;
    location: AgentRuntimeLocation;
    enabled: boolean;
    connectionProfile: AgentRuntimeConnectionProfile;
    transport: AgentRuntimeTransport;
    adapterId?: string;
    adapterVersion?: string;
  };
  connection: {
    profile: AgentRuntimeConnectionProfile;
    state: "online" | "offline" | "revoked" | "unknown" | "not-applicable";
    endpointHost?: string;
    tls: "trusted-https" | "loopback-http" | "not-applicable" | "unknown";
    deviceId?: string;
    lastSeenAt?: number;
    checkedAt?: number;
    protocolVersion?: string;
    connectorVersion?: string;
    message?: string;
  };
  host: {
    state: AgentRuntimeHealthState;
    version?: string;
    adapterId?: string;
    adapterVersion?: string;
    plugin?: AgentRuntimePluginInfo;
    checkedAt?: number;
    message?: string;
  };
  provider: {
    authConfigured: boolean;
    requestedModel?: string;
    actualModel?: AgentEventStreamModel;
    modelSource: "provider-reported" | "configured" | "unknown";
  };
  lastRun?: {
    id: string;
    status: AgentRuntimeRun["status"];
    startedAt: number;
    completedAt?: number;
    eventCount: number;
    lastSequence?: number;
    reconnectFailures: number;
    error?: string;
  };
}

export interface RuntimeInputArtifact {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "text" | "image" | "document";
  sha256: string;
}

export interface AgentRuntimeTaskInput {
  prompt: string;
  /** Conversation-scoped model selection. It overrides the Runtime default for
   * this request without writing user-managed Runtime configuration. */
  model?: string;
  profile?: string;
  sessionId?: string;
  /** The caller is a conversational chat even before the remote session exists. */
  conversation?: boolean;
  /** Files selected explicitly for this task. The main process stages copies
   * before a local Runtime sees them and never grants access to the source path. */
  attachments?: Attachment[];
  /**
   * `implementation` is retained only so historical isolated-worktree tasks
   * remain readable. `safe_write` allows create/edit/write inside an explicit
   * workspace while denying move and delete operations.
   */
  mode?: "analysis" | "safe_write" | "implementation" | "full_access";
  /** Required by the main process for every direct full-access run. */
  fullAccessConfirmed?: boolean;
  /** Optional task-specific workspace. It is validated in the main process. */
  workspace?: string;
  /** Preferred opaque project capability. Main process resolves it to a path. */
  workspaceId?: string;
  /** Main-process generated identity for an isolated implementation worktree. */
  worktreeId?: string;
  /** Remote-only project reference, such as a Bridge artifact or Git ref. */
  workspaceRef?: string;
  timeoutMs?: number;
  coordinatorPlan?: {
    projectId: string;
    title: string;
    objective: string;
    existingTasks?: Array<{
      id: string;
      title: string;
      status: string;
      runtimeId?: string;
    }>;
  };
}

export interface AgentRuntimeArtifact {
  kind: "worktree" | "diff" | "file" | "final";
  label: string;
  /** Remote artifact id, when the provider exposes a downloadable object. */
  id?: string;
  mime?: string;
  size?: number;
  sha256?: string;
  /** Adapter-owned execution environment after independent verification. */
  sourceMachine?: string;
  /** Adapter-owned summary attached to a verified file delivery. */
  changeSummary?: string;
  /** Main-process diagnostic when a remote artifact could not be materialized. */
  unavailableReason?: string;
  path?: string;
  content?: string;
}

/**
 * A compact, redacted execution event shared by every Runtime. It is designed
 * for durable task timelines, not for replaying raw provider protocol frames.
 */
export type AgentRuntimeEventType =
  | "queued"
  | "started"
  | "progress"
  | "tool_call"
  | "tool_result"
  | "message"
  | "artifact_published"
  | "error"
  | "completed"
  | "cancelled"
  | "timed_out";

export interface AgentRuntimeEvent {
  id: string;
  type: AgentRuntimeEventType;
  summary: string;
  createdAt: number;
  /** Optional redacted detail retained for the native conversation renderer. */
  detail?: string;
  /** Optional structured tool evidence from Event Stream v1. */
  tool?: AgentEventStreamTool;
  /** Optional machine-readable error code for diagnostics. */
  code?: string;
}

export interface AgentRuntimeRun {
  id: string;
  runtimeId: string;
  status: "running" | "succeeded" | "failed" | "cancelled" | "timed_out";
  startedAt: number;
  completedAt?: number;
  output?: string;
  sessionId?: string;
  error?: string;
  /** A browser Runtime is paused for an explicit user action such as login.
   * It remains running so the task UI can resume it without resubmission. */
  userActionRequired?: WebAgentUserActionRequired;
  /** Stable opaque identity of a managed implementation worktree. */
  worktreeId?: string;
  worktreePath?: string;
  diffSummary?: string;
  inputArtifacts?: RuntimeInputArtifact[];
  artifacts?: AgentRuntimeArtifact[];
  /** The model requested by the conversation or Runtime configuration. */
  requestedModel?: string;
  /** Provider-reported runtime metadata; never guessed from a different agent. */
  model?: AgentEventStreamModel;
  /** Alias that makes the provider-reported model explicit in audit payloads. */
  actualModel?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
  /** Bounded, redacted execution timeline for UI and durable task history. */
  events?: AgentRuntimeEvent[];
  /** Actual execution boundary, derived by the main process—not a UI choice. */
  isolation?: RuntimeIsolationInfo;
}

export type RuntimeIsolationLevel =
  | "host"
  | "worktree"
  | "container"
  | "remote";

export interface RuntimeIsolationInfo {
  level: RuntimeIsolationLevel;
  /** A precise human explanation; worktree is code isolation, never a sandbox. */
  summary: string;
  unattendedRisk?: "low" | "elevated" | "high";
}

export function runtimeIsolationInfo(
  runtime: Pick<AgentRuntimeDefinition, "location">,
  task: Pick<AgentRuntimeTaskInput, "mode" | "worktreeId">,
): RuntimeIsolationInfo {
  if (runtime.location === "remote") {
    return {
      level: "remote",
      summary: "在远程 Runtime 环境执行；本地项目仅经显式授权交接。",
      unattendedRisk: "elevated",
    };
  }
  if (task.mode === "implementation" || task.worktreeId) {
    return {
      level: "worktree",
      summary: "Git worktree 隔离代码分支，但仍共享宿主系统、网络与用户凭据。",
      unattendedRisk: "elevated",
    };
  }
  return {
    level: "host",
    summary: "使用启动 Agents One 的本机用户权限直接执行。",
    unattendedRisk: task.mode === "analysis" ? "low" : "high",
  };
}

export interface RuntimeUnattendedPreflight {
  allowed: boolean;
  warnings: string[];
}

/** Refuses unattended full-host writes unless callers add an explicit policy. */
export function unattendedRuntimePreflight(
  isolation: RuntimeIsolationInfo,
  task: Pick<AgentRuntimeTaskInput, "mode" | "fullAccessConfirmed">,
): RuntimeUnattendedPreflight {
  const warnings: string[] = [];
  if (isolation.level === "host" && task.mode !== "analysis") {
    warnings.push("该任务在宿主权限下运行，并非系统级沙箱。");
  }
  if (task.mode === "full_access") {
    warnings.push("全权限任务不应在无人值守模式下自动启动。");
    return { allowed: false, warnings };
  }
  return { allowed: true, warnings };
}

export type AgentRuntimeDraft = Omit<AgentRuntimeDefinition, "managed">;

export const NO_AGENT_RUNTIME_CAPABILITIES: AgentRuntimeCapabilities = {
  chat: false,
  taskDispatch: false,
  streaming: false,
  cancellation: false,
  tools: false,
  memory: false,
  orchestration: false,
  readOnlyPlanning: false,
  mailbox: false,
  securityEvents: false,
  artifacts: false,
  workspaceAccess: false,
  steering: "none",
  branching: "none",
};

export type RuntimeSteeringPlan =
  | { kind: "native"; confirmationRequired: false }
  | { kind: "cancel_resume"; confirmationRequired: true }
  | { kind: "follow_up"; confirmationRequired: false }
  | { kind: "unsupported"; confirmationRequired: false };

/** A UI-independent degradation contract; no adapter may silently cancel a run. */
export function runtimeSteeringPlan(
  capabilities: Pick<AgentRuntimeCapabilities, "steering" | "cancellation">,
): RuntimeSteeringPlan {
  switch (capabilities.steering) {
    case "native":
      return { kind: "native", confirmationRequired: false };
    case "cancel_resume":
      return capabilities.cancellation
        ? { kind: "cancel_resume", confirmationRequired: true }
        : { kind: "unsupported", confirmationRequired: false };
    case "follow_up":
      return { kind: "follow_up", confirmationRequired: false };
    default:
      return { kind: "unsupported", confirmationRequired: false };
  }
}

export type AgentRuntimeTransport =
  | "gateway-v1"
  | "local-cli"
  | "local-api"
  | "local-web";

/**
 * Derive the canonical Agents One transport from a runtime definition.
 * Backward compatible: absent `agentTransport` is inferred from legacy
 * location/kind/remoteGateway fields, so old persisted configs keep working.
 */
export function deriveAgentTransport(
  runtime: Pick<AgentRuntimeDefinition, "location" | "kind" | "config">,
): AgentRuntimeTransport {
  if (runtime.config?.agentTransport) return runtime.config.agentTransport;
  if (runtime.kind === "web-agent" || runtime.config?.webAgent) {
    return "local-web";
  }
  if (
    runtime.location === "remote" &&
    runtime.config?.remoteGateway?.protocol === "agents-one-v1"
  ) {
    return "gateway-v1";
  }
  if (runtime.location === "remote") return "gateway-v1";
  if (
    runtime.config?.transport === "http" ||
    runtime.kind === "hermes" ||
    runtime.config?.hermes
  ) {
    return "local-api";
  }
  return "local-cli";
}
