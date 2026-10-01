import {
  NO_AGENT_RUNTIME_CAPABILITIES,
  deriveAgentTransport,
  deriveAgentRuntimeConnectionProfile,
  runtimeIsolationInfo,
  type AgentRuntimeConfig,
  type AgentRuntimeCapabilities,
  type AgentRuntimeConnectionProfile,
  type AgentRuntimeDiagnostics,
  type AgentRuntimeDefinition,
  type AgentRuntimeDraft,
  type AgentRuntimeLocation,
  type AgentRuntimeArtifact,
  type AgentRuntimeAppearance,
  type AgentRuntimeEvent,
  type AgentRuntimeEventType,
  type AgentRuntimeProbe,
  type AgentRuntimeRun,
  type AgentRuntimeTaskInput,
} from "../shared/agent-runtimes";
import {
  manifestForAdapterId,
  manifestForRuntimeKind,
} from "../shared/runtime-adapters";
import {
  createRuntimeCommandCatalog,
  normalizeRuntimeCommandName,
  runtimeCommandSuggestions,
  type RuntimeCommandCatalogSnapshot,
  type RuntimeCommandDescriptor,
  type RuntimeCommandProgress,
  type RuntimeCommandRequest,
  type RuntimeCommandResult,
  type RuntimeModelOption,
} from "../shared/runtime-commands";
import { readDesktopConfig, writeDesktopConfig } from "./config";
import { sendMessage, testRemoteConnection } from "./hermes";
import { HERMES_SCRIPT } from "./installer";
import { existsSync, readFileSync } from "fs";
import { delimiter, join } from "path";
import { prepareRuntimeInputs } from "./runtime-inputs";
import { probeCodexRuntime, startCodexProcess } from "./codex-runtime";
import {
  compactCodexAppServerThread,
  listCodexAppServerModels,
} from "./codex-app-server";
import {
  probeClaudeCodeRuntime,
  startClaudeCodeProcess,
} from "./claude-code-runtime";
import {
  closeClaudeAgentSdkSessions,
  compactClaudeAgentSdkSession,
  executeClaudeAgentSdkCommand,
  listClaudeAgentSdkCommands,
  listClaudeAgentSdkModels,
  setClaudeAgentSdkModel,
  startClaudeAgentSdkProcess,
} from "./claude-agent-sdk";
import {
  executePiRpcCommand,
  executePiRpcPrompt,
  getPiConfiguredModels,
  probePiRuntime,
  startPiProcess,
} from "./pi-runtime";
import { randomUUID } from "crypto";
import { getSecret } from "./secrets";
import {
  deleteEnvValue,
  invalidateSecretsCache,
  readEnv,
  setEnvValue,
} from "./config";
import {
  desktopSecretStore,
  type DesktopSecretStatus,
} from "./desktop-secret-store";
import { redactSensitiveText } from "../shared/redaction";
import {
  MAX_REMOTE_WORKSPACE_TIMEOUT_MS,
  OutboundRemoteWorkspaceGateway,
  createRemoteWorkspaceGrant,
  probeRemoteWorkspaceGateway,
} from "./remote-workspace-gateway";
import { promptRemoteWorkspaceDelete } from "./workspace-delete-prompt";
import {
  cancelAgentsOneRemoteGatewayRun,
  explainAgentsOneRemoteGatewayError,
  executeAgentsOneRemoteGatewayCommand,
  getAgentsOneRemoteGatewayCommandCatalog,
  getAgentsOneRemoteGatewayArtifact,
  getAgentsOneRemoteGatewayRun,
  isAgentsOneRemoteGatewayRunNotFound,
  probeAgentsOneRemoteGateway,
  assertAgentsOneRemoteGatewayEndpoint,
  startAgentsOneRemoteGatewayRun,
  uploadAgentsOneRemoteGatewayArtifact,
  type AgentsOneRemoteGatewayConfig,
} from "./agents-one-remote-gateway";
import {
  AGENT_EVENT_STREAM_V1,
  agentEventTimelineEntry,
  isSyntheticRemoteReasoningSummary,
  normalizeAgentEventStreamModel,
  normalizeAgentEventStreamUsage,
  type AgentEventStreamSupport,
  type AgentEventStreamUsage,
  type AgentEventStreamTool,
  type AgentEventStreamEvent,
} from "../shared/agent-event-stream";
import { isAuthorizedMediaPath, materializeBytesToTemp } from "./media";
import { hasValidTaskCollaborationProposal } from "../shared/task-collaboration-proposals";
import { verifyLocalDeliveryArtifacts } from "./runtime-delivery";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";
import { logErrorDiagnostic, logTaskDiagnostic } from "./agents-one-logs";
import {
  resolveAuthorizedWorkspaceId,
  isAuthorizedWorkspacePath,
  isAuthorizedWorkspaceRoot,
} from "./workspace-authority";
import {
  webAgentController,
  forgetWebAgentRuntimeConversations,
  type StartedWebAgentRun,
} from "./web-agent/controller";
import {
  WEB_AGENT_PROVIDERS,
  normalizeWebAgentProfileId,
  type WebAgentProvider,
  type WebAgentPolicyStatus,
  type WebAgentRuntimeSettings,
} from "../shared/web-agent";
import {
  getWebAgentPolicyStatus,
  setWebAgentPolicyEnabled,
  webAgentDisabledMessage,
  webAgentExecutionAllowed,
} from "./web-agent/policy";
import {
  isRemoteOpenCodeAcpV1Enabled,
  resolveRuntimeAdapter,
} from "./runtime-adapters/registry";
import { startOpenCodeProcess } from "./runtime-adapters/builtin/opencode-acp";
import type { RuntimeAdapter } from "./runtime-adapters/types";
import { getAgentsOneConnectDeviceStatus } from "./agents-one-connect";

const RUNTIME_CONFIG_KEY = "agentRuntimes";
const RUNTIME_APPEARANCE_KEY = "agentRuntimeAppearances";
const RESERVED_RUNTIME_IDS = new Set(["hermes-local"]);
const RUNTIME_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SECRET_CONFIG_KEY = /(token|secret|password|api.?key|credential)/i;
const MAX_RUNTIME_TIMEOUT_MS = 10 * 60 * 1000;
// Scheduled work can legitimately take several hours. Keep a finite ceiling
// (and the explicit cancel control) so an agent loop can never run forever.
const MAX_TASK_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const MAX_TASK_PROMPT_LENGTH = 100_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_GATEWAY_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const GATEWAY_TERMINAL_RECONCILIATION_MAX_ATTEMPTS = 3;
const GATEWAY_TERMINAL_RECONCILIATION_INTERVAL_MS = 750;
const GATEWAY_CANCEL_CONFIRMATION_INTERVAL_MS = 1_000;
const GATEWAY_CANCEL_CONFIRMATION_TIMEOUT_MS = 60_000;
const MAX_GATEWAY_ARTIFACT_RETRY_ATTEMPTS = 3;
const MAX_RETAINED_RUNS = 100;
const MAX_RUNTIME_EVENTS = 200;
const MAX_RUNTIME_EVENT_SUMMARY_LENGTH = 1_000;
const MAX_RUNTIME_EVENT_DETAIL_LENGTH = 8_000;
const WORKSPACE_GATEWAY_TOKEN_SECRET_PREFIX = "HERMES_WORKSPACE_GATEWAY_";
const AGENTS_ONE_GATEWAY_TOKEN_SECRET_PREFIX = "AGENTS_ONE_GATEWAY_";
const REMOTE_WORKSPACE_POLL_INTERVAL_MS = 500;
const LOCAL_RUNTIME_TERMINATION_TIMEOUT_MS = 15_000;

interface ClaudeStreamBlockState {
  type: string;
  thinking: string;
  callId?: string;
  name?: string;
  input?: unknown;
  partialJson: string;
}

interface ClaudeStreamState {
  blocks: Record<string, ClaudeStreamBlockState>;
  toolNamesByCallId: Record<string, string>;
}

interface RuntimeRunRecord {
  run: AgentRuntimeRun;
  completionContext: {
    title: string;
    profile?: string;
  };
  pendingEventOutput?: string;
  claudeStream?: ClaudeStreamState;
  timeout?: NodeJS.Timeout;
  abortHandle?: () => void;
  cancelRequested: boolean;
  taskTimeoutMs: number;
  terminationStatus?: "cancelled" | "timed_out";
  codex?: {
    cancel: () => Promise<void>;
  };
  claudeCode?: {
    cancel: () => Promise<void>;
  };
  claudeSdk?: {
    cancel: () => Promise<void>;
  };
  pi?: {
    cancel: () => Promise<void>;
  };
  opencode?: {
    cancel: () => Promise<void>;
  };
  webAgent?: StartedWebAgentRun;
  remoteGateway?: {
    config: AgentsOneRemoteGatewayConfig;
    runId: string;
    failures: number;
    lastSuccessfulPollAt: number;
    nextPollAt: number;
    terminalReconciliationAttempts: number;
    cancelRequestedAt?: number;
    artifactRetryAttempts: Map<string, number>;
  };
  workspaceGateway?: {
    gateway: OutboundRemoteWorkspaceGateway;
    stopped: boolean;
    timer?: NodeJS.Timeout;
    failures: number;
  };
}

export interface AgentRuntimeRunFinishedEvent {
  runId: string;
  runtimeId: string;
  runtimeName: string;
  runtimeKind: AgentRuntimeDefinition["kind"];
  runtimeAvatar?: string | null;
  title: string;
  profile?: string;
  status: Exclude<AgentRuntimeRun["status"], "running">;
  error?: string;
  completedAt: number;
}

const runtimeRuns = new Map<string, RuntimeRunRecord>();
const runtimeRunFinishedListeners = new Set<
  (event: AgentRuntimeRunFinishedEvent) => void
>();
const runtimeCommandCatalogCache = new Map<
  string,
  { fetchedAt: number; commands: RuntimeCommandDescriptor[] }
>();
const piThinkingLevelsCache = new Map<
  string,
  { fetchedAt: number; levels: string[] }
>();
const piThinkingLevelsInFlight = new Map<string, Promise<string[]>>();
const runtimeCommandRequestCache = new Map<
  string,
  { expiresAt: number; result: Promise<RuntimeCommandResult> }
>();
let runtimeProbeWriteQueue: Promise<void> = Promise.resolve();
const RUNTIME_COMMAND_CATALOG_TTL_MS = 30_000;
// A model's supported reasoning levels do not change within a normal desktop
// session. Keeping this longer than the command catalogue avoids spawning a
// fresh Pi RPC process on every toolbar click; model changes explicitly evict
// the entry below.
const PI_THINKING_LEVELS_CACHE_TTL_MS = 10 * 60_000;
const RUNTIME_COMMAND_REQUEST_TTL_MS = 2 * 60_000;
let runtimeTaskAdmissionOpen = true;

function invalidateRuntimeCommandCatalog(runtimeId: string): void {
  const prefix = `${runtimeId}:`;
  for (const key of runtimeCommandCatalogCache.keys()) {
    if (key.startsWith(prefix)) runtimeCommandCatalogCache.delete(key);
  }
}

function withRuntimeArtifactIds(
  runId: string,
  artifacts: AgentRuntimeArtifact[] | undefined,
): AgentRuntimeArtifact[] | undefined {
  return artifacts?.map((artifact, index) =>
    artifact.id ? artifact : { ...artifact, id: `local-${runId}-${index}` },
  );
}

/**
 * Filesystem paths in a Runtime record are main-process implementation
 * details. Renderer code receives only metadata plus an opaque (run, id)
 * capability and must use the dedicated IPC methods below to open/read/save
 * the artifact. This also keeps persisted Runtime conversations free of local
 * absolute paths.
 */
export function toRendererAgentRuntimeRun(
  run: AgentRuntimeRun | null,
): AgentRuntimeRun | null {
  if (!run) return null;
  const artifacts = withRuntimeArtifactIds(run.id, run.artifacts)?.map(
    ({ path: _path, ...artifact }) => artifact,
  );
  const { worktreePath: _worktreePath, ...safeRun } = run;
  return {
    ...safeRun,
    ...(artifacts?.length ? { artifacts } : {}),
  };
}

/** Resolve a renderer-held Runtime artifact capability without exposing paths. */
export function resolveAgentRuntimeArtifactPath(
  runId: string,
  artifactId: string,
): { path: string; label: string } | null {
  if (!runId || !artifactId) return null;
  const artifact = runtimeRuns
    .get(runId)
    ?.run.artifacts?.find((item) => item.id === artifactId);
  if (!artifact?.path) return null;
  if (
    !isAuthorizedMediaPath(artifact.path) &&
    !isAuthorizedWorkspacePath(artifact.path)
  ) {
    return null;
  }
  return { path: artifact.path, label: artifact.label };
}

/** Prevent new Runtime dispatch while the app is quiescing for shutdown. */
export function stopAcceptingAgentRuntimeTasks(): void {
  runtimeTaskAdmissionOpen = false;
  void closeClaudeAgentSdkSessions();
}

function localRuntimeTerminationDetails(
  record: RuntimeRunRecord,
  status: "cancelled" | "timed_out",
  output = record.run.output,
): Pick<AgentRuntimeRun, "output" | "worktreeId" | "worktreePath" | "error"> {
  return {
    output,
    ...(record.run.worktreePath
      ? { worktreePath: record.run.worktreePath }
      : {}),
    ...(record.run.worktreeId ? { worktreeId: record.run.worktreeId } : {}),
    error:
      status === "cancelled"
        ? "Runtime task was cancelled."
        : `Runtime task exceeded ${record.taskTimeoutMs}ms.`,
  };
}

async function terminateLocalRuntime(
  record: RuntimeRunRecord,
  status: "cancelled" | "timed_out",
): Promise<boolean> {
  if (record.run.status !== "running") return false;
  record.cancelRequested = true;
  record.terminationStatus = status;
  const cancel =
    record.codex?.cancel ||
    record.claudeSdk?.cancel ||
    record.claudeCode?.cancel ||
    record.pi?.cancel ||
    record.opencode?.cancel;
  if (!cancel) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      Promise.resolve(cancel()),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "Timed out waiting for the local Runtime process to close.",
              ),
            ),
          LOCAL_RUNTIME_TERMINATION_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (record.run.status === "running") {
      finishRuntimeRun(record, "failed", {
        ...localRuntimeTerminationDetails(record, status),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (record.run.status === "running") {
    finishRuntimeRun(
      record,
      status,
      localRuntimeTerminationDetails(record, status),
    );
  }
  return true;
}

function eventSummary(value: string): string {
  return redactSensitiveText(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_RUNTIME_EVENT_SUMMARY_LENGTH);
}

function eventDetail(value: string): string {
  return redactSensitiveText(value)
    .trim()
    .slice(0, MAX_RUNTIME_EVENT_DETAIL_LENGTH);
}

function runtimeEventTool(
  value?: AgentEventStreamTool,
): AgentEventStreamTool | undefined {
  if (!value?.name?.trim()) return undefined;
  return {
    name: eventSummary(value.name),
    ...(value.callId?.trim() ? { callId: eventSummary(value.callId) } : {}),
    ...(value.kind ? { kind: value.kind } : {}),
    ...(value.inputSummary?.trim()
      ? { inputSummary: eventDetail(value.inputSummary) }
      : {}),
    ...(value.outputSummary?.trim()
      ? { outputSummary: eventDetail(value.outputSummary) }
      : {}),
  };
}

function normalizedProgressSummary(summary: string): string {
  return summary
    .replace(/^Pi 思考：/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isProgressSnapshotOf(left: string, right: string): boolean {
  const a = normalizedProgressSummary(left);
  const b = normalizedProgressSummary(right);
  // Pi emits cumulative thinking snapshots. Its first frame is often just a
  // one- or two-character prefix (for example "用户"); treating that as a
  // separate event visibly splits a single reasoning chain in the UI.
  if (!a || !b || a === b) return false;
  return a.startsWith(b) || b.startsWith(a);
}

function isGenericWorkspaceToolFailure(summary: string): boolean {
  return /^工具\s+(?:workspace_gateway|workspace-gateway)$/i.test(
    summary.trim(),
  );
}

function isDetailedWorkspaceFailure(summary: string): boolean {
  return /^受控工作区(?:\s|：|:)/.test(summary.trim());
}

function isWorkspaceEvent(event: AgentEventStreamEvent): boolean {
  const tool = event.data?.tool;
  const toolName = tool?.name?.trim().toLowerCase();
  const summary = event.data?.summary?.trim() || "";
  return (
    tool?.kind === "workspace" ||
    toolName === "workspace_gateway" ||
    toolName === "workspace-gateway" ||
    /(?:工具|tool)\s+workspace[-_]gateway\b/i.test(summary)
  );
}

function isSuccessfulWorkspaceEvent(event: AgentEventStreamEvent): boolean {
  return (
    event.type === "workspace.completed" ||
    (event.type === "tool.completed" && isWorkspaceEvent(event))
  );
}

const REMOTE_MEDIA_DELIVERY_RE =
  /\bMEDIA:\s*(?:`[^`\r\n]+`|"[^"\r\n]+"|'[^'\r\n]+'|\S+\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?=$|[\s"'`<>.,;:!?]))/i;

/**
 * A remote run may deliver a local chart/media path without touching the
 * controlled workspace. That is valid for the desktop-local MEDIA protocol:
 * the renderer still asks the main process to verify/read the actual file.
 * Keep the workspace-audit guard for ordinary file-operation claims, but do
 * not turn a verified media/artifact delivery into a false task failure.
 */
export function hasRemoteDeliveredContent(
  output?: string,
  events?: AgentEventStreamEvent[],
  artifacts?: AgentRuntimeArtifact[],
): boolean {
  return Boolean(
    artifacts?.length ||
    events?.some((event) => event.type === "artifact.created") ||
    REMOTE_MEDIA_DELIVERY_RE.test(output || ""),
  );
}

/**
 * A collaboration proposal is a platform control result, not a completed file
 * operation. It may therefore finish before any Workspace Gateway audit entry
 * exists, but only when every assignment targets a registered runtime.
 */
export function hasRemoteWorkspaceOutcome(
  output: string | undefined,
  events: AgentEventStreamEvent[] | undefined,
  artifacts: AgentRuntimeArtifact[] | undefined,
  availableRuntimeIds: Iterable<string>,
): boolean {
  return (
    hasRemoteDeliveredContent(output, events, artifacts) ||
    hasValidTaskCollaborationProposal(output || "", availableRuntimeIds)
  );
}

/**
 * Some Connector versions emit a second, empty tool.failed marker after a
 * successful workspace event. It renders as the misleading bare
 * "工具 workspace_gateway" line. Keep failures that carry any real detail.
 */
function isGenericWorkspaceFailureEvent(event: AgentEventStreamEvent): boolean {
  if (event.type !== "tool.failed" && event.type !== "workspace.blocked") {
    return false;
  }
  if (!isWorkspaceEvent(event)) return false;
  if (
    [event.data?.error, event.data?.detail, event.data?.code].some((value) =>
      Boolean(value?.trim()),
    )
  ) {
    return false;
  }
  if (event.data?.tool?.inputSummary?.trim()) return false;
  const summary = event.data?.summary?.trim().toLowerCase();
  return (
    !summary ||
    summary === "failed" ||
    summary === "error" ||
    summary === "workspace_gateway" ||
    summary === "workspace-gateway" ||
    /^(?:工具|tool)\s+workspace[-_]gateway$/i.test(summary)
  );
}

function appendRuntimeEvent(
  record: RuntimeRunRecord,
  type: AgentRuntimeEventType,
  summary: string,
  evidence: Pick<AgentRuntimeEvent, "detail" | "code" | "tool"> = {},
): void {
  const cleanSummary = eventSummary(summary);
  if (!cleanSummary) return;
  const detail = evidence.detail?.trim()
    ? eventDetail(evidence.detail)
    : undefined;
  const code = evidence.code?.trim() ? eventSummary(evidence.code) : undefined;
  const tool = runtimeEventTool(evidence.tool);
  let current = record.run.events || [];
  if (type === "error" && isDetailedWorkspaceFailure(cleanSummary)) {
    const filtered = current.filter(
      (event) =>
        !(
          event.type === "error" && isGenericWorkspaceToolFailure(event.summary)
        ),
    );
    if (filtered.length !== current.length) {
      record.run = { ...record.run, events: filtered };
      current = filtered;
    }
  }
  if (
    current
      .slice(-80)
      .some(
        (event) =>
          event.type === type &&
          event.summary === cleanSummary &&
          event.detail === detail &&
          event.code === code &&
          JSON.stringify(event.tool) === JSON.stringify(tool),
      )
  ) {
    return;
  }
  if (type === "tool_call" && tool?.callId) {
    let existingIndex = -1;
    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (
        current[index].type === "tool_call" &&
        current[index].tool?.callId === tool.callId
      ) {
        existingIndex = index;
        break;
      }
    }
    if (existingIndex >= 0) {
      const next = [...current];
      const existing = next[existingIndex];
      const mergedTool = runtimeEventTool({
        ...existing.tool,
        ...tool,
        ...(tool.inputSummary
          ? { inputSummary: tool.inputSummary }
          : existing.tool?.inputSummary
            ? { inputSummary: existing.tool.inputSummary }
            : {}),
        ...(tool.outputSummary
          ? { outputSummary: tool.outputSummary }
          : existing.tool?.outputSummary
            ? { outputSummary: existing.tool.outputSummary }
            : {}),
      });
      next[existingIndex] = {
        ...existing,
        summary: cleanSummary,
        ...(detail &&
        (!existing.detail || /waiting|已提交工具调用/i.test(existing.detail))
          ? { detail }
          : detail && existing.detail && !existing.detail.trim()
            ? { detail }
            : {}),
        ...(code ? { code } : {}),
        ...(mergedTool ? { tool: mergedTool } : {}),
      };
      record.run = { ...record.run, events: next };
      return;
    }
  }
  if (type === "progress") {
    const progressiveIndex = current
      .slice(-80)
      .findIndex(
        (event) =>
          event.type === type &&
          isProgressSnapshotOf(event.summary, cleanSummary),
      );
    if (progressiveIndex >= 0) {
      const absoluteIndex = Math.max(current.length - 80, 0) + progressiveIndex;
      const next = [...current];
      next[absoluteIndex] = {
        ...next[absoluteIndex],
        summary:
          cleanSummary.length > next[absoluteIndex].summary.length
            ? cleanSummary
            : next[absoluteIndex].summary,
        createdAt: Date.now(),
        ...(detail ? { detail } : {}),
        ...(code ? { code } : {}),
        ...(tool ? { tool } : {}),
      };
      record.run = { ...record.run, events: next };
      return;
    }
  }
  const next: AgentRuntimeEvent[] = [
    ...current,
    {
      id: `runtime-event-${randomUUID()}`,
      type,
      summary: cleanSummary,
      createdAt: Date.now(),
      ...(detail ? { detail } : {}),
      ...(code ? { code } : {}),
      ...(tool ? { tool } : {}),
    },
  ].slice(-MAX_RUNTIME_EVENTS);
  record.run = { ...record.run, events: next };
}

