import type { AgentRuntimeEvent } from "./agent-runtimes";

/** Keep live and saved transcripts under the same bounded event budget. */
export const MAX_RUNTIME_TRACE_EVENTS = 200;

/** Preserve initial reasoning and recent evidence ahead of answer fragments. */
export function retainRuntimeEvents(
  events: readonly AgentRuntimeEvent[],
  limit: number,
): AgentRuntimeEvent[] {
  if (limit <= 0) return [];
  let overflow = events.length - limit;
  if (overflow <= 0) return [...events];
  const evidence = events.filter((event) => {
    if (
      event.type === "message" &&
      event.code !== "user_input" &&
      event.code !== "assistant_progress" &&
      overflow > 0
    ) {
      overflow -= 1;
      return false;
    }
    return true;
  });
  const tail = evidence.slice(-limit);
  const initialReasoning = evidence.find(
    (event) => event.type === "progress" && !event.code && event.summary.trim(),
  );
  // Keep the newest terminal/status event even for a one-event budget.
  if (limit > 1 && initialReasoning && !tail.includes(initialReasoning)) {
    return [initialReasoning, ...tail.slice(1)];
  }
  return tail;
}
