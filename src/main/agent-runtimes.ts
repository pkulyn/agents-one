import {
  AGENT_RUNTIME_KINDS,
  NO_AGENT_RUNTIME_CAPABILITIES,
  deriveAgentTransport,
  type AgentRuntimeConfig,
  type AgentRuntimeDefinition,
  type AgentRuntimeDraft,
  type AgentRuntimeArtifact,
  type AgentRuntimeAppearance,
  type AgentRuntimeEvent,
  type AgentRuntimeEventType,
  type AgentRuntimeProbe,
  type AgentRuntimeRun,
  type AgentRuntimeTaskInput,
  type HermesRuntimeMode,
} from "../shared/agent-runtimes";
import {
  getConnectionConfig,
  readDesktopConfig,
  writeDesktopConfig,
} from "./config";
import { sendMessage, testRemoteConnection } from "./hermes";
import {
  cancelOpenClawTask,
  getOpenClawTask,
  probeOpenClawRuntime,
  startOpenClawTask,
  uploadOpenClawArtifact,
  type OpenClawBridgeTask,
  type OpenClawRuntimeConfig,
} from "./openclaw-runtime";
import { existsSync, readFileSync } from "fs";
import { delimiter, join } from "path";
import { prepareRuntimeInputs } from "./runtime-inputs";
import type { OpenClawRuntimeAuth } from "./openclaw-runtime";
import {
  cancelRemoteCoordinatorPlan,
  getRemoteCoordinatorPlan,
  probeRemoteCoordinatorBridge,
  startRemoteCoordinatorPlan,
  type RemoteCoordinatorConfig,
  type RemoteCoordinatorPlan,
} from "./remote-coordinator-bridge";
import { probeCodexRuntime, startCodexProcess } from "./codex-runtime";
import {
  probeClaudeCodeRuntime,
  startClaudeCodeProcess,
} from "./claude-code-runtime";
import { probePiRuntime, startPiProcess } from "./pi-runtime";
import { randomUUID } from "crypto";
import { getSecret } from "./secrets";
import { invalidateSecretsCache, setEnvValue } from "./config";
import { redactSensitiveText } from "../shared/redaction";
import {
  OutboundRemoteWorkspaceGateway,
  createRemoteWorkspaceGrant,
  probeRemoteWorkspaceGateway,
  type RemoteWorkspaceGatewayConfig,
} from "./remote-workspace-gateway";
import { promptRemoteWorkspaceDelete } from "./workspace-delete-prompt";
import {
  cancelAgentsOneRemoteGatewayRun,
  explainAgentsOneRemoteGatewayError,
  getAgentsOneRemoteGatewayArtifact,
  getAgentsOneRemoteGatewayRun,
  isAgentsOneRemoteGatewayRunNotFound,
  probeAgentsOneRemoteGateway,
  startAgentsOneRemoteGatewayRun,
  uploadAgentsOneRemoteGatewayArtifact,
  type AgentsOneRemoteGatewayConfig,
} from "./agents-one-remote-gateway";
import {
  agentEventTimelineEntry,
  isSyntheticRemoteReasoningSummary,
  normalizeAgentEventStreamModel,
  normalizeAgentEventStreamUsage,
  type AgentEventStreamUsage,
  type AgentEventStreamTool,
  type AgentEventStreamEvent,
} from "../shared/agent-event-stream";
import { materializeBytesToTemp } from "./media";
import { hasValidTaskCollaborationProposal } from "../shared/task-collaboration-proposals";
import { verifyLocalDeliveryArtifacts } from "./runtime-delivery";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";

const RUNTIME_CONFIG_KEY = "agentRuntimes";
const RUNTIME_APPEARANCE_KEY = "agentRuntimeAppearances";
const RESERVED_RUNTIME_IDS = new Set(["hermes-local", "hermes-remote"]);
const RUNTIME_ID = /^[a-z][a-z0-9-]{1,63}$/;
const SECRET_CONFIG_KEY = /(token|secret|password|api.?key|credential)/i;
const MAX_RUNTIME_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TASK_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_TASK_PROMPT_LENGTH = 100_000;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_GATEWAY_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const GATEWAY_TERMINAL_RECONCILIATION_MAX_ATTEMPTS = 3;
const GATEWAY_TERMINAL_RECONCILIATION_INTERVAL_MS = 750;
const MAX_RETAINED_RUNS = 100;
const MAX_RUNTIME_EVENTS = 200;
const MAX_RUNTIME_EVENT_SUMMARY_LENGTH = 1_000;
const MAX_RUNTIME_EVENT_DETAIL_LENGTH = 8_000;
const OPENCLAW_BEARER_SECRET_PREFIX = "HERMES_OPENCLAW_RUNTIME_";
const HERMES_API_KEY_SECRET_PREFIX = "HERMES_REMOTE_RUNTIME_";
const HERMES_DASHBOARD_TOKEN_SECRET_PREFIX = "HERMES_RUNTIME_DASHBOARD_";
const WORKSPACE_GATEWAY_TOKEN_SECRET_PREFIX = "HERMES_WORKSPACE_GATEWAY_";
const AGENTS_ONE_GATEWAY_TOKEN_SECRET_PREFIX = "AGENTS_ONE_GATEWAY_";
const REMOTE_WORKSPACE_POLL_INTERVAL_MS = 500;

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
  pendingEventOutput?: string;
  claudeStream?: ClaudeStreamState;
  timeout?: NodeJS.Timeout;
  abortHandle?: () => void;
  cancelRequested: boolean;
  openClaw?: {
    config: OpenClawRuntimeConfig;
    taskId: string;
  };
  remotePlan?: {
    config: RemoteCoordinatorConfig;
    planId: string;
  };
  codex?: {
    cancel: () => void;
  };
  claudeCode?: {
    cancel: () => void;
  };
  pi?: {
    cancel: () => void;
  };
  remoteGateway?: {
    config: AgentsOneRemoteGatewayConfig;
    runId: string;
    failures: number;
    lastSuccessfulPollAt: number;
    nextPollAt: number;
    terminalReconciliationAttempts: number;
  };
  workspaceGateway?: {
    gateway: OutboundRemoteWorkspaceGateway;
    stopped: boolean;
    timer?: NodeJS.Timeout;
    failures: number;
  };
}

