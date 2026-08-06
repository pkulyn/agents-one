/**
 * Agents One Event Stream v1 is the provider-neutral, durable subset of an
 * agent's live activity.  It deliberately carries user-visible reasoning
 * summaries and operational evidence, never raw private chain-of-thought.
 */
export const AGENT_EVENT_STREAM_V1 = "agents-one-event-stream-v1" as const;

export const AGENT_EVENT_STREAM_EVENT_TYPES = [
  "run.started",
  "run.status",
  "run.completed",
  "run.failed",
  "assistant.delta",
  "assistant.completed",
  "reasoning.summary",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "artifact.created",
  "workspace.requested",
  "workspace.completed",
  "workspace.blocked",
  "handoff.created",
  "handoff.completed",
] as const;

export type AgentEventStreamEventType =
  (typeof AGENT_EVENT_STREAM_EVENT_TYPES)[number];

export type AgentEventStreamToolKind =
  | "tool"
  | "skill"
  | "mcp"
  | "terminal"
  | "workspace";

export interface AgentEventStreamTool {
  callId?: string;
  name: string;
  kind?: AgentEventStreamToolKind;
  inputSummary?: string;
  outputSummary?: string;
}

export interface AgentEventStreamModel {
  id?: string;
  provider?: string;
  contextWindowTokens?: number;
}

export interface AgentEventStreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Current prompt occupancy reported by Hermes-style gateways. */
  contextUsedTokens?: number;
  contextWindowTokens?: number;
}

export interface AgentEventStreamArtifact {
  id?: string;
  label?: string;
  name?: string;
  mime?: string;
  size?: number;
  path?: string;
  sha256?: string;
  summary?: string;
}

export interface AgentEventStreamEventData {
  /** A redacted, user-visible description of the event. */
  summary?: string;
  /** Optional machine-readable error code from the upstream runtime. */
  code?: string;
  /** Structured redacted error detail, preserved separately from summary. */
  error?: string;
  /** Structured redacted detail, preserved separately from summary. */
  detail?: string;
  /** Optional final assistant text. Deltas are intentionally not persisted. */
  text?: string;
  reasoningSummary?: string;
  tool?: AgentEventStreamTool;
  artifact?: AgentEventStreamArtifact;
  model?: AgentEventStreamModel;
  usage?: AgentEventStreamUsage;
}

export interface AgentEventStreamEvent {
  id: string;
  type: AgentEventStreamEventType;
  /** Monotonic within a run when the upstream transport can provide it. */
  sequence?: number;
  createdAt: number;
  data?: AgentEventStreamEventData;
}

export interface AgentEventStreamSupport {
  protocol: typeof AGENT_EVENT_STREAM_V1;
  transport: "sse" | "poll" | "websocket";
  reasoningSummaries?: boolean;
  toolEvents?: boolean;
  modelMetadata?: boolean;
  usageMetadata?: boolean;
}

export interface AgentEventTimelineEntry {
  id: string;
  type:
    | "started"
    | "progress"
    | "tool_call"
    | "tool_result"
    | "message"
    | "artifact_published"
    | "error"
    | "completed";
  summary: string;
  createdAt: number;
  detail?: string;
  code?: string;
  tool?: AgentEventStreamTool;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function firstText(
  source: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return undefined;
}

function firstNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = number(source[key]);
    if (value !== undefined && value >= 0) return value;
  }
  return undefined;
}

/** Accepts both Event Stream v1 names and common provider snake_case aliases. */
export function normalizeAgentEventStreamModel(
  value: unknown,
): AgentEventStreamModel | undefined {
  const source = typeof value === "string" ? { id: value } : object(value);
  if (!source) return undefined;
  const id = firstText(source, [
    "id",
    "name",
    "model",
    "modelId",
    "model_id",
    "modelName",
    "model_name",
  ]);
  const provider = firstText(source, ["provider", "vendor"]);
  const contextWindowTokens = firstNumber(source, [
    "contextWindowTokens",
    "context_window_tokens",
    "contextWindow",
    "context_window",
    "maxContextTokens",
    "max_context_tokens",
    "contextLength",
    "context_length",
  ]);
  return id || provider || contextWindowTokens !== undefined
    ? {
        ...(id ? { id } : {}),
        ...(provider ? { provider } : {}),
        ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      }
    : undefined;
}

