import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { RuntimeConversation } from "../../../../shared/runtime-conversations";
import type { TaskCollaborationRecord } from "../../../../shared/task-collaboration";

type ModeApi = Pick<
  typeof window.agentsOneAPI,
  | "getTaskCollaboration"
  | "saveTaskCollaboration"
  | "getRuntimeConversation"
  | "saveRuntimeConversation"
>;
/** Save mode explicitly; a failed owner change restores the previous mode. */
export async function switchTaskToSingle(
  api: ModeApi,
  input: {
    taskId: string;
    profile: string;
    conversationId?: string;
    runtimeId?: string;
    target?: AgentRuntimeDefinition;
  },
): Promise<{
  record: TaskCollaborationRecord;
  conversation: RuntimeConversation | null;
}> {
  const previous = await api.getTaskCollaboration(input.taskId, input.profile);
  if (!previous) throw new Error("collaboration_unavailable");
  let current: RuntimeConversation | null = null;
  if (
    input.target &&
    input.target.id !== input.runtimeId &&
    input.conversationId
  ) {
    current = await api.getRuntimeConversation(
      input.conversationId,
      input.profile,
    );
    if (!current || current.activeRuntimeRunId)
      throw new Error("collaboration_running");
  }
  const record = await api.saveTaskCollaboration(
    { ...previous, taskMode: "single" },
    input.profile,
  );
  if (!current || !input.target) return { record, conversation: null };
  const target = input.target;
  try {
    const conversation = await api.saveRuntimeConversation({
      id: current.id,
      title: current.title,
      workspace: current.workspace,
      workspaceId: current.workspaceId,
      accessMode: current.accessMode,
      branch: current.branch,
      profile: input.profile,
      expectedRevision: current.revision,
      runtimeId: target.id,
      runtimeName: target.name,
      runtimeKind: target.kind,
      runtimeLocation: target.location,
      runtimeColor: target.color,
      runtimeAvatar: target.avatar,
      runtimeSessionId: undefined,
      messages: current.messages.map((message) =>
        message.role === "agent" && !message.agentRuntimeId
          ? {
              ...message,
              agentRuntimeId: current.runtimeId,
              agentName: current.runtimeName,
              agentAvatar: current.runtimeAvatar,
              agentColor: current.runtimeColor,
            }
          : message,
      ),
    });
    return { record, conversation };
  } catch (error) {
    await api.saveTaskCollaboration(
      { ...previous, taskMode: previous.taskMode || "collaboration" },
      input.profile,
    );
    throw error;
  }
}
