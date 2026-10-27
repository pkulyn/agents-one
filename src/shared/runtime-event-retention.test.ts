import { describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "./agent-runtimes";
import { retainRuntimeEvents } from "./runtime-event-retention";

describe("Runtime trace retention", () => {
  it("keeps tool evidence through repeated live event truncation", () => {
    const evidence: AgentRuntimeEvent[] = [
      {
        id: "thought",
        type: "progress",
        summary: "Check sources",
        createdAt: 1,
      },
      { id: "call", type: "tool_call", summary: "Read", createdAt: 2 },
      { id: "result", type: "tool_result", summary: "Read done", createdAt: 3 },
    ];
    let events = [...evidence];
    for (let i = 0; i < 400; i += 1) {
      events = retainRuntimeEvents(
        [
          ...events,
          {
            id: String(i),
            type: "message",
            summary: String(i),
            createdAt: i + 4,
          },
        ],
        200,
      );
    }
    expect(events).toHaveLength(200);
    expect(events.slice(0, 3)).toEqual(evidence);
    expect(events.at(-1)?.id).toBe("399");
  });

  it("keeps existing chronological tail behavior when process evidence alone fills the limit", () => {
    const events: AgentRuntimeEvent[] = Array.from({ length: 85 }, (_, i) => ({
      id: String(i),
      type: i === 84 ? "cancelled" : "tool_result",
      summary: String(i),
      createdAt: i,
    }));
    expect(retainRuntimeEvents(events, 80)).toEqual(events.slice(-80));
    expect(events).toHaveLength(85);
  });
});
