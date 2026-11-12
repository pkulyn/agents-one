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

  it("keeps initial reasoning through repeated process-only overflow", () => {
    const thought: AgentRuntimeEvent = {
      id: "initial",
      type: "progress",
      summary: "Initial plan",
      detail: "Full initial reasoning",
      createdAt: 1,
    };
    let events = [thought];
    for (let i = 0; i < 450; i += 1) {
      events = retainRuntimeEvents(
        [
          ...events,
          {
            id: String(i),
            type: i === 449 ? "completed" : "tool_result",
            summary: String(i),
            createdAt: i + 2,
          },
        ],
        200,
      );
    }
    expect(events).toHaveLength(200);
    expect(events[0]).toEqual(thought);
    expect(events.slice(1).map((event) => event.id)).toEqual(
      Array.from({ length: 199 }, (_, i) => String(i + 251)),
    );
    expect(retainRuntimeEvents(events, 1)).toEqual([events.at(-1)]);
    expect(retainRuntimeEvents(events, 0)).toEqual([]);
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

it("retains accepted corrections and native commentary ahead of output fragments", () => {
  const correction = {
    id: "u",
    type: "message" as const,
    code: "user_input",
    detail: "correct this",
    summary: "correct",
    createdAt: 1,
  };
  const commentary = { ...correction, id: "a", code: "assistant_progress" };
  const fragments = Array.from({ length: 240 }, (_, i) => ({
    ...correction,
    id: "f" + i,
    code: undefined,
  }));
  expect(
    retainRuntimeEvents([correction, commentary, ...fragments], 200).slice(
      0,
      2,
    ),
  ).toEqual([correction, commentary]);
});
