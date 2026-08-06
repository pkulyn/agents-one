import { describe, expect, it } from "vitest";
import {
  agentEventTimelineEntry,
  isSyntheticRemoteReasoningSummary,
  normalizeAgentEventStreamModel,
  normalizeAgentEventStreamUsage,
  parseAgentEventStreamEvents,
} from "../src/shared/agent-event-stream";

describe("Agent Event Stream v1", () => {
  it("converts user-visible reasoning and native tool events into timeline entries", () => {
    const events = parseAgentEventStreamEvents({
      events: [
        {
          id: "thinking-1",
          sequence: 1,
          type: "reasoning.summary",
          createdAt: "2026-07-31T10:00:00.000Z",
          data: { summary: "正在检查任务要求。" },
        },
        {
          id: "skill-1",
          sequence: 2,
          type: "tool.completed",
          createdAt: "2026-07-31T10:00:01.000Z",
          data: {
            tool: {
              kind: "skill",
              name: "project-review",
              outputSummary: "已读取项目规则。",
            },
          },
        },
      ],
    });

    expect(events).toHaveLength(2);
    expect(agentEventTimelineEntry(events[0]!)).toMatchObject({
      type: "progress",
      summary: "正在检查任务要求。",
    });
    expect(agentEventTimelineEntry(events[1]!)).toMatchObject({
      type: "tool_result",
      summary: "技能 project-review 已完成：已读取项目规则。",
      tool: {
        kind: "skill",
        name: "project-review",
        outputSummary: "已读取项目规则。",
      },
    });
  });

  it("does not persist transient assistant deltas as timeline records", () => {
    const [event] = parseAgentEventStreamEvents([
      {
        id: "delta-1",
        type: "assistant.delta",
        createdAt: 1_722_420_000_000,
        data: { text: "正在" },
      },
    ]);

    expect(agentEventTimelineEntry(event!)).toBeUndefined();
  });

  it("preserves artifact metadata emitted by artifact.created", () => {
    const [event] = parseAgentEventStreamEvents([
      {
        id: "artifact-event-1",
        type: "artifact.created",
        createdAt: 1_722_420_000_000,
        data: {
          artifact: {
            id: "artifact-chart",
            name: "chart_quarterly_revenue.png",
            mime: "image/png",
            size: 128,
            sha256: "a".repeat(64),
          },
        },
      },
    ]);

    expect(event?.data?.artifact).toMatchObject({
      id: "artifact-chart",
      name: "chart_quarterly_revenue.png",
      mime: "image/png",
      size: 128,
    });
  });

  it("normalizes remote model and usage aliases without inventing metadata", () => {
    expect(
      normalizeAgentEventStreamModel({
        model_name: "glm-5.2",
        vendor: "ARK",
        context_window_tokens: 1_000_000,
      }),
    ).toEqual({
      id: "glm-5.2",
      provider: "ARK",
      contextWindowTokens: 1_000_000,
    });
    expect(
      normalizeAgentEventStreamUsage({
        input_tokens: 120,
        output_tokens: 30,
        total_tokens: 150,
        context_used: 9_000,
        context_window: 1_000_000,
      }),
    ).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      contextUsedTokens: 9_000,
      contextWindowTokens: 1_000_000,
    });
  });

  it("rejects synthetic remote reasoning that mirrors the final answer", () => {
    expect(
      isSyntheticRemoteReasoningSummary("远程智能体已返回新的答复。"),
    ).toBe(true);
    expect(isSyntheticRemoteReasoningSummary("最终答复", "最终答复")).toBe(
      true,
    );
    expect(
      isSyntheticRemoteReasoningSummary("正在检查工作区", "最终答复"),
    ).toBe(false);
  });

  it("rejects a long remote reasoning snapshot that contains the final answer", () => {
    const finalAnswer =
      "已完成 Connector 排查：注册 ID、Token 与 runtimeId 路由均已修复，连接恢复稳定。";
    expect(
      isSyntheticRemoteReasoningSummary(`老大，${finalAnswer}`, finalAnswer),
    ).toBe(true);
  });
});
