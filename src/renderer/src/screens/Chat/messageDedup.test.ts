import { describe, expect, it } from "vitest";
import { collapseHistoricalEchoes } from "./messageDedup";
import type { ChatBubbleMessage, ChatMessage } from "./types";

const user = (id: string, content: string): ChatBubbleMessage => ({
  id,
  role: "user",
  content,
});
const answer = (id: string, content: string): ChatBubbleMessage => ({
  id,
  role: "agent",
  kind: "assistant",
  content,
});

describe("collapseHistoricalEchoes", () => {
  it("keeps one answer when an old reasoning row mirrors it", () => {
    const text =
      "老大好，连接正常，Agents One 在线。当前状态：模型 gl m，运行环境 NAS。";
    const messages: ChatMessage[] = [
      user("u1", "你好"),
      answer("a1", text),
      {
        id: "r1",
        kind: "reasoning",
        role: "agent",
        text: `${text} 有什么需要帮忙的随时说。`,
      },
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["u1", "a1"]);
  });

  it("keeps the fuller of two duplicated final answers", () => {
    const prefix = "Agents One 连接正常，当前服务运行正常，远程连接已经建立。";
    const messages: ChatMessage[] = [
      user("u1", "测试"),
      answer("a1", prefix),
      answer("a2", `${prefix} 可以继续安排任务。`),
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["u1", "a2"]);
  });

  it("does not merge separate agent turns", () => {
    const text =
      "这是一段足够长的相同测试答复，用来确认不同用户轮次不会被错误折叠。";
    const messages: ChatMessage[] = [
      user("u1", "一"),
      answer("a1", text),
      user("u2", "二"),
      answer("a2", text),
    ];

    expect(collapseHistoricalEchoes(messages)).toHaveLength(4);
  });

  it("collapses short live and persisted answers while streaming", () => {
    const messages: ChatMessage[] = [
      { ...user("u1", "测试"), turnId: "turn-1" },
      { ...answer("live-a", "H"), pending: true, turnId: "turn-1" },
      answer("db-2", "Hermes 连续对话第一轮通过。"),
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["u1", "db-2"]);
  });

  it("ignores a persisted attachment user echo as a new turn boundary", () => {
    const prompt = "请读取附件并返回标记";
    const final = "AO-U5-20260717";
    const messages: ChatMessage[] = [
      { ...user("u1", prompt), turnId: "turn-1" },
      { ...answer("live-a", "AO"), pending: true, turnId: "turn-1" },
      user(
        "db-10",
        `${prompt}\n<file name="fixture.txt">AO-U5-20260717</file>`,
      ),
      answer("db-11", final),
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["u1", "db-11"]);
  });

  it("keeps a deliberate repeated prompt in a later local turn", () => {
    const messages: ChatMessage[] = [
      { ...user("u1", "再说一次"), turnId: "turn-1" },
      answer("a1", "第一次答复"),
      { ...user("u2", "再说一次"), turnId: "turn-2" },
      answer("a2", "第二次答复"),
    ];

    expect(collapseHistoricalEchoes(messages)).toHaveLength(4);
  });

  it("prefers a canonical answer over a duplicated live full chunk", () => {
    const messages: ChatMessage[] = [
      { ...user("u1", "recall marker"), turnId: "turn-1" },
      {
        ...answer("live-a", "AO-U5-20260717AO-U5-20260717"),
        turnId: "turn-1",
      },
      answer("db-2", "AO-U5-20260717"),
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["u1", "db-2"]);
  });

  it("collapses stream and recovery fragments around an attachment echo", () => {
    const prompt = "请确认项目文件夹是否能阅读和编辑";
    const final = "已收到项目文件夹快照，确认可以读取，但快照不能直接回写。";
    const messages: ChatMessage[] = [
      {
        ...user("db--900000000", prompt),
        turnId: "turn-1",
        attachments: [],
      },
      {
        ...answer("agent-live", "已收到项目文件夹快照，确认可以读"),
        turnId: "turn-1",
      },
      {
        ...answer("db--900000001", "已收到项目文件夹快照取，但快照不能"),
        turnId: "turn-1",
      },
      user("db-10", `${prompt}\n\n</file>`),
      {
        id: "db-r-11",
        kind: "reasoning",
        role: "agent",
        text: "check snapshot",
      },
      answer("db-11", final),
    ];

    expect(
      collapseHistoricalEchoes(messages).map((message) => message.id),
    ).toEqual(["db--900000000", "db-r-11", "db-11"]);
  });
});