/**
 * Provider events have stable ids. Upsert them separately from locally
 * generated status text so Gateway reconnects never duplicate a tool trace.
 */
function appendProviderRuntimeEvent(
  record: RuntimeRunRecord,
  event: AgentRuntimeEvent,
): boolean {
  const summary = eventSummary(event.summary);
  if (!summary) return false;
  const current = record.run.events || [];
  if (
    event.type === "error" &&
    isGenericWorkspaceToolFailure(summary) &&
    current.some(
      (item) =>
        item.type === "error" && isDetailedWorkspaceFailure(item.summary),
    )
  ) {
    return false;
  }
  const tool = event.tool
    ? {
        ...event.tool,
        name: eventSummary(event.tool.name),
        ...(event.tool.inputSummary
          ? { inputSummary: eventDetail(event.tool.inputSummary) }
          : {}),
        ...(event.tool.outputSummary
          ? { outputSummary: eventDetail(event.tool.outputSummary) }
          : {}),
      }
    : undefined;
  const incoming: AgentRuntimeEvent = {
    ...event,
    summary,
    createdAt: event.createdAt || Date.now(),
    ...(event.detail ? { detail: eventDetail(event.detail) } : {}),
    ...(event.code ? { code: eventSummary(event.code) } : {}),
    ...(tool ? { tool } : {}),
  };
  const existingIndex = current.findIndex((item) => item.id === incoming.id);
  if (existingIndex >= 0) {
    const existing = current[existingIndex];
    if (
      existing.type === incoming.type &&
      existing.summary === incoming.summary &&
      existing.createdAt === incoming.createdAt &&
      existing.detail === incoming.detail &&
      existing.code === incoming.code &&
      JSON.stringify(existing.tool) === JSON.stringify(incoming.tool)
    ) {
      return false;
    }
    const next = [...current];
    next[existingIndex] = incoming;
    record.run = { ...record.run, events: next };
    return true;
  }
  record.run = {
    ...record.run,
    events: [...current, incoming].slice(-MAX_RUNTIME_EVENTS),
  };
  return true;
}

function isGenericRuntimeFailureText(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？]+$/u, "");
  return [
    "failed",
    "error",
    "workspace operation failed",
    "任务执行失败",
  ].includes(normalized);
}

function appendRemoteGatewayEvents(
  record: RuntimeRunRecord,
  events: NonNullable<
    Awaited<ReturnType<typeof getAgentsOneRemoteGatewayRun>>["events"]
  >,
  finalOutput?: string,
): boolean {
  let applied = false;
  const resolvedFinalOutput = finalOutput?.trim() || undefined;
  if (resolvedFinalOutput && record.run.events?.length) {
    const current = record.run.events;
    const filtered = current.filter(
      (event) =>
        !(
          event.type === "progress" &&
          isSyntheticRemoteReasoningSummary(event.summary, resolvedFinalOutput)
        ),
    );
    if (filtered.length !== current.length) {
      record.run = { ...record.run, events: filtered };
      applied = true;
    }
  }
  const hasDetailedFailure = events.some((event) => {
    if (
      event.type !== "run.failed" &&
      event.type !== "tool.failed" &&
      event.type !== "workspace.blocked"
    ) {
      return false;
    }
    const candidates = [
      event.data?.error,
      event.data?.detail,
      event.data?.code,
      event.data?.summary,
    ].filter((value): value is string => Boolean(value?.trim()));
    return candidates.some((detail) => {
      const normalized = detail.trim().toLowerCase();
      return ![
        "failed",
        "error",
        "远程任务结束：failed。",
        "远程任务结束: failed.",
        "任务执行失败。",
      ].includes(normalized);
    });
  });
  const hasSuccessfulWorkspaceEvent = events.some(isSuccessfulWorkspaceEvent);
  if (hasSuccessfulWorkspaceEvent) {
    const current = record.run.events || [];
    const filtered = current.filter(
      (event) =>
        !(
          event.type === "error" && isGenericWorkspaceToolFailure(event.summary)
        ),
    );
    if (filtered.length !== current.length) {
      record.run = { ...record.run, events: filtered };
      applied = true;
    }
  }
  for (const event of [...events].sort(
    (left, right) =>
      (left.sequence ?? left.createdAt) - (right.sequence ?? right.createdAt),
  )) {
    const eventSummary =
      event.data?.summary?.trim() ||
      event.data?.reasoningSummary?.trim() ||
      event.data?.text?.trim();
    const eventModel =
      normalizeAgentEventStreamModel(event.data?.model) ??
      normalizeAgentEventStreamModel(event.data);
    const eventUsage =
      normalizeAgentEventStreamUsage(event.data?.usage) ??
      normalizeAgentEventStreamUsage(event.data);
    if (eventModel || eventUsage) {
      record.run = {
        ...record.run,
        ...(eventModel
          ? { model: { ...(record.run.model ?? {}), ...eventModel } }
          : {}),
        ...(eventUsage
          ? { usage: { ...(record.run.usage ?? {}), ...eventUsage } }
          : {}),
      };
      applied = true;
    }
    if (hasSuccessfulWorkspaceEvent && isGenericWorkspaceFailureEvent(event)) {
      continue;
    }
    if (
      event.type === "reasoning.summary" &&
      eventSummary &&
      isSyntheticRemoteReasoningSummary(eventSummary, finalOutput)
    ) {
      // Some Gateway adapters mirror the final assistant text into a
      // reasoning event. Keep the real answer, but do not present it twice as
      // a fabricated reasoning step.
      continue;
    }
    const summary = event.data?.summary?.trim().toLowerCase();
    if (
      hasDetailedFailure &&
      event.type === "run.failed" &&
      (summary === "远程任务结束：failed。" ||
        summary === "远程任务结束: failed." ||
        summary === "failed")
    ) {
      continue;
    }
    const timeline = agentEventTimelineEntry(event);
    if (timeline) {
      applied =
        appendProviderRuntimeEvent(record, timeline as AgentRuntimeEvent) ||
        applied;
    }
  }
  return applied;
}

/**
 * Provider CLIs do not share one metadata envelope. Codex usually reports
 * model/usage on turn.completed, Claude Code may put usage under result or
 * modelUsage, and Pi may put it on the assistant message. Normalize those
 * provider frames at the main-process boundary so the renderer only consumes
 * the canonical AgentRuntimeRun fields.
 */
function localUsageNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return undefined;
}

function normalizeLocalRuntimeUsage(
  value: unknown,
): AgentEventStreamUsage | undefined {
  const source = isRecord(value) ? value : undefined;
  const normalized = normalizeAgentEventStreamUsage(value);
  if (!source) return normalized;

  const inputTokens =
    normalized?.inputTokens ?? localUsageNumber(source, ["input"]);
  const outputTokens =
    normalized?.outputTokens ?? localUsageNumber(source, ["output"]);
  const cacheReadTokens = localUsageNumber(source, [
    "cacheRead",
    "cache_read",
    "cacheReadInputTokens",
    "cache_read_input_tokens",
  ]);
  const cacheWriteTokens = localUsageNumber(source, [
    "cacheWrite",
    "cache_write",
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
  ]);
  const contextUsedTokens =
    normalized?.contextUsedTokens ??
    (inputTokens !== undefined
      ? inputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
      : undefined);

  if (
    !normalized &&
    inputTokens === undefined &&
    outputTokens === undefined &&
    contextUsedTokens === undefined
  ) {
    return undefined;
  }
  return {
    ...(normalized ?? {}),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(contextUsedTokens !== undefined ? { contextUsedTokens } : {}),
  };
}

function appendLocalRuntimeMetadata(
  record: RuntimeRunRecord,
  value: unknown,
): void {
  const root = isRecord(value) ? value : undefined;
  if (!root) return;
  const sources = [
    root,
    root.data,
    root.message,
    root.result,
    root.response,
    root.metadata,
    root.meta,
  ].filter(isRecord);

  let model: ReturnType<typeof normalizeAgentEventStreamModel>;
  let usage: ReturnType<typeof normalizeAgentEventStreamUsage>;
  for (const source of sources) {
    const modelValue = source.model;
    const modelSource = isRecord(modelValue)
      ? {
          ...modelValue,
          provider: modelValue.provider ?? source.provider ?? source.vendor,
          contextWindowTokens:
            modelValue.contextWindowTokens ??
            modelValue.context_window_tokens ??
            source.contextWindowTokens ??
            source.context_window_tokens ??
            source.contextWindow ??
            source.context_window ??
            source.maxContextTokens ??
            source.max_context_tokens ??
            source.contextLength ??
            source.context_length,
        }
      : {
          id:
            (typeof modelValue === "string" ? modelValue : undefined) ??
            source.modelId ??
            source.model_id ??
            source.modelName ??
            source.model_name,
          provider: source.provider ?? source.vendor,
          contextWindowTokens:
            source.contextWindowTokens ??
            source.context_window_tokens ??
            source.contextWindow ??
            source.context_window ??
            source.maxContextTokens ??
            source.max_context_tokens ??
            source.contextLength ??
            source.context_length,
        };
    model ||= normalizeAgentEventStreamModel(modelSource);
    if (!usage) {
      const explicitUsage =
        source.usage ??
        source.stats ??
        source.metrics ??
        source.tokenUsage ??
        source.token_usage;
      usage = normalizeLocalRuntimeUsage(explicitUsage);
    }
    if (!usage) usage = normalizeLocalRuntimeUsage(source);
  }

  // Claude Code's result stream has historically exposed modelUsage as a
  // map keyed by model id. Prefer the entry with the largest total when a
  // provider reports more than one model in a single run.
  for (const source of sources) {
    const modelUsage = source.modelUsage ?? source.model_usage;
    if (!isRecord(modelUsage)) continue;
    const entries = Object.entries(modelUsage).filter(([, item]) =>
      isRecord(item),
    ) as Array<[string, Record<string, unknown>]>;
    if (!entries.length) continue;
    const selected = entries
      .map(([id, item]) => ({
        id,
        item,
        usage: normalizeLocalRuntimeUsage(item),
      }))
      .sort(
        (left, right) =>
          (right.usage?.totalTokens ?? 0) - (left.usage?.totalTokens ?? 0),
      )[0];
    if (!model) {
      model = normalizeAgentEventStreamModel({
        id: selected.id,
        provider: source.provider ?? source.vendor,
      });
    }
    if (!usage && selected.usage) usage = selected.usage;
  }

  if (!model && !usage) return;
  if (
    model &&
    model.contextWindowTokens === undefined &&
    usage?.contextWindowTokens !== undefined
  ) {
    model = { ...model, contextWindowTokens: usage.contextWindowTokens };
  }
  record.run = {
    ...record.run,
    ...(model ? { model: { ...(record.run.model ?? {}), ...model } } : {}),
    ...(usage ? { usage: { ...(record.run.usage ?? {}), ...usage } } : {}),
  };
}

function appendOutputEvent(
  record: RuntimeRunRecord,
  kind: AgentRuntimeDefinition["kind"],
  chunk: string,
): void {
  if (!chunk.trim()) return;
  // OpenCode ACP delivers assistant text through the dedicated `onOutput`
  // callback, while lifecycle/tool frames arrive through `onEvent`. There is
  // no provider JSONL to parse here. Falling through to the legacy default
  // branch would incorrectly append "Hermes Agent Runtime 正在生成回复。" for every
  // OpenCode response chunk and pollute both the live timeline and archive.
  if (kind === "opencode") return;
  const lines = `${record.pendingEventOutput || ""}${chunk}`.split(/\r?\n/);
  record.pendingEventOutput = lines.pop() || "";

  const toolName = (value: unknown): string =>
    typeof value === "string" && value.trim()
      ? value.trim().slice(0, 160)
      : "工具";
  const contentItems = (value: unknown): Record<string, unknown>[] =>
    isRecord(value) && Array.isArray(value.content)
      ? value.content.filter(isRecord)
      : [];
  const describeCodexItem = (value: unknown): string => {
    switch (value) {
      case "command_execution":
        return "命令";
      case "file_change":
        return "文件修改";
      case "mcp_tool_call":
        return "MCP 工具";
      case "web_search":
        return "网页搜索";
      case "reasoning":
        return "分析";
      default:
        return "工具";
    }
  };
  const compactText = (value: unknown, maxLength = 520): string => {
    const text = typeof value === "string" ? value : "";
    return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
  };
  const firstString = (
    value: Record<string, unknown> | undefined,
    keys: string[],
  ): string | undefined => {
    if (!value) return undefined;
    for (const key of keys) {
      const item = value[key];
      if (typeof item === "string" && item.trim()) return item.trim();
    }
    return undefined;
  };
  const jsonPreview = (value: unknown, maxLength = 360): string => {
    try {
      return JSON.stringify(value).replace(/\s+/g, " ").slice(0, maxLength);
    } catch {
      return "";
    }
  };
  const toolArgs = (value: unknown): Record<string, unknown> | undefined => {
    if (isRecord(value)) return value;
    if (typeof value !== "string" || !value.trim()) return undefined;
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  };
  const isEmptyArgs = (value: Record<string, unknown> | undefined): boolean =>
    value !== undefined && Object.keys(value).length === 0;
  const toolTarget = (name: unknown, value: unknown): string => {
    const cleanName = toolName(name).toLowerCase();
    const args = toolArgs(value);
    if (isEmptyArgs(args)) return "";
    const path = firstString(args, [
      "path",
      "file",
      "filePath",
      "filepath",
      "target",
      "targetPath",
      "absolutePath",
    ]);
    const command = firstString(args, ["command", "cmd", "shell", "script"]);
    const query = firstString(args, ["query", "pattern", "search", "glob"]);
    const cwd = firstString(args, ["cwd", "workspace", "directory", "dir"]);

    if (/^(write|write_file|edit|replace|patch)$/.test(cleanName)) {
      return path || "";
    }
    if (/^(read|read_file|cat)$/.test(cleanName) && path) return path;
    if (/^(bash|cmd|shell|terminal)$/.test(cleanName) && command) {
      return command;
    }
    if (/^(grep|search|find|ls|list)$/.test(cleanName)) {
      return [query, cwd || path].filter(Boolean).join(" @ ");
    }
    return path || command || query || jsonPreview(args);
  };
  const toolKindFor = (name: unknown): AgentEventStreamTool["kind"] => {
    const cleanName = toolName(name).toLowerCase();
    if (/workspace[-_]gateway|workspace/.test(cleanName)) return "workspace";
    if (/^(?:mcp|mcp_)/.test(cleanName)) return "mcp";
    if (/^(?:bash|cmd|shell|terminal|command)$/.test(cleanName)) {
      return "terminal";
    }
    if (/skill/.test(cleanName)) return "skill";
    return "tool";
  };
  const toolCallId = (
    value: Record<string, unknown> | undefined,
  ): string | undefined =>
    firstString(value, [
      "id",
      "callId",
      "call_id",
      "toolCallId",
      "tool_call_id",
      "toolUseId",
      "tool_use_id",
    ]);
  const toolInput = (name: unknown, value: unknown): string =>
    toolTarget(name, value) || jsonPreview(value);
  const toolEvidence = (
    name: unknown,
    input?: unknown,
    output?: unknown,
    callId?: string,
  ): AgentEventStreamTool => ({
    name: toolName(name),
    kind: toolKindFor(name),
    ...(callId ? { callId } : {}),
    ...(input !== undefined
      ? { inputSummary: compactText(toolInput(name, input), 1_200) }
      : {}),
    ...(output !== undefined
      ? { outputSummary: compactText(output, 1_200) }
      : {}),
  });
  const piText = (item: Record<string, unknown>): string => {
    if (typeof item.thinking === "string") return item.thinking;
    if (typeof item.text === "string") return item.text;
    if (typeof item.content === "string") return item.content;
    return "";
  };
  const toolResultText = (message: Record<string, unknown>): string => {
    const content = Array.isArray(message.content)
      ? message.content.filter(isRecord)
      : [];
    return content
      .map((item) => piText(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  };

  if (kind === "codex") {
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const frame = JSON.parse(line) as Record<string, unknown>;
        appendLocalRuntimeMetadata(record, frame);
        const item = isRecord(frame.item) ? frame.item : undefined;
        const itemType = firstString(item, ["type"]);
        const itemName =
          firstString(item, ["name", "toolName", "tool_name"]) ||
          (itemType === "command_execution"
            ? "Terminal"
            : itemType === "mcp_tool_call"
              ? "MCP Tool"
              : itemType === "file_change"
                ? "Write File"
                : itemType === "web_search"
                  ? "Web Search"
                  : itemType || "工具");
        const itemId = toolCallId(item);
        const itemInput =
          item?.arguments ?? item?.input ?? item?.command ?? item;
        const itemOutput =
          item?.output ?? item?.result ?? item?.aggregated_output ?? item?.text;
        switch (frame.type) {
          case "thread.started":
            appendRuntimeEvent(record, "progress", "Codex 已创建执行会话。");
            break;
          case "turn.started":
            appendRuntimeEvent(record, "progress", "Codex 开始分析任务。");
            break;
          case "item.started":
            appendRuntimeEvent(
              record,
              "tool_call",
              `Codex 正在调用${describeCodexItem(itemType)}。`,
              {
                tool: toolEvidence(itemName, itemInput, undefined, itemId),
              },
            );
            break;
          case "item.completed":
            appendRuntimeEvent(
              record,
              itemType === "agent_message" ? "message" : "tool_result",
              itemType === "agent_message"
                ? "Codex 已生成阶段性回复。"
                : `Codex 已完成${describeCodexItem(itemType)}。`,
              itemType === "agent_message"
                ? {}
                : {
                    tool: toolEvidence(itemName, undefined, itemOutput, itemId),
                    ...(itemOutput ? { detail: compactText(itemOutput) } : {}),
                  },
            );
            break;
          case "error":
            appendRuntimeEvent(
              record,
              "error",
              typeof frame.message === "string"
                ? frame.message
                : "Codex 返回了执行错误。",
              {
                ...(typeof frame.message === "string"
                  ? { detail: frame.message }
                  : {}),
                ...(typeof frame.code === "string" ? { code: frame.code } : {}),
                ...(item ? { tool: toolEvidence(itemName) } : {}),
              },
            );
            break;
          default:
            break;
        }
      } catch {
        // Codex may stream a partial NDJSON frame. The raw output remains in
        // the bounded log; it is intentionally not promoted to an event.
      }
    }
    return;
  }

  if (kind === "claude-code") {
    const stream = (record.claudeStream ??= {
      blocks: {},
      toolNamesByCallId: {},
    });
    const appendClaudeThinking = (value: unknown): void => {
      const thought = compactText(value);
      if (thought) appendRuntimeEvent(record, "progress", thought);
    };
    const upsertClaudeToolCall = (
      nameValue: unknown,
      input: unknown,
      callId?: string,
    ): void => {
      const name = toolName(nameValue);
      const tool = toolEvidence(name, input, undefined, callId);
      if (callId) stream.toolNamesByCallId[callId] = name;

      let existingIndex = -1;
      if (callId) {
        const events = record.run.events || [];
        for (let index = events.length - 1; index >= 0; index -= 1) {
          if (
            events[index].type === "tool_call" &&
            events[index].tool?.callId === callId
          ) {
            existingIndex = index;
            break;
          }
        }
      }
      if (existingIndex < 0) {
        appendRuntimeEvent(
          record,
          "tool_call",
          `Claude Code 正在调用${name}。`,
          { tool },
        );
        return;
      }

      const events = [...(record.run.events || [])];
      const existing = events[existingIndex];
      const mergedTool = runtimeEventTool({
        ...existing.tool,
        ...tool,
        ...(tool.inputSummary ? { inputSummary: tool.inputSummary } : {}),
      });
      events[existingIndex] = {
        ...existing,
        summary: eventSummary(`Claude Code 正在调用${name}。`),
        ...(mergedTool ? { tool: mergedTool } : {}),
      };
      record.run = { ...record.run, events };
    };
    const streamBlockKey = (value: unknown): string | undefined =>
      typeof value === "number" || typeof value === "string"
        ? String(value)
        : undefined;
    const partialToolInput = (block: ClaudeStreamBlockState): unknown => {
      if (block.partialJson.trim()) {
        try {
          return JSON.parse(block.partialJson) as unknown;
        } catch {
          return block.partialJson;
        }
      }
      return block.input;
    };

    for (const line of lines) {
      try {
        const frame = JSON.parse(line) as Record<string, unknown>;
        appendLocalRuntimeMetadata(record, frame);
        if (frame.type === "stream_event" && isRecord(frame.event)) {
          const event = frame.event;
          const eventType = firstString(event, ["type"]);
          const blockKey = streamBlockKey(event.index);
          if (eventType === "content_block_start" && blockKey) {
            const contentBlock = isRecord(event.content_block)
              ? event.content_block
              : undefined;
            const blockType = firstString(contentBlock, ["type"]);
            if (blockType === "thinking" || blockType === "tool_use") {
              const block: ClaudeStreamBlockState = {
                type: blockType,
                thinking:
                  typeof contentBlock?.thinking === "string"
                    ? contentBlock.thinking
                    : "",
                callId: toolCallId(contentBlock),
                name: firstString(contentBlock, ["name"]),
                input: contentBlock?.input,
                partialJson: "",
              };
              stream.blocks[blockKey] = block;
              if (block.type === "thinking") {
                appendClaudeThinking(block.thinking);
              } else {
                upsertClaudeToolCall(block.name, block.input, block.callId);
              }
            }
            continue;
          }
          if (eventType === "content_block_delta" && blockKey) {
            const block = stream.blocks[blockKey];
            const delta = isRecord(event.delta) ? event.delta : undefined;
            const deltaType = firstString(delta, ["type"]);
            if (block?.type === "thinking" && deltaType === "thinking_delta") {
              if (typeof delta?.thinking === "string") {
                block.thinking += delta.thinking;
                appendClaudeThinking(block.thinking);
              }
            } else if (
              block?.type === "tool_use" &&
              deltaType === "input_json_delta" &&
              typeof delta?.partial_json === "string"
            ) {
              block.partialJson += delta.partial_json;
            }
            continue;
          }
          if (eventType === "content_block_stop" && blockKey) {
            const block = stream.blocks[blockKey];
            if (block?.type === "thinking") {
              appendClaudeThinking(block.thinking);
            } else if (block?.type === "tool_use") {
              upsertClaudeToolCall(
                block.name,
                partialToolInput(block),
                block.callId,
              );
            }
            delete stream.blocks[blockKey];
            continue;
          }
        }
        const items = contentItems(frame.message);
        if (frame.type === "assistant") {
          for (const item of items) {
            if (item.type === "tool_use") {
              const name = toolName(item.name);
              const input = item.input;
              const id = toolCallId(item);
              upsertClaudeToolCall(name, input, id);
            } else if (item.type === "thinking") {
              appendClaudeThinking(piText(item));
            }
          }
        } else if (
          frame.type === "user" &&
          items.some((item) => item.type === "tool_result")
        ) {
          for (const item of items.filter(
            (candidate) => candidate.type === "tool_result",
          )) {
            const output =
              typeof item.content === "string"
                ? item.content
                : jsonPreview(item.content);
            const id = toolCallId(item);
            const name = toolName(
              item.name ||
                (id ? stream.toolNamesByCallId[id] : undefined) ||
                "Claude Tool",
            );
            const isError = item.is_error === true;
            appendRuntimeEvent(
              record,
              isError ? "error" : "tool_result",
              isError
                ? "Claude Code 工具执行失败。"
                : "Claude Code 已收到工具结果。",
              {
                detail: output || undefined,
                tool: toolEvidence(name, undefined, output, id),
              },
            );
          }
        } else if (frame.type === "result") {
          appendRuntimeEvent(record, "message", "Claude Code 已生成本轮答复。");
        } else if (frame.type === "error") {
          appendRuntimeEvent(record, "error", "Claude Code 返回了执行错误。", {
            detail: compactText(frame.message),
          });
        }
      } catch {
        // A partial JSONL frame remains in the bounded raw log for diagnosis.
      }
    }
    return;
  }

  if (kind === "pi") {
    for (const line of lines) {
      try {
        const frame = JSON.parse(line) as Record<string, unknown>;
        appendLocalRuntimeMetadata(record, frame);
        const message = isRecord(frame.message) ? frame.message : undefined;
        const items = contentItems(message);
        if (message?.role === "assistant") {
          for (const item of items) {
            if (item.type === "toolCall") {
              const name = toolName(item.name);
              const target = toolTarget(item.name, item.arguments);
              const id = toolCallId(item);
              appendRuntimeEvent(
                record,
                "tool_call",
                target
                  ? `Pi Agent 调用 ${name}：${target}`
                  : `Pi Agent 调用 ${name}。`,
                {
                  tool: toolEvidence(name, item.arguments, undefined, id),
                },
              );
            } else if (item.type === "thinking") {
              const thought = compactText(piText(item));
              if (thought) {
                appendRuntimeEvent(record, "progress", thought);
              }
            }
          }
        } else if (message?.role === "toolResult") {
          const result = compactText(toolResultText(message), 520);
          const name = toolName(message.toolName);
          const id = toolCallId(message);
          const isError = message.isError === true || message.is_error === true;
          appendRuntimeEvent(
            record,
            isError ? "error" : "tool_result",
            result
              ? `Pi Agent ${name} 结果：${result}`
              : `Pi Agent 已收到 ${name} 结果。`,
            {
              detail: result || undefined,
              tool: toolEvidence(name, undefined, result, id),
            },
          );
        } else if (frame.type === "agent_end") {
          appendRuntimeEvent(record, "message", "Pi Agent 已生成本轮答复。");
        }
      } catch {
        // Keep provider frames in the raw log; they are not user-facing text.
      }
    }
    return;
  }

  appendRuntimeEvent(record, "message", "Hermes Agent Runtime 正在生成回复。");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new Error("Runtime configuration contains an invalid string value.");
  }
  return value.trim() || undefined;
}

function optionalStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error("Runtime argument configuration is invalid.");
  }
  return value.map((item) => {
    if (
      typeof item !== "string" ||
      item.length > maxItemLength ||
      /[\0\r\n]/.test(item)
    ) {
      throw new Error("Runtime argument configuration is invalid.");
    }
    return item;
  });
}

function runtimeAdapterOptionsFrom(
  value: unknown,
): AgentRuntimeConfig["adapterOptions"] {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) throw new Error("Runtime adapter options are invalid.");
  const entries = Object.entries(value);
  if (entries.length > 64) {
    throw new Error("Runtime adapter options exceed the maximum count.");
  }
  const options: NonNullable<AgentRuntimeConfig["adapterOptions"]> = {};
  for (const [key, option] of entries) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/.test(key) ||
      SECRET_CONFIG_KEY.test(key) ||
      (typeof option !== "string" &&
        typeof option !== "number" &&
        typeof option !== "boolean") ||
      (typeof option === "string" &&
        (option.length > 4_096 || /[\0\r\n]/.test(option))) ||
      (typeof option === "number" && !Number.isFinite(option))
    ) {
      throw new Error("Runtime adapter options are invalid.");
    }
    options[key] = option;
  }
  return options;
}

function runtimeConfigFrom(value: unknown): AgentRuntimeConfig {
  if (!isRecord(value)) return {};
  for (const key of Object.keys(value)) {
    if (SECRET_CONFIG_KEY.test(key)) {
      throw new Error(
        "Runtime credentials must use the protected connection store.",
      );
    }
  }
  const transport = value.transport;
  if (transport !== undefined && transport !== "http" && transport !== "cli") {
    throw new Error("Runtime transport must be http or cli.");
  }
  const agentTransport = value.agentTransport;
  if (
    agentTransport !== undefined &&
    agentTransport !== "gateway-v1" &&
    agentTransport !== "local-cli" &&
    agentTransport !== "local-api" &&
    agentTransport !== "local-web"
  ) {
    throw new Error("Runtime agent transport is invalid.");
  }
  const timeoutMs = value.timeoutMs;
  if (
    timeoutMs !== undefined &&
    (typeof timeoutMs !== "number" ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1_000 ||
      timeoutMs > MAX_RUNTIME_TIMEOUT_MS)
  ) {
    throw new Error(
      "Runtime timeout must be between 1000 and 600000 milliseconds.",
    );
  }
  const endpoint = optionalString(value.endpoint, 2048);
  const rawRemoteGateway = value.remoteGateway;
  if (rawRemoteGateway !== undefined && !isRecord(rawRemoteGateway)) {
    throw new Error("Remote Gateway configuration is invalid.");
  }
  const remoteGateway = rawRemoteGateway
    ? rawRemoteGateway.protocol === "agents-one-v1"
      ? { protocol: "agents-one-v1" as const }
      : (() => {
          throw new Error("Remote Gateway protocol is invalid.");
        })()
    : undefined;
  const workspaceGatewayEndpoint = optionalString(
    value.workspaceGatewayEndpoint,
    2048,
  );
  // ACP launch parameters are still bounded, but a Node-based Windows shim
  // or a diagnostic `-e` helper may legitimately exceed a short CLI token.
  const acpArgs = optionalStringArray(value.acpArgs, 32, 4_096);
  const agent = optionalString(value.agent, 256);
  const adapterOptions = runtimeAdapterOptionsFrom(value.adapterOptions);
  const rawConnect = value.connect;
  let connect: AgentRuntimeConfig["connect"];
  if (rawConnect !== undefined) {
    if (!isRecord(rawConnect))
      throw new Error("Connect configuration is invalid.");
    const connectEndpoint = optionalString(rawConnect.endpoint, 2048);
    const connectRuntimeId = optionalString(rawConnect.runtimeId, 64);
    const connectDeviceId = optionalString(rawConnect.deviceId, 128);
    if (
      !connectEndpoint ||
      !connectRuntimeId ||
      !RUNTIME_ID.test(connectRuntimeId) ||
      (connectDeviceId !== undefined &&
        !/^[A-Za-z0-9_-]{1,128}$/.test(connectDeviceId))
    ) {
      throw new Error("Connect endpoint/runtimeId are invalid.");
    }
    connect = {
      endpoint: connectEndpoint,
      runtimeId: connectRuntimeId,
      ...(connectDeviceId ? { deviceId: connectDeviceId } : {}),
    };
  }
  const hermes = runtimeHermesConnectionFrom(value.hermes, endpoint);
  const rawWebAgent = value.webAgent;
  let webAgent: WebAgentRuntimeSettings | undefined;
  if (rawWebAgent !== undefined) {
    if (
      !isRecord(rawWebAgent) ||
      !WEB_AGENT_PROVIDERS.includes(rawWebAgent.provider as WebAgentProvider)
    ) {
      throw new Error("Web Agent configuration is invalid.");
    }
    const provider = rawWebAgent.provider as WebAgentProvider;
    const profileId = optionalString(rawWebAgent.profileId, 128);
    const adapterVersion = optionalString(rawWebAgent.adapterVersion, 64);
    if (
      !profileId ||
      !adapterVersion ||
      (rawWebAgent.enabled !== undefined &&
        typeof rawWebAgent.enabled !== "boolean")
    ) {
      throw new Error("Web Agent profile or adapter configuration is invalid.");
    }
    webAgent = {
      provider,
      profileId: normalizeWebAgentProfileId(profileId),
      adapterVersion,
      enabled: rawWebAgent.enabled !== false,
    };
  }
  const knownKeys = new Set([
    "endpoint",
    "remoteGateway",
    "workspaceGatewayEndpoint",
    "connect",
    "transport",
    "agentTransport",
    "executablePath",
    "acpArgs",
    "agent",
    "adapterOptions",
    "model",
    "workspace",
    "timeoutMs",
    "hermes",
    "webAgent",
  ]);
  // Keep forward-compatible, non-secret Runtime options intact. Top-level
  // secret-looking keys were rejected above; known fields below still win so
  // old configs cannot shadow the normalized values.
  const unknownConfig = Object.fromEntries(
    Object.entries(value).filter(([key]) => !knownKeys.has(key)),
  );
  return {
    ...unknownConfig,
    endpoint,
    ...(remoteGateway ? { remoteGateway } : {}),
    workspaceGatewayEndpoint,
    ...(connect ? { connect } : {}),
    transport,
    ...(agentTransport ? { agentTransport } : {}),
    executablePath: optionalString(value.executablePath, 4096),
    ...(acpArgs ? { acpArgs } : {}),
    ...(agent ? { agent } : {}),
    ...(adapterOptions ? { adapterOptions } : {}),
    model: optionalString(value.model, 256),
    workspace: optionalString(value.workspace, 4096),
    timeoutMs: timeoutMs as number | undefined,
    ...(hermes ? { hermes } : {}),
    ...(webAgent ? { webAgent } : {}),
  };
}

function runtimeHermesConnectionFrom(
  value: unknown,
  _endpoint?: string,
): NonNullable<AgentRuntimeConfig["hermes"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error(
      "Hermes Agent Runtime connection configuration is invalid.",
    );
  }
  // Legacy SSH/remote modes were removed (plan D4/D5) — the unified remote
  // transport is Gateway v1. Old persisted modes are read as local; legacy
  // SSH runtimes are additionally flagged for re-setup in normalizeUserRuntime.
  const mode = value.mode;
  if (mode !== "local" && mode !== "remote" && mode !== "ssh") {
    throw new Error("Hermes Agent Runtime connection mode is invalid.");
  }
  return {
    mode: "local",
    dashboardUrl: optionalString(value.dashboardUrl, 2048),
  };
}

function runtimeAppearanceFrom(value: unknown): AgentRuntimeAppearance {
  if (!isRecord(value)) return {};
  const name = optionalString(value.name, 80);
  const color = optionalString(value.color, 16);
  const avatar =
    value.avatar === null ? null : optionalString(value.avatar, 700_000);
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) {
    throw new Error("Runtime display color must be a hex value.");
  }
  if (avatar && !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(avatar)) {
    throw new Error("Runtime avatar must be an image data URL.");
  }
  return { name, color, avatar };
}

function runtimeAppearances(): Record<string, AgentRuntimeAppearance> {
  const raw = readDesktopConfig()[RUNTIME_APPEARANCE_KEY];
  if (!isRecord(raw)) return {};
  const appearances: Record<string, AgentRuntimeAppearance> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!RUNTIME_ID.test(id)) continue;
    try {
      appearances[id] = runtimeAppearanceFrom(value);
    } catch {
      // Ignore an old or malformed visual override without blocking agents.
    }
  }
  return appearances;
}

function applyRuntimeAppearance(
  runtime: AgentRuntimeDefinition,
  appearance: AgentRuntimeAppearance | undefined,
): AgentRuntimeDefinition {
  if (!appearance) return runtime;
  return {
    ...runtime,
    ...(appearance.name ? { name: appearance.name } : {}),
    ...(appearance.color ? { color: appearance.color } : {}),
    ...(appearance.avatar !== undefined ? { avatar: appearance.avatar } : {}),
  };
}

const RUNTIME_KIND_ID = /^[a-z][a-z0-9._:-]{1,127}$/;
const RUNTIME_ADAPTER_ID = /^[a-z][a-z0-9._:-]{1,127}$/;
const RUNTIME_CONNECTION_PROFILES = new Set<AgentRuntimeConnectionProfile>([
  "local",
  "managed-connect",
  "self-hosted-gateway",
]);
const RUNTIME_PROBE_STATES = new Set<AgentRuntimeProbe["state"]>([
  "healthy",
  "degraded",
  "unreachable",
  "unsupported",
  "unknown",
]);

function runtimeCapabilitySnapshotFrom(
  value: unknown,
): AgentRuntimeCapabilities | undefined {
  if (!isRecord(value)) return undefined;
  const snapshot: AgentRuntimeCapabilities = {
    ...NO_AGENT_RUNTIME_CAPABILITIES,
  };
  let found = false;
  for (const key of [
    "chat",
    "taskDispatch",
    "streaming",
    "cancellation",
    "tools",
    "memory",
    "orchestration",
    "readOnlyPlanning",
    "mailbox",
    "securityEvents",
    "artifacts",
    "artifactUpload",
    "workspaceAccess",
    "commands",
    "modelSelection",
  ] as const) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (typeof candidate !== "boolean") {
      throw new Error("Runtime capability snapshot is invalid.");
    }
    snapshot[key] = candidate;
    found = true;
  }
  const eventStream = value.eventStream;
  if (isRecord(eventStream)) {
    const protocol = optionalString(eventStream.protocol, 64);
    const transport = optionalString(eventStream.transport, 32);
    if (
      protocol !== AGENT_EVENT_STREAM_V1 ||
      (transport !== "sse" && transport !== "poll" && transport !== "websocket")
    ) {
      throw new Error("Runtime capability event stream is invalid.");
    }
    const eventStreamSnapshot: AgentEventStreamSupport = {
      protocol: AGENT_EVENT_STREAM_V1,
      transport,
    };
    for (const key of [
      "reasoningSummaries",
      "toolEvents",
      "modelMetadata",
      "usageMetadata",
    ] as const) {
      const candidate = eventStream[key];
      if (candidate === undefined) continue;
      if (typeof candidate !== "boolean") {
        throw new Error("Runtime capability event stream is invalid.");
      }
      eventStreamSnapshot[key] = candidate;
    }
    snapshot.eventStream = eventStreamSnapshot;
    found = true;
  }
  const plugin = value.plugin;
  if (isRecord(plugin)) {
    const id = optionalString(plugin.id, 128);
    const version = optionalString(plugin.version, 64);
    const kind = optionalString(plugin.kind, 32);
    if (
      !id ||
      (kind !== undefined &&
        kind !== "remote-gateway" &&
        kind !== "cli-adapter")
    ) {
      throw new Error("Runtime capability plugin metadata is invalid.");
    }
    snapshot.plugin = {
      id,
      ...(version ? { version } : {}),
      ...(kind ? { kind } : {}),
    };
    found = true;
  }
  const compaction = value.compaction;
  if (compaction !== undefined) {
    if (
      compaction !== "native" &&
      compaction !== "platform" &&
      compaction !== "none"
    ) {
      throw new Error("Runtime capability compaction is invalid.");
    }
    snapshot.compaction = compaction;
    found = true;
  }
  const steering = value.steering;
  if (steering !== undefined) {
    if (
      steering !== "native" &&
      steering !== "cancel_resume" &&
      steering !== "follow_up" &&
      steering !== "none"
    ) {
      throw new Error("Runtime capability steering is invalid.");
    }
    snapshot.steering = steering;
    found = true;
  }
  const branching = value.branching;
  if (branching !== undefined) {
    if (
      branching !== "native" &&
      branching !== "platform" &&
      branching !== "none"
    ) {
      throw new Error("Runtime capability branching is invalid.");
    }
    snapshot.branching = branching;
    found = true;
  }
  return found ? snapshot : undefined;
}

function runtimeLastProbeFrom(
  value: unknown,
): AgentRuntimeDefinition["lastProbe"] {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("Runtime last probe is invalid.");
  const checkedAt = value.checkedAt;
  const state = value.state;
  if (
    typeof checkedAt !== "number" ||
    !Number.isInteger(checkedAt) ||
    checkedAt < 0 ||
    typeof state !== "string" ||
    !RUNTIME_PROBE_STATES.has(state as AgentRuntimeProbe["state"])
  ) {
    throw new Error("Runtime last probe is invalid.");
  }
  return {
    checkedAt,
    state: state as AgentRuntimeProbe["state"],
    message: optionalString(value.message, 1_000),
    gatewayProtocolVersion: optionalString(value.gatewayProtocolVersion, 32),
    hostVersion: optionalString(value.hostVersion, 64),
  };
}

function runtimeAdapterMetadataFrom(
  value: Record<string, unknown>,
  kind: string,
): Pick<
  AgentRuntimeDefinition,
  | "adapterId"
  | "vendorId"
  | "adapterVersion"
  | "authRef"
  | "capabilitySnapshot"
  | "lastProbe"
> {
  const explicitAdapterId = optionalString(value.adapterId, 128);
  if (explicitAdapterId && !RUNTIME_ADAPTER_ID.test(explicitAdapterId)) {
    throw new Error("Runtime adapterId is invalid.");
  }
  const manifest = explicitAdapterId
    ? manifestForAdapterId(explicitAdapterId)
    : manifestForRuntimeKind(kind);
  if (
    explicitAdapterId &&
    manifest &&
    !manifest.kinds.includes(kind) &&
    !manifest.legacyKinds?.includes(kind)
  ) {
    throw new Error("Runtime kind does not match adapterId.");
  }
  const vendorId = optionalString(value.vendorId, 128);
  const adapterVersion = optionalString(value.adapterVersion, 64);
  const authRef = optionalString(value.authRef, 256);
  return {
    ...(explicitAdapterId || manifest?.adapterId
      ? { adapterId: explicitAdapterId || manifest?.adapterId }
      : {}),
    ...(vendorId || manifest?.vendorId
      ? { vendorId: vendorId || manifest?.vendorId }
      : {}),
    ...(adapterVersion || manifest?.adapterVersion
      ? { adapterVersion: adapterVersion || manifest?.adapterVersion }
      : {}),
    ...(authRef ? { authRef } : {}),
    ...(value.capabilitySnapshot !== undefined
      ? {
          capabilitySnapshot: runtimeCapabilitySnapshotFrom(
            value.capabilitySnapshot,
          ),
        }
      : {}),
    ...(value.lastProbe !== undefined
      ? { lastProbe: runtimeLastProbeFrom(value.lastProbe) }
      : {}),
  };
}

