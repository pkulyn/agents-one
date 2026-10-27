import {
  automaticRuntimeTaskMode,
  isRuntimePermissionFailure,
} from "../../shared/runtime-permissions";
import { randomUUID } from "crypto";
import type {
  AgentRuntimeRun,
  AgentRuntimeTaskInput,
} from "../../shared/agent-runtimes";
import { summarizeTaskOutput } from "../../shared/runtime-output";
import {
  cancelAgentRuntimeTask,
  getAgentRuntimeRun,
  listAgentRuntimes,
  startAgentRuntimeTask,
} from "../agent-runtimes";
import {
  getRuntimeConversation,
  saveRuntimeConversation,
} from "../runtime-conversation-store";
import { getActiveProfileNameSync } from "../utils";

export interface TrayRuntimeConversationChange {
  profile: string;
  conversationId: string;
}

export interface StartedTrayRuntimeTask extends TrayRuntimeConversationChange {
  run: AgentRuntimeRun;
}

type TrayRuntimeTaskInput = Pick<
  AgentRuntimeTaskInput,
  "prompt" | "attachments" | "workspaceId"
>;

// @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Durable quick tasks]]
export async function startTrayRuntimeTask(
  runtimeId: string,
  input: TrayRuntimeTaskInput,
): Promise<StartedTrayRuntimeTask> {
  const runtime = listAgentRuntimes().find((item) => item.id === runtimeId);
  if (!runtime) throw new Error("Runtime was not found.");
  const profile = getActiveProfileNameSync();
  const run = await startAgentRuntimeTask(runtimeId, {
    ...input,
    profile,
    mode: automaticRuntimeTaskMode(runtime, Boolean(input.workspaceId)),
    conversation: true,
  });
  const conversationId = `runtime-conv-tray-${randomUUID()}`;
  try {
    saveRuntimeConversation({
      profile,
      id: conversationId,
      title: input.prompt,
      runtimeId: runtime.id,
      runtimeName: runtime.name,
      runtimeKind: runtime.kind,
      runtimeLocation: runtime.location,
      runtimeColor: runtime.color,
      runtimeAvatar: runtime.avatar,
      activeRuntimeRunId: run.status === "running" ? run.id : null,
      workspaceId: input.workspaceId,
      accessMode: "auto",
      messages: [
        {
          id: `${run.id}-user`,
          role: "user",
          content: input.prompt,
          createdAt: run.startedAt,
        },
      ],
    });
  } catch (error) {
    await cancelAgentRuntimeTask(run.id).catch(() => undefined);
    throw error;
  }
  return { run, profile, conversationId };
}

function trayRuntimeResult(run: AgentRuntimeRun): string {
  if (isRuntimePermissionFailure(run.error)) return run.error!;
  const output = run.output?.trim() || "";
  const summary = summarizeTaskOutput(output);
  if (summary.finalText) return summary.finalText;
  if (output && !summary.hasStructuredEvents) return output.slice(-200_000);
  if (run.error?.trim()) return run.error.trim();
  return run.status === "succeeded"
    ? "任务已完成，但 Runtime 未返回正文。"
    : `任务未成功完成（${run.status}）。`;
}

export function finishTrayRuntimeTask(
  task: TrayRuntimeConversationChange,
  run: AgentRuntimeRun,
): TrayRuntimeConversationChange | null {
  const conversation = getRuntimeConversation(
    task.conversationId,
    task.profile,
  );
  if (!conversation || conversation.activeRuntimeRunId !== run.id) return null;
  const hasResult = conversation.messages.some(
    (message) => message.execution?.runId === run.id,
  );
  saveRuntimeConversation({
    ...conversation,
    profile: task.profile,
    runtimeSessionId: run.sessionId || conversation.runtimeSessionId,
    activeRuntimeRunId: null,
    messages: hasResult
      ? conversation.messages
      : [
          ...conversation.messages,
          {
            id: `${run.id}-result`,
            role: run.status === "succeeded" ? "agent" : "system",
            content: trayRuntimeResult(run),
            createdAt: run.completedAt || Date.now(),
            execution: {
              runId: run.id,
              events: run.events || [],
              startedAt: run.startedAt,
              completedAt: run.completedAt,
              ...(run.artifacts?.length ? { artifacts: run.artifacts } : {}),
              ...(run.model ? { model: run.model } : {}),
              ...(run.usage ? { usage: run.usage } : {}),
            },
          },
        ],
  });
  return { profile: task.profile, conversationId: task.conversationId };
}

/** Continue observing after the tray window closes, including Gateway runs that require polling. */
export function watchTrayRuntimeTask(
  task: StartedTrayRuntimeTask,
  onChanged: (change: TrayRuntimeConversationChange) => void,
): void {
  void (async () => {
    let run: AgentRuntimeRun | null = task.run;
    while (run?.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 900));
      run = await getAgentRuntimeRun(task.run.id);
    }
    if (!run) return;
    const change = finishTrayRuntimeTask(task, run);
    if (change) onChanged(change);
  })().catch((error) => {
    console.error("[TRAY] Failed to save quick task result", error);
  });
}
