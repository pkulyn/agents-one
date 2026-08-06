export interface TaskOutputSummary {
  finalText?: string;
  transportNote?: string;
  usage?: string;
  hasStructuredEvents: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanPiAssistantText(value: string): string {
  const raw = value.trim();
  if (!raw) return "";

  const hasUnclosedToolCall = /<tool_call\b/i.test(raw) && !/<\/tool_call>/i.test(raw);
  const cleaned = raw
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?(?:think|tool_call|tool_result|analysis|final)\b[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (hasUnclosedToolCall) return "";
  return cleaned;
}

function assistantText(value: unknown): string {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) {
    return "";
  }
  return value.content
    .filter(isRecord)
    .filter((item) => item.type === "text")
    .map((item) => cleanPiAssistantText(text(item.text)))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function summarizeTaskOutput(output: string): TaskOutputSummary {
  let finalText = "";
  let transportFallback = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let hasStructuredEvents = false;

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!isRecord(event)) continue;
    hasStructuredEvents = true;
    if (event.type === "item.completed" && isRecord(event.item)) {
      if (event.item.type === "agent_message") {
        const next = text(event.item.text);
        if (next) finalText = next;
      }
      if (event.item.type === "error" && /falling back from websockets to https/i.test(text(event.item.message))) {
        transportFallback = true;
      }
    }
    if (event.type === "turn.completed" && isRecord(event.usage)) {
      inputTokens = typeof event.usage.input_tokens === "number" ? event.usage.input_tokens : undefined;
      outputTokens = typeof event.usage.output_tokens === "number" ? event.usage.output_tokens : undefined;
    }
    if (event.type === "assistant" && isRecord(event.message) && Array.isArray(event.message.content)) {
      for (const content of event.message.content) {
        if (isRecord(content) && content.type === "text") {
          const next = text(content.text);
          if (next) finalText = next;
        }
      }
    }
    const piMessage = assistantText(event.message);
    if (piMessage) finalText = piMessage;
    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      for (const message of event.messages) {
        const next = assistantText(message);
        if (next) finalText = next;
      }
    }
    if (event.type === "result") {
      const next = text(event.result);
      if (next) finalText = next;
      if (isRecord(event.usage)) {
        inputTokens = typeof event.usage.input_tokens === "number" ? event.usage.input_tokens : inputTokens;
        outputTokens = typeof event.usage.output_tokens === "number" ? event.usage.output_tokens : outputTokens;
      }
    }
  }

  return {
    ...(finalText ? { finalText } : {}),
    ...(transportFallback ? { transportNote: "WebSocket unavailable; completed over HTTPS." } : {}),
    ...(inputTokens !== undefined || outputTokens !== undefined
      ? { usage: `${inputTokens ?? 0} input / ${outputTokens ?? 0} output tokens` }
      : {}),
    hasStructuredEvents,
  };
}
