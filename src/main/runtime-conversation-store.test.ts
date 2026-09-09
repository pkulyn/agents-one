// @vitest-environment node

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("./utils", () => ({
  getActiveProfileNameSync: () => "default",
  profileHome: (profile: string) => join(state.root, profile),
  safeWriteFile: (path: string, content: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
}));

describe("runtime conversation store", () => {
  beforeEach(() => {
    state.root = mkdtempSync(
      join(tmpdir(), "agents-one-runtime-conversations-"),
    );
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true });
  });

  it("keeps entry audience metadata and branch links without migrating old messages", async () => {
    const store = await import("./runtime-conversation-store");
    store.saveRuntimeConversation({
      id: "root",
      title: "根会话",
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      messages: [
        { id: "u1", role: "user", content: "需求", createdAt: 1 },
        {
          id: "s1",
          role: "system",
          content: "仅审计",
          createdAt: 2,
          meta: {
            audience: ["user", "audit"],
            origin: "platform",
            persistence: "durable",
          },
          controlAudit: {
            requestId: "audit-1",
            command: "compact",
            runtimeId: "pi",
            outcome: "handled",
            startedAt: 1,
            completedAt: 2,
            createdAt: 2,
          },
        },
      ],
    });
    const branch = store.forkRuntimeConversation("root", {
      id: "branch",
      forkedFromMessageId: "u1",
      branchLabel: "方案 B",
      branchSummary: "仅保留用户可见事实。",
    });
    expect(branch.messages.map((message) => message.id)).toEqual(["u1"]);
    expect(branch.branch).toMatchObject({
      parentConversationId: "root",
      forkedFromMessageId: "u1",
    });
    expect(() =>
      store.forkRuntimeConversation("root", {
        id: "unsafe",
        implementation: true,
      }),
    ).toThrow(/worktree/);
    expect(
      store.getRuntimeConversation("root")?.messages[1].controlAudit,
    ).toMatchObject({
      requestId: "audit-1",
      command: "compact",
    });
  });

  it("keeps OpenCode, OpenClaw, and future runtime kinds in conversation storage", async () => {
    const store = await import("./runtime-conversation-store");
    for (const runtimeKind of ["opencode", "openclaw", "future-cli"] as const) {
      const saved = store.saveRuntimeConversation({
        id: `conversation-${runtimeKind}`,
        title: runtimeKind,
        runtimeId: runtimeKind,
        runtimeName: runtimeKind,
        runtimeKind,
        runtimeLocation: runtimeKind === "openclaw" ? "remote" : "local",
        messages: [
          {
            id: `message-${runtimeKind}`,
            role: "user",
            content: "hello",
            createdAt: 1,
          },
        ],
      });
      expect(saved.runtimeKind).toBe(runtimeKind);
      expect(
        store.getRuntimeConversation(`conversation-${runtimeKind}`)
          ?.runtimeKind,
      ).toBe(runtimeKind);
    }
  });

  it("persists OpenCode execution metadata without failing on incomplete artifacts", async () => {
    const store = await import("./runtime-conversation-store");
    const saved = store.saveRuntimeConversation({
      id: "opencode-metadata",
      title: "OpenCode 元数据",
      runtimeId: "opencode",
      runtimeName: "OpenCode",
      runtimeKind: "opencode",
      runtimeLocation: "local",
      messages: [
        { id: "u1", role: "user", content: "你是谁？", createdAt: 1 },
        {
          id: "a1",
          role: "agent",
          content: "我是 OpenCode。",
          createdAt: 2,
          execution: {
            runId: "opencode-run-1",
            events: [
              {
                id: "thought-1",
                type: "progress",
                summary: "用户请求介绍自己。",
                createdAt: 2,
              },
            ],
            model: { provider: "ark", id: "glm-5.2" },
            usage: {
              inputTokens: 10,
              outputTokens: 4,
              totalTokens: 14,
              contextUsedTokens: 42,
              contextWindowTokens: 100,
            },
            artifacts: [{ kind: "diff" } as never],
          },
        },
      ],
    });

    expect(saved.messages[1]?.execution).toMatchObject({
      model: { provider: "ark", id: "glm-5.2" },
      usage: { inputTokens: 10, totalTokens: 14 },
      events: [expect.objectContaining({ summary: "用户请求介绍自己。" })],
    });
    expect(saved.messages[1]?.execution?.artifacts).toBeUndefined();
  });

  it("preserves individual collaboration agent identity on disk", async () => {
    const store = await import("./runtime-conversation-store");
    const saved = store.saveRuntimeConversation({
      id: "collaboration-1",
      title: "协作测试",
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
      runtimeLocation: "local",
      messages: [
        { id: "u1", role: "user", content: "开始", createdAt: 1 },
        {
          id: "a1",
          role: "agent",
          content: "实施已完成",
          createdAt: 2,
          agentRuntimeId: "claude-code",
          agentName: "Claude",
          agentAvatar: "data:image/png;base64,avatar",
          agentColor: "#7357e8",
          collaborationRole: "实施交付",
        },
      ],
    });

    expect(saved.messages[1]).toMatchObject({
      agentRuntimeId: "claude-code",
      agentName: "Claude",
      agentAvatar: "data:image/png;base64,avatar",
      agentColor: "#7357e8",
      collaborationRole: "实施交付",
    });
    expect(
      store.getRuntimeConversation("collaboration-1")?.messages[1],
    ).toMatchObject({
      agentRuntimeId: "claude-code",
      agentName: "Claude",
      collaborationRole: "实施交付",
    });
  });

  it("persists runtime evidence needed to replay the first remote turn", async () => {
    const store = await import("./runtime-conversation-store");
    store.saveRuntimeConversation({
      id: "remote-trace-1",
      title: "远程首轮事件",
      runtimeId: "hers-2",
      runtimeName: "Hers-2",
      runtimeKind: "hermes",
      runtimeLocation: "remote",
      messages: [
        { id: "u1", role: "user", content: "生成图表", createdAt: 1 },
        {
          id: "a1",
          role: "agent",
          content: "已完成。",
          createdAt: 2,
          execution: {
            runId: "run-1",
            events: [
              {
                id: "tool-1",
                type: "tool_call",
                summary: "工具 artifact_store",
                detail: "上传图表",
                code: "artifact_upload",
                tool: {
                  name: "artifact_store",
                  kind: "mcp",
                  callId: "call-1",
                },
                createdAt: 2,
              },
            ],
            artifacts: [
              {
                kind: "final",
                label: "chart_quarterly_revenue.png",
                id: "artifact-chart",
                mime: "image/png",
                size: 128,
                path: "C:\\temp\\chart_quarterly_revenue.png",
              },
            ],
          },
        },
      ],
    });

    expect(
      store.getRuntimeConversation("remote-trace-1")?.messages[1],
    ).toMatchObject({
      execution: {
        events: [
          expect.objectContaining({
            detail: "上传图表",
            code: "artifact_upload",
            tool: expect.objectContaining({ name: "artifact_store" }),
          }),
        ],
        artifacts: [
          expect.objectContaining({
            id: "artifact-chart",
            label: "chart_quarterly_revenue.png",
          }),
        ],
      },
    });
  });

  it("persists and clears a background conversation's active Runtime run", async () => {
    const store = await import("./runtime-conversation-store");
    const base = {
      id: "schedule-live-1",
      title: "定时任务：整理知识库",
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi" as const,
      runtimeLocation: "local" as const,
      messages: [
        {
          id: "u1",
          role: "user" as const,
          content: "整理知识库",
          createdAt: 1,
        },
      ],
    };

    store.saveRuntimeConversation({
      ...base,
      activeRuntimeRunId: "runtime-run-schedule-1",
    });
    expect(store.getRuntimeConversation(base.id)).toMatchObject({
      activeRuntimeRunId: "runtime-run-schedule-1",
    });

    store.saveRuntimeConversation({ ...base, activeRuntimeRunId: null });
    expect(
      store.getRuntimeConversation(base.id)?.activeRuntimeRunId,
    ).toBeUndefined();
  });

  it("persists Web Agent conversations and their resumable session", async () => {
    const store = await import("./runtime-conversation-store");
    const saved = store.saveRuntimeConversation({
      id: "doubao-conversation-1",
      title: "介绍豆包功能",
      runtimeId: "doubao-web-test",
      runtimeName: "豆包网页版",
      runtimeKind: "web-agent",
      runtimeLocation: "local",
      runtimeSessionId: "web-doubao:conversation-1",
      messages: [
        { id: "u1", role: "user", content: "介绍一下功能", createdAt: 1 },
        { id: "a1", role: "agent", content: "这是最终答复", createdAt: 2 },
      ],
    });

    expect(saved).toMatchObject({
      runtimeKind: "web-agent",
      runtimeSessionId: "web-doubao:conversation-1",
      messageCount: 2,
    });
    expect(
      store.getRuntimeConversation(saved.id)?.messages.at(-1)?.content,
    ).toBe("这是最终答复");
  });
});
