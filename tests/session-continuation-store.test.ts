import { describe, expect, it } from "vitest";
import {
  continuationItemsToHistory,
  mergeSessionContinuationWithCanonical,
  mergeSessionLocalErrors,
  normalizeContinuationItems,
} from "../src/main/session-continuation-store";

describe("desktop session continuations", () => {
  it("normalizes and expands a visible prefix including errors and tool rows", () => {
    const normalized = normalizeContinuationItems([
      { kind: "user", content: "bad turn" },
      { kind: "assistant", content: "", error: "Invalid API Key" },
      { kind: "reasoning", text: "Need a tool." },
      {
        kind: "tool_call",
        callId: "call-1",
        name: "terminal",
        args: '{"command":"date"}',
      },
      {
        kind: "tool_result",
        callId: "call-1",
        name: "terminal",
        content: "Mon Jun 8",
      },
    ]);

    expect(normalized).toHaveLength(5);

    const history = continuationItemsToHistory(normalized);
    expect(history.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "reasoning",
      "tool_call",
      "tool_result",
    ]);
    expect(history[0].id).toBeLessThan(0);
    expect(history[1]).toMatchObject({
      kind: "assistant",
      content: "",
      error: "Invalid API Key",
    });
    expect(history[3]).toMatchObject({
      kind: "tool_call",
      callId: "call-1",
      name: "terminal",
    });
  });

  it("drops empty placeholder rows but preserves empty assistant error bubbles", () => {
    expect(
      normalizeContinuationItems([
        { kind: "user", content: "   " },
        { kind: "assistant", content: "", error: "boom" },
        { kind: "reasoning", text: "" },
      ]),
    ).toEqual([{ kind: "assistant", content: "", error: "boom" }]);
  });

  it("clears assistant content when it duplicates the preserved error text", () => {
    expect(
      normalizeContinuationItems([
        {
          kind: "assistant",
          content: "Invalid API Key",
          error: "Invalid API Key",
        },
      ]),
    ).toEqual([{ kind: "assistant", content: "", error: "Invalid API Key" }]);
  });

  it("inserts local provider errors after the matching canonical user row", () => {
    const merged = mergeSessionLocalErrors(
      [
        { kind: "user", id: 1, content: "good", timestamp: 1 },
        { kind: "assistant", id: 2, content: "ok", timestamp: 2 },
        { kind: "user", id: 3, content: "bad provider", timestamp: 3 },
      ],
      [{ userContent: "bad provider", error: "Invalid API Key" }],
    );

    expect(merged.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(merged[3]).toMatchObject({
      kind: "assistant",
      content: "",
      error: "Invalid API Key",
    });
  });

  it("does not duplicate local provider errors already present in continuation rows", () => {
    const continuation = continuationItemsToHistory([
      { kind: "user", content: "bad provider" },
      { kind: "assistant", content: "", error: "Invalid API Key" },
      { kind: "user", content: "recovery" },
      { kind: "assistant", content: "OK" },
    ]);

    const merged = mergeSessionLocalErrors(continuation, [
      { userContent: "bad provider", error: "Invalid API Key" },
    ]);

    expect(
      merged.filter((item) => item.kind === "assistant" && item.error),
    ).toHaveLength(1);
    expect(merged.map((item) => item.kind)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("drops recovery overlay rows after Hermes persists the same attachment turn", () => {
    const attachment = {
      id: "attachment-1",
      kind: "text-file" as const,
      name: "fixture.txt",
      mime: "text/plain",
      size: 20,
      text: "Marker: AO-U5",
    };
    const continuation = continuationItemsToHistory([
      {
        kind: "user",
        content: "Read the marker",
        attachments: [attachment],
      },
      { kind: "assistant", content: "AO-U5" },
      {
        kind: "user",
        content: "Read the marker",
        attachments: [attachment],
      },
    ]);
    const canonical = [
      {
        kind: "user" as const,
        id: 10,
        content:
          'Read the marker\n<file name="fixture.txt">Marker: AO-U5</file>',
        timestamp: 10,
      },
      {
        kind: "assistant" as const,
        id: 11,
        content: "AO-U5",
        timestamp: 11,
      },
    ];

    const merged = mergeSessionContinuationWithCanonical(
      continuation,
      canonical,
    );

    expect(merged).toEqual([
      { ...canonical[0], attachments: [attachment] },
      canonical[1],
    ]);
  });

  it("matches a canonical attachment prompt with an orphan close tag", () => {
    const continuation = continuationItemsToHistory([
      { kind: "user", content: "Read project" },
      { kind: "assistant", content: "partial" },
    ]);
    const canonical = [
      {
        kind: "user" as const,
        id: 20,
        content: "Read project\n\n</file>",
        timestamp: 20,
      },
      {
        kind: "assistant" as const,
        id: 21,
        content: "final",
        timestamp: 21,
      },
    ];

    expect(
      mergeSessionContinuationWithCanonical(continuation, canonical).map(
        (item) => item.id,
      ),
    ).toEqual([20, 21]);
  });

  it("inserts a missing remote user before its canonical assistant turn", () => {
    const continuation = continuationItemsToHistory([
      { kind: "user", content: "first prompt" },
      { kind: "assistant", content: "first answer" },
      { kind: "user", content: "follow-up prompt" },
      { kind: "assistant", content: "follow-up answerfollow-up answer" },
    ]);
    const canonical = [
      {
        kind: "user" as const,
        id: 1,
        content: "first prompt",
        timestamp: 1,
      },
      {
        kind: "assistant" as const,
        id: 2,
        content: "first answer",
        timestamp: 2,
      },
      {
        kind: "reasoning" as const,
        id: 3,
        assistantId: 4,
        text: "recall context",
        timestamp: 3,
      },
      {
        kind: "assistant" as const,
        id: 4,
        content: "follow-up answer",
        timestamp: 4,
      },
    ];

    expect(
      mergeSessionContinuationWithCanonical(continuation, canonical).map(
        (item) =>
          item.kind === "user" || item.kind === "assistant"
            ? `${item.kind}:${item.content}`
            : item.kind,
      ),
    ).toEqual([
      "user:first prompt",
      "assistant:first answer",
      "user:follow-up prompt",
      "reasoning",
      "assistant:follow-up answer",
    ]);
  });
});
