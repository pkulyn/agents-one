import { describe, expect, it } from "vitest";
import { t as translate } from "../../../../shared/i18n";
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
        content: "图表如下：\nMEDIA:C:\\Users\\tester\\Desktop\\test-chart.png",
        createdAt: 2,
      },
    ];

    const result = runtimeConversationToChatMessages(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: "user", role: "user" });
    expect(result[1]).toMatchObject({
      kind: "assistant",
      role: "agent",
      content: expect.stringContaining("MEDIA:C:\\Users\\tester"),
    });
  });

  it("marks platform controls as chrome-free and preserves runtime timing facts", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "reply",
        role: "agent",
        content: "已完成。",
        createdAt: 1_780_000_000_000,
        execution: {
          runId: "run-1",
          events: [],
          startedAt: 1_780_000_000_000,
          completedAt: 1_780_000_013_000,
          model: { provider: "ark", id: "deepseek-v4-flash" },
        },
      },
      {
        id: "control",
        role: "system",
        content: "当前会话已切换到模型。",
        createdAt: 1_780_000_014_000,
      },
    ]);

    expect(result[0]).toMatchObject({
      runtimeMeta: {
        durationMs: 13_000,
      },
    });
    expect(result[1]).toMatchObject({ isControlMessage: true });
  });

  it("keeps safe user attachment metadata on the sent chat bubble", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "user-with-files",
        role: "user",
        content: "请查看这些附件。",
        createdAt: 1,
        attachments: [
          {
            id: "image-1",
            kind: "image",
            name: "diagram.png",
            mime: "image/png",
            size: 512,
          },
          {
            id: "document-1",
            kind: "path-ref",
            name: "notes.pdf",
            mime: "application/pdf",
            size: 1024,
          },
        ],
      },
    ]);

    expect(result[0]).toMatchObject({
      kind: "user",
      content: "请查看这些附件。",
      attachments: [
        expect.objectContaining({ id: "image-1", name: "diagram.png" }),
        expect.objectContaining({ id: "document-1", name: "notes.pdf" }),
      ],
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

  it("merges repeated ACP tool_call snapshots by call id", () => {
    const result = runtimeEventsToChatMessages([
      event("call-pending", "tool_call", "正在调用工具：read", {
        tool: { callId: "call-1", kind: "workspace", name: "read" },
      }),
      event("call-input", "tool_call", "正在调用工具：read", {
        tool: {
          callId: "call-1",
          kind: "workspace",
          name: "read",
          inputSummary: '{"filePath":"README.md"}',
        },
      }),
      event("call-result", "tool_result", "工具已完成：read", {
        detail: "1: hello",
        tool: {
          callId: "call-1",
          kind: "workspace",
          name: "read",
          outputSummary: "1: hello",
        },
      }),
    ]);

    expect(result.map((message) => message.kind)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(result[0]).toMatchObject({
      kind: "tool_call",
      name: "Read File",
      args: '{"filePath":"README.md"}',
      callId: "call-1",
      status: "completed",
    });
    expect(result[1]).toMatchObject({
      kind: "tool_result",
      name: "Read File",
      callId: "call-1",
      content: "1: hello",
    });
  });

  it("coalesces persisted cumulative Pi thinking snapshots into one reasoning row", () => {
    const result = runtimeEventsToChatMessages([
      event("pi-thought-prefix", "progress", "用户"),
      event(
        "pi-thought-full",
        "progress",
        "用户说这是 Agents One 联调测试，需要简单介绍。",
      ),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        kind: "reasoning",
        text: "用户说这是 Agents One 联调测试，需要简单介绍。",
      }),
    ]);
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

  it("omits trace notices when a collaboration provider omitted detailed events", () => {
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
      kind: "assistant",
      agentRuntimeId: "hers",
      collaborationRole: "规划",
    });
    expect(result.at(-1)).toMatchObject({
      kind: "assistant",
      content: "Hers 已完成规划。",
    });
  });

  it("coalesces OpenCode thought deltas after the ACP adapter turns them into snapshots", () => {
    const result = runtimeEventsToChatMessages([
      event("opencode-thought-1", "progress", "用户"),
      event("opencode-thought-2", "progress", "用户请求介绍"),
      event("opencode-thought-3", "progress", "用户请求介绍自己。"),
    ]);

    expect(result).toEqual([
      expect.objectContaining({
        kind: "reasoning",
        text: "用户请求介绍自己。",
      }),
    ]);
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
            },
          ],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "assistant",
      content: expect.stringContaining(
        "MEDIA:`agents-one-artifact://runtime/run-artifact-notices/chart-1/quarterly-revenue.png`",
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
            },
            {
              id: "report-1",
              kind: "final",
              label: "report.pdf",
              mime: "application/pdf",
              size: 256,
            },
          ],
        },
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      kind: "assistant",
      content: expect.stringContaining(
        "MEDIA:`agents-one-artifact://runtime/run-artifacts/chart-1/test-chart.png`",
      ),
      attachments: [
        expect.objectContaining({
          kind: "path-ref",
          name: "report.pdf",
          runtimeArtifact: {
            runId: "run-artifacts",
            artifactId: "report-1",
          },
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
        "MEDIA:`agents-one-artifact://runtime/run-remote-media/chart-1/quarterly_revenue_chart.png`",
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

  it("localizes platform-authored event fallbacks without changing Runtime text", () => {
    const labels: Record<string, string> = {
      "runtimeChat.events.cancelled": "Task cancelled",
      "runtimeChat.events.noDetail": "The Runtime did not provide details.",
    };
    const result = runtimeEventsToChatMessages(
      [event("cancelled", "cancelled", "")],
      { translate: (key) => labels[key] || key },
    );

    expect(result).toEqual([
      expect.objectContaining({
        kind: "assistant",
        content: "Task cancelled",
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

// @lat: [[runtime-chat#Inactivity warning visibility]]
it("shows one localized inactivity bubble while preserving the running tool", () => {
  const result = runtimeEventsToChatMessages(
    [
      {
        id: "tool",
        type: "tool_call",
        summary: "Read",
        createdAt: 1,
        tool: { name: "Read", kind: "tool", callId: "read-1" },
      },
      {
        id: "idle",
        type: "progress",
        summary: "任务执行可能中断，请停止后重试。",
        code: "runtime_inactive",
        createdAt: 2,
      },
    ],
    { live: true },
  );
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "assistant",
        content: "智能体已 10 分钟无响应，可继续等待或停止后重试。",
      }),
      expect.objectContaining({ kind: "tool_call", status: "running" }),
    ]),
  );
});

// @lat: [[runtime-chat#Task outcome message visibility]]
it.each([
  ["cancelled", "Runtime task was cancelled.", "任务已取消", "Task cancelled"],
  [
    "timed_out",
    "Runtime task exceeded 600000ms.",
    "任务已超时，请重试。",
    "Task timed out. Please try again.",
  ],
] as const)(
  "renders repeated %s events as one localized agent bubble in history",
  (type, content, zh, en) => {
    const messages: RuntimeConversationMessage[] = [
      {
        id: "reply",
        role: "agent",
        content,
        createdAt: 2,
        agentRuntimeId: "opencode",
        agentName: "OpenCode",
        execution: {
          runId: "run",
          events: [
            event("idle-1", "progress", "stale warning", {
              code: "runtime_inactive",
            }),
            event("terminal-1", type, content),
            event("idle-2", "progress", "stale warning", {
              code: "runtime_inactive",
            }),
            event("terminal-2", type, content),
          ],
        },
      },
    ];
    const original = JSON.stringify(messages);
    for (const [language, expected] of [
      ["zh-CN", zh],
      ["en", en],
    ]) {
      const result = runtimeConversationToChatMessages(messages, {
        translate: (key) => translate(key, language as "en" | "zh-CN"),
      });
      expect(result).toEqual([
        expect.objectContaining({
          kind: "assistant",
          content: expected,
          agentName: "OpenCode",
        }),
      ]);
    }
    expect(JSON.stringify(messages)).toBe(original);
  },
);

it("localizes legacy terminal fallback text without execution metadata", () => {
  expect(
    runtimeConversationToChatMessages([
      {
        id: "old",
        role: "agent",
        content: "Runtime task was cancelled.",
        createdAt: 1,
      },
    ])[0],
  ).toMatchObject({ kind: "assistant", content: "任务已取消" });
});

it("keeps useful partial output and tool failures with a single timeout notice", () => {
  const result = runtimeConversationToChatMessages([
    {
      id: "partial",
      role: "agent",
      content: "已完成第一步。",
      createdAt: 1,
      execution: {
        runId: "partial-run",
        events: [
          event("tool", "tool_call", "Read", {
            tool: { name: "Read", callId: "call", kind: "tool" },
          }),
          event("timeout", "timed_out", "budget exceeded"),
        ],
      },
    },
  ]);
  expect(result).toEqual([
    expect.objectContaining({ kind: "tool_call", status: "failed" }),
    expect.objectContaining({
      kind: "assistant",
      content: "已完成第一步。\n\n任务已超时，请重试。",
    }),
  ]);
});

it("coalesces live warnings, then drops them from completed history", () => {
  const idle = event("idle", "progress", "中文原文", {
    code: "runtime_inactive",
  });
  const options = {
    live: true,
    translate: (key: string) => translate(key, "en"),
  };
  expect(
    runtimeEventsToChatMessages([idle, { ...idle, id: "idle-2" }], options),
  ).toEqual([
    expect.objectContaining({
      kind: "assistant",
      content:
        "No response for 10 minutes. You can keep waiting or stop and retry.",
    }),
  ]);
  expect(
    runtimeEventsToChatMessages(
      [idle, event("done", "completed", "done")],
      options,
    ),
  ).toEqual([]);
  expect(
    runtimeConversationToChatMessages([
      {
        id: "done",
        role: "agent",
        content: "Final answer",
        createdAt: 1,
        execution: { runId: "done-run", events: [idle] },
      },
    ]),
  ).toEqual([
    expect.objectContaining({ kind: "assistant", content: "Final answer" }),
  ]);
});

it.each(["zh-CN", "en"] as const)(
  "shows model exhaustion as one localized agent bubble in %s",
  (locale) => {
    const content =
      "[OpenCode models unavailable] No available configured or free model.";
    const result = runtimeConversationToChatMessages(
      [
        {
          id: "quota",
          role: "agent",
          content,
          createdAt: 1,
          execution: {
            runId: "quota-run",
            events: [event("quota-error", "error", content)],
          },
        },
      ],
      { translate: (key) => translate(key, locale) },
    );
    expect(result).toEqual([
      expect.objectContaining({
        kind: "assistant",
        content: translate("runtimeChat.events.modelsUnavailable", locale),
      }),
    ]);
  },
);

it.each([
  "invalid_api_key",
  "insufficient_quota",
  "Model unavailable",
  "AI_APICallError: network connection failed",
  "[Word input error] broken document",
])("shows a localized failure in one agent reply: %s", (content) => {
  const result = runtimeConversationToChatMessages([
    {
      id: "failure",
      role: "agent",
      content,
      createdAt: 1,
      execution: {
        runId: "failed",
        events: [event("error", "error", content)],
      },
    },
  ]);
  expect(result).toHaveLength(1);
  expect(result[0].kind).toBe("assistant");
  expect(JSON.stringify(result)).not.toContain(content);
});

it("does not add trace-unavailable cards to failed collaboration replies", () => {
  const result = runtimeConversationToChatMessages([
    {
      id: "collab-error",
      role: "agent",
      collaborationRole: "review",
      content: "invalid_api_key",
      createdAt: 1,
      execution: {
        runId: "error-run",
        events: [event("error", "error", "invalid_api_key")],
      },
    },
  ]);
  expect(result).toHaveLength(1);
  expect(result[0].kind).toBe("assistant");
});

it("shows a model failure immediately while native cleanup is pending", () => {
  expect(
    runtimeEventsToChatMessages(
      [event("failure", "error", "insufficient_quota")],
      { live: true },
    ),
  ).toEqual([
    expect.objectContaining({
      kind: "assistant",
      content: "模型额度已用尽或达到调用上限，请更换可用模型或检查额度后重试。",
    }),
  ]);
  expect(
    runtimeEventsToChatMessages(
      [
        event("tool-error", "error", "insufficient_quota", {
          tool: { name: "Read", kind: "tool", callId: "tool" },
        }),
      ],
      { live: true },
    ),
  ).toEqual([]);
});

describe("remote execution visibility", () => {
  it("shows only the reply when the remote service did not report reasoning or tools", () => {
    const result = runtimeConversationToChatMessages([
      {
        id: "remote-greeting",
        role: "agent",
        createdAt: 2,
        content: "Hello",
        execution: {
          runId: "remote-run",
          events: [
            event("s", "started", "Remote task started"),
            event("m", "message", "Hello"),
            event("e", "completed", "Remote task completed"),
          ],
        },
      },
    ]);
    expect(result[0]).toMatchObject({
      kind: "assistant",
      content: "Hello",
    });
    expect(
      result.filter(
        (item) => item.kind === "reasoning" || item.kind === "tool_call",
      ),
    ).toHaveLength(0);
    expect(result.at(-1)).toMatchObject({
      kind: "assistant",
      content: "Hello",
    });
  });
  it("preserves real remote reasoning and paired tools after JSON persistence and reload", () => {
    const messages: RuntimeConversationMessage[] = [
      {
        id: "remote-tools",
        role: "agent",
        content: "Done",
        createdAt: 3,
        execution: {
          runId: "real-trace",
          events: [
            event("r", "progress", "Inspect the requested file"),
            event("c", "tool_call", "read_file", {
              tool: {
                name: "read_file",
                callId: "read-1",
                inputSummary: "test.txt",
              },
            }),
            event("t", "tool_result", "read complete", {
              tool: {
                name: "read_file",
                callId: "read-1",
                outputSummary: "hello",
              },
            }),
            event("m", "message", "Done"),
          ],
        },
      },
    ];
    const result = runtimeConversationToChatMessages(
      JSON.parse(JSON.stringify(messages)),
    );
    expect(result.map((item) => item.kind)).toEqual([
      "reasoning",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result[1]).toMatchObject({ callId: "read-1", args: "test.txt" });
    expect(result[2]).toMatchObject({ callId: "read-1", content: "hello" });
  });
});

// @lat: [[runtime-chat#Verified One compaction usage]]
it("excludes historical One call counters and diagnostics while retaining genuine reasoning and tools", () => {
  const result = runtimeEventsToChatMessages([
    event(
      "count",
      "progress",
      "One 模型调用 1/59（含自动重试与上下文摘要）。",
      { code: "one_model_call" },
    ),
    event(
      "old-count",
      "progress",
      "One 模型调用 3/59（含自动重试与上下文摘要）。",
    ),
    event("retry", "progress", "retrying", {
      code: "one_request_retry_scheduled",
    }),
    event("compact", "progress", "compacting", {
      code: "one_compaction_started",
    }),
    event("real", "progress", "I should verify the file before answering."),
    event("tool", "tool_call", "Workspace Read test.txt"),
  ]);
  expect(result.filter((message) => message.kind === "reasoning")).toHaveLength(
    1,
  );
  expect(JSON.stringify(result)).toContain("verify the file");
  expect(JSON.stringify(result)).not.toContain("模型调用");
  expect(result.some((message) => message.kind === "tool_call")).toBe(true);
});

it.each([
  ["workspace_read", "Read File"],
  ["workspace_write", "Write File"],
  ["workspace_list", "List Files"],
  ["workspace_search", "Search Files"],
])(
  "labels %s as a file operation without hiding the real call",
  (name, label) => {
    const messages = runtimeEventsToChatMessages([
      event("file-call", "tool_call", "One 调用 " + name + "：test.txt", {
        tool: {
          name,
          callId: "actual-call",
          kind: "workspace",
          inputSummary: "test.txt",
        },
      }),
    ]);
    expect(JSON.stringify(messages)).toContain(label);
    expect(JSON.stringify(messages)).toContain("test.txt");
  },
);
