import { describe, expect, it } from "vitest";
import {
  publicConversationPreview,
  projectRuntimeConversation,
} from "../src/main/mobile-control/conversation-projection";
import { assertMobileSchema } from "../src/shared/mobile-control";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";

describe("mobile original conversation preview", () => {
  it("bounds the last nonempty original excerpt without cutting Unicode or changing full body", () => {
    const text = "😀".repeat(200) + " original ending";
    const messages = [
      { content: "earlier" },
      { content: text },
      { content: "\n \t" },
    ];
    expect(publicConversationPreview(messages)).toBe("😀".repeat(120));
    expect(messages[1].content).toBe(text);
    expect(
      publicConversationPreview([{ content: "  第一行\n\t第二行  " }]),
    ).toBe("第一行 第二行");
    expect(
      publicConversationPreview([{ content: "A" + " ".repeat(10000) + "😀" }]),
    ).toBe("A 😀");
    expect(publicConversationPreview([])).toBeNull();
    expect(publicConversationPreview([{ content: "\n\t " }])).toBeNull();
    expect(() =>
      assertMobileSchema("Conversation", {
        id: "c",
        sourceKind: "runtime_conversation",
        title: "Original",
        runtimeId: "r",
        pinned: false,
        archived: false,
        revision: "1",
        lastMessageSeq: "1",
        lastReadMessageSeq: "0",
        lastMessagePreview: publicConversationPreview(messages),
        activity: "idle",
        activeRunIds: [],
        createdAt: "2026-10-07T00:00:00Z",
        updatedAt: "2026-10-07T00:00:00Z",
        allowedActions: ["read"],
      }),
    ).not.toThrow();
  });
  it("uses only durable user-visible source messages and keeps internal entries out of excerpts", () => {
    const value: RuntimeConversation = {
      id: "c",
      title: "Original",
      runtimeId: "r",
      runtimeName: "Original runtime",
      runtimeKind: "pi" as const,
      runtimeLocation: "local" as const,
      createdAt: 1,
      updatedAt: 2,
      messageCount: 4,
      messages: [
        {
          id: "public",
          role: "agent" as const,
          content: "Original visible answer",
          createdAt: 1,
        },
        {
          id: "private",
          role: "agent" as const,
          content: "Private reasoning",
          createdAt: 2,
          meta: {
            audience: ["audit" as const],
            origin: "runtime" as const,
            persistence: "durable" as const,
          },
        },
        {
          id: "ephemeral",
          role: "agent" as const,
          content: "Not durable",
          createdAt: 3,
          meta: {
            audience: ["user" as const],
            origin: "runtime" as const,
            persistence: "transient" as const,
          },
        },
      ],
    };
    expect(
      publicConversationPreview(projectRuntimeConversation(value).messages),
    ).toBe("Original visible answer");
    value.messages.push({
      id: "platform",
      role: "system",
      content: "Authorization: Bearer private-key\nOpened D:/internal/file",
      createdAt: 4,
    });
    const preview = publicConversationPreview(
      projectRuntimeConversation(value).messages,
    );
    expect(preview).not.toMatch(
      /private-key|D:\/internal|Private reasoning|Not durable/,
    );
    expect(value.messages[1].content).toBe("Private reasoning");
  });
});
