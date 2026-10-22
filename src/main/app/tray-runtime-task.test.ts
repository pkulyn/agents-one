import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import type { SaveRuntimeConversationInput } from "../../shared/runtime-conversations";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  getRun: vi.fn(),
  cancel: vi.fn(),
  save: vi.fn(),
  conversations: new Map<string, SaveRuntimeConversationInput>(),
}));

vi.mock("../agent-runtimes", () => ({
  listAgentRuntimes: () => [
    {
      id: "chatgpt-web",
      name: "ChatGPT",
      kind: "web-agent",
      location: "local",
      enabled: true,
      color: "#15803d",
    },
    { id: "pi", name: "Pi", kind: "pi", location: "local", enabled: true },
  ],
  startAgentRuntimeTask: mocks.start,
  getAgentRuntimeRun: mocks.getRun,
  cancelAgentRuntimeTask: mocks.cancel,
}));

vi.mock("../runtime-conversation-store", () => ({
  saveRuntimeConversation: mocks.save,
  getRuntimeConversation: (id: string) => mocks.conversations.get(id) || null,
}));

vi.mock("../utils", () => ({ getActiveProfileNameSync: () => "work" }));

import {
  finishTrayRuntimeTask,
  startTrayRuntimeTask,
  watchTrayRuntimeTask,
} from "./tray-runtime-task";

const running: AgentRuntimeRun = {
  id: "run-tray-1",
  runtimeId: "chatgpt-web",
  status: "running",
  startedAt: 1_800_000_000_000,
};

beforeEach(() => {
  mocks.conversations.clear();
  mocks.start.mockReset().mockResolvedValue(running);
  mocks.getRun.mockReset();
  mocks.cancel.mockReset().mockResolvedValue(true);
  mocks.save
    .mockReset()
    .mockImplementation((input: SaveRuntimeConversationInput) => {
      mocks.conversations.set(input.id, structuredClone(input));
      return input;
    });
});

afterEach(() => vi.useRealTimers());

describe("tray Runtime task persistence", () => {
  // @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Durable quick tasks]]
  it("saves the user turn before the tray closes and appends the final ChatGPT reply once", async () => {
    const task = await startTrayRuntimeTask("chatgpt-web", {
      prompt: "帮我总结今天的新闻",
      attachments: [],
    });
    expect(mocks.start).toHaveBeenCalledWith(
      "chatgpt-web",
      expect.objectContaining({
        prompt: "帮我总结今天的新闻",
        profile: "work",
        conversation: true,
        mode: "analysis",
      }),
    );
    expect(mocks.conversations.get(task.conversationId)).toMatchObject({
      profile: "work",
      runtimeId: "chatgpt-web",
      activeRuntimeRunId: "run-tray-1",
      accessMode: "auto",
      messages: [{ role: "user", content: "帮我总结今天的新闻" }],
    });

    const completed: AgentRuntimeRun = {
      ...running,
      status: "succeeded",
      completedAt: running.startedAt + 10_000,
      output: "# 今日简报\n\n| 主题 | 内容 |\n| --- | --- |\n| AI | 进展 |",
      sessionId: "web-chatgpt:session-1",
      events: [
        {
          id: "event-1",
          type: "completed",
          summary: "任务已完成",
          createdAt: running.startedAt + 10_000,
        },
      ],
    };
    expect(finishTrayRuntimeTask(task, completed)).toEqual({
      profile: "work",
      conversationId: task.conversationId,
    });
    const saved = mocks.conversations.get(task.conversationId);
    expect(saved).toMatchObject({
      activeRuntimeRunId: null,
      runtimeSessionId: "web-chatgpt:session-1",
      messages: [
        { role: "user" },
        {
          role: "agent",
          content: completed.output,
          execution: { runId: running.id },
        },
      ],
    });
    expect(finishTrayRuntimeTask(task, completed)).toBeNull();
    expect(mocks.conversations.get(task.conversationId)?.messages).toHaveLength(
      2,
    );
  });

  it("starts a new Pi tray conversation with automatic native tools", async () => {
    const task = await startTrayRuntimeTask("pi", {
      prompt: "读取记忆并搜索资料",
    });
    expect(mocks.start).toHaveBeenCalledWith(
      "pi",
      expect.objectContaining({ mode: "safe_write" }),
    );
    expect(mocks.conversations.get(task.conversationId)?.accessMode).toBe(
      "auto",
    );
  });

  it("keeps a failed run visible and cancels dispatch if the first save fails", async () => {
    const task = await startTrayRuntimeTask("chatgpt-web", {
      prompt: "测试失败记录",
    });
    finishTrayRuntimeTask(task, {
      ...running,
      status: "failed",
      error: "网页暂时无法访问",
      completedAt: running.startedAt + 1000,
    });
    expect(
      mocks.conversations.get(task.conversationId)?.messages.at(-1),
    ).toMatchObject({
      role: "system",
      content: "网页暂时无法访问",
    });

    mocks.save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    await expect(
      startTrayRuntimeTask("chatgpt-web", { prompt: "不可丢失的任务" }),
    ).rejects.toThrow("disk full");
    expect(mocks.cancel).toHaveBeenCalledWith(running.id);
  });

  it("keeps polling after the composer closes and reports the saved result", async () => {
    vi.useFakeTimers();
    const task = await startTrayRuntimeTask("chatgpt-web", {
      prompt: "后台任务",
    });
    const completed: AgentRuntimeRun = {
      ...running,
      status: "succeeded",
      output: "后台完成",
    };
    mocks.getRun
      .mockResolvedValueOnce(running)
      .mockResolvedValueOnce(completed);
    const onChanged = vi.fn();
    watchTrayRuntimeTask(task, onChanged);
    await vi.advanceTimersByTimeAsync(1800);
    expect(onChanged).toHaveBeenCalledWith({
      profile: "work",
      conversationId: task.conversationId,
    });
    expect(
      mocks.conversations.get(task.conversationId)?.messages.at(-1)?.content,
    ).toBe("后台完成");
  });
});
