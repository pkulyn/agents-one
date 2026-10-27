import type { AgentRuntimeEvent } from "./agent-runtimes";

/** Keep process evidence ahead of redundant answer fragments at history limits. */
export function retainRuntimeEvents(
  events: readonly AgentRuntimeEvent[],
  limit: number,
): AgentRuntimeEvent[] {
  if (limit <= 0) return [];
  let overflow = events.length - limit;
  if (overflow <= 0) return [...events];
  return events
    .filter((event) => {
      if (event.type === "message" && overflow > 0) {
        overflow -= 1;
        return false;
      }
      return true;
    })
    .slice(-limit);
}