function normalizeUserRuntime(value: unknown): AgentRuntimeDefinition | null {
  if (!isRecord(value)) return null;
  const id = optionalString(value.id, 64);
  const name = optionalString(value.name, 80);
  const kind = value.kind;
  const location = value.location;
  if (
    !id ||
    !name ||
    !RUNTIME_ID.test(id) ||
    RESERVED_RUNTIME_IDS.has(id) ||
    typeof kind !== "string" ||
    !RUNTIME_KIND_ID.test(kind) ||
    (location !== "local" && location !== "remote")
  ) {
    return null;
  }
  try {
    const rawConfig = value.config;
    // Legacy SSH runtimes are readable but must be re-set up on Gateway v1
    // before they can connect again (plan D4: SSH 删除).
    const legacySshMode =
      isRecord(rawConfig) &&
      isRecord(rawConfig.hermes) &&
      rawConfig.hermes.mode === "ssh";
    const config = runtimeConfigFrom(rawConfig);
    const connectionProfile = value.connectionProfile;
    if (
      connectionProfile !== undefined &&
      (typeof connectionProfile !== "string" ||
        !RUNTIME_CONNECTION_PROFILES.has(
          connectionProfile as AgentRuntimeConnectionProfile,
        ))
    ) {
      throw new Error("Runtime connection profile is invalid.");
    }
    const inferredProfile: AgentRuntimeConnectionProfile =
      location === "local"
        ? "local"
        : config.connect
          ? "managed-connect"
          : "self-hosted-gateway";
    const configurationIssue =
      connectionProfile && connectionProfile !== inferredProfile
        ? {
            code: "connection-profile-conflict" as const,
            explicitProfile: connectionProfile as AgentRuntimeConnectionProfile,
            inferredProfile,
            message:
              `显式接入方式“${connectionProfile}”与旧配置推断的“${inferredProfile}”冲突；` +
              "请明确切换接入方式后再保存。",
          }
        : undefined;
    const runtime: AgentRuntimeDefinition = {
      id,
      name,
      kind,
      ...(connectionProfile
        ? {
            connectionProfile:
              connectionProfile as AgentRuntimeConnectionProfile,
          }
        : {}),
      ...(configurationIssue ? { configurationIssue } : {}),
      ...runtimeAdapterMetadataFrom(value, kind),
      location,
      enabled: value.enabled !== false,
      needsReauthorization:
        value.needsReauthorization === true || legacySshMode,
      managed: "user",
      config,
    };
    if (!config.agentTransport) {
      runtime.config = {
        ...config,
        agentTransport: deriveAgentTransport(runtime),
      };
    }
    if (
      (runtime.kind === "web-agent" &&
        (!runtime.config.webAgent ||
          runtime.config.agentTransport !== "local-web")) ||
      (runtime.kind !== "web-agent" &&
        (runtime.config.webAgent ||
          runtime.config.agentTransport === "local-web"))
    ) {
      return null;
    }
    return runtime;
  } catch {
    return null;
  }
}

function userRuntimes(): AgentRuntimeDefinition[] {
  const raw = readDesktopConfig()[RUNTIME_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeUserRuntime)
    .filter((runtime): runtime is AgentRuntimeDefinition => runtime !== null);
}

/** Persist probe metadata serially so concurrent Settings probes cannot lose updates. */
async function persistRuntimeProbe(
  runtimeId: string,
  probe: AgentRuntimeProbe,
): Promise<void> {
  const write = async (): Promise<void> => {
    const runtimes = userRuntimes();
    const index = runtimes.findIndex((runtime) => runtime.id === runtimeId);
    if (index < 0) return;
    runtimes[index] = {
      ...runtimes[index],
      capabilitySnapshot: probe.capabilities,
      lastProbe: {
        checkedAt: probe.checkedAt,
        state: probe.state,
        ...(probe.message ? { message: probe.message } : {}),
        ...(probe.gatewayProtocolVersion
          ? { gatewayProtocolVersion: probe.gatewayProtocolVersion }
          : {}),
        ...(probe.hostVersion ? { hostVersion: probe.hostVersion } : {}),
      },
    };
    writeUserRuntimes(runtimes);
  };
  runtimeProbeWriteQueue = runtimeProbeWriteQueue.then(write, write);
  await runtimeProbeWriteQueue;
}

export function workspaceGatewayTokenSecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${WORKSPACE_GATEWAY_TOKEN_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_TOKEN`;
}

export function agentsOneGatewayTokenSecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${AGENTS_ONE_GATEWAY_TOKEN_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_TOKEN`;
}

function isAgentsOneGatewayRuntime(runtime: AgentRuntimeDefinition): boolean {
  return (
    runtime.location === "remote" &&
    runtime.config.remoteGateway?.protocol === "agents-one-v1"
  );
}

function isRemoteOpenCodeRuntime(runtime: {
  kind: string;
  adapterId?: string;
  location: AgentRuntimeLocation;
}): boolean {
  return (
    runtime.location === "remote" &&
    (runtime.kind === "opencode" || runtime.adapterId === "opencode")
  );
}

/** Canonical transport classifiers (Agents One unified model).
 * `gateway-v1` = remote via one URL + one token; `local-cli` = local
 * executable path (Pi/Claude Code/Codex); `local-api` = local HTTP API
 * (built-in Hermes).  Falls back to `deriveAgentTransport` for legacy
 * persisted runtimes without an explicit `agentTransport`.
 */
function isGatewayTransport(runtime: AgentRuntimeDefinition): boolean {
  return deriveAgentTransport(runtime) === "gateway-v1";
}

function isLocalCliTransport(runtime: AgentRuntimeDefinition): boolean {
  return deriveAgentTransport(runtime) === "local-cli";
}

function isLocalApiTransport(runtime: AgentRuntimeDefinition): boolean {
  return deriveAgentTransport(runtime) === "local-api";
}

function isLocalWebTransport(runtime: AgentRuntimeDefinition): boolean {
  return deriveAgentTransport(runtime) === "local-web";
}

function runtimeAdapterFor(
  runtime: AgentRuntimeDefinition,
): RuntimeAdapter | undefined {
  return resolveRuntimeAdapter(runtime);
}

function unsupportedRuntimeProbe(
  runtime: AgentRuntimeDefinition,
  checkedAt: number,
  message = `${runtime.kind} 适配器尚未安装。`,
): AgentRuntimeProbe {
  return {
    runtimeId: runtime.id,
    state: "unsupported",
    capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
    checkedAt,
    message,
  };
}

function remoteRuntimeForCredential(runtimeId: string): AgentRuntimeDefinition {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime || !isAgentsOneGatewayRuntime(runtime)) {
    throw new Error("Only remote Gateway v1 runtimes may store a credential.");
  }
  return runtime;
}

function runtimeAuth(
  runtime: AgentRuntimeDefinition,
): { bearerToken?: string } | undefined {
  if (runtime.needsReauthorization) return undefined;
  if (isAgentsOneGatewayRuntime(runtime)) {
    const key = agentsOneGatewayTokenSecretKey(runtime.id);
    const token = (readDesktopManagedRuntimeSecret(key) || "").trim();
    return token ? { bearerToken: token } : undefined;
  }

  return undefined;
}

export function getAgentRuntimeCredentialStatus(runtimeId: string): {
  required: boolean;
  configured: boolean;
  storage?: DesktopSecretStatus;
} {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (!isAgentsOneGatewayRuntime(runtime)) {
    return { required: false, configured: false };
  }
  const key = agentsOneGatewayTokenSecretKey(runtime.id);
  const configuredValue = readDesktopManagedRuntimeSecret(key);
  const storage = desktopSecretStore()?.status(key);
  return {
    required: true,
    configured:
      runtime.needsReauthorization !== true && Boolean(configuredValue),
    ...(storage ? { storage } : {}),
  };
}

function readDesktopManagedRuntimeSecret(key: string): string | null {
  const injected = process.env[key];
  if (injected != null && injected !== "") return injected;
  const store = desktopSecretStore();
  if (!store) return getSecret(key);
  const protectedOrLegacy = store.get(key, {
    // Only migrate the legacy value that the desktop itself wrote to .env.
    // Process-injected and command-provider values remain externally managed.
    read: () => readEnv()[key] || null,
    remove: () => {
      deleteEnvValue(key);
      invalidateSecretsCache();
    },
  });
  return protectedOrLegacy || getSecret(key);
}

function writeDesktopManagedRuntimeSecret(
  key: string,
  value: string,
): DesktopSecretStatus | undefined {
  const store = desktopSecretStore();
  if (!store || !store.protector.available) {
    setEnvValue(key, value);
    return store?.status(key);
  }
  return store.set(key, value, {
    read: () => readEnv()[key] || null,
    remove: () => deleteEnvValue(key),
  });
}

function markRuntimeReauthorized(runtimeId: string): void {
  const runtimes = userRuntimes();
  const runtime = runtimes.find((item) => item.id === runtimeId);
  if (!runtime?.needsReauthorization) return;
  runtime.needsReauthorization = false;
  writeUserRuntimes(runtimes);
}

export function setAgentRuntimeBearerToken(
  runtimeId: string,
  bearerToken: string,
): {
  configured: true;
  storage?: DesktopSecretStatus;
} {
  const runtime = remoteRuntimeForCredential(runtimeId);
  if (
    typeof bearerToken !== "string" ||
    bearerToken.trim().length < 8 ||
    bearerToken.length > 4096 ||
    /[\0\r\n]/.test(bearerToken)
  ) {
    throw new Error("Remote agent credential is invalid.");
  }
  const storage = writeDesktopManagedRuntimeSecret(
    agentsOneGatewayTokenSecretKey(runtime.id),
    bearerToken.trim(),
  );
  markRuntimeReauthorized(runtimeId);
  invalidateSecretsCache();
  invalidateRuntimeCommandCatalog(runtimeId);
  return { configured: true, ...(storage ? { storage } : {}) };
}

/** Stores the credential used only by a separately hosted workspace gateway. */
export function setAgentRuntimeWorkspaceGatewayToken(
  runtimeId: string,
  bearerToken: string,
): { configured: true; storage?: DesktopSecretStatus } {
  const runtime = remoteRuntimeForCredential(runtimeId);
  if (
    typeof bearerToken !== "string" ||
    bearerToken.trim().length < 8 ||
    bearerToken.length > 4096 ||
    /[\0\r\n]/.test(bearerToken)
  ) {
    throw new Error("Remote workspace gateway credential is invalid.");
  }
  const storage = writeDesktopManagedRuntimeSecret(
    workspaceGatewayTokenSecretKey(runtime.id),
    bearerToken.trim(),
  );
  invalidateSecretsCache();
  invalidateRuntimeCommandCatalog(runtimeId);
  return { configured: true, ...(storage ? { storage } : {}) };
}

function remoteWorkspaceInstruction(
  grantId: string,
  permission: "read" | "safe_write" | "write",
): string {
  return [
    "【受控本机工作区】本次任务已由 Agents One 授予项目范围内的受控访问；授权不会自动到期，任务结束、取消或明确撤销时失效。",
    `授权标识：desktop-gateway:${grantId}；权限：${permission === "write" ? "完全访问" : permission === "safe_write" ? "可读写，无移动、删除文件权限" : "只读"}。`,
    `只能通过 Bridge 的 workspace-gateway 工具提交项目相对路径的 ${permission === "write" ? "list/read/write/move/delete" : permission === "safe_write" ? "list/read/write" : "list/read"} 请求；不得使用或猜测办公电脑绝对路径。`,
    "每项文件变更完成后须在答复中说明相对路径、SHA-256 与变更摘要。",
  ].join("\n");
}

function startWorkspaceGatewayPolling(record: RuntimeRunRecord): void {
  const session = record.workspaceGateway;
  if (!session) return;
  const poll = async (): Promise<void> => {
    if (session.stopped || record.run.status !== "running") return;
    try {
      const result = await session.gateway.pollOnce();
      session.failures = 0;
      if (result) {
        const audit = session.gateway.audit.at(-1);
        appendRuntimeEvent(
          record,
          result.status === "succeeded" ? "tool_result" : "error",
          audit
            ? `受控工作区 ${audit.operation}：${result.summary}`
            : `受控工作区：${result.summary}`,
        );
      }
    } catch (error) {
      session.failures += 1;
      if (session.failures === 1 || session.failures % 3 === 0) {
        appendRuntimeEvent(
          record,
          "error",
          `受控工作区网关暂时不可用：${
            error instanceof Error ? error.message : "请求失败"
          }`,
        );
      }
    }
    if (!session.stopped && record.run.status === "running") {
      session.timer = setTimeout(
        () => void poll(),
        REMOTE_WORKSPACE_POLL_INTERVAL_MS,
      );
    }
  };
  void poll();
}

function writeUserRuntimes(runtimes: AgentRuntimeDefinition[]): void {
  const config = readDesktopConfig();
  config[RUNTIME_CONFIG_KEY] = runtimes.map(
    ({ managed: _managed, ...runtime }) => runtime,
  );
  writeDesktopConfig(config);
}

function builtInHermesRuntime(): AgentRuntimeDefinition {
  return {
    id: "hermes-local",
    name: "Hermes Agent Runtime",
    kind: "hermes",
    adapterId: "hermes",
    vendorId: "agents-one",
    adapterVersion: "1.0.0",
    connectionProfile: "local",
    location: "local",
    enabled: true,
    managed: "builtin",
    config: {
      transport: "cli",
      agentTransport: "local-api",
      timeoutMs: 15_000,
    },
  };
}

function defaultWindowsCommand(commandName: string): string {
  if (process.platform !== "win32") return commandName.replace(/\.cmd$/i, "");
  const path = process.env.PATH || process.env.Path || "";
  for (const directory of path.split(delimiter)) {
    if (!directory.trim()) continue;
    const candidate = join(directory, commandName);
    if (existsSync(candidate)) return candidate;
  }
  return commandName;
}

function defaultPiRuntime(): AgentRuntimeDefinition {
  return {
    id: "pi",
    name: "Pi",
    kind: "pi",
    adapterId: "pi",
    vendorId: "badlogic",
    adapterVersion: "1.0.0",
    connectionProfile: "local",
    location: "local",
    enabled: true,
    managed: "user",
    color: "#7C3AED",
    config: {
      executablePath: defaultWindowsCommand("pi.cmd"),
      transport: "cli",
      agentTransport: "local-cli",
      timeoutMs: DEFAULT_TASK_TIMEOUT_MS,
    },
  };
}

export function listAgentRuntimes(): AgentRuntimeDefinition[] {
  const appearances = runtimeAppearances();
  const users = userRuntimes();
  const hasPi = users.some((runtime) => runtime.kind === "pi");
  const defaults = hasPi ? [] : [defaultPiRuntime()];
  // The legacy local Hermes entry is a built-in adapter, but it should not be
  // advertised when the actual Hermes executable is absent. A desktop.json
  // or other leftover data directory is not proof that Hermes is installed.
  const builtIns = existsSync(HERMES_SCRIPT) ? [builtInHermesRuntime()] : [];
  return [...builtIns, ...defaults, ...users].map((runtime) =>
    applyRuntimeAppearance(runtime, appearances[runtime.id]),
  );
}

function runtimeEndpointHost(endpoint: string | undefined): string | undefined {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).host;
  } catch {
    return undefined;
  }
}

