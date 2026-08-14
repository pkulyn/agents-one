import type { Attachment } from "./attachments";
import type {
  AgentEventStreamModel,
  AgentEventStreamSupport,
  AgentEventStreamTool,
  AgentEventStreamUsage,
} from "./agent-event-stream";

export const AGENT_RUNTIME_KINDS = [
  "hermes",
  "openclaw",
  "codex",
  "claude-code",
  "pi",
] as const;

export type AgentRuntimeKind = (typeof AGENT_RUNTIME_KINDS)[number];
export type AgentRuntimeLocation = "local" | "remote";
/** A Hermes Runtime has the same three connection choices as the built-in
 * Hermes connection, while retaining its own independent connection profile. */
export type HermesRuntimeMode = "local" | "remote" | "ssh";
export type HermesChatTransport = "auto" | "dashboard" | "legacy";

/**
 * Agents One Remote Gateway is deliberately separate from legacy Hermes and
 * OpenClaw transports.  A v1 gateway exposes one public base URL and keeps
 * all vendor-specific endpoints and credentials on the remote side.
 */
export interface AgentsOneRemoteGatewayConfig {
  protocol: "agents-one-v1";
}

export interface HermesRuntimeSshConfig {
  host?: string;
  port?: number;
  username?: string;
  keyPath?: string;
  remotePort?: number;
  localPort?: number;
}

export interface HermesRuntimeConnectionConfig {
  mode: HermesRuntimeMode;
  dashboardUrl?: string;
  chatTransport?: HermesChatTransport;
  ssh?: HermesRuntimeSshConfig;
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
  /** Optional richer provider telemetry. Legacy runtimes remain compatible. */
  eventStream?: AgentEventStreamSupport;
  /** Optional SDK identity. This is probe metadata, not persisted configuration. */
  plugin?: AgentRuntimePluginInfo;
}

export interface AgentRuntimeConfig {
  endpoint?: string;
  /** When present, `endpoint` is an Agents One Remote Gateway v1 base URL. */
  remoteGateway?: AgentsOneRemoteGatewayConfig;
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
  agentTransport?: "gateway-v1" | "local-cli" | "local-api";
  executablePath?: string;
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
  location: AgentRuntimeLocation;
  enabled: boolean;
  /** Restored remote endpoints stay blocked until a fresh credential is saved. */
  needsReauthorization?: boolean;
  managed: "builtin" | "user";
  config: AgentRuntimeConfig;
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
  worktreePath?: string;
  diffSummary?: string;
  inputArtifacts?: RuntimeInputArtifact[];
  artifacts?: AgentRuntimeArtifact[];
  /** Provider-reported runtime metadata; never guessed from a different agent. */
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
  /** Bounded, redacted execution timeline for UI and durable task history. */
  events?: AgentRuntimeEvent[];
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
};

export type AgentRuntimeTransport = "gateway-v1" | "local-cli" | "local-api";

/**
 * Derive the canonical Agents One transport from a runtime definition.
 * Backward compatible: absent `agentTransport` is inferred from legacy
 * location/kind/remoteGateway fields, so old persisted configs keep working.
 */
export function deriveAgentTransport(
  runtime: Pick<AgentRuntimeDefinition, "location" | "kind" | "config">,
): AgentRuntimeTransport {
  if (runtime.config?.agentTransport) return runtime.config.agentTransport;
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