/** Accepts both Event Stream v1 names and common provider snake_case aliases. */
export function normalizeAgentEventStreamUsage(
  value: unknown,
): AgentEventStreamUsage | undefined {
  const source = object(value);
  if (!source) return undefined;
  const inputTokens = firstNumber(source, [
    "inputTokens",
    "input_tokens",
    "prompt_tokens",
  ]);
  const outputTokens = firstNumber(source, [
    "outputTokens",
    "output_tokens",
    "completion_tokens",
  ]);
  const totalTokens = firstNumber(source, ["totalTokens", "total_tokens"]);
  const contextUsedTokens = firstNumber(source, [
    "contextUsedTokens",
    "context_used_tokens",
    "context_used",
    "contextUsed",
    "usedContextTokens",
  ]);
  const contextWindowTokens = firstNumber(source, [
    "contextWindowTokens",
    "context_window_tokens",
    "contextWindow",
    "context_window",
    "maxContextTokens",
    "max_context_tokens",
    "contextMaxTokens",
    "context_max_tokens",
    "context_max",
    "contextLength",
    "context_length",
  ]);
  return inputTokens !== undefined ||
    outputTokens !== undefined ||
    totalTokens !== undefined ||
    contextUsedTokens !== undefined ||
    contextWindowTokens !== undefined
    ? {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
        ...(contextUsedTokens !== undefined ? { contextUsedTokens } : {}),
        ...(contextWindowTokens !== undefined ? { contextWindowTokens } : {}),
      }
    : undefined;
}

const SYNTHETIC_REMOTE_REASONING_SUMMARIES = new Set([
  "远程智能体已返回新的答复。",
  "远程智能体已返回新的答复",
  "远程任务已返回新的答复。",
  "远程任务已返回新的答复",
]);

function comparableEventText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[。.!！?？]+$/u, "")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Gateways must send an explicit reasoning.summary. A few older adapters
 * mirrored the final answer into that field; hide that duplicate instead of
 * presenting the answer as fabricated reasoning.
 */
export function isSyntheticRemoteReasoningSummary(
  summary?: string,
  finalOutput?: string,
): boolean {
  if (!summary?.trim()) return false;
  const normalized = comparableEventText(summary);
  const normalizedFinal = finalOutput?.trim()
    ? comparableEventText(finalOutput)
    : undefined;
  const mirroredFinal =
    normalizedFinal &&
    (normalized === normalizedFinal ||
      (Math.min(normalized.length, normalizedFinal.length) >= 48 &&
        (normalized.includes(normalizedFinal) ||
          normalizedFinal.includes(normalized))));
  return (
    SYNTHETIC_REMOTE_REASONING_SUMMARIES.has(summary.trim()) ||
    Boolean(mirroredFinal)
  );
}