function runtimeTlsState(
  endpoint: string | undefined,
): "trusted-https" | "loopback-http" | "not-applicable" | "unknown" {
  if (!endpoint) return "not-applicable";
  try {
    const url = new URL(endpoint);
    if (url.protocol === "https:") return "trusted-https";
    if (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "::1")
    ) {
      return "loopback-http";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

function lastRunSequence(run: AgentRuntimeRun): number | undefined {
  const id = run.events?.at(-1)?.id;
  const match = id?.match(/:(\d+)$/);
  return match ? Number(match[1]) : undefined;
}

/**
 * Build the layered, redacted Settings diagnostic snapshot. The Connect
 * device status is best-effort: an unavailable status endpoint must not hide
 * the local adapter/probe information that can still explain the failure.
 */
export async function getAgentRuntimeDiagnostics(
  runtimeId: string,
  desktopVersion?: string,
): Promise<AgentRuntimeDiagnostics> {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  const profile = deriveAgentRuntimeConnectionProfile(runtime);
  const transport = deriveAgentTransport(runtime);
  const probe = runtime.lastProbe;
  const currentRun = [...runtimeRuns.values()]
    .filter((record) => record.run.runtimeId === runtime.id)
    .sort((left, right) => right.run.startedAt - left.run.startedAt)[0];
  const lastRun = currentRun?.run;
  const actualModel = lastRun?.actualModel || lastRun?.model;
  const requestedModel = lastRun?.requestedModel || runtime.config.model;
  const credentialStatus = getAgentRuntimeCredentialStatus(runtime.id);
  const connectionEndpoint =
    runtime.config.connect?.endpoint || runtime.config.endpoint;
  const connection: AgentRuntimeDiagnostics["connection"] = {
    profile,
    state: profile === "local" ? "not-applicable" : "unknown",
    ...(runtimeEndpointHost(connectionEndpoint)
      ? { endpointHost: runtimeEndpointHost(connectionEndpoint) }
      : {}),
    tls: runtimeTlsState(connectionEndpoint),
    ...(runtime.config.connect?.deviceId
      ? { deviceId: runtime.config.connect.deviceId }
      : {}),
  };

  if (profile === "managed-connect") {
    const token = runtimeAuth(runtime)?.bearerToken;
    if (!runtime.config.connect?.deviceId) {
      connection.message =
        "已配对配置缺少 deviceId；请重新完成一次 Connect 配对以补齐设备引用。";
    } else if (!token) {
      connection.message = "Connect Runtime Token 尚未配置。";
    } else {
      try {
        const status = await getAgentsOneConnectDeviceStatus(
          runtime.config.connect.endpoint,
          runtime.config.connect.deviceId,
          token,
        );
        connection.state = status.state;
        connection.checkedAt = status.checkedAt;
        if (status.lastSeenAt !== undefined)
          connection.lastSeenAt = status.lastSeenAt;
        if (status.protocolVersion)
          connection.protocolVersion = status.protocolVersion;
        if (status.connectorVersion)
          connection.connectorVersion = status.connectorVersion;
        if (status.reason) connection.message = status.reason;
      } catch (error) {
        connection.message = redactSensitiveText(
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  } else if (profile === "self-hosted-gateway") {
    connection.state =
      probe?.state === "healthy"
        ? "online"
        : probe?.state === "unreachable"
          ? "offline"
          : "unknown";
  }

  return {
    generatedAt: Date.now(),
    desktopVersion: desktopVersion?.trim() || "development",
    ...(probe?.gatewayProtocolVersion
      ? { gatewayProtocolVersion: probe.gatewayProtocolVersion }
      : {}),
    runtime: {
      id: runtime.id,
      name: runtime.name,
      kind: runtime.kind,
      location: runtime.location,
      enabled: runtime.enabled,
      connectionProfile: profile,
      transport,
      ...(runtime.adapterId ? { adapterId: runtime.adapterId } : {}),
      ...(runtime.adapterVersion
        ? { adapterVersion: runtime.adapterVersion }
        : {}),
    },
    connection,
    host: {
      state: probe?.state || "unknown",
      ...(probe?.hostVersion ? { version: probe.hostVersion } : {}),
      ...(runtime.adapterId ? { adapterId: runtime.adapterId } : {}),
      ...(runtime.adapterVersion
        ? { adapterVersion: runtime.adapterVersion }
        : {}),
      ...(probe?.message ? { message: probe.message } : {}),
      ...(probe?.checkedAt ? { checkedAt: probe.checkedAt } : {}),
      ...(runtime.capabilitySnapshot?.plugin
        ? { plugin: runtime.capabilitySnapshot.plugin }
        : {}),
    },
    provider: {
      authConfigured: credentialStatus.configured,
      ...(requestedModel ? { requestedModel } : {}),
      ...(actualModel ? { actualModel } : {}),
      modelSource: actualModel
        ? "provider-reported"
        : requestedModel
          ? "configured"
          : "unknown",
    },
    ...(lastRun
      ? {
          lastRun: {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            ...(lastRun.completedAt
              ? { completedAt: lastRun.completedAt }
              : {}),
            eventCount: lastRun.events?.length || 0,
            ...(lastRunSequence(lastRun) !== undefined
              ? { lastSequence: lastRunSequence(lastRun) }
              : {}),
            reconnectFailures: currentRun?.remoteGateway?.failures || 0,
            ...(lastRun.error
              ? { error: redactSensitiveText(lastRun.error) }
              : {}),
          },
        }
      : {}),
  };
}

function runtimeCommandCacheKey(runtimeId: string, sessionId?: string): string {
  return `${runtimeId}:${sessionId?.trim() || "none"}`;
}

function piThinkingLevelsCacheKey(runtimeId: string): string {
  return runtimeId;
}

function piThinkingLevelsFromResponse(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.levels)) return [];
  return [
    ...new Set(
      data.levels.filter(
        (level): level is string =>
          typeof level === "string" && Boolean(level.trim()),
      ),
    ),
  ];
}

async function piAvailableThinkingLevels(
  runtime: AgentRuntimeDefinition,
  sessionId: string,
): Promise<string[]> {
  const key = piThinkingLevelsCacheKey(runtime.id);
  const cached = piThinkingLevelsCache.get(key);
  if (
    cached &&
    Date.now() - cached.fetchedAt < PI_THINKING_LEVELS_CACHE_TTL_MS
  ) {
    return cached.levels;
  }
  const pending = piThinkingLevelsInFlight.get(key);
  if (pending) return pending;
  const request = executePiRpcCommand(
    { executablePath: runtime.config.executablePath },
    // This is an optional picker catalogue, never a task. Do not block the
    // chat for the generic 20-second RPC timeout if Pi has a transient lock.
    { type: "get_available_thinking_levels", sessionId, timeoutMs: 2_500 },
  )
    .then((response) => {
      const levels = piThinkingLevelsFromResponse(response.data);
      piThinkingLevelsCache.set(key, { fetchedAt: Date.now(), levels });
      return levels;
    })
    .catch((error) => {
      // A stale verified catalogue is safer and more useful than surfacing an
      // internal RPC transport error to the user.
      if (cached?.levels.length) return cached.levels;
      throw error;
    })
    .finally(() => {
      piThinkingLevelsInFlight.delete(key);
    });
  piThinkingLevelsInFlight.set(key, request);
  return request;
}

function baseRuntimeControlCommands(
  runtime: AgentRuntimeDefinition,
  capabilities?: AgentRuntimeCapabilities,
): RuntimeCommandDescriptor[] {
  const commands: RuntimeCommandDescriptor[] = [
    {
      name: "new",
      description: "新建当前 Runtime 对话",
      category: "Chat",
      source: "desktop",
      target: "desktop",
      availability: "any",
    },
    {
      name: "clear",
      description: "清空并新建当前 Runtime 对话",
      category: "Chat",
      source: "desktop",
      target: "desktop",
      availability: "any",
    },
    {
      name: "status",
      description: "查看当前运行时、会话和模型状态",
      category: "Runtime",
      source: "desktop",
      target: "runtime-control",
      availability: "any",
    },
    {
      name: "abort",
      aliases: ["stop"],
      description: "停止当前运行中的任务",
      category: "Runtime",
      source: "desktop",
      target: "runtime-control",
      availability: "running",
    },
  ];
  if (["pi", "codex"].includes(runtime.kind) || capabilities?.modelSelection) {
    commands.push({
      name: "model",
      description: "选择当前会话模型",
      category: "Runtime",
      source: "desktop",
      target: "runtime-control",
      availability: "any",
      argumentHint: "<provider/model>",
    });
  }
  if (runtime.kind === "pi") {
    commands.push({
      name: "thinking",
      description: "查看或切换当前会话的思考等级",
      category: "Runtime",
      source: "desktop",
      target: "runtime-control",
      availability: "idle",
      argumentHint: "[off|minimal|low|medium|high|xhigh|max]",
    });
  }
  if (
    ["pi", "codex"].includes(runtime.kind) ||
    (capabilities?.compaction && capabilities.compaction !== "none")
  ) {
    commands.push({
      name: "compact",
      description: `压缩当前 ${
        runtime.kind === "pi"
          ? "Pi"
          : runtime.kind === "codex"
            ? "Codex"
            : runtime.kind === "claude-code"
              ? "Claude Code"
              : "Runtime"
      } 会话上下文`,
      category: "Runtime",
      source: "desktop",
      target: "runtime-control",
      availability: "idle",
      ...(runtime.kind === "pi" || runtime.kind === "claude-code"
        ? { argumentHint: "[保留重点]" }
        : {}),
    });
  }
  return commands;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || typeof value[key] !== "string") return undefined;
  const text = value[key].trim();
  return text || undefined;
}

function piModelLabel(value: unknown): string | undefined {
  const provider = stringField(value, "provider");
  const modelId = stringField(value, "id") || stringField(value, "modelId");
  return modelId ? (provider ? `${provider}/${modelId}` : modelId) : undefined;
}

function piModelsFromResponse(data: unknown): RuntimeModelOption[] {
  const models =
    isRecord(data) && Array.isArray(data.models) ? data.models : [];
  const seen = new Set<string>();
  const result: RuntimeModelOption[] = [];
  for (const raw of models) {
    const provider = stringField(raw, "provider");
    const modelId = stringField(raw, "id") || stringField(raw, "modelId");
    if (!modelId) continue;
    const id = provider ? `${provider}/${modelId}` : modelId;
    if (seen.has(id)) continue;
    seen.add(id);
    const displayName =
      stringField(raw, "name") || stringField(raw, "displayName");
    const thinking =
      isRecord(raw) && Array.isArray(raw.thinkingLevels)
        ? raw.thinkingLevels.filter(
            (level): level is string => typeof level === "string",
          )
        : undefined;
    result.push({
      id,
      ...(provider ? { provider } : {}),
      ...(displayName ? { displayName } : {}),
      ...(thinking?.length ? { reasoningEfforts: thinking } : {}),
    });
  }
  return result.sort((left, right) => left.id.localeCompare(right.id));
}

function piNativeCommandsFromResponse(
  data: unknown,
): RuntimeCommandDescriptor[] {
  const commands =
    isRecord(data) && Array.isArray(data.commands) ? data.commands : [];
  const mapped: RuntimeCommandDescriptor[] = [];
  for (const raw of commands) {
    const name = stringField(raw, "name");
    if (!name) continue;
    const source = stringField(raw, "source");
    mapped.push({
      name,
      description:
        stringField(raw, "description") || `执行 Pi 原生命令 /${name}`,
      category: source === "skill" ? "Pi Skills" : "Pi Commands",
      source:
        source === "skill"
          ? "skill"
          : source === "extension"
            ? "plugin"
            : "runtime",
      target: "runtime-native",
      availability: "any",
      ...(source === "skill" || source === "prompt"
        ? { argumentHint: "[参数]" }
        : {}),
    });
  }
  return mapped;
}

function claudeAgentSdkConfig(runtime: AgentRuntimeDefinition): {
  executablePath?: string;
  workspace?: string;
  timeoutMs?: number;
} {
  return {
    executablePath: runtime.config.executablePath,
    workspace: runtime.config.workspace,
    timeoutMs: runtime.config.timeoutMs,
  };
}

function claudeModelsFromSdk(
  models: Awaited<ReturnType<typeof listClaudeAgentSdkModels>>,
): RuntimeModelOption[] {
  const seen = new Set<string>();
  return models.flatMap((model) => {
    const id = model.value?.trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [
      {
        id,
        ...(model.displayName?.trim()
          ? { displayName: model.displayName.trim() }
          : {}),
        ...(model.supportedEffortLevels?.length
          ? { reasoningEfforts: [...model.supportedEffortLevels] }
          : {}),
      },
    ];
  });
}

function claudeNativeCommandsFromSdk(
  commands: Awaited<ReturnType<typeof listClaudeAgentSdkCommands>>,
): RuntimeCommandDescriptor[] {
  return commands.map((command) => ({
    name: command.name,
    ...(command.aliases?.length ? { aliases: command.aliases } : {}),
    description: command.description || `执行 Claude Code /${command.name}`,
    category: "Claude Code",
    source: "skill",
    target: "runtime-native",
    availability: "idle",
    ...(command.argumentHint?.trim()
      ? { argumentHint: command.argumentHint.trim() }
      : {}),
  }));
}

function configuredModelOption(
  runtime: AgentRuntimeDefinition,
): RuntimeModelOption[] {
  const configured = runtime.config.model?.trim();
  return configured
    ? [{ id: configured, displayName: configured, isDefault: true }]
    : [];
}

async function piRuntimeModels(
  runtime: AgentRuntimeDefinition,
  sessionId?: string,
): Promise<RuntimeModelOption[]> {
  // Pi persists provider/model metadata locally. Reading that small catalogue
  // is effectively immediate on Windows, whereas starting a fresh Pi RPC
  // process only to enumerate the same metadata often takes several seconds.
  // Keep RPC as the compatibility fallback for installations without it.
  const configured = getPiConfiguredModels();
  if (configured.length) {
    return configured.map((model) => ({
      id: `${model.provider}/${model.id}`,
      provider: model.provider,
      ...(model.displayName ? { displayName: model.displayName } : {}),
      ...(model.reasoningEfforts?.length
        ? { reasoningEfforts: model.reasoningEfforts }
        : {}),
    }));
  }
  const response = await executePiRpcCommand(
    { executablePath: runtime.config.executablePath },
    { type: "get_available_models", sessionId },
  );
  return piModelsFromResponse(response.data);
}

async function runtimeModels(
  runtime: AgentRuntimeDefinition,
  sessionId?: string,
): Promise<RuntimeModelOption[]> {
  if (runtime.kind === "pi") return piRuntimeModels(runtime, sessionId);
  if (runtime.kind === "codex") {
    const models = await listCodexAppServerModels({
      executablePath: runtime.config.executablePath,
    });
    return models;
  }
  if (runtime.kind === "claude-code") {
    return claudeModelsFromSdk(
      await listClaudeAgentSdkModels(claudeAgentSdkConfig(runtime), sessionId),
    );
  }
  return configuredModelOption(runtime);
}

/** Return the command catalogue that belongs to one Runtime conversation. */
export async function getAgentRuntimeCommandCatalog(
  runtimeId: string,
  sessionId?: string,
): Promise<RuntimeCommandCatalogSnapshot> {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  const key = runtimeCommandCacheKey(runtimeId, sessionId);
  const cached = runtimeCommandCatalogCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < RUNTIME_COMMAND_CATALOG_TTL_MS) {
    return { commands: cached.commands, fetchedAt: cached.fetchedAt };
  }

  let nativeCommands: RuntimeCommandDescriptor[] = [];
  let capabilities: AgentRuntimeCapabilities | undefined;
  if (runtime.kind === "pi") {
    try {
      const response = await executePiRpcCommand(
        { executablePath: runtime.config.executablePath },
        { type: "get_commands", sessionId },
      );
      nativeCommands = piNativeCommandsFromResponse(response.data);
    } catch {
      // Command discovery is additive. Base controls must remain usable if a
      // provider has no configured model or its optional RPC call fails.
    }
  }
  if (runtime.kind === "claude-code") {
    try {
      nativeCommands = claudeNativeCommandsFromSdk(
        await listClaudeAgentSdkCommands(
          claudeAgentSdkConfig(runtime),
          sessionId,
        ),
      );
      capabilities = {
        ...NO_AGENT_RUNTIME_CAPABILITIES,
        modelSelection: true,
        compaction: "native",
      };
    } catch {
      // The normal Claude Code CLI remains available when SDK credentials or
      // initialization are unavailable. Do not advertise controls we could
      // not discover from the provider.
    }
  }
  if (isAgentsOneGatewayRuntime(runtime) && runtime.config.endpoint) {
    const auth = runtimeAuth(runtime);
    try {
      const probe = await probeAgentsOneRemoteGateway(
        {
          endpoint: runtime.config.endpoint,
          timeoutMs: runtime.config.timeoutMs,
          connect: runtime.config.connect,
        },
        auth,
      );
      capabilities = probe.capabilities;
      if (probe.healthy && probe.capabilities.commands) {
        const remote = await getAgentsOneRemoteGatewayCommandCatalog(
          {
            endpoint: runtime.config.endpoint,
            timeoutMs: runtime.config.timeoutMs,
            connect: runtime.config.connect,
          },
          {
            requestId: `catalog-${randomUUID()}`,
            runtimeId: runtime.id,
            conversationId: sessionId,
          },
          auth,
        );
        nativeCommands = remote.commands;
      }
    } catch {
      // Legacy and degraded gateways retain their ordinary chat path.
    }
  }
  const catalog = createRuntimeCommandCatalog({
    desktop: baseRuntimeControlCommands(runtime, capabilities),
    runtime: nativeCommands,
  });
  const snapshot = { commands: catalog.commands, fetchedAt: now };
  runtimeCommandCatalogCache.set(key, snapshot);
  // Catalogue refresh already happens after a Pi turn settles. Warm the
  // optional reasoning-level catalogue in the background so opening
  // `/thinking` is normally a cache read, never a visible RPC wait.
  if (runtime.kind === "pi" && sessionId?.trim()) {
    void piAvailableThinkingLevels(runtime, sessionId).catch(() => undefined);
  }
  return snapshot;
}

function piModelReference(
  value: string,
): { provider: string; modelId: string } | null {
  const [provider, ...modelParts] = value.trim().split("/");
  const modelId = modelParts.join("/").trim();
  return provider?.trim() && modelId
    ? { provider: provider.trim(), modelId }
    : null;
}

function runtimeStatusMessage(
  runtime: AgentRuntimeDefinition,
  request: RuntimeCommandRequest,
): string {
  const run = request.runId ? runtimeRuns.get(request.runId)?.run : undefined;
  const model = runtime.config.model?.trim();
  return [
    `运行时：${runtime.name}（${runtime.kind}）`,
    `会话：${request.sessionId?.trim() || "尚未建立"}`,
    model ? `默认模型：${model}` : "默认模型：由原生 Runtime 决定",
    run ? `任务状态：${run.status}` : "任务状态：空闲",
  ].join("\n");
}

function runtimeCommandError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  return redactSensitiveText(message || fallback).slice(0, 2_000);
}

type RuntimeCommandProgressListener = (
  progress: RuntimeCommandProgress,
) => void;

function reportRuntimeCommandProgress(
  request: RuntimeCommandRequest,
  listener: RuntimeCommandProgressListener | undefined,
  phase: RuntimeCommandProgress["phase"],
  message: string,
): void {
  const requestId = request.requestId?.trim();
  if (!requestId || !listener || !message.trim()) return;
  listener({
    requestId,
    runtimeId: request.runtimeId,
    phase,
    message: message.trim().slice(0, 1_000),
    createdAt: Date.now(),
  });
}

/** Execute a typed Runtime control command without turning it into a prompt. */
async function executeAgentRuntimeCommandOnce(
  request: RuntimeCommandRequest,
  onProgress?: RuntimeCommandProgressListener,
): Promise<RuntimeCommandResult> {
  const runtime = listAgentRuntimes().find(
    (item) => item.id === request.runtimeId,
  );
  if (!runtime) return { type: "error", message: "Runtime was not found." };
  const name = normalizeRuntimeCommandName(request.name);
  const args = request.args?.trim() || "";
  // Pi and Codex own these core controls locally. Resolving them from the
  // static desktop contract avoids a second, cold native command-discovery
  // process after every newly-created provider session.
  const fastCoreControl =
    (runtime.kind === "pi" || runtime.kind === "codex") &&
    ["status", "abort", "stop", "model", "thinking", "compact"].includes(name);
  const coreCatalog = createRuntimeCommandCatalog({
    desktop: baseRuntimeControlCommands(runtime),
  });
  const catalog = fastCoreControl
    ? undefined
    : await getAgentRuntimeCommandCatalog(runtime.id, request.sessionId);
  const command = fastCoreControl
    ? coreCatalog.resolve(name)
    : (catalog!.commands.find((candidate) => candidate.name === name) ??
      createRuntimeCommandCatalog({ desktop: catalog!.commands }).resolve(
        name,
      ));
  if (!command) {
    const suggestionsCatalog = catalog
      ? createRuntimeCommandCatalog({ desktop: catalog.commands })
      : coreCatalog;
    const suggestions = runtimeCommandSuggestions(suggestionsCatalog, name);
    return {
      type: "error",
      message: suggestions.length
        ? `未知命令 /${name}。你是否想使用：${suggestions.map((item) => `/${item}`).join("、")}？`
        : `未知命令：/${name}`,
    };
  }
  const activeRun = request.runId
    ? runtimeRuns.get(request.runId)?.run
    : undefined;
  if (command.availability === "idle" && activeRun?.status === "running") {
    return { type: "error", message: `/${name} 只能在当前任务空闲时执行。` };
  }
  if (command.availability === "running" && activeRun?.status !== "running") {
    return { type: "error", message: `/${name} 仅在任务运行中可用。` };
  }

  if (name === "status") {
    if (runtime.kind === "pi" && request.sessionId?.trim()) {
      try {
        const response = await executePiRpcCommand(
          { executablePath: runtime.config.executablePath },
          { type: "get_state", sessionId: request.sessionId },
        );
        const model = isRecord(response.data)
          ? piModelLabel(response.data.model)
          : undefined;
        return {
          type: "handled",
          message: model
            ? `${runtimeStatusMessage(runtime, request)}\n当前 Pi 模型：${model}`
            : runtimeStatusMessage(runtime, request),
        };
      } catch {
        // A status refresh must not turn a healthy conversation into an error.
      }
    }
    return { type: "handled", message: runtimeStatusMessage(runtime, request) };
  }

  if (name === "abort") {
    if (!request.runId) {
      return { type: "error", message: "没有可停止的运行中任务。" };
    }
    const run = runtimeRuns.get(request.runId)?.run;
    if (!run || run.runtimeId !== runtime.id || run.status !== "running") {
      return { type: "error", message: "没有可停止的运行中任务。" };
    }
    const cancelled = await cancelAgentRuntimeTask(request.runId);
    return cancelled
      ? { type: "handled", message: "已请求停止当前任务。" }
      : { type: "error", message: "停止任务失败，请稍后重试。" };
  }

  if (isAgentsOneGatewayRuntime(runtime) && runtime.config.endpoint) {
    const auth = runtimeAuth(runtime);
    if (!auth?.bearerToken) {
      return { type: "error", message: "Gateway Token 未配置或需要重新授权。" };
    }
    try {
      return await executeAgentsOneRemoteGatewayCommand(
        {
          endpoint: runtime.config.endpoint,
          timeoutMs: runtime.config.timeoutMs,
          connect: runtime.config.connect,
        },
        {
          ...request,
          name,
          ...(args ? { args } : {}),
          requestId: request.requestId?.trim() || `command-${randomUUID()}`,
        },
        auth,
      );
    } catch (error) {
      return {
        type: "error",
        message: runtimeCommandError(error, "Gateway 命令执行失败。"),
      };
    }
  }

  if (name === "model") {
    if (!args) {
      try {
        const models = await runtimeModels(runtime, request.sessionId);
        return { type: "needs-input", input: "model-picker", models };
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(error, "无法获取可用模型。"),
        };
      }
    }
    // Model ids come from the provider's own catalogue. Never accept an
    // arbitrary identifier for adapters that can enumerate candidates: a
    // successful control message must match what the next Runtime request
    // will actually receive.
    if (
      runtime.kind === "pi" ||
      runtime.kind === "codex" ||
      runtime.kind === "claude-code"
    ) {
      try {
        const models = await runtimeModels(runtime, request.sessionId);
        if (!models.some((model) => model.id === args)) {
          return {
            type: "error",
            message: `模型 ${args} 不在当前 Runtime 返回的可用目录中。`,
          };
        }
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(
            error,
            "无法验证当前 Runtime 的模型目录。",
          ),
        };
      }
    }
    const applyPiModelImmediately =
      runtime.kind === "pi" &&
      Boolean(request.sessionId?.trim()) &&
      activeRun?.status !== "running";
    const applyClaudeModelImmediately =
      runtime.kind === "claude-code" &&
      Boolean(request.sessionId?.trim()) &&
      activeRun?.status !== "running";
    if (applyPiModelImmediately) {
      const reference = piModelReference(args);
      if (!reference) {
        return {
          type: "error",
          message:
            "Pi 模型必须使用 provider/model 形式，例如 anthropic/claude-sonnet。",
        };
      }
      try {
        await executePiRpcCommand(
          { executablePath: runtime.config.executablePath },
          {
            type: "set_model",
            sessionId: request.sessionId,
            params: reference,
          },
        );
        piThinkingLevelsCache.delete(piThinkingLevelsCacheKey(runtime.id));
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(error, "Pi 模型切换失败。"),
        };
      }
    }
    if (applyClaudeModelImmediately) {
      try {
        await setClaudeAgentSdkModel(
          claudeAgentSdkConfig(runtime),
          request.sessionId as string,
          args,
        );
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(error, "Claude Code 模型切换失败。"),
        };
      }
    }
    return {
      type: "handled",
      message:
        applyPiModelImmediately || applyClaudeModelImmediately
          ? `当前会话已切换到模型：${args}`
          : activeRun?.status === "running"
            ? `模型已设为 ${args}，当前任务不受影响，将在下一轮原生 Runtime 请求中生效。`
            : `模型已设为 ${args}，将在下一轮原生 Runtime 请求中生效。`,
      statePatch: { model: args },
    };
  }

  if (name === "thinking") {
    if (runtime.kind !== "pi") {
      return {
        type: "unsupported",
        reason: "当前 Runtime 未声明可切换的思考等级。",
      };
    }
    if (!request.sessionId?.trim()) {
      return {
        type: "error",
        message: "请先发送一条消息以创建 Pi 会话后，再设置思考等级。",
      };
    }
    if (!args) {
      // Read the small state record independently. It lets the picker still
      // open with the current setting when the optional level catalogue is
      // briefly unavailable.
      const state = await executePiRpcCommand(
        { executablePath: runtime.config.executablePath },
        { type: "get_state", sessionId: request.sessionId, timeoutMs: 2_500 },
      )
        .then((response) => stringField(response.data, "thinkingLevel"))
        .catch(() => "");
      let levels: string[] = [];
      try {
        levels = await piAvailableThinkingLevels(runtime, request.sessionId);
      } catch {
        // Do not expose a raw Pi RPC exception in the chat transcript. The
        // known current level remains inspectable; a subsequent click retries
        // discovery once Pi is responsive again.
        levels = state ? [state] : [];
      }
      if (!levels.length && !state) {
        return {
          type: "error",
          message: "Pi 暂未返回思考等级；请稍后重试。",
        };
      }
      return {
        type: "needs-input",
        input: "thinking-picker",
        thinkingLevels: levels,
        ...(state ? { thinkingLevel: state } : {}),
      };
    }
    try {
      const levels = await piAvailableThinkingLevels(
        runtime,
        request.sessionId,
      );
      if (!levels.includes(args)) {
        return {
          type: "error",
          message: `思考等级 ${args} 不受当前 Pi 模型支持。`,
        };
      }
      await executePiRpcCommand(
        { executablePath: runtime.config.executablePath },
        {
          type: "set_thinking_level",
          sessionId: request.sessionId,
          params: { level: args },
        },
      );
      return {
        type: "handled",
        message: `当前会话已切换到思考等级：${args}`,
        statePatch: { thinkingLevel: args },
      };
    } catch (error) {
      return {
        type: "error",
        message: runtimeCommandError(error, "Pi 思考等级切换失败。"),
      };
    }
  }

  if (name === "compact") {
    if (runtime.kind === "codex") {
      if (args) {
        return {
          type: "unsupported",
          reason:
            "当前 Codex App Server 版本不支持向原生压缩传递自定义保留说明。",
        };
      }
      if (!request.sessionId?.trim()) {
        return {
          type: "error",
          message: "当前 Codex 会话还没有可压缩的线程标识。",
        };
      }
      try {
        await compactCodexAppServerThread(
          { executablePath: runtime.config.executablePath },
          request.sessionId,
          (message) =>
            reportRuntimeCommandProgress(
              request,
              onProgress,
              "progress",
              message,
            ),
        );
        return {
          type: "handled",
          message: "Codex 上下文压缩已完成。",
          statePatch: {
            compacted: true,
            compaction: { trigger: "manual" },
          },
        };
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(error, "Codex 上下文压缩失败。"),
        };
      }
    }
    if (runtime.kind === "claude-code") {
      if (!request.sessionId?.trim()) {
        return {
          type: "error",
          message: "当前 Claude Code 会话尚未建立，无法压缩上下文。",
        };
      }
      try {
        reportRuntimeCommandProgress(
          request,
          onProgress,
          "started",
          "Claude Code 已开始压缩当前会话上下文…",
        );
        const compacted = await compactClaudeAgentSdkSession(
          claudeAgentSdkConfig(runtime),
          request.sessionId,
          args,
        );
        reportRuntimeCommandProgress(
          request,
          onProgress,
          "progress",
          "Claude Code 已完成上下文压缩，正在同步结果…",
        );
        return {
          type: "handled",
          message:
            typeof compacted.tokensAfter === "number"
              ? `Claude Code 上下文压缩完成：${compacted.tokensBefore} → ${compacted.tokensAfter} tokens。`
              : `Claude Code 上下文压缩完成：压缩前 ${compacted.tokensBefore} tokens。`,
          statePatch: {
            compacted: true,
            compaction: {
              trigger: compacted.trigger,
              tokensBefore: compacted.tokensBefore,
              ...(typeof compacted.tokensAfter === "number"
                ? { tokensAfter: compacted.tokensAfter }
                : {}),
            },
          },
        };
      } catch (error) {
        return {
          type: "error",
          message: runtimeCommandError(error, "Claude Code 上下文压缩失败。"),
        };
      }
    }
    if (runtime.kind !== "pi") {
      return {
        type: "unsupported",
        reason: "当前 Runtime 尚未提供原生上下文压缩。",
      };
    }
    if (!request.sessionId?.trim()) {
      return {
        type: "error",
        message: "当前 Pi 会话尚未建立，无法压缩上下文。",
      };
    }
    try {
      reportRuntimeCommandProgress(
        request,
        onProgress,
        "started",
        "Pi 已开始压缩当前会话上下文…",
      );
      const response = await executePiRpcCommand(
        { executablePath: runtime.config.executablePath },
        {
          type: "compact",
          sessionId: request.sessionId,
          ...(args ? { params: { customInstructions: args } } : {}),
          onEvent: (event) => {
            if (event.type === "compaction_start") {
              reportRuntimeCommandProgress(
                request,
                onProgress,
                "progress",
                "Pi 正在整理并压缩会话上下文…",
              );
            }
            if (event.type === "compaction_end") {
              reportRuntimeCommandProgress(
                request,
                onProgress,
                "progress",
                "Pi 已完成上下文压缩，正在同步结果…",
              );
            }
          },
        },
      );
      const before = isRecord(response.data)
        ? response.data.tokensBefore
        : undefined;
      const after = isRecord(response.data)
        ? response.data.estimatedTokensAfter
        : undefined;
      return {
        type: "handled",
        message:
          typeof before === "number" && typeof after === "number"
            ? `Pi 上下文压缩完成：${before} → ${after} tokens。`
            : "Pi 上下文压缩完成。",
        statePatch: {
          compacted: true,
          compaction: {
            trigger: "manual",
            ...(typeof before === "number" ? { tokensBefore: before } : {}),
            ...(typeof after === "number" ? { tokensAfter: after } : {}),
          },
        },
      };
    } catch (error) {
      return {
        type: "error",
        message: runtimeCommandError(error, "Pi 上下文压缩失败。"),
      };
    }
  }

  if (command.target === "runtime-native" && runtime.kind === "pi") {
    if (!request.sessionId?.trim()) {
      return {
        type: "error",
        message: `/${command.name} 需要先完成至少一轮 Pi 对话以建立会话。`,
      };
    }
    try {
      const result = await executePiRpcPrompt(
        { executablePath: runtime.config.executablePath },
        {
          sessionId: request.sessionId,
          message: `/${command.name}${args ? ` ${args}` : ""}`,
          waitForAgentSettled: command.source !== "plugin",
        },
      );
      return {
        type: "handled",
        message: result.output
          ? `Pi /${command.name} 已完成：\n${result.output}`
          : `Pi /${command.name} 已执行完成。`,
      };
    } catch (error) {
      return {
        type: "error",
        message: runtimeCommandError(error, `Pi /${command.name} 执行失败。`),
      };
    }
  }

  if (command.target === "runtime-native" && runtime.kind === "claude-code") {
    if (!request.sessionId?.trim()) {
      return {
        type: "error",
        message: `/${command.name} 需要先完成至少一轮 Claude Code 对话以建立会话。`,
      };
    }
    try {
      await executeClaudeAgentSdkCommand(
        claudeAgentSdkConfig(runtime),
        request.sessionId,
        command.name,
        args,
      );
      return {
        type: "handled",
        message: `Claude Code /${command.name} 已执行完成。`,
      };
    } catch (error) {
      return {
        type: "error",
        message: runtimeCommandError(
          error,
          `Claude Code /${command.name} 执行失败。`,
        ),
      };
    }
  }

  return { type: "unsupported", reason: `/${name} 当前尚未实现。` };
}

