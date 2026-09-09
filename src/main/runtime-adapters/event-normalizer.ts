import type { AgentRuntimeEventType } from "../../shared/agent-runtimes";
import type { AgentEventStreamTool } from "../../shared/agent-event-stream";
import { redactSensitiveText } from "../../shared/redaction";

export interface NormalizedRuntimeEvent {
  type: AgentRuntimeEventType;
  summary: string;
  detail?: string;
  code?: string;
  tool?: AgentEventStreamTool;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return redactSensitiveText(value.trim()).slice(0, 8_000);
  }
  if (Array.isArray(value)) {
    const text = value.map(textFrom).filter(Boolean).join("\n");
    return text || undefined;
  }
  if (isRecord(value)) {
    for (const key of [
      "summary",
      "message",
      "text",
      "content",
      "output",
      "result",
      "detail",
    ]) {
      const text = textFrom(value[key]);
      if (text) return text;
    }
  }
  return undefined;
}

function previewFrom(value: unknown): string | undefined {
  const text = textFrom(value);
  if (text) return text;
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}"
      ? redactSensitiveText(serialized).slice(0, 8_000)
      : undefined;
  } catch {
    return undefined;
  }
}

function toolKindFrom(
  value: unknown,
): AgentEventStreamTool["kind"] | undefined {
  const kind = textFrom(value)?.toLowerCase();
  if (!kind) return undefined;
  if (kind.includes("mcp")) return "mcp";
  if (kind.includes("skill")) return "skill";
  if (/(?:execute|terminal|shell|command|bash)/.test(kind)) return "terminal";
  if (
    /(?:read|write|edit|delete|file|directory|search|glob|patch)/.test(kind)
  ) {
    return "workspace";
  }
  return "tool";
}

function toolFrom(value: unknown): AgentEventStreamTool | undefined {
  if (!isRecord(value)) return undefined;
  const name = textFrom(
    value.name || value.tool || value.title || value.toolName || value.kind,
  );
  if (!name) return undefined;
  const callId = textFrom(
    value.callId ||
      value.call_id ||
      value.toolCallId ||
      value.tool_call_id ||
      value.id,
  );
  const input = previewFrom(
    value.input ?? value.arguments ?? value.params ?? value.rawInput,
  );
  const output = previewFrom(
    value.output ?? value.result ?? value.rawOutput ?? value.content,
  );
  return {
    name: name.slice(0, 256),
    ...(callId ? { callId: callId.slice(0, 256) } : {}),
    ...(input ? { inputSummary: input } : {}),
    ...(output ? { outputSummary: output } : {}),
    ...(toolKindFrom(value.kind) ? { kind: toolKindFrom(value.kind) } : {}),
  };
}

function eventPayload(value: Record<string, unknown>): Record<string, unknown> {
  const nested = value.data;
  if (
    !isRecord(nested) ||
    !(
      nested.sessionUpdate ||
      nested.toolCallId ||
      nested.tool_call_id ||
      nested.rawInput ||
      nested.rawOutput
    )
  ) {
    return value;
  }
  return { ...value, ...nested };
}

function eventName(value: Record<string, unknown>): string {
  return String(value.type || value.event || value.method || "")
    .trim()
    .toLowerCase();
}

/**
 * Normalize common JSONL/ACP-style lifecycle names to the durable Runtime
 * event vocabulary. Vendor-specific adapters can add richer mappings before
 * falling back to this conservative, redacted baseline.
 */
export function normalizeRuntimeEvent(
  value: unknown,
): NormalizedRuntimeEvent | undefined {
  if (!isRecord(value)) return undefined;
  const payload = eventPayload(value);
  const name = eventName(payload);
  const detail = textFrom(payload.detail || payload.message || payload.data);
  const summary = textFrom(
    payload.summary || payload.text || payload.message || payload.data,
  );
  const tool = toolFrom(payload.tool || payload);
  const status = textFrom(payload.status)?.toLowerCase();
  const isToolUpdate = name === "tool_call" || name === "tool_call_update";
  const isTerminalToolStatus = [
    "completed",
    "complete",
    "success",
    "succeeded",
    "done",
    "failed",
    "error",
    "cancelled",
    "canceled",
  ].includes(status || "");
  const isActiveToolUpdate = isToolUpdate && !isTerminalToolStatus;
  const isFailedToolUpdate =
    isToolUpdate &&
    ["failed", "error", "cancelled", "canceled"].includes(status || "");
  const isCompletedToolUpdate =
    isToolUpdate &&
    ["completed", "complete", "success", "succeeded", "done"].includes(
      status || "",
    );
  if (
    (name.includes("tool") &&
      !isToolUpdate &&
      (name.includes("start") ||
        name.includes("call") ||
        name.includes("begin"))) ||
    isActiveToolUpdate
  ) {
    return {
      type: "tool_call",
      summary:
        summary || (tool ? `调用工具：${tool.name}` : "工具调用已开始。"),
      ...(tool?.inputSummary || detail
        ? { detail: tool?.inputSummary || detail }
        : {}),
      ...(tool ? { tool } : {}),
    };
  }
  if (
    (name.includes("tool") &&
      !isToolUpdate &&
      (name.includes("fail") || name.includes("error"))) ||
    isFailedToolUpdate
  ) {
    return {
      type: "error",
      summary: summary || (tool ? `工具失败：${tool.name}` : "工具执行失败。"),
      ...(tool?.outputSummary || detail
        ? { detail: tool?.outputSummary || detail }
        : {}),
      ...(tool ? { tool } : {}),
    };
  }
  if (
    (name.includes("tool") &&
      !isToolUpdate &&
      (name.includes("complete") ||
        name.includes("result") ||
        name.includes("end"))) ||
    isCompletedToolUpdate
  ) {
    return {
      type: "tool_result",
      summary: summary || (tool ? `工具完成：${tool.name}` : "工具执行完成。"),
      ...(tool?.outputSummary || detail
        ? { detail: tool?.outputSummary || detail }
        : {}),
      ...(tool ? { tool } : {}),
    };
  }
  if (name.includes("permission") || name.includes("approval")) {
    return {
      type: "progress",
      summary: summary || "等待用户确认权限。",
      ...(detail ? { detail } : {}),
    };
  }
  if (
    name.includes("assistant") ||
    name.includes("message") ||
    name.includes("text")
  ) {
    return {
      type: "message",
      summary: summary || "智能体正在生成回复。",
      ...(detail ? { detail } : {}),
    };
  }
  if (name.includes("cancel") || name.includes("abort")) {
    return { type: "cancelled", summary: summary || "任务已取消。" };
  }
  if (name.includes("fail") || name.includes("error")) {
    return {
      type: "error",
      summary: summary || "智能体运行失败。",
      ...(detail ? { detail } : {}),
    };
  }
  if (name.includes("complete") || name === "done" || name === "result") {
    return { type: "completed", summary: summary || "智能体已完成运行。" };
  }
  if (name.includes("start") || name === "ready" || name === "initialized") {
    return { type: "started", summary: summary || "智能体已开始运行。" };
  }
  if (summary)
    return { type: "progress", summary, ...(detail ? { detail } : {}) };
  return undefined;
}

export function parseRuntimeJsonLine(line: string): unknown | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
