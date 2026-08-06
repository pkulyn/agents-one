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
    state.root = mkdtempSync(join(tmpdir(), "agents-one-runtime-conversations-"));
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(state.root, { recursive: true, force: true });
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
    expect(store.getRuntimeConversation("collaboration-1")?.messages[1]).toMatchObject({
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

    expect(store.getRuntimeConversation("remote-trace-1")?.messages[1]).toMatchObject({
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
});
