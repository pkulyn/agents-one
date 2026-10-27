import type { AgentRuntimeEvent } from "../../shared/agent-runtimes";
import { publicPlatformText } from "./conversation-projection";

const visibleTypes = new Set([
  "queued",
  "started",
  "progress",
  "tool_call",
  "tool_result",
  "error",
  "completed",
  "cancelled",
  "timed_out",
]);
const toolKinds = new Set(["tool", "skill", "mcp", "terminal", "workspace"]);
const bounded = (value: string, limit: number): string =>
  Array.from(publicPlatformText(value)).slice(0, limit).join("");

/** Projects only published runtime activity; never exports raw tool arguments or outputs. */
export function projectMobileRunActivity(
  events: readonly AgentRuntimeEvent[] | undefined,
): Array<Record<string, unknown>> {
  return (events ?? [])
    .filter(
      (event) =>
        visibleTypes.has(event.type) &&
        typeof event.id === "string" &&
        event.id.length > 0 &&
        Number.isFinite(event.createdAt),
    )
    .slice(-50)
    .map((event) => {
      const toolName = event.tool?.name
        ? bounded(event.tool.name.trim(), 160)
        : undefined;
      const kind = event.tool?.kind;
      const summary =
        event.type === "tool_call"
          ? "Tool call"
          : event.type === "tool_result"
            ? "Tool step completed"
            : bounded(event.summary.trim(), 500);
      return {
        eventId: bounded(event.id, 160),
        type: event.type,
        summary: summary || "Execution progress",
        createdAt: new Date(event.createdAt).toISOString(),
        ...(toolName ? { toolName } : {}),
        ...(kind && toolKinds.has(kind) ? { toolKind: kind } : {}),
      };
    });
}
