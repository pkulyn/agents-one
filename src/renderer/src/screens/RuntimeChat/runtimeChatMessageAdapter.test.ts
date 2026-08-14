import { describe, expect, it } from "vitest";
import type { AgentRuntimeEvent } from "../../../../shared/agent-runtimes";
import type { RuntimeConversationMessage } from "../../../../shared/runtime-conversations";
import {
  runtimeConversationToChatMessages,
  runtimeEventsToChatMessages,
  toolNameFromRuntimeSummary,
} from "./runtimeChatMessageAdapter";

function event(
  id: string,
  type: AgentRuntimeEvent["type"],
  summary: string,
  extras: Partial<AgentRuntimeEvent> = {},
): AgentRuntimeEvent {
  return { id, type, summary, createdAt: 1, ...extras };
}

describe("runtimeChatMessageAdapter", () => {
  it("keeps local MEDIA tokens in the assistant bubble for MessageRow to render", () => {
    const messages: RuntimeConversationMessage[] = [
      {
        id: "user-1",
        role: "user",
        content: "请发图",
        createdAt: 1,
      },
      {
        id: "agent-1",
        role: "agent",
        content: "图表如下：\nMEDIA:C:\\Users\\chenfl\\Desktop\\test-chart.png",
        createdAt: 2,
      },
    ];

    const result = runtimeConversationToChatMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "user", role: "user" });
    expect(result[1]).toMatchObject({
      kind: "assistant",
      role: "agent",
      content: expect.stringContaining("MEDIA:C:\\Users\\chenfl"),
    });
  });

  it("maps runtime reasoning and tool events to native history rows", () => {
    const messages: RuntimeConversationMessage[] = [
      {
        id: "agent-1",
        role: "agent",
        content: "已完成。",
        createdAt: 2,
        execution: {
          runId: "run-1",
          events: [
            event("e1", "progress", "先检查工作区。"),
            event("e2", "tool_call", "工具 workspace_gateway", {
              tool: {
                callId: "gateway-call-1",
                kind: "workspace",
                name: "workspace_gateway",
                inputSummary: "list .",
              },
            }),
            event("e3", "tool_result", "工具 workspace_gateway 已完成", {
              tool: {
                callId: "gateway-call-1",
                kind: "workspace",
                name: "workspace_gateway",
                outputSummary: "TASK_SPEC.md\ntest-document.txt",
              },
            }),
            event("e4", "error", "MCP power_memory_search 失败"),
          ],
        },
      },
    ];

    const result = runtimeConversationToChatMessages(messages);

    expect(result.map((message) => message.kind || "bubble")).toEqual([
      "reasoning",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result[1]).toMatchObject({
      kind: "tool_call",
      name: "workspace_gateway",
      callId: "gateway-call-1",
      args: "list .",
      status: "completed",
    });
    expect(result[2]).toMatchObject({
      kind: "tool_result",
      callId: "gateway-call-1",
      content: "TASK_SPEC.md\ntest-document.txt",
    });
    expect(result).not.toContainEqual(
      expect.objectContaining({ kind: "system", title: "错误" }),
    );
  });

  it("keeps each collaboration reply and its event trace on the producing Runtime identity", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "pi-reply",
        role: "agent",
        content: "Pi 已完成文件交付。",
        createdAt: 2,
        agentRuntimeId: "pi",
        agentName: "Pi",
        agentAvatar: "data:image/png;base64,cGk=",
        agentColor: "#7C3AED",
        collaborationRole: "实施",
        execution: {
          runId: "pi-run",
          events: [event("pi-thinking", "progress", "正在写入文件。")],
        },
      },
      {
        id: "claude-reply",
        role: "agent",
        content: "Claude 已完成复核。",
        createdAt: 3,
        agentRuntimeId: "claude-code",
        agentName: "Claude",
        agentAvatar: null,
        agentColor: "#2563eb",
        collaborationRole: "复核",
      },
    ]);

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "reasoning",
          agentRuntimeId: "pi",
          agentName: "Pi",
          agentAvatar: "data:image/png;base64,cGk=",
        }),
        expect.objectContaining({
          kind: "assistant",
          content: "Pi 已完成文件交付。",
          agentRuntimeId: "pi",
          agentName: "Pi",
          agentAvatar: "data:image/png;base64,cGk=",
          collaborationRole: "实施",
        }),
        expect.objectContaining({
          kind: "assistant",
          content: "Claude 已完成复核。",
          agentRuntimeId: "claude-code",
          agentName: "Claude",
          agentAvatar: null,
          collaborationRole: "复核",
        }),
      ]),
    );
  });

  it("labels a collaboration reply when its provider omitted detailed trace events", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "hers-reply",
        role: "agent",
        content: "Hers 已完成规划。",
        createdAt: 2,
        agentRuntimeId: "hers",
        agentName: "Hers",
        collaborationRole: "规划",
        execution: {
          runId: "hers-run",
          events: [
            event("started", "started", "任务已开始。"),
            event("completed", "completed", "任务已完成。"),
          ],
        },
      },
    ]);

    expect(result[0]).toMatchObject({
      kind: "system",
      title: "思考记录未上报",
      agentRuntimeId: "hers",
      collaborationRole: "规划",
    });
    expect(result.at(-1)).toMatchObject({
      kind: "assistant",
      content: "Hers 已完成规划。",
    });
  });

  it("does not present a mirrored final answer as remote reasoning", () => {
    const answer =
      "我已基于全部协作材料完成验收，检查了交付物、路径与测试结果。";
    const result = runtimeConversationToChatMessages([
      {
        id: "hers-mirrored-reply",
        role: "agent",
        content: answer,
        createdAt: 2,
        agentRuntimeId: "hers-2",
        agentName: "Hers-2",
        collaborationRole: "验收",
        execution: {
          runId: "hers-mirrored-run",
          events: [event("mirrored", "progress", answer)],
        },
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        kind: "system",
        title: "思考记录未上报",
      }),
      expect.objectContaining({ kind: "assistant", content: answer }),
    ]);
  });

  it("does not present workspace authorization lifecycle notices as reasoning", () => {
    const result = runtimeEventsToChatMessages([
      event(
        "grant-created",
        "progress",
        "已建立不会自动到期的受控本机工作区授权；任务结束或取消时撤销。",
      ),
      event("real-reasoning", "progress", "先分析任务并准备协作方案。"),
      event(
        "grant-missing",
        "progress",
        "本轮未授予远程工作区权限，已按普通只读对话执行。",
      ),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        kind: "reasoning",
        text: "先分析任务并准备协作方案。",
      }),
    ]);
  });

  it("omits error and artifact notice cards while preserving rendered image artifacts", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "agent-artifact-notices",
        role: "agent",
        content: "图表如下。",
        createdAt: 2,
        execution: {
          runId: "run-artifact-notices",
          events: [
            event("e1", "error", "工具 search_files"),
            event("e2", "artifact_published", "任务已发布新的产物。"),
          ],
          artifacts: [
            {
              id: "chart-1",
              kind: "final",
              label: "quarterly-revenue.png",
              mime: "image/png",
              size: 128,
              path: "C:\\Users\\chenfl\\AppData\\Local\\Temp\\quarterly-revenue.png",
            },
          ],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "assistant",
      content: expect.stringContaining(
        "MEDIA:`C:\\Users\\chenfl\\AppData\\Local\\Temp\\quarterly-revenue.png`",
      ),
    });
  });

  it("routes remote image and file artifacts through native media/attachment rendering", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "agent-artifacts",
        role: "agent",
        content: "产物已生成。",
        createdAt: 2,
        execution: {
          runId: "run-artifacts",
          events: [],
          artifacts: [
            {
              id: "chart-1",
              kind: "final",
              label: "test-chart.png",
              mime: "image/png",
              size: 128,
              path: "C:\\Users\\chenfl\\AppData\\Local\\Temp\\test-chart.png",
            },
            {
              id: "report-1",
              kind: "final",
              label: "report.pdf",
              mime: "application/pdf",
              size: 256,
              path: "C:\\Users\\chenfl\\AppData\\Local\\Temp\\report.pdf",
            },
          ],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "assistant",
      content: expect.stringContaining("MEDIA:`C:\\Users\\chenfl"),
      attachments: [
        expect.objectContaining({
          kind: "path-ref",
          name: "report.pdf",
          path: "C:\\Users\\chenfl\\AppData\\Local\\Temp\\report.pdf",
        }),
      ],
    });
  });

  it("replaces a remote MEDIA path with the hydrated local artifact token", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "agent-remote-media",
        role: "agent",
        content:
          "图表如下。\nMEDIA:C:\\remote\\Temp\\quarterly_revenue_chart.png",
        createdAt: 2,
        execution: {
          runId: "run-remote-media",
          events: [],
          artifacts: [
            {
              id: "chart-1",
              kind: "final",
              label: "quarterly_revenue_chart.png",
              mime: "image/png",
              size: 128,
              path: "C:\\Users\\chenfl\\AppData\\Local\\Temp\\artifact-chart.png",
            },
          ],
        },
      },
    ]);

    expect(result[0]).toMatchObject({
      content: expect.not.stringContaining("C:\\remote\\Temp"),
    });
    expect(result[0]).toMatchObject({
      content: expect.stringContaining(
        "MEDIA:`C:\\Users\\chenfl\\AppData\\Local\\Temp\\artifact-chart.png`",
      ),
    });
  });

  it("leaves a live tool call running until its result arrives", () => {
    const result = runtimeEventsToChatMessages(
      [event("e1", "tool_call", "Codex 正在调用 bash。")],
      { live: true, idPrefix: "live-1" },
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: "tool_call",
        name: "Terminal",
        status: "running",
      }),
    ]);
  });

  it("extracts tool names from the flat summaries used by remote runtimes", () => {
    expect(toolNameFromRuntimeSummary("技能 session_search: recall NAS")).toBe(
      "session_search",
    );
    expect(toolNameFromRuntimeSummary("Claude Code 正在调用 ReadFile。")).toBe(
      "ReadFile",
    );
    expect(toolNameFromRuntimeSummary("Gateway 查询失败")).toBe("工具");
  });
});
