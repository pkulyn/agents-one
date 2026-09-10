/**
 * Example mapper for a CLI that emits JSONL. Use vendor event IDs when present.
 * It intentionally persists completed summaries only, not incremental snapshots.
 */
export function mapCliJsonlEvent(event) {
  if (!event?.id) return undefined;
  if (event.type === "reasoning.completed") {
    return {
      id: event.id,
      type: "reasoning.summary",
      data: { reasoningSummary: event.summary },
    };
  }
  if (event.type === "tool.completed") {
    return {
      id: event.id,
      type: "tool.completed",
      data: {
        tool: {
          name: event.name,
          kind: event.kind || "tool",
          inputSummary: event.inputSummary,
          outputSummary: event.outputSummary,
        },
      },
    };
  }
  if (event.type === "assistant.completed") {
    return {
      id: event.id,
      type: "assistant.completed",
      data: { text: event.text },
    };
  }
  return undefined;
}
