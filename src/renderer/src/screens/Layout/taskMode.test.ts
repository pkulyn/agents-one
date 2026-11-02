import { describe, it, expect, vi, type MockedFunction } from "vitest";
import { switchTaskToSingle } from "./taskMode";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { RuntimeConversation } from "../../../../shared/runtime-conversations";
import type { TaskCollaborationRecord } from "../../../../shared/task-collaboration";
const previous = {
  taskId: "task",
  title: "Task",
  taskMode: "collaboration",
  assignments: [],
  status: "configured",
  createdAt: 1,
  updatedAt: 1,
} as TaskCollaborationRecord;
const target = {
  id: "opencode",
  name: "OpenCode",
  kind: "opencode",
  location: "local",
  enabled: true,
  managed: "user",
  config: {},
} as AgentRuntimeDefinition;
const conversation = {
  id: "conv",
  runtimeId: "pi",
  runtimeName: "Pi",
  revision: "3",
  activeRuntimeRunOwner: undefined,
  title: "Conversation",
  createdAt: 1,
  updatedAt: 1,
  runtimeKind: "pi",
  runtimeLocation: "local",
  messageCount: 2,
  messages: [
    { id: "m1", role: "agent", content: "Earlier answer", createdAt: 1 },
    {
      id: "m2",
      role: "agent",
      content: "Other answer",
      createdAt: 2,
      agentRuntimeId: "codex",
      agentName: "Codex",
    },
  ],
} as RuntimeConversation;
type ModeApi = Parameters<typeof switchTaskToSingle>[0];
function setup(): { [K in keyof ModeApi]: MockedFunction<ModeApi[K]> } {
  return {
    getTaskCollaboration: vi.fn().mockResolvedValue(previous),
    saveTaskCollaboration: vi.fn().mockImplementation(async (value) => value),
    getRuntimeConversation: vi.fn().mockResolvedValue(conversation),
    saveRuntimeConversation: vi.fn().mockImplementation(async (value) => value),
  };
}
const input = {
  taskId: "task",
  profile: "default",
  runtimeId: "pi",
  conversationId: "conv",
  target,
};
describe("Task mode persistence", () => {
  it("preserves previous message authors and clears the native session when changing future agent", async () => {
    const api = setup();
    await switchTaskToSingle(api, input);
    expect(
      Object.hasOwn(
        api.saveRuntimeConversation.mock.calls[0][0],
        "activeRuntimeRunOwner",
      ),
    ).toBe(false);
    expect(api.saveRuntimeConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: "3",
        runtimeId: "opencode",
        runtimeSessionId: undefined,
        messages: [
          expect.objectContaining({ agentRuntimeId: "pi", agentName: "Pi" }),
          expect.objectContaining({
            agentRuntimeId: "codex",
            agentName: "Codex",
          }),
        ],
      }),
    );
  });
  it("restores collaboration mode if owner persistence fails", async () => {
    const api = setup();
    api.saveRuntimeConversation.mockRejectedValue(
      new Error("revision_conflict"),
    );
    await expect(switchTaskToSingle(api, input)).rejects.toThrow(
      "revision_conflict",
    );
    expect(
      api.saveTaskCollaboration.mock.calls.map((call) => call[0].taskMode),
    ).toEqual(["single", "collaboration"]);
  });
  it("refuses active conversations before writing mode", async () => {
    const api = setup();
    api.getRuntimeConversation.mockResolvedValue({
      ...conversation,
      activeRuntimeRunId: "live",
    });
    await expect(switchTaskToSingle(api, input)).rejects.toThrow(
      "collaboration_running",
    );
    expect(api.saveTaskCollaboration).not.toHaveBeenCalled();
  });
  it("does not rewrite conversation history when keeping the current agent", async () => {
    const api = setup();
    await switchTaskToSingle(api, {
      ...input,
      target: { ...target, id: "pi" },
    });
    expect(api.saveRuntimeConversation).not.toHaveBeenCalled();
    expect(api.saveTaskCollaboration).toHaveBeenCalledWith(
      expect.objectContaining({ taskMode: "single" }),
      "default",
    );
  });
});