/**
 * Control requests can be retried by Electron while an IPC response is in
 * flight. Keep a short-lived result promise keyed by the caller's opaque id,
 * so retried `/compact` and `/model` requests have exactly-once semantics.
 */
export function executeAgentRuntimeCommand(
  request: RuntimeCommandRequest,
  onProgress?: RuntimeCommandProgressListener,
): Promise<RuntimeCommandResult> {
  const requestId = request.requestId?.trim();
  if (!requestId) return executeAgentRuntimeCommandOnce(request, onProgress);
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(requestId)) {
    return Promise.resolve({
      type: "error",
      message: "Runtime 命令请求标识无效。",
    });
  }
  const now = Date.now();
  for (const [key, entry] of runtimeCommandRequestCache) {
    if (entry.expiresAt <= now) runtimeCommandRequestCache.delete(key);
  }
  const key = `${request.runtimeId}:${requestId}`;
  const previous = runtimeCommandRequestCache.get(key);
  if (previous) return previous.result;
  const result = executeAgentRuntimeCommandOnce(
    { ...request, requestId },
    onProgress,
  );
  runtimeCommandRequestCache.set(key, {
    expiresAt: now + RUNTIME_COMMAND_REQUEST_TTL_MS,
    result,
  });
  return result;
}

/** Save desktop-only display metadata for both built-in and user runtimes. */
export function saveAgentRuntimeAppearance(
  id: string,
  appearance: AgentRuntimeAppearance,
): AgentRuntimeDefinition {
  const runtime = listAgentRuntimes().find((item) => item.id === id);
  if (!runtime) throw new Error("Runtime was not found.");
  if (runtime.needsReauthorization) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }
  const normalized = runtimeAppearanceFrom(appearance);
  const config = readDesktopConfig();
  const appearances = runtimeAppearances();
  appearances[id] = normalized;
  config[RUNTIME_APPEARANCE_KEY] = appearances;
  writeDesktopConfig(config);
  return applyRuntimeAppearance(runtime, normalized);
}

export function saveAgentRuntime(
  draft: AgentRuntimeDraft,
): AgentRuntimeDefinition {
  // Validate config separately so callers receive the security-specific error
  // instead of a generic invalid-definition result.
  const config = runtimeConfigFrom(draft.config);
  if (isRemoteOpenCodeRuntime(draft) && !isRemoteOpenCodeAcpV1Enabled()) {
    throw new Error("远程 OpenCode ACP v1 当前处于灰度关闭状态。");
  }
  if (
    draft.location === "remote" &&
    config.remoteGateway?.protocol === "agents-one-v1" &&
    config.endpoint
  ) {
    assertAgentsOneRemoteGatewayEndpoint(config.endpoint);
  }
  if (draft.location === "remote" && config.connect?.endpoint) {
    assertAgentsOneRemoteGatewayEndpoint(config.connect.endpoint);
  }
  const legacyConnectionProfile: AgentRuntimeConnectionProfile =
    draft.location === "local"
      ? "local"
      : config.connect
        ? "managed-connect"
        : "self-hosted-gateway";
  if (
    draft.connectionProfile &&
    draft.connectionProfile !== legacyConnectionProfile
  ) {
    throw new Error(
      `接入方式“${draft.connectionProfile}”与现有配置冲突；请先明确切换接入方式并重新配置。`,
    );
  }
  const inferredConnectionProfile: AgentRuntimeConnectionProfile =
    draft.connectionProfile || legacyConnectionProfile;
  const runtime = normalizeUserRuntime({
    ...draft,
    connectionProfile: inferredConnectionProfile,
    config,
    managed: "user",
  });
  if (!runtime) throw new Error("Runtime definition is invalid.");

  const runtimes = userRuntimes();
  const existingIndex = runtimes.findIndex((item) => item.id === runtime.id);
  if (existingIndex >= 0) runtimes[existingIndex] = runtime;
  else runtimes.push(runtime);
  writeUserRuntimes(runtimes);
  invalidateRuntimeCommandCatalog(runtime.id);
  return runtime;
}

export function removeAgentRuntime(id: string): boolean {
  if (!RUNTIME_ID.test(id) || RESERVED_RUNTIME_IDS.has(id)) {
    throw new Error("Built-in or invalid runtimes cannot be removed.");
  }
  const runtimes = userRuntimes();
  const next = runtimes.filter((runtime) => runtime.id !== id);
  if (next.length === runtimes.length) return false;
  writeUserRuntimes(next);
  invalidateRuntimeCommandCatalog(id);
  void webAgentController().disposeRuntime(id);
  // Runtime deletion removes only the local mapping. The provider's cloud
  // conversation remains untouched and can still be reached from Doubao.
  forgetWebAgentRuntimeConversations(undefined, id);
  return true;
}

function webAgentRuntimeFor(runtimeId: string): AgentRuntimeDefinition {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (
    !runtime ||
    runtime.kind !== "web-agent" ||
    !isLocalWebTransport(runtime) ||
    !runtime.config.webAgent
  ) {
    throw new Error("Web Agent Runtime was not found.");
  }
  return runtime;
}

/** Open the isolated provider window for user login, verification, or review. */
export async function openWebAgentRuntime(runtimeId: string): Promise<void> {
  if (!webAgentExecutionAllowed()) throw new Error(webAgentDisabledMessage());
  const runtime = webAgentRuntimeFor(runtimeId);
  await webAgentController().open(runtime.config.webAgent!, runtime.id);
}

/** Clear only Chromium-owned provider storage; Runtime config stays intact. */
export async function clearWebAgentRuntimeLogin(
  runtimeId: string,
): Promise<void> {
  const runtime = webAgentRuntimeFor(runtimeId);
  await webAgentController().clearLogin(runtime.config.webAgent!);
}

export function webAgentPolicyStatus(): WebAgentPolicyStatus {
  return getWebAgentPolicyStatus();
}

export async function updateWebAgentPolicy(
  enabled: boolean,
  acknowledged = false,
): Promise<WebAgentPolicyStatus> {
  const status = setWebAgentPolicyEnabled(enabled, acknowledged);
  if (!status.enabled) await webAgentController().disableAll();
  return status;
}

/** Resume a paused Browser Runtime after the user completed an in-app action. */
export async function resumeWebAgentRuntimeRun(
  runId: string,
): Promise<boolean> {
  return webAgentController().resume(runId);
}

