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

/** Convert local runtime JSONL into the small amount of information a reviewer needs. */
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