function timestamp(value: unknown): number | undefined {
  const direct = number(value);
  if (direct !== undefined) return direct;
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function eventType(value: unknown): AgentEventStreamEventType | undefined {
  return typeof value === "string" &&
    (AGENT_EVENT_STREAM_EVENT_TYPES as readonly string[]).includes(value)
    ? (value as AgentEventStreamEventType)
    : undefined;
}

function toolFrom(value: unknown): AgentEventStreamTool | undefined {
  const source = object(value);
  const name = text(source?.name);
  if (!source || !name) return undefined;
  const kind = text(source.kind);
  return {
    name,
    ...(text(source.callId) ? { callId: text(source.callId) } : {}),
    ...(["tool", "skill", "mcp", "terminal", "workspace"].includes(kind || "")
      ? { kind: kind as AgentEventStreamToolKind }
      : {}),
    ...(text(source.inputSummary)
      ? { inputSummary: text(source.inputSummary) }
      : {}),
    ...(text(source.outputSummary)
      ? { outputSummary: text(source.outputSummary) }
      : {}),
  };
}

function dataFrom(value: unknown): AgentEventStreamEventData | undefined {
  const source = object(value);
  if (!source) return undefined;
  const model =
    normalizeAgentEventStreamModel(source.model) ||
    normalizeAgentEventStreamModel({
      id:
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
    });
  const usage =
    normalizeAgentEventStreamUsage(source.usage) ||
    normalizeAgentEventStreamUsage({
      inputTokens:
        source.inputTokens ?? source.input_tokens ?? source.prompt_tokens,
      outputTokens:
        source.outputTokens ?? source.output_tokens ?? source.completion_tokens,
      totalTokens: source.totalTokens ?? source.total_tokens,
      contextUsedTokens:
        source.contextUsedTokens ??
        source.context_used_tokens ??
        source.context_used ??
        source.contextUsed ??
        source.usedContextTokens,
      contextWindowTokens:
        source.contextWindowTokens ??
        source.context_window_tokens ??
        source.contextWindow ??
        source.context_window ??
        source.maxContextTokens ??
        source.max_context_tokens ??
        source.contextMaxTokens ??
        source.context_max_tokens ??
        source.context_max ??
        source.contextLength ??
        source.context_length,
    });
  const artifact = object(source.artifact);
  const workspaceOperation = text(source.operation);
  const workspacePath = text(source.path);
  const explicitTool = toolFrom(source.tool);
  const code = text(source.code);
  const error = text(source.error);
  const detail = text(source.detail);
  const summary =
    text(source.summary) ||
    text(source.message) ||
    error ||
    detail ||
    text(source.reason);
  return {
    ...(summary ? { summary } : {}),
    ...(code ? { code } : {}),
    ...(error ? { error } : {}),
    ...(detail ? { detail } : {}),
    ...(text(source.text) ? { text: text(source.text) } : {}),
    ...(text(source.reasoningSummary)
      ? { reasoningSummary: text(source.reasoningSummary) }
      : {}),
    ...(explicitTool
      ? { tool: explicitTool }
      : workspaceOperation
        ? {
            tool: {
              name: workspaceOperation,
              kind: "workspace" as const,
              ...(workspacePath ? { inputSummary: workspacePath } : {}),
            },
          }
        : {}),
    ...(model ? { model } : {}),
    ...(usage ? { usage } : {}),
    ...(artifact
      ? {
          artifact: {
            ...(text(artifact.id) ? { id: text(artifact.id) } : {}),
            ...(text(artifact.label) ? { label: text(artifact.label) } : {}),
            ...(text(artifact.name) ? { name: text(artifact.name) } : {}),
            ...(text(artifact.mime) || text(artifact.contentType)
              ? { mime: text(artifact.mime) || text(artifact.contentType) }
              : {}),
            ...(number(artifact.size) !== undefined
              ? { size: number(artifact.size) }
              : {}),
            ...(text(artifact.path) ? { path: text(artifact.path) } : {}),
            ...(text(artifact.sha256) ? { sha256: text(artifact.sha256) } : {}),
            ...(text(artifact.summary)
              ? { summary: text(artifact.summary) }
              : {}),
          },
        }
      : {}),
  };
}

/** Accepts either the `events` array or a Gateway response containing it. */
export function parseAgentEventStreamEvents(
  value: unknown,
): AgentEventStreamEvent[] {
  const list = Array.isArray(value) ? value : object(value)?.events;
  if (!Array.isArray(list)) return [];
  return list.flatMap((value): AgentEventStreamEvent[] => {
    const source = object(value);
    const id = text(source?.id) || text(source?.eventId);
    const type = eventType(source?.type);
    if (!source || !id || !type) return [];
    return [
      {
        id,
        type,
        createdAt: timestamp(source.createdAt) || Date.now(),
        ...(number(source.sequence) !== undefined
          ? { sequence: number(source.sequence) }
          : {}),
        ...(dataFrom(source.data || source)
          ? { data: dataFrom(source.data || source) }
          : {}),
      },
    ];
  });
}

function toolSummary(event: AgentEventStreamEvent): string {
  const tool = event.data?.tool;
  if (!tool) return event.data?.summary || "智能体正在调用工具。";
  const prefix =
    tool.kind === "mcp"
      ? "MCP"
      : tool.kind === "skill"
        ? "技能"
        : tool.kind === "terminal"
          ? "终端"
          : tool.kind === "workspace"
            ? "受控工作区"
            : "工具";
  const detail =
    event.type === "tool.completed" || event.type === "workspace.completed"
      ? tool.outputSummary || tool.inputSummary
      : tool.inputSummary;
  const completed =
    event.type === "tool.completed" || event.type === "workspace.completed";
  return `${prefix} ${tool.name}${completed ? " 已完成" : ""}${detail ? `：${detail}` : ""}`;
}

/** Converts a provider-neutral event into the existing durable timeline UI. */
export function agentEventTimelineEntry(
  event: AgentEventStreamEvent,
): AgentEventTimelineEntry | undefined {
  const summary =
    event.type === "reasoning.summary"
      ? event.data?.reasoningSummary || event.data?.summary
      : event.type.startsWith("tool.") || event.type.startsWith("workspace.")
        ? toolSummary(event)
        : event.type === "artifact.created"
          ? event.data?.artifact?.summary ||
            event.data?.artifact?.label ||
            event.data?.summary
          : event.data?.summary || event.data?.text;
  if (!summary || event.type === "assistant.delta") return undefined;
  const type =
    event.type === "run.started"
      ? "started"
      : event.type === "run.completed"
        ? "completed"
        : event.type === "run.failed" ||
            event.type === "tool.failed" ||
            event.type === "workspace.blocked"
          ? "error"
          : event.type === "tool.started" ||
              event.type === "workspace.requested"
            ? "tool_call"
            : event.type === "tool.completed" ||
                event.type === "workspace.completed"
              ? "tool_result"
              : event.type === "artifact.created"
                ? "artifact_published"
                : event.type === "assistant.completed"
                  ? "message"
                  : "progress";
  const detail =
    event.data?.detail || event.data?.error || event.data?.code || undefined;
  return {
    id: `provider-event-${event.id}`,
    type,
    summary,
    createdAt: event.createdAt,
    ...(detail ? { detail } : {}),
    ...(event.data?.code ? { code: event.data.code } : {}),
    ...(event.data?.tool ? { tool: event.data.tool } : {}),
  };
}