async function probeRuntimeDefinition(
  runtime: AgentRuntimeDefinition,
  transientAuth?: { bearerToken?: string },
): Promise<AgentRuntimeProbe> {
  const checkedAt = Date.now();
  if (runtime.needsReauthorization && !transientAuth?.bearerToken) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }
  if (isRemoteOpenCodeRuntime(runtime) && !isRemoteOpenCodeAcpV1Enabled()) {
    return unsupportedRuntimeProbe(
      runtime,
      checkedAt,
      "远程 OpenCode ACP v1 当前处于灰度关闭状态。",
    );
  }
  if (isAgentsOneGatewayRuntime(runtime)) {
    if (!runtime.config.endpoint) {
      throw new Error("Unified Gateway endpoint is required.");
    }
    const result = await probeAgentsOneRemoteGateway(
      {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
        connect: runtime.config.connect,
      },
      transientAuth?.bearerToken ? transientAuth : runtimeAuth(runtime),
    );
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.capabilities,
      checkedAt,
      ...(result.gatewayProtocolVersion
        ? { gatewayProtocolVersion: result.gatewayProtocolVersion }
        : {}),
      ...(result.hostVersion ? { hostVersion: result.hostVersion } : {}),
      ...(result.message ? { message: result.message } : {}),
    };
  }

  const adapter = runtimeAdapterFor(runtime);
  if (!adapter) {
    return unsupportedRuntimeProbe(runtime, checkedAt);
  }
  if (adapter.probe) {
    return adapter.probe({
      runtime,
      transientAuth,
      auth: transientAuth || runtimeAuth(runtime),
    });
  }

  if (runtime.kind === "web-agent" && isLocalWebTransport(runtime)) {
    const settings = runtime.config.webAgent;
    if (!settings) {
      return {
        runtimeId: runtime.id,
        state: "unsupported",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        checkedAt,
        message: "Web Agent 配置缺失。",
      };
    }
    if (!settings.enabled) {
      return {
        runtimeId: runtime.id,
        state: "unsupported",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        checkedAt,
        message: "网页智能体适配器已被禁用。",
      };
    }
    if (!webAgentExecutionAllowed()) {
      return {
        runtimeId: runtime.id,
        state: "unsupported",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        checkedAt,
        message: webAgentDisabledMessage(),
      };
    }
    const result = await webAgentController().probe(settings);
    const capabilities: AgentRuntimeCapabilities = {
      chat: true,
      taskDispatch: true,
      streaming: true,
      cancellation: true,
      // The web adapter reports only upload/download evidence; it does not
      // expose arbitrary provider tools to Agents One.
      tools: false,
      memory: false,
      orchestration: false,
      readOnlyPlanning: false,
      mailbox: false,
      securityEvents: false,
      artifacts: true,
      artifactUpload: true,
      workspaceAccess: false,
      // The provider page cannot steer a response in place.  Agents One can
      // still preserve the user's next prompt (and its attachments) and send
      // it after this run reaches a terminal state, so advertise the safe
      // platform queue instead of forcing a cancel/confirm modal.
      steering: "follow_up",
      branching: "platform",
      eventStream: {
        protocol: "agents-one-event-stream-v1",
        transport: "poll",
        reasoningSummaries: false,
        toolEvents: true,
        modelMetadata: false,
        usageMetadata: false,
      },
    };
    return {
      runtimeId: runtime.id,
      state: result.state,
      capabilities:
        result.state === "unsupported"
          ? NO_AGENT_RUNTIME_CAPABILITIES
          : capabilities,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "codex" && runtime.location === "local") {
    const result = await probeCodexRuntime({
      executablePath: runtime.config.executablePath,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? {
            chat: false,
            taskDispatch: true,
            streaming: true,
            cancellation: true,
            tools: true,
            memory: false,
            orchestration: false,
            readOnlyPlanning: false,
            mailbox: false,
            securityEvents: false,
            artifacts: true,
            workspaceAccess: result.workspaceAccess,
            steering: "cancel_resume",
            branching: "platform",
          }
        : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "claude-code" && runtime.location === "local") {
    const result = await probeClaudeCodeRuntime({
      executablePath: runtime.config.executablePath,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? {
            chat: false,
            taskDispatch: true,
            streaming: true,
            cancellation: true,
            tools: true,
            memory: false,
            orchestration: false,
            readOnlyPlanning: false,
            mailbox: false,
            securityEvents: false,
            artifacts: true,
            workspaceAccess: result.workspaceAccess,
            steering: "follow_up",
            branching: "platform",
          }
        : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "pi" && runtime.location === "local") {
    const result = await probePiRuntime({
      executablePath: runtime.config.executablePath,
      workspace: runtime.config.workspace,
      timeoutMs: runtime.config.timeoutMs,
    });
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.healthy
        ? {
            chat: true,
            taskDispatch: true,
            streaming: true,
            cancellation: true,
            tools: true,
            memory: true,
            orchestration: false,
            readOnlyPlanning: false,
            mailbox: false,
            securityEvents: false,
            artifacts: true,
            workspaceAccess: result.workspaceAccess,
            steering: "cancel_resume",
            branching: "platform",
          }
        : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  const customHermes =
    runtime.kind === "hermes" &&
    runtime.managed === "user" &&
    runtime.config.hermes;
  if (customHermes) {
    const capabilities = {
      chat: true,
      taskDispatch: true,
      streaming: true,
      cancellation: true,
      tools: true,
      memory: true,
      orchestration: false,
      readOnlyPlanning: false,
      mailbox: false,
      securityEvents: false,
      artifacts: false,
      workspaceAccess: false,
      steering: "follow_up" as const,
      branching: "platform" as const,
    };
    const healthy = await testRemoteConnection("http://127.0.0.1:8642");
    return {
      runtimeId: runtime.id,
      state: healthy ? "healthy" : "unreachable",
      capabilities: healthy ? capabilities : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(healthy
        ? {}
        : { message: "本地 Hermes Agent Runtime 健康检查失败。" }),
    };
  }

  // Legacy remote Hermes/OpenClaw transports were removed (plan D5): any
  // non-gateway, non-local runtime is unsupported until it is re-registered
  // on Gateway v1.
  return unsupportedRuntimeProbe(
    runtime,
    checkedAt,
    `${runtime.kind} 适配器已注册，但当前执行能力尚未实现。`,
  );
}

/** Probe a saved Runtime without exposing any credentials to the renderer. */
export async function probeAgentRuntime(
  id: string,
): Promise<AgentRuntimeProbe> {
  const runtime = listAgentRuntimes().find((item) => item.id === id);
  if (!runtime) throw new Error("Runtime was not found.");
  const probe = await probeRuntimeDefinition(runtime);
  await persistRuntimeProbe(runtime.id, probe);
  return probe;
}

/**
 * Probe a draft before it is persisted. The optional token is used only for
 * this one request and is never included in the Runtime definition or logs.
 */
export async function probeAgentRuntimeDraft(
  draft: AgentRuntimeDraft,
  bearerToken?: string,
): Promise<AgentRuntimeProbe> {
  const runtime = normalizeUserRuntime({ ...draft, managed: "user" });
  if (!runtime) throw new Error("Runtime definition is invalid.");
  const token = typeof bearerToken === "string" ? bearerToken.trim() : "";
  return probeRuntimeDefinition(
    runtime,
    token ? { bearerToken: token } : undefined,
  );
}

function applyAgentsOneRemoteGatewayRun(
  record: RuntimeRunRecord,
  remoteRun: Awaited<ReturnType<typeof getAgentsOneRemoteGatewayRun>>,
): AgentRuntimeRun {
  const assistantOutput = remoteRun.events?.length
    ? [...remoteRun.events]
        .reverse()
        .find((event) => event.type === "assistant.completed")
        ?.data?.text?.trim()
    : undefined;
  // Some older Hers adapters put the final response in a reasoning.summary
  // event's `text` field. Only recover that malformed shape for a terminal
  // run with no canonical assistant.completed event; ordinary reasoning
  // summaries continue to render in the thinking group.
  const legacyAnswer =
    remoteRun.status !== "running" && !assistantOutput
      ? remoteRun.events?.length
        ? [...remoteRun.events]
            .reverse()
            .find(
              (event) =>
                event.type === "reasoning.summary" &&
                Boolean(event.data?.text?.trim()),
            )
            ?.data?.text?.trim()
        : undefined
      : undefined;
  const reportedOutput = remoteRun.output?.trim();
  const finalOutput =
    (reportedOutput && !isGenericRuntimeFailureText(reportedOutput)
      ? reportedOutput
      : undefined) ||
    assistantOutput ||
    legacyAnswer ||
    reportedOutput;
  if (remoteRun.events?.length) {
    appendRemoteGatewayEvents(record, remoteRun.events, finalOutput);
  }
  const providerModel = remoteRun.actualModel || remoteRun.model;
  const mergedModel = providerModel
    ? { ...(record.run.model ?? {}), ...providerModel }
    : record.run.model;
  const mergedUsage = remoteRun.usage
    ? { ...(record.run.usage ?? {}), ...remoteRun.usage }
    : record.run.usage;
  record.run = {
    ...record.run,
    ...(finalOutput && !record.run.output ? { output: finalOutput } : {}),
    ...(remoteRun.requestedModel
      ? { requestedModel: remoteRun.requestedModel }
      : {}),
    ...(mergedModel ? { model: mergedModel } : {}),
    ...(mergedModel ? { actualModel: mergedModel } : {}),
    ...(mergedUsage ? { usage: mergedUsage } : {}),
  };
  if (
    remoteRun.status === "succeeded" &&
    !finalOutput &&
    !remoteRun.artifacts?.length
  ) {
    const gateway = record.remoteGateway;
    if (
      gateway &&
      gateway.terminalReconciliationAttempts <
        GATEWAY_TERMINAL_RECONCILIATION_MAX_ATTEMPTS
    ) {
      gateway.terminalReconciliationAttempts += 1;
      gateway.nextPollAt =
        Date.now() + GATEWAY_TERMINAL_RECONCILIATION_INTERVAL_MS;
      record.run = {
        ...record.run,
        sessionId:
          remoteRun.conversationId ??
          remoteRun.sessionId ??
          record.run.sessionId,
        model: mergedModel,
        usage: mergedUsage,
      };
      return { ...record.run };
    }
    return finishRuntimeRun(record, "failed", {
      sessionId:
        remoteRun.conversationId ?? remoteRun.sessionId ?? record.run.sessionId,
      error:
        "Gateway 已报告运行完成，但未返回 assistant.completed 或最终答复。请让插件先持久化 assistant.completed（data.text），并在终态快照中保留 output。",
      model: mergedModel,
      usage: mergedUsage,
    });
  }
  if (record.remoteGateway) {
    record.remoteGateway.terminalReconciliationAttempts = 0;
  }
  if (remoteRun.status !== "running") {
    if (record.terminationStatus === "timed_out") {
      return finishRuntimeRun(record, "timed_out", {
        output: remoteRun.output ?? finalOutput ?? record.run.output,
        sessionId:
          remoteRun.conversationId ??
          remoteRun.sessionId ??
          record.run.sessionId,
        error:
          remoteRun.error ||
          `Gateway 运行超出 ${record.taskTimeoutMs}ms，远端终态已确认。`,
        artifacts: remoteRun.artifacts,
        model: mergedModel,
        usage: mergedUsage,
      });
    }
    if (
      remoteRun.status === "succeeded" &&
      record.workspaceGateway &&
      record.workspaceGateway.gateway.audit.length === 0 &&
      !hasRemoteWorkspaceOutcome(
        remoteRun.output ?? finalOutput,
        remoteRun.events,
        remoteRun.artifacts,
        listAgentRuntimes()
          .filter((runtime) => runtime.enabled)
          .map((runtime) => runtime.id),
      )
    ) {
      return finishRuntimeRun(record, "failed", {
        output: remoteRun.output ?? finalOutput ?? record.run.output,
        sessionId:
          remoteRun.conversationId ??
          remoteRun.sessionId ??
          record.run.sessionId,
        error:
          "远程智能体未发起受控工作区操作，也未交付可验证的媒体或产物，不能将本轮标记为完成。请检查 Relay 是否已把 workspaceRef 注册为真实的 workspace_gateway 工具。",
        artifacts: remoteRun.artifacts,
        model: mergedModel,
        usage: mergedUsage,
      });
    }
    return finishRuntimeRun(record, remoteRun.status, {
      output: remoteRun.output ?? finalOutput ?? record.run.output,
      sessionId:
        remoteRun.conversationId ?? remoteRun.sessionId ?? record.run.sessionId,
      error: remoteRun.error ?? record.run.error,
      artifacts: remoteRun.artifacts,
      model: mergedModel,
      usage: mergedUsage,
    });
  }
  const next: AgentRuntimeRun = {
    ...record.run,
    status: remoteRun.status,
    output: remoteRun.output ?? finalOutput ?? record.run.output,
    sessionId:
      remoteRun.conversationId ?? remoteRun.sessionId ?? record.run.sessionId,
    error: remoteRun.error ?? record.run.error,
    model: mergedModel,
    usage: mergedUsage,
    ...(remoteRun.artifacts?.length
      ? {
          artifacts: withRuntimeArtifactIds(record.run.id, remoteRun.artifacts),
        }
      : {}),
    ...(remoteRun.status === "running" ? {} : { completedAt: Date.now() }),
  };
  if (next.status !== "running" && record.timeout) {
    clearTimeout(record.timeout);
    record.timeout = undefined;
  }
  record.run = next;
  return { ...next };
}

/**
 * Resolve remote artifact ids in the main process before the run is exposed
 * to the renderer. This keeps bearer credentials out of the UI and converts
 * a provider object into the same local path consumed by native media/artifact
 * components.
 */
async function hydrateAgentsOneRemoteGatewayArtifacts(
  config: AgentsOneRemoteGatewayConfig,
  auth: { bearerToken?: string } | undefined,
  artifacts: AgentRuntimeArtifact[] | undefined,
): Promise<{
  artifacts: AgentRuntimeArtifact[] | undefined;
  failures: string[];
}> {
  if (!artifacts?.length) return { artifacts, failures: [] };
  const hydrated: AgentRuntimeArtifact[] = [];
  const failures: string[] = [];
  for (const artifact of artifacts) {
    if (!artifact.id) {
      hydrated.push(artifact);
      continue;
    }
    try {
      const downloaded = await getAgentsOneRemoteGatewayArtifact(
        config,
        artifact.id,
        auth,
      );
      const path = materializeBytesToTemp(
        downloaded.bytes,
        downloaded.name,
        downloaded.mime,
      );
      if (!path) {
        throw new Error(`远程产物 ${downloaded.name} 无法暂存在本机。`);
      }
      const { unavailableReason: _unavailableReason, ...verifiedArtifact } =
        artifact;
      hydrated.push({
        ...verifiedArtifact,
        id: downloaded.id,
        label: downloaded.name || artifact.label,
        mime: downloaded.mime,
        size: downloaded.size,
        ...(downloaded.sha256 ? { sha256: downloaded.sha256 } : {}),
        path,
      });
    } catch (error) {
      const failure = `远程产物 ${artifact.label || artifact.id} 下载失败：${
        error instanceof Error ? error.message : String(error)
      }`;
      hydrated.push({ ...artifact, unavailableReason: failure });
      failures.push(failure);
    }
  }
  return { artifacts: hydrated, failures };
}

async function applyHydratedAgentsOneRemoteGatewayRun(
  record: RuntimeRunRecord,
  remoteRun: Awaited<ReturnType<typeof getAgentsOneRemoteGatewayRun>>,
  auth: { bearerToken?: string } | undefined,
): Promise<AgentRuntimeRun> {
  // A provider can announce artifact.created before the bytes are committed
  // to its Artifact API. Defer hydration until the run is terminal so an
  // otherwise healthy running turn is not failed by a temporary 404/empty
  // artifact download.
  const hydrated =
    remoteRun.status === "running"
      ? { artifacts: remoteRun.artifacts, failures: [] }
      : await hydrateAgentsOneRemoteGatewayArtifacts(
          record.remoteGateway?.config || { endpoint: "" },
          auth,
          remoteRun.artifacts,
        );
  for (const failure of hydrated.failures) {
    appendRuntimeEvent(record, "progress", failure);
  }
  return applyAgentsOneRemoteGatewayRun(
    record,
    hydrated.artifacts
      ? { ...remoteRun, artifacts: hydrated.artifacts }
      : remoteRun,
  );
}

function reconcileGatewayCancellation(
  record: RuntimeRunRecord,
  run: AgentRuntimeRun,
): AgentRuntimeRun {
  const gateway = record.remoteGateway;
  if (!gateway || !record.cancelRequested || run.status !== "running") {
    return run;
  }
  const requestedAt = gateway.cancelRequestedAt || Date.now();
  gateway.cancelRequestedAt = requestedAt;
  if (Date.now() - requestedAt >= GATEWAY_CANCEL_CONFIRMATION_TIMEOUT_MS) {
    return finishRuntimeRun(record, "failed", {
      output: record.run.output,
      error:
        "Gateway 已收到取消请求，但 60 秒内仍无法确认远端运行已停止。请在 Gateway 侧核查该运行后再重试。",
    });
  }
  gateway.nextPollAt = Date.now() + GATEWAY_CANCEL_CONFIRMATION_INTERVAL_MS;
  return { ...record.run };
}

function rememberRuntimeRun(record: RuntimeRunRecord): void {
  runtimeRuns.set(record.run.id, record);
  while (runtimeRuns.size > MAX_RETAINED_RUNS) {
    const terminal = [...runtimeRuns.entries()].find(
      ([, candidate]) => candidate.run.status !== "running",
    )?.[0];
    if (!terminal) break;
    runtimeRuns.delete(terminal);
  }
}

function finishRuntimeRun(
  record: RuntimeRunRecord,
  status: Exclude<AgentRuntimeRun["status"], "running">,
  details: Pick<
    AgentRuntimeRun,
    | "output"
    | "sessionId"
    | "error"
    | "worktreeId"
    | "worktreePath"
    | "diffSummary"
    | "inputArtifacts"
    | "artifacts"
    | "requestedModel"
    | "model"
    | "actualModel"
    | "usage"
  > = {},
): AgentRuntimeRun {
  if (record.run.status !== "running") return { ...record.run };
  if (record.timeout) clearTimeout(record.timeout);
  if (record.workspaceGateway) {
    const gateway = record.workspaceGateway;
    gateway.stopped = true;
    if (gateway.timer) clearTimeout(gateway.timer);
    void gateway.gateway.revoke(`Task ${status}.`).catch((error) => {
      const detail = redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      );
      console.warn(`[agent-runtime] Workspace Grant revoke failed: ${detail}`);
      appendRuntimeEvent(
        record,
        "progress",
        "任务已结束，但受控工作区授权撤销未确认；请检查 Gateway 侧状态。",
      );
    });
  }
  const suppliedError =
    typeof details.error === "string" ? details.error.trim() : undefined;
  const normalizedError =
    status === "failed" && suppliedError
      ? explainAgentsOneRemoteGatewayError(suppliedError)
      : suppliedError;
  const terminalError =
    status === "failed" &&
    (!normalizedError ||
      ["failed", "error"].includes(normalizedError.toLowerCase()))
      ? "任务执行失败，但远程网关未返回详细错误。"
      : normalizedError;
  if (status === "succeeded") {
    // Keep the terminal event for API/history consumers; the renderer hides this
    // generic marker so it does not add noise to the conversation transcript.
    if (
      !(record.run.events || []).some((event) => event.type === "completed")
    ) {
      appendRuntimeEvent(record, "completed", "任务执行完成。");
    }
  } else {
    appendRuntimeEvent(
      record,
      status === "cancelled"
        ? "cancelled"
        : status === "timed_out"
          ? "timed_out"
          : "error",
      status === "cancelled"
        ? "任务已取消。"
        : status === "timed_out"
          ? "任务执行超时。"
          : terminalError || "任务执行失败。",
    );
  }
  const artifacts =
    withRuntimeArtifactIds(
      record.run.id,
      details.artifacts || record.run.artifacts,
    ) || [];
  if (details.artifacts?.length) {
    appendRuntimeEvent(record, "artifact_published", "任务已发布新的产物。");
  }
  const { userActionRequired: _userActionRequired, ...activeRun } = record.run;
  record.run = {
    ...activeRun,
    status,
    completedAt: Date.now(),
    ...details,
    ...(details.model ? { actualModel: details.model } : {}),
    ...(terminalError ? { error: terminalError } : {}),
    ...(artifacts.length ? { artifacts } : {}),
  };
  const lifecycle = {
    runId: record.run.id,
    runtimeId: record.run.runtimeId,
    status,
    durationMs: (record.run.completedAt ?? Date.now()) - record.run.startedAt,
    artifactCount: artifacts.length,
  };
  logTaskDiagnostic("task.finished", lifecycle);
  if (status === "failed" || status === "timed_out") {
    logErrorDiagnostic("task.failed", {
      ...lifecycle,
      error: terminalError || "任务执行失败。",
    });
  }
  const runtime = listAgentRuntimes().find(
    (item) => item.id === record.run.runtimeId,
  );
  if (runtime) {
    const event: AgentRuntimeRunFinishedEvent = {
      runId: record.run.id,
      runtimeId: runtime.id,
      runtimeName: runtime.name,
      runtimeKind: runtime.kind,
      runtimeAvatar: runtime.avatar,
      title: record.completionContext.title,
      profile: record.completionContext.profile,
      status,
      ...(record.run.error ? { error: record.run.error } : {}),
      completedAt: record.run.completedAt ?? Date.now(),
    };
    setImmediate(() => {
      for (const listener of runtimeRunFinishedListeners) {
        try {
          listener(event);
        } catch (error) {
          console.error("[agent-runtime] Finished listener failed", error);
        }
      }
    });
  }
  return { ...record.run };
}

function completionTitle(prompt: string): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return "未命名任务";
  return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
}

function validatedTaskInput(
  input: AgentRuntimeTaskInput,
  defaultTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
): {
  prompt: string;
  model?: string;
  profile?: string;
  sessionId?: string;
  conversation?: boolean;
  mode: "analysis" | "safe_write" | "implementation" | "full_access";
  fullAccessConfirmed?: boolean;
  workspace?: string;
  workspaceId?: string;
  workspaceRef?: string;
  attachments?: AgentRuntimeTaskInput["attachments"];
  timeoutMs: number;
} {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_TASK_PROMPT_LENGTH) {
    throw new Error(
      "Runtime task prompt must be between 1 and 100000 characters.",
    );
  }
  const profile = optionalString(input.profile, 128);
  const model = optionalString(input.model, 512);
  const sessionId = optionalString(input.sessionId, 256);
  const conversation = input.conversation === true;
  const mode = input.mode ?? "analysis";
  if (
    mode !== "analysis" &&
    mode !== "safe_write" &&
    mode !== "implementation" &&
    mode !== "full_access"
  ) {
    throw new Error("Runtime task mode is invalid.");
  }
  const fullAccessConfirmed = input.fullAccessConfirmed === true;
  if (mode === "full_access" && !fullAccessConfirmed) {
    throw new Error("Full-access tasks require an explicit confirmation.");
  }
  const workspaceId = optionalString(input.workspaceId, 128);
  const legacyWorkspace = optionalString(input.workspace, 4096);
  const workspace = workspaceId
    ? resolveAuthorizedWorkspaceId(workspaceId) || undefined
    : legacyWorkspace;
  if (workspaceId && !workspace) {
    throw new Error(
      "Workspace capability is unavailable or no longer authorized.",
    );
  }
  if (workspace && !isAuthorizedWorkspaceRoot(workspace)) {
    throw new Error(
      "Workspace must be selected through the desktop file chooser or be a registered project.",
    );
  }
  const workspaceRef = optionalString(input.workspaceRef, 4096);
  const attachments = input.attachments;
  if (attachments !== undefined && !Array.isArray(attachments)) {
    throw new Error("Runtime task attachments must be an array.");
  }
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_TASK_TIMEOUT_MS
  ) {
    throw new Error(
      "Runtime task timeout must be between 1000 and 86400000 milliseconds.",
    );
  }
  return {
    prompt,
    model,
    profile,
    sessionId,
    conversation,
    mode,
    fullAccessConfirmed,
    workspace,
    workspaceId,
    workspaceRef,
    attachments,
    timeoutMs,
  };
}

/**
 * A remote Workspace Grant is deliberately shorter-lived than every authority
 * that constrains it: the current task, the desktop safety ceiling, and the
 * Relay capability if it advertises one. Supplying `now` keeps this security
 * boundary deterministic in regression tests.
 */
export function workspaceGrantExpiresAt(
  taskTimeoutMs: number,
  maxGrantSeconds: number | undefined,
  now = Date.now(),
): number {
  return (
    now +
    Math.min(
      taskTimeoutMs,
      MAX_TASK_TIMEOUT_MS,
      typeof maxGrantSeconds === "number" && maxGrantSeconds > 0
        ? maxGrantSeconds * 1_000
        : MAX_TASK_TIMEOUT_MS,
    )
  );
}

export async function startAgentRuntimeTask(
  runtimeId: string,
  input: AgentRuntimeTaskInput,
): Promise<AgentRuntimeRun> {
  if (!runtimeTaskAdmissionOpen) {
    throw new Error(
      "Runtime task dispatch is unavailable while Agents One is shutting down.",
    );
  }
  assertAgentsOneWritesAllowed();
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (runtime.configurationIssue) {
    throw new Error(
      `${runtime.configurationIssue.message} 当前 Runtime 已暂停执行。`,
    );
  }
  if (isRemoteOpenCodeRuntime(runtime) && !isRemoteOpenCodeAcpV1Enabled()) {
    throw new Error("远程 OpenCode ACP v1 当前处于灰度关闭状态。");
  }
  if (!runtimeAdapterFor(runtime)) {
    throw new Error(`${runtime.kind} 适配器尚未安装，暂不能派发任务。`);
  }
  if (!runtime.enabled) throw new Error("Runtime is disabled.");
  if (runtime.needsReauthorization) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }
  if (
    !isGatewayTransport(runtime) &&
    !isLocalCliTransport(runtime) &&
    !isLocalApiTransport(runtime) &&
    !isLocalWebTransport(runtime)
  ) {
    throw new Error(`${runtime.kind} task dispatch is not available yet.`);
  }

  const validatedTask = validatedTaskInput(
    input,
    isGatewayTransport(runtime)
      ? DEFAULT_GATEWAY_TASK_TIMEOUT_MS
      : DEFAULT_TASK_TIMEOUT_MS,
  );
  // A unified Gateway is the remote equivalent of a local CLI/API runtime:
  // the permission is enforced by the remote Connector, while any desktop
  // workspace is separately constrained by a short-lived Workspace Grant.
  // The previous check accidentally excluded every configured Agents One
  // Gateway and made the remote "完全访问" control unusable.
  const configuredRemoteGateway =
    isAgentsOneGatewayRuntime(runtime) &&
    Boolean(runtime.config.endpoint?.trim());
  if (
    validatedTask.mode === "full_access" &&
    !(
      isLocalCliTransport(runtime) ||
      isLocalApiTransport(runtime) ||
      configuredRemoteGateway
    )
  ) {
    throw new Error(
      "Full access is available only for local CLI agents or configured remote Gateway v1 runtimes.",
    );
  }
  const id = `run-${randomUUID()}`;
  const task = {
    ...validatedTask,
    ...(validatedTask.mode === "implementation"
      ? { worktreeId: `worktree-${id.slice(4)}` }
      : {}),
  };
  if (isLocalWebTransport(runtime) && task.mode !== "analysis") {
    throw new Error(
      "Web Agent Runtime 仅支持对话分析，不提供工作区或 Shell 权限。",
    );
  }
  if (isLocalWebTransport(runtime) && (task.workspace || task.workspaceRef)) {
    throw new Error(
      "Web Agent Runtime 不接受项目工作区；请仅添加本轮明确选择的附件。",
    );
  }
  const startedAt = Date.now();
  const record: RuntimeRunRecord = {
    run: {
      id,
      runtimeId,
      status: "running",
      startedAt,
      output: "",
      requestedModel: task.model?.trim() || runtime.config.model?.trim(),
      events: [],
      isolation: runtimeIsolationInfo(runtime, task),
    },
    completionContext: {
      title: completionTitle(task.prompt),
      ...(task.profile ? { profile: task.profile } : {}),
    },
    cancelRequested: false,
    taskTimeoutMs: task.timeoutMs,
  };
  appendRuntimeEvent(record, "started", "任务已开始执行。");
  rememberRuntimeRun(record);
  // Do not record the prompt, output, workspace path or provider payloads.
  // Task diagnostics describe only lifecycle metadata.
  logTaskDiagnostic("task.started", {
    runId: id,
    runtimeId: runtime.id,
    runtimeKind: runtime.kind,
    transport: deriveAgentTransport(runtime),
    mode: task.mode,
    timeoutMs: task.timeoutMs,
    hasWorkspace: Boolean(task.workspace),
  });

  let dispatchPrompt = task.prompt;
  let dispatchWorkspaceRef = task.workspaceRef;
  const unifiedGatewayRuntime = isAgentsOneGatewayRuntime(runtime);
  if (
    task.workspace &&
    runtime.location === "remote" &&
    unifiedGatewayRuntime
  ) {
    try {
      const auth = runtimeAuth(runtime);
      const config = {
        endpoint: runtime.config.endpoint || "",
        bearerToken: auth?.bearerToken,
        // The runtime timeout bounds the remote model task and may be several
        // minutes. Workspace Grant HTTP calls have a separate, shorter client
        // ceiling because pull is a bounded long-poll; do not pass the model
        // timeout through unchanged or the workspace client rejects it.
        timeoutMs:
          runtime.config.timeoutMs === undefined
            ? undefined
            : Math.min(
                runtime.config.timeoutMs,
                MAX_REMOTE_WORKSPACE_TIMEOUT_MS,
              ),
        contract: "agents-one-v1" as const,
      };
      if (!config.endpoint || !config.bearerToken) {
        throw new Error("统一 Gateway 地址或 Token 尚未配置。");
      }
      const capabilities = await probeRemoteWorkspaceGateway(config);
      const permission =
        task.mode === "full_access"
          ? "write"
          : task.mode === "safe_write"
            ? "safe_write"
            : "read";
      const requiredOperations =
        permission === "write"
          ? (["list", "read", "write", "move", "delete"] as const)
          : permission === "safe_write"
            ? (["list", "read", "write"] as const)
            : (["list", "read"] as const);
      const missingOperations = requiredOperations.filter(
        (operation) => !capabilities.operations.includes(operation),
      );
      if (missingOperations.length) {
        throw new Error(
          `远程工作区 Gateway 缺少操作能力：${missingOperations.join(", ")}。`,
        );
      }
      const grant = createRemoteWorkspaceGrant({
        taskId: id,
        runtimeId: runtime.id,
        rootPath: task.workspace,
        permission: permission === "read" ? "read" : "write",
        operations: [...requiredOperations],
        // A workspace Grant may never outlive this desktop task, the desktop
        // safety ceiling, or the Relay's advertised maximum lifetime.
        expiresAt: workspaceGrantExpiresAt(
          task.timeoutMs,
          capabilities.maxGrantSeconds,
        ),
        maxOperationBytes: Math.min(
          capabilities.maxOperationBytes || 256 * 1024,
          256 * 1024,
        ),
      });
      const gateway = new OutboundRemoteWorkspaceGateway(config, grant, {
        confirmDelete: async (request) => {
          appendRuntimeEvent(
            record,
            "progress",
            `${runtime.name} 请求删除项目文件 ${request.path}，等待本机确认。`,
          );
          return promptRemoteWorkspaceDelete(runtime.name, request.path);
        },
      });
      await gateway.register();
      record.workspaceGateway = { gateway, stopped: false, failures: 0 };
      startWorkspaceGatewayPolling(record);
      dispatchWorkspaceRef = `desktop-gateway:${grant.id}`;
      dispatchPrompt = `${task.prompt}\n\n${remoteWorkspaceInstruction(
        grant.id,
        permission,
      )}`;
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let gatewayPermission: "read" | "write" =
    task.mode === "full_access" || task.mode === "safe_write"
      ? "write"
      : "read";
  if (task.workspace && unifiedGatewayRuntime && !dispatchWorkspaceRef) {
    gatewayPermission = "read";
    dispatchPrompt = `${task.prompt}\n\n[Agents One 工作区状态]\n当前任务已在桌面端关联本地项目，但本轮尚未建立 Workspace Grant。本地项目路径与文件内容未发送给你。你可以继续处理普通对话；如果请求依赖本地文件，请明确说明需要用户启用受控工作区授权。`;
  }

  if (runtime.kind === "opencode" && runtime.location === "local") {
    try {
      const opencode = await startOpenCodeProcess(
        {
          executablePath: runtime.config.executablePath,
          acpArgs: runtime.config.acpArgs,
          model: task.model?.trim() || runtime.config.model,
          agent: runtime.config.agent,
          workspace: runtime.config.workspace,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          appendOutputEvent(record, "opencode", chunk);
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
        (event) => {
          if (record.run.status !== "running") return;
          appendRuntimeEvent(record, event.type, event.summary, {
            detail: event.detail,
            code: event.code,
            tool: event.tool,
          });
        },
        (metadata) => {
          if (record.run.status !== "running") return;
          appendLocalRuntimeMetadata(record, metadata);
        },
      );
      record.opencode = { cancel: opencode.cancel };
      if (opencode.sessionId) {
        record.run = { ...record.run, sessionId: opencode.sessionId };
      }
      record.timeout = setTimeout(() => {
        void terminateLocalRuntime(record, "timed_out");
      }, task.timeoutMs);
      void opencode.completion.then((result) => {
        if (record.run.status !== "running") return;
        if (record.terminationStatus) {
          finishRuntimeRun(
            record,
            record.terminationStatus,
            localRuntimeTerminationDetails(
              record,
              record.terminationStatus,
              result.output,
            ),
          );
          return;
        }
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
          ...(result.model ? { model: result.model } : {}),
          ...(result.usage ? { usage: result.usage } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (isAgentsOneGatewayRuntime(runtime)) {
    const endpoint = runtime.config.endpoint;
    const auth = runtimeAuth(runtime);
    if (!endpoint || !auth?.bearerToken) {
      return finishRuntimeRun(record, "failed", {
        error: "统一 Gateway 地址或 Token 尚未配置。",
      });
    }
    const config: AgentsOneRemoteGatewayConfig = {
      endpoint,
      runtimeId: runtime.id,
      timeoutMs: runtime.config.timeoutMs,
      connect: runtime.config.connect,
    };
    try {
      let artifactIds: string[] | undefined;
      if (task.attachments?.length) {
        const probe = await probeAgentsOneRemoteGateway(config, auth);
        if (!probe.healthy || probe.capabilities.artifactUpload !== true) {
          throw new Error(
            "统一 Gateway 未声明附件上传能力。请更新 Hers-2 Connector/Plugin，并确认 capabilities.artifacts.upload=true。",
          );
        }
        const prepared = prepareRuntimeInputs(
          task.profile,
          task.attachments,
          `agents-one-${id}`,
        );
        artifactIds = [];
        for (const file of prepared.files) {
          const uploaded = await uploadAgentsOneRemoteGatewayArtifact(
            config,
            {
              name: file.artifact.name,
              mime: file.artifact.mime,
              bytes: readFileSync(file.path),
              sha256: file.artifact.sha256,
            },
            auth,
          );
          artifactIds.push(uploaded.id);
        }
        record.run = {
          ...record.run,
          inputArtifacts: prepared.artifacts,
        };
      }
      const remoteRun = await startAgentsOneRemoteGatewayRun(
        config,
        {
          runtimeId: runtime.id,
          idempotencyKey: id,
          // A chat must stay a Gateway conversation from its first turn. The
          // The first request creates a Gateway conversation identity and
          // uses the same structured event stream as subsequent turns.
          mode: task.conversation || task.sessionId ? "conversation" : "task",
          conversationId:
            task.sessionId ||
            (task.conversation ? `conversation_${randomUUID()}` : undefined),
          text: dispatchPrompt,
          model: task.model,
          artifactIds,
          workspaceRef: dispatchWorkspaceRef,
          timeoutSeconds: Math.ceil(task.timeoutMs / 1_000),
          permission: gatewayPermission,
        },
        auth,
      );
      record.remoteGateway = {
        config,
        runId: remoteRun.id,
        failures: 0,
        lastSuccessfulPollAt: Date.now(),
        nextPollAt: 0,
        terminalReconciliationAttempts: 0,
        artifactRetryAttempts: new Map(),
      };
      record.timeout = setTimeout(() => {
        void requestRemoteGatewayCancellation(record, "timed_out");
      }, task.timeoutMs);
      return await applyHydratedAgentsOneRemoteGatewayRun(
        record,
        remoteRun,
        auth,
      );
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "web-agent" && isLocalWebTransport(runtime)) {
    const settings = runtime.config.webAgent;
    if (!settings) {
      return finishRuntimeRun(record, "failed", {
        error: "Web Agent 配置缺失。",
      });
    }
    if (!settings.enabled) {
      return finishRuntimeRun(record, "failed", {
        error: "网页智能体适配器已被禁用。",
      });
    }
    if (!webAgentExecutionAllowed()) {
      return finishRuntimeRun(record, "failed", {
        error: webAgentDisabledMessage(),
      });
    }
    try {
      const started = webAgentController().start(
        {
          runId: id,
          runtimeId: runtime.id,
          settings,
          profile: task.profile,
          sessionId: task.sessionId,
          prompt: task.prompt,
          attachments: task.attachments,
          timeoutMs: task.timeoutMs,
        },
        {
          onEvent: (type, summary, options) =>
            appendRuntimeEvent(record, type, summary, options),
          onOutput: (output) => {
            if (record.run.status !== "running") return;
            record.run = { ...record.run, output };
          },
          onUserAction: (userActionRequired) => {
            if (record.run.status !== "running") return;
            record.run = {
              ...record.run,
              ...(userActionRequired ? { userActionRequired } : {}),
            };
            if (!userActionRequired) {
              const { userActionRequired: _ignored, ...run } = record.run;
              record.run = run;
            }
          },
        },
      );
      record.webAgent = started;
      record.timeout = setTimeout(() => {
        void started.cancel().finally(() => {
          finishRuntimeRun(record, "timed_out", {
            output: record.run.output,
            error: `Runtime task exceeded ${task.timeoutMs}ms.`,
          });
        });
      }, task.timeoutMs);
      void started.completion
        .then((result) => {
          if (record.run.status !== "running") return;
          finishRuntimeRun(record, "succeeded", {
            output: result.output,
            sessionId: result.sessionId,
            ...(result.inputArtifacts.length
              ? { inputArtifacts: result.inputArtifacts }
              : {}),
            ...(result.artifacts.length ? { artifacts: result.artifacts } : {}),
          });
        })
        .catch((error) => {
          if (record.run.status !== "running") return;
          finishRuntimeRun(record, "failed", {
            output: record.run.output,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "codex") {
    try {
      const codex = await startCodexProcess(
        {
          executablePath: runtime.config.executablePath,
          model: task.model?.trim() || runtime.config.model,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          appendOutputEvent(record, "codex", chunk);
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
      );
      record.codex = { cancel: codex.cancel };
      if (codex.inputArtifacts.length) {
        record.run = { ...record.run, inputArtifacts: codex.inputArtifacts };
      }
      if (codex.worktreePath) {
        record.run = {
          ...record.run,
          worktreeId: task.worktreeId,
          worktreePath: codex.worktreePath,
        };
      }
      record.timeout = setTimeout(() => {
        void terminateLocalRuntime(record, "timed_out");
      }, task.timeoutMs);
      void codex.completion.then(async (result) => {
        if (record.run.status !== "running") return;
        if (record.terminationStatus) {
          finishRuntimeRun(
            record,
            record.terminationStatus,
            localRuntimeTerminationDetails(
              record,
              record.terminationStatus,
              result.output,
            ),
          );
          return;
        }
        const verifiedFiles =
          !result.error && task.mode === "full_access"
            ? await verifyLocalDeliveryArtifacts(
                result.output,
                task.workspace || "",
              )
            : [];
        if (record.run.status !== "running") return;
        const artifacts = [...result.artifacts, ...verifiedFiles];
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          ...(result.sessionId ? { sessionId: result.sessionId } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(task.worktreeId ? { worktreeId: task.worktreeId } : {}),
          ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...(result.inputArtifacts.length
            ? { inputArtifacts: result.inputArtifacts }
            : {}),
          ...(artifacts.length ? { artifacts } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "claude-code") {
    // Conversational analysis turns stay inside one persistent SDK Query. File
    // writes and staged attachments keep the CLI path until their workspace
    // policy is modeled by the SDK adapter.
    const useClaudeSdk =
      task.conversation === true &&
      (task.mode || "analysis") === "analysis" &&
      !task.attachments?.length;
    if (useClaudeSdk) {
      try {
        const claudeSdk = await startClaudeAgentSdkProcess(
          {
            executablePath: runtime.config.executablePath,
            workspace: task.workspace,
            timeoutMs: runtime.config.timeoutMs,
          },
          task,
          (message) => {
            if (record.run.status !== "running") return;
            const chunk = `${JSON.stringify(message)}\n`;
            appendOutputEvent(record, "claude-code", chunk);
            record.run = {
              ...record.run,
              output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
            };
          },
        );
        record.claudeSdk = { cancel: claudeSdk.cancel };
        if (claudeSdk.sessionId) {
          record.run = { ...record.run, sessionId: claudeSdk.sessionId };
        }
        record.timeout = setTimeout(() => {
          void terminateLocalRuntime(record, "timed_out");
        }, task.timeoutMs);
        void claudeSdk.completion.then((result) => {
          if (record.run.status !== "running") return;
          if (record.terminationStatus) {
            finishRuntimeRun(
              record,
              record.terminationStatus,
              localRuntimeTerminationDetails(
                record,
                record.terminationStatus,
                result.output,
              ),
            );
            return;
          }
          finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
            output: result.output,
            ...(result.sessionId ? { sessionId: result.sessionId } : {}),
            ...(result.error ? { error: result.error } : {}),
          });
        });
        return { ...record.run };
      } catch (error) {
        appendRuntimeEvent(
          record,
          "progress",
          "Claude Agent SDK 不可用，已切换到 Claude Code CLI 兼容模式。",
          { detail: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    try {
      const claudeCode = await startClaudeCodeProcess(
        {
          executablePath: runtime.config.executablePath,
          model: task.model?.trim() || runtime.config.model,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          appendOutputEvent(record, "claude-code", chunk);
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
      );
      record.claudeCode = { cancel: claudeCode.cancel };
      record.run = { ...record.run, sessionId: claudeCode.sessionId };
      const claudeInputArtifacts = claudeCode.inputArtifacts || [];
      if (claudeInputArtifacts.length) {
        record.run = {
          ...record.run,
          inputArtifacts: claudeInputArtifacts,
        };
      }
      if (claudeCode.worktreePath) {
        record.run = {
          ...record.run,
          worktreeId: task.worktreeId,
          worktreePath: claudeCode.worktreePath,
        };
      }
      record.timeout = setTimeout(() => {
        void terminateLocalRuntime(record, "timed_out");
      }, task.timeoutMs);
      void claudeCode.completion.then(async (result) => {
        if (record.run.status !== "running") return;
        if (record.terminationStatus) {
          finishRuntimeRun(
            record,
            record.terminationStatus,
            localRuntimeTerminationDetails(
              record,
              record.terminationStatus,
              result.output,
            ),
          );
          return;
        }
        const verifiedFiles =
          !result.error && task.mode === "full_access"
            ? await verifyLocalDeliveryArtifacts(
                result.output,
                task.workspace || "",
              )
            : [];
        if (record.run.status !== "running") return;
        const artifacts = [...result.artifacts, ...verifiedFiles];
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          sessionId: result.sessionId,
          ...(result.error ? { error: result.error } : {}),
          ...(task.worktreeId ? { worktreeId: task.worktreeId } : {}),
          ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...((result.inputArtifacts || []).length
            ? { inputArtifacts: result.inputArtifacts }
            : {}),
          ...(artifacts.length ? { artifacts } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (runtime.kind === "pi") {
    try {
      const pi = await startPiProcess(
        {
          executablePath: runtime.config.executablePath,
          model: task.model?.trim() || runtime.config.model,
          timeoutMs: runtime.config.timeoutMs,
        },
        task,
        (chunk) => {
          if (record.run.status !== "running") return;
          appendOutputEvent(record, "pi", chunk);
          record.run = {
            ...record.run,
            output: `${record.run.output ?? ""}${chunk}`.slice(-512 * 1024),
          };
        },
      );
      record.pi = { cancel: pi.cancel };
      if (pi.inputArtifacts.length) {
        record.run = { ...record.run, inputArtifacts: pi.inputArtifacts };
      }
      if (pi.worktreePath) {
        record.run = {
          ...record.run,
          worktreeId: task.worktreeId,
          worktreePath: pi.worktreePath,
        };
      }
      record.run = { ...record.run, sessionId: pi.sessionId };
      record.timeout = setTimeout(() => {
        void terminateLocalRuntime(record, "timed_out");
      }, task.timeoutMs);
      void pi.completion.then(async (result) => {
        if (record.run.status !== "running") return;
        if (record.terminationStatus) {
          finishRuntimeRun(
            record,
            record.terminationStatus,
            localRuntimeTerminationDetails(
              record,
              record.terminationStatus,
              result.output,
            ),
          );
          return;
        }
        const verifiedFiles =
          !result.error && task.mode === "full_access"
            ? await verifyLocalDeliveryArtifacts(
                result.output,
                task.workspace || "",
              )
            : [];
        if (record.run.status !== "running") return;
        const artifacts = [...result.artifacts, ...verifiedFiles];
        finishRuntimeRun(record, result.error ? "failed" : "succeeded", {
          output: result.output,
          sessionId: result.sessionId,
          ...(result.error ? { error: result.error } : {}),
          ...(task.worktreeId ? { worktreeId: task.worktreeId } : {}),
          ...(result.worktreePath ? { worktreePath: result.worktreePath } : {}),
          ...(result.diffSummary ? { diffSummary: result.diffSummary } : {}),
          ...(result.inputArtifacts.length
            ? { inputArtifacts: result.inputArtifacts }
            : {}),
          ...(artifacts.length ? { artifacts } : {}),
        });
      });
      return { ...record.run };
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const finish = (
    status: Exclude<AgentRuntimeRun["status"], "running">,
    details: Pick<AgentRuntimeRun, "output" | "sessionId" | "error"> = {},
  ): void => {
    finishRuntimeRun(record, status, details);
  };

  record.timeout = setTimeout(() => {
    record.abortHandle?.();
    finish("timed_out", {
      output: record.run.output,
      error: `Runtime task exceeded ${task.timeoutMs}ms.`,
    });
  }, task.timeoutMs);

  void sendMessage(
    dispatchPrompt,
    {
      onChunk: (chunk) => {
        if (record.run.status !== "running") return;
        appendOutputEvent(record, "hermes", chunk);
        record.run = {
          ...record.run,
          output: `${record.run.output ?? ""}${chunk}`,
        };
      },
      onDone: (sessionId) =>
        finish("succeeded", { output: record.run.output, sessionId }),
      onError: (error) =>
        finish("failed", { output: record.run.output, error }),
    },
    task.profile,
    task.sessionId,
    undefined,
    task.attachments,
  )
    .then((handle) => {
      record.abortHandle = handle.abort;
      if (record.cancelRequested || record.run.status !== "running") {
        handle.abort();
      }
    })
    .catch((error) => {
      finish("failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    });

  return { ...record.run };
}

export async function getAgentRuntimeRun(
  runId: string,
): Promise<AgentRuntimeRun | null> {
  const record = runtimeRuns.get(runId);
  if (!record) return null;
  if (record.remoteGateway && record.run.status === "running") {
    if (Date.now() < record.remoteGateway.nextPollAt) {
      return { ...record.run };
    }
    try {
      const runtime = listAgentRuntimes().find(
        (item) => item.id === record.run.runtimeId,
      );
      const remoteRun = await getAgentsOneRemoteGatewayRun(
        record.remoteGateway.config,
        record.remoteGateway.runId,
        runtime ? runtimeAuth(runtime) : undefined,
      );
      record.remoteGateway.failures = 0;
      record.remoteGateway.lastSuccessfulPollAt = Date.now();
      record.remoteGateway.nextPollAt = 0;
      return reconcileGatewayCancellation(
        record,
        await applyHydratedAgentsOneRemoteGatewayRun(
          record,
          remoteRun,
          runtime ? runtimeAuth(runtime) : undefined,
        ),
      );
    } catch (error) {
      if (isAgentsOneRemoteGatewayRunNotFound(error)) {
        return finishRuntimeRun(record, "failed", {
          output: record.run.output,
          error: explainAgentsOneRemoteGatewayError(error),
        });
      }
      record.remoteGateway.failures += 1;
      record.remoteGateway.nextPollAt =
        Date.now() +
        Math.min(
          15_000,
          1_000 * 2 ** Math.min(record.remoteGateway.failures - 1, 4),
        );
      if (
        record.remoteGateway.failures === 1 ||
        record.remoteGateway.failures === 3
      ) {
        appendRuntimeEvent(
          record,
          "progress",
          `Gateway 状态查询暂时失败，正在重试（${record.remoteGateway.failures}）。`,
        );
      }
      if (Date.now() - record.remoteGateway.lastSuccessfulPollAt < 120_000) {
        return { ...record.run };
      }
      return finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: `Gateway 状态连续 120 秒不可达：${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    }
  }
  return { ...record.run };
}

/** Retry one previously unavailable remote artifact without re-running the task. */
export async function retryAgentRuntimeArtifact(
  runId: string,
  artifactId: string,
): Promise<AgentRuntimeRun | null> {
  const record = runtimeRuns.get(runId);
  if (!record?.remoteGateway || record.run.status === "running") return null;
  const artifact = record.run.artifacts?.find((item) => item.id === artifactId);
  if (!artifact?.unavailableReason) return { ...record.run };
  const attempts =
    record.remoteGateway.artifactRetryAttempts.get(artifactId) || 0;
  if (attempts >= MAX_GATEWAY_ARTIFACT_RETRY_ATTEMPTS) {
    appendRuntimeEvent(
      record,
      "progress",
      `远程产物 ${artifact.label} 已达到 ${MAX_GATEWAY_ARTIFACT_RETRY_ATTEMPTS} 次下载重试上限。`,
    );
    return { ...record.run };
  }
  record.remoteGateway.artifactRetryAttempts.set(artifactId, attempts + 1);
  const runtime = listAgentRuntimes().find(
    (item) => item.id === record.run.runtimeId,
  );
  const hydrated = await hydrateAgentsOneRemoteGatewayArtifacts(
    record.remoteGateway.config,
    runtime ? runtimeAuth(runtime) : undefined,
    [artifact],
  );
  for (const failure of hydrated.failures) {
    appendRuntimeEvent(record, "progress", failure);
  }
  const replacement = hydrated.artifacts?.[0];
  if (replacement) {
    record.run = {
      ...record.run,
      artifacts: (record.run.artifacts || []).map((item) =>
        item.id === artifactId ? replacement : item,
      ),
    };
  }
  if (!replacement?.unavailableReason) {
    appendRuntimeEvent(record, "artifact_published", "远程产物下载重试成功。");
  }
  return { ...record.run };
}

export async function runAgentRuntimeTask(
  runtimeId: string,
  input: AgentRuntimeTaskInput,
): Promise<AgentRuntimeRun> {
  const run = await startAgentRuntimeTask(runtimeId, input);
  return new Promise<AgentRuntimeRun>((resolve) => {
    const interval = setInterval(async () => {
      const current = await getAgentRuntimeRun(run.id);
      if (!current) {
        clearInterval(interval);
        resolve({
          ...run,
          status: "failed",
          completedAt: Date.now(),
          error: "Runtime task record was lost before completion.",
        });
        return;
      }
      if (current.status === "running") return;
      clearInterval(interval);
      resolve(current);
    }, 25);
  });
}

async function requestRemoteGatewayCancellation(
  record: RuntimeRunRecord,
  status?: "timed_out",
): Promise<boolean> {
  const gateway = record.remoteGateway;
  if (!gateway || record.run.status !== "running") return false;
  record.cancelRequested = true;
  if (status) record.terminationStatus = status;
  try {
    const runtime = listAgentRuntimes().find(
      (item) => item.id === record.run.runtimeId,
    );
    const cancelledRun = await applyHydratedAgentsOneRemoteGatewayRun(
      record,
      await cancelAgentsOneRemoteGatewayRun(
        gateway.config,
        gateway.runId,
        runtime ? runtimeAuth(runtime) : undefined,
      ),
      runtime ? runtimeAuth(runtime) : undefined,
    );
    // HTTP success merely acknowledges the request. A run remains active until
    // a subsequent Gateway snapshot reports a real terminal status.
    if (cancelledRun.status === "running") {
      gateway.cancelRequestedAt ||= Date.now();
      gateway.nextPollAt = Date.now() + GATEWAY_CANCEL_CONFIRMATION_INTERVAL_MS;
      appendRuntimeEvent(
        record,
        "progress",
        "Gateway 已收到取消请求，正在确认远端运行是否已停止。",
      );
      return false;
    }
    return true;
  } catch (error) {
    record.cancelRequested = false;
    if (!status) record.terminationStatus = undefined;
    appendRuntimeEvent(
      record,
      "progress",
      `Gateway 取消尚未确认：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

export async function cancelAgentRuntimeTask(runId: string): Promise<boolean> {
  const record = runtimeRuns.get(runId);
  if (!record || record.run.status !== "running") return false;
  record.cancelRequested = true;
  if (record.remoteGateway) {
    return requestRemoteGatewayCancellation(record);
  }
  if (record.webAgent) {
    void record.webAgent.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
  if (
    record.codex ||
    record.claudeSdk ||
    record.claudeCode ||
    record.pi ||
    record.opencode
  )
    return terminateLocalRuntime(record, "cancelled");
  record.abortHandle?.();
  finishRuntimeRun(record, "cancelled", {
    output: record.run.output,
    error: "Runtime task was cancelled.",
  });
  return true;
}

/** Stop every in-process Runtime task before replacing portable user data. */
export async function cancelAllAgentRuntimeTasks(): Promise<number> {
  const activeIds = [...runtimeRuns.entries()]
    .filter(([, record]) => record.run.status === "running")
    .map(([runId]) => runId);
  const outcomes = await Promise.allSettled(
    activeIds.map((runId) => cancelAgentRuntimeTask(runId)),
  );
  return outcomes.filter(
    (outcome) => outcome.status === "fulfilled" && outcome.value,
  ).length;
}

/** Number of in-process Runtime writes that must quiesce before export. */
export function activeAgentRuntimeTaskCount(): number {
  return [...runtimeRuns.values()].filter(
    (record) => record.run.status === "running",
  ).length;
}

/** Subscribe to terminal Runtime outcomes without changing persisted run data. */
// @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
export function onAgentRuntimeRunFinished(
  listener: (event: AgentRuntimeRunFinishedEvent) => void,
): () => void {
  runtimeRunFinishedListeners.add(listener);
  return () => runtimeRunFinishedListeners.delete(listener);
}
