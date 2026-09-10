import { describe, expect, it } from "vitest";
import { placeInitialUserMessageBeforeAgentTrace } from "./messageOrder";
import type { ChatMessage } from "./types";

describe("placeInitialUserMessageBeforeAgentTrace", () => {
  it("places the initial user bubble before a leading agent trace", () => {
    const messages = [
      { id: "reason", role: "agent", kind: "reasoning", content: "thinking" },
      { id: "tool", role: "agent", kind: "tool_call", name: "read" },
      { id: "user", role: "user", content: "question" },
      { id: "answer", role: "agent", content: "answer" },
    ] as ChatMessage[];

    expect(
      placeInitialUserMessageBeforeAgentTrace(messages).map(
        (message) => message.id,
      ),
    ).toEqual(["user", "reason", "tool", "answer"]);
  });

  it("does not change normally ordered history", () => {
    const messages = [
      { id: "user", role: "user", content: "question" },
      { id: "reason", role: "agent", kind: "reasoning", content: "thinking" },
      { id: "answer", role: "agent", content: "answer" },
    ] as ChatMessage[];

    expect(
      placeInitialUserMessageBeforeAgentTrace(messages).map(
        (message) => message.id,
      ),
    ).toEqual(["user", "reason", "answer"]);
  });
});
