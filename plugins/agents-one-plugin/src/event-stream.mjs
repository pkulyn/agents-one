import { randomUUID } from "node:crypto";

export const EVENT_STREAM_PROTOCOL = "agents-one-event-stream-v1";

export const EVENT_TYPES = new Set([
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
]);

const SENSITIVE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~-]+/gi,
  /\b(api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
  /[A-Za-z]:\\(?:[^\s,:;]+\\)*[^\s,:;]*/g,
  /\/(?:home|root|opt|etc|Users|var)\/(?:[^\s,:;]+\/)*[^\s,:;]*/g,
];

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const WORKSPACE_OPERATIONS = new Set([
  "list",
  "read",
  "write",
  "move",
  "delete",
]);

function sanitizeWorkspaceOperation(value) {
  const operation = nonEmptyString(value)?.toLowerCase();
  return operation && WORKSPACE_OPERATIONS.has(operation)
    ? operation
    : undefined;
}

function sanitizeWorkspacePath(value) {
  const path = nonEmptyString(value);
  if (!path) return undefined;
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }
  return sanitizeEventText(normalized, 2048);
}

export function sanitizeEventText(value, maxLength = 12000) {
  const text = nonEmptyString(value);
  if (!text) return undefined;
  const sanitized = SENSITIVE_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "[已脱敏]"),
    text,
  );
  return sanitized.length > maxLength
    ? `${sanitized.slice(0, maxLength)}\n[内容已截断]`
    : sanitized;
}

function sanitizeTool(tool) {
  if (!tool || typeof tool !== "object" || !nonEmptyString(tool.name))
    return undefined;
  const kind = ["tool", "skill", "mcp", "terminal", "workspace"].includes(
    tool.kind,
  )
    ? tool.kind
    : "tool";
  const duration = Number.isFinite(tool.duration)
    ? Math.max(0, Math.floor(tool.duration))
    : undefined;
  const durationMs = Number.isFinite(tool.durationMs)
    ? Math.max(0, Math.floor(tool.durationMs))
    : undefined;
  return {
    ...(nonEmptyString(tool.callId) ? { callId: tool.callId.trim() } : {}),
    name: tool.name.trim(),
    kind,
    ...(sanitizeEventText(tool.inputSummary)
      ? { inputSummary: sanitizeEventText(tool.inputSummary) }
      : {}),
    ...(sanitizeEventText(tool.outputSummary)
      ? { outputSummary: sanitizeEventText(tool.outputSummary) }
      : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

function sanitizeArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return undefined;
  const label = nonEmptyString(artifact.label) || nonEmptyString(artifact.path);
  if (!label) return undefined;
  return {
    ...(nonEmptyString(artifact.id) ? { id: artifact.id.trim() } : {}),
    label,
    ...(nonEmptyString(artifact.mime) ? { mime: artifact.mime.trim() } : {}),
    ...(Number.isFinite(artifact.size) && artifact.size >= 0
      ? { size: Math.floor(artifact.size) }
      : {}),
    ...(nonEmptyString(artifact.path) ? { path: artifact.path.trim() } : {}),
    ...(nonEmptyString(artifact.sha256)
      ? { sha256: artifact.sha256.trim() }
      : {}),
    ...(sanitizeEventText(artifact.summary)
      ? { summary: sanitizeEventText(artifact.summary) }
      : {}),
  };
}

/**
 * Durable, user-visible event store. It accepts only summaries, never raw
 * chain-of-thought or raw terminal payloads. Stable upstream IDs are deduped.
 */
export class EventJournal {
  constructor({ runId, maxEvents = 200 } = {}) {
    this.runId = runId || `run_${randomUUID()}`;
    this.maxEvents = Math.max(10, Math.min(maxEvents, 1000));
    this.events = [];
    this.ids = new Set();
    this.nextSequence = 1;
  }

  append(rawEvent) {
    if (!rawEvent || !EVENT_TYPES.has(rawEvent.type)) return undefined;
    const id =
      nonEmptyString(rawEvent.id) ||
      nonEmptyString(rawEvent.eventId) ||
      `evt_${randomUUID()}`;
    if (this.ids.has(id)) return this.events.find((event) => event.id === id);
    const data =
      rawEvent.data && typeof rawEvent.data === "object"
        ? rawEvent.data
        : rawEvent;
    const workspaceEvent = rawEvent.type.startsWith("workspace.");
    const operation = workspaceEvent
      ? sanitizeWorkspaceOperation(data.operation)
      : undefined;
    const path = workspaceEvent ? sanitizeWorkspacePath(data.path) : undefined;
    const event = {
      id,
      type: rawEvent.type,
      sequence: Number.isFinite(rawEvent.sequence)
        ? rawEvent.sequence
        : this.nextSequence,
      createdAt: rawEvent.createdAt || new Date().toISOString(),
      data: {
        ...(sanitizeEventText(data.summary)
          ? { summary: sanitizeEventText(data.summary) }
          : {}),
        ...(sanitizeEventText(data.text)
          ? { text: sanitizeEventText(data.text) }
          : {}),
        ...(sanitizeEventText(data.reasoningSummary)
          ? { reasoningSummary: sanitizeEventText(data.reasoningSummary) }
          : {}),
        ...(sanitizeTool(data.tool) ? { tool: sanitizeTool(data.tool) } : {}),
        ...(sanitizeArtifact(data.artifact)
          ? { artifact: sanitizeArtifact(data.artifact) }
          : {}),
        ...(operation ? { operation } : {}),
        ...(path ? { path } : {}),
        ...(data.model && typeof data.model === "object"
          ? { model: data.model }
          : {}),
        ...(data.usage && typeof data.usage === "object"
          ? { usage: data.usage }
          : {}),
      },
    };
    this.ids.add(id);
    this.events.push(event);
    this.nextSequence = Math.max(this.nextSequence, event.sequence + 1);
    while (this.events.length > this.maxEvents) {
      const removed = this.events.shift();
      this.ids.delete(removed.id);
    }
    return event;
  }

  after(sequence = 0) {
    return this.events.filter((event) => event.sequence > sequence);
  }

  snapshot() {
    return [...this.events];
  }
}

export function eventStreamCapability(transport = "poll", support = {}) {
  const normalizedTransport = ["sse", "poll", "websocket"].includes(transport)
    ? transport
    : "poll";
  const declared = support && typeof support === "object" ? support : {};
  return {
    protocol: EVENT_STREAM_PROTOCOL,
    transport: normalizedTransport,
    ...(declared.reasoningSummaries === true
      ? { reasoningSummaries: true }
      : {}),
    ...(declared.toolEvents === true ? { toolEvents: true } : {}),
    ...(declared.modelMetadata === true ? { modelMetadata: true } : {}),
    ...(declared.usageMetadata === true ? { usageMetadata: true } : {}),
  };
}