const runtimeRuns = new Map<string, RuntimeRunRecord>();

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
  if (a.length < 3 || b.length < 3 || a === b) return false;
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
      event.data?.summary?.trim() || event.data?.reasoningSummary?.trim();
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

  appendRuntimeEvent(record, "message", "Hermes 正在生成回复。");
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
    agentTransport !== "local-api"
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
  const hermes = runtimeHermesConnectionFrom(value.hermes, endpoint);
  return {
    endpoint,
    ...(remoteGateway ? { remoteGateway } : {}),
    workspaceGatewayEndpoint,
    transport,
    ...(agentTransport ? { agentTransport } : {}),
    executablePath: optionalString(value.executablePath, 4096),
    model: optionalString(value.model, 256),
    workspace: optionalString(value.workspace, 4096),
    timeoutMs: timeoutMs as number | undefined,
    ...(hermes ? { hermes } : {}),
  };
}

function runtimeHermesConnectionFrom(
  value: unknown,
  endpoint?: string,
): NonNullable<AgentRuntimeConfig["hermes"]> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new Error("Hermes connection configuration is invalid.");
  }
  // Legacy SSH mode was removed — the unified remote transport is Gateway v1.
  // Old persisted configs keep their stored fields untouched; on read they are
  // coerced to `remote` and flagged for re-setup (see normalizeUserRuntime).
  const mode = value.mode;
  if (mode !== "local" && mode !== "remote" && mode !== "ssh") {
    throw new Error("Hermes connection mode is invalid.");
  }
  const migratedFromSsh = mode === "ssh";
  const effectiveMode: HermesRuntimeMode = migratedFromSsh ? "remote" : mode;
  const chatTransport = value.chatTransport;
  if (
    chatTransport !== undefined &&
    chatTransport !== "auto" &&
    chatTransport !== "dashboard" &&
    chatTransport !== "legacy"
  ) {
    throw new Error("Hermes chat transport is invalid.");
  }
  if (effectiveMode === "remote" && !migratedFromSsh && !endpoint) {
    throw new Error("Remote Hermes server address is required.");
  }
  return {
    mode: effectiveMode,
    dashboardUrl: optionalString(value.dashboardUrl, 2048),
    chatTransport: chatTransport as "auto" | "dashboard" | "legacy" | undefined,
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
    !AGENT_RUNTIME_KINDS.includes(
      kind as (typeof AGENT_RUNTIME_KINDS)[number],
    ) ||
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
    const runtime: AgentRuntimeDefinition = {
      id,
      name,
      kind: kind as AgentRuntimeDefinition["kind"],
      location,
      enabled: value.enabled !== false,
      needsReauthorization: value.needsReauthorization === true || legacySshMode,
      managed: "user",
      config,
    };
    if (!config.agentTransport) {
      runtime.config = { ...config, agentTransport: deriveAgentTransport(runtime) };
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

export function openClawBearerSecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${OPENCLAW_BEARER_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_BEARER_TOKEN`;
}

export function hermesApiKeySecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${HERMES_API_KEY_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

export function hermesDashboardTokenSecretKey(runtimeId: string): string {
  if (!RUNTIME_ID.test(runtimeId)) throw new Error("Runtime ID is invalid.");
  return `${HERMES_DASHBOARD_TOKEN_SECRET_PREFIX}${runtimeId.replace(/-/g, "_").toUpperCase()}_TOKEN`;
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

function remoteRuntimeForCredential(runtimeId: string): AgentRuntimeDefinition {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (
    !runtime ||
    runtime.location !== "remote" ||
    (!isAgentsOneGatewayRuntime(runtime) &&
      runtime.kind !== "openclaw" &&
      (runtime.kind !== "hermes" || runtime.managed === "builtin"))
  ) {
    throw new Error(
      "Only user-managed remote Hermes and OpenClaw runtimes may store a credential.",
    );
  }
  return runtime;
}

function openClawAuth(runtimeId: string): OpenClawRuntimeAuth {
  return {
    bearerToken: getSecret(openClawBearerSecretKey(runtimeId)) || undefined,
  };
}

function remoteRuntimeCredentialKey(runtime: AgentRuntimeDefinition): string {
  if (isAgentsOneGatewayRuntime(runtime)) {
    return agentsOneGatewayTokenSecretKey(runtime.id);
  }
  return runtime.kind === "hermes"
    ? hermesApiKeySecretKey(runtime.id)
    : openClawBearerSecretKey(runtime.id);
}

function runtimeAuth(
  runtime: AgentRuntimeDefinition,
): { bearerToken?: string } | undefined {
  if (runtime.needsReauthorization) return undefined;
  if (isAgentsOneGatewayRuntime(runtime)) {
    const token = (
      getSecret(agentsOneGatewayTokenSecretKey(runtime.id)) || ""
    ).trim();
    return token ? { bearerToken: token } : undefined;
  }
  if (runtime.kind === "openclaw" && runtime.location === "remote") {
    return openClawAuth(runtime.id);
  }
  if (runtime.kind === "hermes" && runtime.location === "remote") {
    const token =
      runtime.managed === "builtin"
        ? getConnectionConfig().apiKey.trim()
        : (getSecret(hermesApiKeySecretKey(runtime.id)) || "").trim();
    return token ? { bearerToken: token } : undefined;
  }
  return undefined;
}

function hasConstrainedPlanning(capabilities: {
  orchestration: boolean;
  readOnlyPlanning: boolean;
  cancellation: boolean;
  artifacts: boolean;
  securityEvents: boolean;
}): boolean {
  return Boolean(
    capabilities.orchestration &&
    capabilities.readOnlyPlanning &&
    capabilities.cancellation &&
    capabilities.artifacts &&
    capabilities.securityEvents,
  );
}

export function getAgentRuntimeCredentialStatus(runtimeId: string): {
  required: boolean;
  configured: boolean;
} {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (
    runtime.location !== "remote" ||
    (!isAgentsOneGatewayRuntime(runtime) &&
      runtime.kind !== "openclaw" &&
      (runtime.kind !== "hermes" || runtime.managed === "builtin"))
  ) {
    return { required: false, configured: false };
  }
  return {
    required: true,
    configured:
      runtime.needsReauthorization !== true &&
      Boolean(getSecret(remoteRuntimeCredentialKey(runtime))),
  };
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
  setEnvValue(remoteRuntimeCredentialKey(runtime), bearerToken.trim());
  markRuntimeReauthorized(runtimeId);
  invalidateSecretsCache();
  return { configured: true };
}

export function setAgentRuntimeDashboardToken(
  runtimeId: string,
  dashboardToken: string,
): { configured: true } {
  const runtime = remoteRuntimeForCredential(runtimeId);
  if (runtime.kind !== "hermes") {
    throw new Error("Only Hermes runtimes use a Dashboard token.");
  }
  if (
    typeof dashboardToken !== "string" ||
    dashboardToken.trim().length < 8 ||
    dashboardToken.length > 4096 ||
    /[\0\r\n]/.test(dashboardToken)
  ) {
    throw new Error("Remote Hermes Dashboard token is invalid.");
  }
  setEnvValue(hermesDashboardTokenSecretKey(runtime.id), dashboardToken.trim());
  invalidateSecretsCache();
  return { configured: true };
}

/** Stores the credential used only by a separately hosted workspace gateway. */
export function setAgentRuntimeWorkspaceGatewayToken(
  runtimeId: string,
  bearerToken: string,
): { configured: true } {
  const runtime = remoteRuntimeForCredential(runtimeId);
  if (
    typeof bearerToken !== "string" ||
    bearerToken.trim().length < 8 ||
    bearerToken.length > 4096 ||
    /[\0\r\n]/.test(bearerToken)
  ) {
    throw new Error("Remote workspace gateway credential is invalid.");
  }
  setEnvValue(workspaceGatewayTokenSecretKey(runtime.id), bearerToken.trim());
  invalidateSecretsCache();
  return { configured: true };
}

function remoteWorkspaceGatewayConfig(
  runtime: AgentRuntimeDefinition,
): RemoteWorkspaceGatewayConfig {
  if (runtime.needsReauthorization) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }
  const endpoint =
    runtime.config.workspaceGatewayEndpoint?.trim() ||
    runtime.config.endpoint?.trim();
  if (!endpoint) {
    throw new Error("请先在智能体管理中配置受控工作区网关地址。");
  }
  const bearerToken =
    (getSecret(workspaceGatewayTokenSecretKey(runtime.id)) || "").trim() ||
    runtimeAuth(runtime)?.bearerToken;
  if (!bearerToken) {
    throw new Error("请先在智能体管理中保存受控工作区网关 Token。");
  }
  return {
    endpoint,
    bearerToken,
    timeoutMs: runtime.config.timeoutMs,
  };
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
  const connection = getConnectionConfig();
  const remote = connection.mode === "remote";
  return {
    id: remote ? "hermes-remote" : "hermes-local",
    name: "Hermes",
    kind: "hermes",
    location: remote ? "remote" : "local",
    enabled: true,
    managed: "builtin",
    config: remote
      ? {
          endpoint: connection.remoteUrl,
          transport: "http",
          agentTransport: "gateway-v1",
          timeoutMs: 15_000,
        }
      : { transport: "cli", agentTransport: "local-api", timeoutMs: 15_000 },
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
  const builtIns = [builtInHermesRuntime()];
  return [...builtIns, ...defaults, ...users].map((runtime) =>
    applyRuntimeAppearance(runtime, appearances[runtime.id]),
  );
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
  const runtime = normalizeUserRuntime({
    ...draft,
    config,
    managed: "user",
  });
  if (!runtime) throw new Error("Runtime definition is invalid.");

  const runtimes = userRuntimes();
  const existingIndex = runtimes.findIndex((item) => item.id === runtime.id);
  if (existingIndex >= 0) runtimes[existingIndex] = runtime;
  else runtimes.push(runtime);
  writeUserRuntimes(runtimes);
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
  return true;
}

async function probeRuntimeDefinition(
  runtime: AgentRuntimeDefinition,
  transientAuth?: { bearerToken?: string },
): Promise<AgentRuntimeProbe> {
  const checkedAt = Date.now();
  if (runtime.needsReauthorization && !transientAuth?.bearerToken) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }

  if (isAgentsOneGatewayRuntime(runtime)) {
    if (!runtime.config.endpoint) {
      throw new Error("Unified Gateway endpoint is required.");
    }
    const result = await probeAgentsOneRemoteGateway(
      {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      },
      transientAuth?.bearerToken ? transientAuth : runtimeAuth(runtime),
    );
    return {
      runtimeId: runtime.id,
      state: result.healthy ? "healthy" : "unreachable",
      capabilities: result.capabilities,
      checkedAt,
      ...(result.message ? { message: result.message } : {}),
    };
  }

  if (runtime.kind === "openclaw" && runtime.location === "remote") {
    if (!runtime.config.endpoint) {
      throw new Error("OpenClaw runtime endpoint is required.");
    }
    const result = await probeOpenClawRuntime(
      {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      },
      transientAuth?.bearerToken ? transientAuth : openClawAuth(runtime.id),
    );
    return {
      runtimeId: runtime.id,
      state: result.state === "healthy" ? "healthy" : "unreachable",
      capabilities: result.capabilities,
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
    };
    const mode = customHermes.mode;
    const healthy =
      mode === "remote"
        ? await testRemoteConnection(
            runtime.config.endpoint || "",
            transientAuth?.bearerToken || runtimeAuth(runtime)?.bearerToken,
          )
        : await testRemoteConnection("http://127.0.0.1:8642");
    return {
      runtimeId: runtime.id,
      state: healthy ? "healthy" : "unreachable",
      capabilities: healthy ? capabilities : NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      ...(healthy
        ? {}
        : {
            message: `${mode === "local" ? "本地" : "远程"} Hermes 健康检查失败。`,
          }),
    };
  }

  if (runtime.kind !== "hermes" || runtime.location !== "remote") {
    return {
      runtimeId: runtime.id,
      state: "unsupported",
      capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
      checkedAt,
      message: `${runtime.kind} adapter is not installed yet.`,
    };
  }

  if (runtime.config.endpoint) {
    const coordinatorProbe = await probeRemoteCoordinatorBridge(
      {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      },
      transientAuth?.bearerToken ? transientAuth : runtimeAuth(runtime),
    );
    if (coordinatorProbe.state === "healthy") {
      return {
        runtimeId: runtime.id,
        state: "healthy",
        capabilities: coordinatorProbe.capabilities,
        checkedAt,
        ...(coordinatorProbe.message
          ? { message: coordinatorProbe.message }
          : {}),
      };
    }
    if (runtime.managed !== "builtin") {
      return {
        runtimeId: runtime.id,
        state: "unreachable",
        capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
        checkedAt,
        ...(coordinatorProbe.message
          ? { message: coordinatorProbe.message }
          : { message: "Remote Hermes health check failed." }),
      };
    }
  }
  const connection = getConnectionConfig();
  const healthy = await testRemoteConnection(
    connection.remoteUrl,
    connection.apiKey,
  );
  return {
    runtimeId: runtime.id,
    state: healthy ? "healthy" : "unreachable",
    capabilities: healthy
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
          artifacts: false,
          workspaceAccess: false,
        }
      : NO_AGENT_RUNTIME_CAPABILITIES,
    checkedAt,
    ...(healthy ? {} : { message: "Remote Hermes health check failed." }),
  };
}

/** Probe a saved Runtime without exposing any credentials to the renderer. */
export async function probeAgentRuntime(
  id: string,
): Promise<AgentRuntimeProbe> {
  const runtime = listAgentRuntimes().find((item) => item.id === id);
  if (!runtime) throw new Error("Runtime was not found.");
  return probeRuntimeDefinition(runtime);
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

function statusFromOpenClaw(status: string): AgentRuntimeRun["status"] {
  switch (status.toLowerCase()) {
    case "running":
    case "queued":
    case "pending":
      return "running";
    case "succeeded":
    case "success":
    case "completed":
    case "done":
      return "succeeded";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "timed_out":
    case "timeout":
      return "timed_out";
    case "failed":
    case "error":
      return "failed";
    default:
      return "failed";
  }
}

function statusFromRemotePlan(
  status: RemoteCoordinatorPlan["status"],
): AgentRuntimeRun["status"] {
  switch (status) {
    case "queued":
    case "running":
    case "cancelling":
      return "running";
    case "succeeded":
      return "succeeded";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    case "failed":
    default:
      return "failed";
  }
}

function applyOpenClawTask(
  record: RuntimeRunRecord,
  task: OpenClawBridgeTask,
): AgentRuntimeRun {
  const status = statusFromOpenClaw(task.status);
  if (task.status !== record.run.status) {
    appendRuntimeEvent(
      record,
      status === "running"
        ? "progress"
        : status === "succeeded"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : status === "timed_out"
              ? "timed_out"
              : "error",
      status === "running"
        ? "OpenClaw 正在远端执行。"
        : status === "succeeded"
          ? "OpenClaw 已完成远端任务。"
          : `OpenClaw 任务状态：${task.status}。`,
    );
  }
  if (task.output && task.output !== record.run.output) {
    appendRuntimeEvent(record, "message", "OpenClaw 已返回新的任务输出。");
  }
  const baseArtifacts = record.run.artifacts || [];
  const artifacts = baseArtifacts;
  const next: AgentRuntimeRun = {
    ...record.run,
    status,
    output: task.output ?? record.run.output,
    sessionId: task.sessionId ?? record.run.sessionId,
    error: task.error ?? record.run.error,
    ...(artifacts.length ? { artifacts } : {}),
    ...(status === "running" ? {} : { completedAt: Date.now() }),
  };
  record.run = next;
  return { ...next };
}

function applyAgentsOneRemoteGatewayRun(
  record: RuntimeRunRecord,
  remoteRun: Awaited<ReturnType<typeof getAgentsOneRemoteGatewayRun>>,
): AgentRuntimeRun {
  const finalOutput =
    remoteRun.output?.trim() ||
    (remoteRun.events?.length
      ? [...remoteRun.events]
          .reverse()
          .find((event) => event.type === "assistant.completed")
          ?.data?.text?.trim()
      : undefined);
  if (remoteRun.events?.length) {
    appendRemoteGatewayEvents(record, remoteRun.events, finalOutput);
  }
  const mergedModel = remoteRun.model
    ? { ...(record.run.model ?? {}), ...remoteRun.model }
    : record.run.model;
  const mergedUsage = remoteRun.usage
    ? { ...(record.run.usage ?? {}), ...remoteRun.usage }
    : record.run.usage;
  record.run = {
    ...record.run,
    ...(finalOutput && !record.run.output ? { output: finalOutput } : {}),
    ...(mergedModel ? { model: mergedModel } : {}),
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
        sessionId: remoteRun.conversationId ?? record.run.sessionId,
        model: mergedModel,
        usage: mergedUsage,
      };
      return { ...record.run };
    }
    return finishRuntimeRun(record, "failed", {
      sessionId: remoteRun.conversationId ?? record.run.sessionId,
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
        sessionId: remoteRun.conversationId ?? record.run.sessionId,
        error:
          "远程智能体未发起受控工作区操作，也未交付可验证的媒体或产物，不能将本轮标记为完成。请检查 Relay 是否已把 workspaceRef 注册为真实的 workspace_gateway 工具。",
        artifacts: remoteRun.artifacts,
        model: mergedModel,
        usage: mergedUsage,
      });
    }
    return finishRuntimeRun(record, remoteRun.status, {
      output: remoteRun.output ?? finalOutput ?? record.run.output,
      sessionId: remoteRun.conversationId ?? record.run.sessionId,
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
    sessionId: remoteRun.conversationId ?? record.run.sessionId,
    error: remoteRun.error ?? record.run.error,
    model: mergedModel,
    usage: mergedUsage,
    ...(remoteRun.artifacts?.length ? { artifacts: remoteRun.artifacts } : {}),
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
): Promise<AgentRuntimeArtifact[] | undefined> {
  if (!artifacts?.length) return artifacts;
  const hydrated: AgentRuntimeArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact.id) {
      hydrated.push(artifact);
      continue;
    }
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
    hydrated.push({
      ...artifact,
      id: downloaded.id,
      label: downloaded.name || artifact.label,
      mime: downloaded.mime,
      size: downloaded.size,
      ...(downloaded.sha256 ? { sha256: downloaded.sha256 } : {}),
      path,
    });
  }
  return hydrated;
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
  const artifacts =
    remoteRun.status === "running"
      ? remoteRun.artifacts
      : await hydrateAgentsOneRemoteGatewayArtifacts(
          record.remoteGateway?.config || { endpoint: "" },
          auth,
          remoteRun.artifacts,
        );
  return applyAgentsOneRemoteGatewayRun(
    record,
    artifacts ? { ...remoteRun, artifacts } : remoteRun,
  );
}

function planOutput(plan: RemoteCoordinatorPlan): string {
  return plan.output || (plan.plan ? JSON.stringify(plan.plan, null, 2) : "");
}

function applyRemoteCoordinatorPlan(
  record: RuntimeRunRecord,
  plan: RemoteCoordinatorPlan,
): AgentRuntimeRun {
  const status = statusFromRemotePlan(plan.status);
  if (plan.status !== record.run.status) {
    appendRuntimeEvent(
      record,
      status === "running"
        ? "progress"
        : status === "succeeded"
          ? "completed"
          : status === "cancelled"
            ? "cancelled"
            : status === "timed_out"
              ? "timed_out"
              : "error",
      status === "running"
        ? "远程协调者正在生成受控计划。"
        : status === "succeeded"
          ? "远程协调者已完成受控计划。"
          : `远程协调计划状态：${plan.status}。`,
    );
  }
  if (status !== "running" && record.timeout) {
    clearTimeout(record.timeout);
    record.timeout = undefined;
  }
  const output = planOutput(plan) || record.run.output;
  const artifacts = [
    ...(plan.artifacts || []),
    ...(status === "succeeded" && output
      ? [{ kind: "final" as const, label: "Coordinator plan", content: output }]
      : []),
  ];
  const next: AgentRuntimeRun = {
    ...record.run,
    status,
    output,
    error: plan.error ?? record.run.error,
    artifacts: artifacts.length ? artifacts : record.run.artifacts,
    ...(status === "running" ? {} : { completedAt: Date.now() }),
  };
  record.run = next;
  return { ...next };
}

function rememberRuntimeRun(record: RuntimeRunRecord): void {
  runtimeRuns.set(record.run.id, record);
  while (runtimeRuns.size > MAX_RETAINED_RUNS) {
    const oldest = runtimeRuns.keys().next().value as string | undefined;
    if (!oldest) break;
    runtimeRuns.delete(oldest);
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
    | "worktreePath"
    | "diffSummary"
    | "inputArtifacts"
    | "artifacts"
    | "model"
    | "usage"
  > = {},
): AgentRuntimeRun {
  if (record.run.status !== "running") return { ...record.run };
  if (record.timeout) clearTimeout(record.timeout);
  if (record.workspaceGateway) {
    const gateway = record.workspaceGateway;
    gateway.stopped = true;
    if (gateway.timer) clearTimeout(gateway.timer);
    void gateway.gateway.revoke(`Task ${status}.`).catch(() => undefined);
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
  const artifacts = details.artifacts || record.run.artifacts || [];
  if (details.artifacts?.length) {
    appendRuntimeEvent(record, "artifact_published", "任务已发布新的产物。");
  }
  record.run = {
    ...record.run,
    status,
    completedAt: Date.now(),
    ...details,
    ...(terminalError ? { error: terminalError } : {}),
    ...(artifacts.length ? { artifacts } : {}),
  };
  return { ...record.run };
}

function validatedTaskInput(
  input: AgentRuntimeTaskInput,
  defaultTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
): {
  prompt: string;
  profile?: string;
  sessionId?: string;
  conversation?: boolean;
  mode: "analysis" | "safe_write" | "implementation" | "full_access";
  fullAccessConfirmed?: boolean;
  workspace?: string;
  workspaceRef?: string;
  attachments?: AgentRuntimeTaskInput["attachments"];
  timeoutMs: number;
  coordinatorPlan?: NonNullable<AgentRuntimeTaskInput["coordinatorPlan"]>;
} {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_TASK_PROMPT_LENGTH) {
    throw new Error(
      "Runtime task prompt must be between 1 and 100000 characters.",
    );
  }
  const profile = optionalString(input.profile, 128);
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
  const workspace = optionalString(input.workspace, 4096);
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
      "Runtime task timeout must be between 1000 and 3600000 milliseconds.",
    );
  }
  const coordinatorPlan = input.coordinatorPlan;
  if (coordinatorPlan !== undefined) {
    if (
      !coordinatorPlan ||
      typeof coordinatorPlan !== "object" ||
      typeof coordinatorPlan.projectId !== "string" ||
      typeof coordinatorPlan.title !== "string" ||
      typeof coordinatorPlan.objective !== "string"
    ) {
      throw new Error("Coordinator planning context is invalid.");
    }
    return {
      prompt,
      profile,
      sessionId,
      conversation,
      mode,
      fullAccessConfirmed,
      workspace,
      workspaceRef,
      attachments,
      timeoutMs,
      coordinatorPlan: {
        projectId: coordinatorPlan.projectId.trim(),
        title: coordinatorPlan.title.trim(),
        objective: coordinatorPlan.objective.trim(),
        existingTasks: Array.isArray(coordinatorPlan.existingTasks)
          ? coordinatorPlan.existingTasks.map((item) => ({
              id: String(item.id || ""),
              title: String(item.title || ""),
              status: String(item.status || ""),
              ...(item.runtimeId ? { runtimeId: String(item.runtimeId) } : {}),
            }))
          : [],
      },
    };
  }
  return {
    prompt,
    profile,
    sessionId,
    conversation,
    mode,
    fullAccessConfirmed,
    workspace,
    workspaceRef,
    timeoutMs,
    attachments,
  };
}

export async function startAgentRuntimeTask(
  runtimeId: string,
  input: AgentRuntimeTaskInput,
): Promise<AgentRuntimeRun> {
  assertAgentsOneWritesAllowed();
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  if (!runtime.enabled) throw new Error("Runtime is disabled.");
  if (runtime.needsReauthorization) {
    throw new Error("请先为恢复的远程智能体重新保存凭据。");
  }
  if (
    !isGatewayTransport(runtime) &&
    !isLocalCliTransport(runtime) &&
    !isLocalApiTransport(runtime)
  ) {
    throw new Error(`${runtime.kind} task dispatch is not available yet.`);
  }

  const task = validatedTaskInput(
    input,
    isGatewayTransport(runtime) ? DEFAULT_GATEWAY_TASK_TIMEOUT_MS : DEFAULT_TASK_TIMEOUT_MS,
  );
  if (
    task.mode === "full_access" &&
    !(
      isLocalCliTransport(runtime) ||
      (isGatewayTransport(runtime) &&
        (runtime.kind === "hermes" || runtime.kind === "openclaw")) ||
      (isLocalApiTransport(runtime) &&
        (runtime.kind === "hermes" || runtime.kind === "openclaw"))
    )
  ) {
    throw new Error(
      "Full access is available only for local CLI agents or configured remote workspace gateways.",
    );
  }
  const id = `run-${randomUUID()}`;
  const startedAt = Date.now();
  const record: RuntimeRunRecord = {
    run: {
      id,
      runtimeId,
      status: "running",
      startedAt,
      output: "",
      events: [],
    },
    cancelRequested: false,
  };
  appendRuntimeEvent(record, "started", "任务已开始执行。");
  rememberRuntimeRun(record);

  let dispatchPrompt = task.prompt;
  let dispatchWorkspaceRef = task.workspaceRef;
  const unifiedGatewayRuntime = isAgentsOneGatewayRuntime(runtime);
  if (
    task.workspace &&
    runtime.location === "remote" &&
    (unifiedGatewayRuntime ||
      runtime.kind === "hermes" ||
      runtime.kind === "openclaw")
  ) {
    try {
      const auth = runtimeAuth(runtime);
      const config = unifiedGatewayRuntime
        ? {
            endpoint: runtime.config.endpoint || "",
            bearerToken: auth?.bearerToken,
            timeoutMs: runtime.config.timeoutMs,
            contract: "agents-one-v1" as const,
          }
        : remoteWorkspaceGatewayConfig(runtime);
      if (unifiedGatewayRuntime && (!config.endpoint || !config.bearerToken)) {
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

  if (task.coordinatorPlan) {
    if (task.attachments?.length) {
      return finishRuntimeRun(record, "failed", {
        error: "Coordinator planning does not accept file inputs yet.",
      });
    }
    if (
      runtime.location !== "remote" ||
      (runtime.kind !== "hermes" && runtime.kind !== "openclaw")
    ) {
      return finishRuntimeRun(record, "failed", {
        error:
          "Coordinator planning requires a remote Hermes or OpenClaw Bridge.",
      });
    }
    if (!runtime.config.endpoint) {
      return finishRuntimeRun(record, "failed", {
        error: "Remote coordinator endpoint is required.",
      });
    }
    try {
      const probe = await probeRemoteCoordinatorBridge(
        {
          endpoint: runtime.config.endpoint,
          timeoutMs: runtime.config.timeoutMs,
        },
        runtimeAuth(runtime),
      );
      if (
        probe.state !== "healthy" ||
        !hasConstrainedPlanning(probe.capabilities)
      ) {
        return finishRuntimeRun(record, "failed", {
          error:
            "Remote coordinator Bridge does not expose enforceable read-only planning.",
        });
      }
      const config: RemoteCoordinatorConfig = {
        endpoint: runtime.config.endpoint,
        timeoutMs: runtime.config.timeoutMs,
      };
      const plan = await startRemoteCoordinatorPlan(
        config,
        {
          projectId: task.coordinatorPlan.projectId,
          request: task.prompt,
          context: {
            title: task.coordinatorPlan.title,
            requirements: task.coordinatorPlan.objective,
            ...(task.workspace ? { workspace: task.workspace } : {}),
            existingTasks: task.coordinatorPlan.existingTasks,
          },
          timeoutSeconds: Math.ceil(task.timeoutMs / 1000),
        },
        runtimeAuth(runtime),
      );
      record.remotePlan = { config, planId: plan.id };
      record.timeout = setTimeout(() => {
        void cancelRemoteCoordinatorPlan(
          config,
          plan.id,
          runtimeAuth(runtime),
        ).catch(() => undefined);
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          error: `Remote coordinator planning exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      return applyRemoteCoordinatorPlan(record, plan);
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
      timeoutMs: runtime.config.timeoutMs,
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
          // A chat must stay a Gateway conversation from its first turn. The
          // first request has no remote session id yet, but still needs the
          // structured reasoning/tool event stream used by later turns.
          mode: task.conversation || task.sessionId ? "conversation" : "task",
          conversationId: task.sessionId,
          text: dispatchPrompt,
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
      };
      record.timeout = setTimeout(() => {
        void cancelAgentsOneRemoteGatewayRun(config, remoteRun.id, auth).catch(
          () => undefined,
        );
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          error: `Gateway 运行超出 ${task.timeoutMs}ms。`,
        });
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

  if (runtime.kind === "codex") {
    try {
      const codex = await startCodexProcess(
        {
          executablePath: runtime.config.executablePath,
          model: runtime.config.model,
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
        record.run = { ...record.run, worktreePath: codex.worktreePath };
      }
      record.timeout = setTimeout(() => {
        codex.cancel();
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          worktreePath: record.run.worktreePath,
          error: `Runtime task exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      void codex.completion.then(async (result) => {
        if (record.run.status !== "running") return;
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
          ...(result.error ? { error: result.error } : {}),
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
    try {
      const claudeCode = await startClaudeCodeProcess(
        {
          executablePath: runtime.config.executablePath,
          model: runtime.config.model,
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
        record.run = { ...record.run, worktreePath: claudeCode.worktreePath };
      }
      record.timeout = setTimeout(() => {
        claudeCode.cancel();
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          worktreePath: record.run.worktreePath,
          error: `Runtime task exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      void claudeCode.completion.then(async (result) => {
        if (record.run.status !== "running") return;
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
          model: runtime.config.model,
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
        record.run = { ...record.run, worktreePath: pi.worktreePath };
      }
      record.run = { ...record.run, sessionId: pi.sessionId };
      record.timeout = setTimeout(() => {
        pi.cancel();
        finishRuntimeRun(record, "timed_out", {
          output: record.run.output,
          worktreePath: record.run.worktreePath,
          error: `Runtime task exceeded ${task.timeoutMs}ms.`,
        });
      }, task.timeoutMs);
      void pi.completion.then(async (result) => {
        if (record.run.status !== "running") return;
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

  if (runtime.kind === "openclaw") {
    if (!runtime.config.endpoint) {
      throw new Error("OpenClaw runtime endpoint is required.");
    }
    const config: OpenClawRuntimeConfig = {
      endpoint: runtime.config.endpoint,
      timeoutMs: runtime.config.timeoutMs,
    };
    return (async () => {
      const auth = openClawAuth(runtime.id);
      if (task.workspace && !dispatchWorkspaceRef) {
        throw new Error(
          "远程 OpenClaw 无法直接访问本机工作区。请配置受控工作区网关、上传上下文包或使用 git: 工作区引用。",
        );
      }
      let artifactIds: string[] | undefined;
      if (task.attachments?.length) {
        const probe = await probeOpenClawRuntime(config, auth);
        if (probe.state !== "healthy" || !probe.capabilities.artifacts) {
          throw new Error(
            "OpenClaw Bridge does not advertise the Artifact capability.",
          );
        }
        const prepared = prepareRuntimeInputs(
          task.profile,
          task.attachments,
          `openclaw-${id}`,
        );
        artifactIds = [];
        for (const file of prepared.files) {
          const uploaded = await uploadOpenClawArtifact(
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
      return startOpenClawTask(
        config,
        {
          prompt: dispatchPrompt,
          profile: task.profile,
          sessionId: task.sessionId,
          artifactIds,
          workspaceRef: dispatchWorkspaceRef,
        },
        auth,
      );
    })()
      .then((bridgeTask) => {
        record.openClaw = { config, taskId: bridgeTask.id };
        return applyOpenClawTask(record, bridgeTask);
      })
      .catch((error) => {
        return finishRuntimeRun(record, "failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
  if (record.remotePlan && record.run.status === "running") {
    try {
      const plan = await getRemoteCoordinatorPlan(
        record.remotePlan.config,
        record.remotePlan.planId,
        runtimeAuth(
          listAgentRuntimes().find((item) => item.id === record.run.runtimeId)!,
        ),
      );
      return applyRemoteCoordinatorPlan(record, plan);
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
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
      return await applyHydratedAgentsOneRemoteGatewayRun(
        record,
        remoteRun,
        runtime ? runtimeAuth(runtime) : undefined,
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
  if (record.openClaw && record.run.status === "running") {
    try {
      const task = await getOpenClawTask(
        record.openClaw.config,
        record.openClaw.taskId,
        openClawAuth(record.run.runtimeId),
      );
      return applyOpenClawTask(record, task);
    } catch (error) {
      return finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
      if (!current || current.status === "running") return;
      clearInterval(interval);
      resolve(current);
    }, 25);
  });
}

export async function cancelAgentRuntimeTask(runId: string): Promise<boolean> {
  const record = runtimeRuns.get(runId);
  if (!record || record.run.status !== "running") return false;
  record.cancelRequested = true;
  if (record.remotePlan) {
    try {
      const runtime = listAgentRuntimes().find(
        (item) => item.id === record.run.runtimeId,
      );
      const plan = await cancelRemoteCoordinatorPlan(
        record.remotePlan.config,
        record.remotePlan.planId,
        runtime ? runtimeAuth(runtime) : undefined,
      );
      applyRemoteCoordinatorPlan(record, plan);
    } catch (error) {
      finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  if (record.remoteGateway) {
    try {
      const runtime = listAgentRuntimes().find(
        (item) => item.id === record.run.runtimeId,
      );
      return Boolean(
        await applyHydratedAgentsOneRemoteGatewayRun(
          record,
          await cancelAgentsOneRemoteGatewayRun(
            record.remoteGateway.config,
            record.remoteGateway.runId,
            runtime ? runtimeAuth(runtime) : undefined,
          ),
          runtime ? runtimeAuth(runtime) : undefined,
        ),
      );
    } catch (error) {
      finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
  }
  if (record.openClaw) {
    try {
      const task = await cancelOpenClawTask(
        record.openClaw.config,
        record.openClaw.taskId,
        openClawAuth(record.run.runtimeId),
      );
      applyOpenClawTask(record, task);
    } catch (error) {
      finishRuntimeRun(record, "failed", {
        output: record.run.output,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  if (record.codex) {
    record.codex.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      worktreePath: record.run.worktreePath,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
  if (record.claudeCode) {
    record.claudeCode.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      worktreePath: record.run.worktreePath,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
  if (record.pi) {
    record.pi.cancel();
    finishRuntimeRun(record, "cancelled", {
      output: record.run.output,
      worktreePath: record.run.worktreePath,
      error: "Runtime task was cancelled.",
    });
    return true;
  }
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
