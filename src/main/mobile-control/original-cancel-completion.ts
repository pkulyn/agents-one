import type { AgentRuntimeRun } from "../../shared/agent-runtimes";
import type {
  RuntimeConversation,
  RuntimeConversationMessage,
} from "../../shared/runtime-conversations";
import { summarizeTaskOutput } from "../../shared/runtime-output";

/** Commits only an observed Native cancellation to its ordinary desktop claim. */
export function completeOriginalCancelledRun(
  run: AgentRuntimeRun,
  conversations: RuntimeConversation[],
  finish: (
    conversationId: string,
    runId: string,
    message: RuntimeConversationMessage,
    sessionId: string | undefined,
  ) => unknown,
): void {
  if (run.status !== "cancelled") return;
  const candidates = conversations.filter(
    (value) =>
      value.activeRuntimeRunId === run.id &&
      value.runtimeId === run.runtimeId &&
      !value.activeRuntimeRunOwner,
  );
  if (candidates.length !== 1) return;
  const source = candidates[0];
  if (source.messages.some((message) => message.execution?.runId === run.id))
    return;
  const summary = summarizeTaskOutput(run.output ?? "");
  const reply =
    summary.finalText ||
    (!summary.hasStructuredEvents ? run.output?.trim() : "");
  finish(
    source.id,
    run.id,
    {
      id: `${run.id}-result`,
      role: reply ? "agent" : "system",
      content: reply || "任务已取消。",
      createdAt: run.completedAt ?? Date.now(),
      meta: {
        audience: reply ? ["model", "user", "audit"] : ["user", "audit"],
        origin: reply ? "runtime" : "platform",
        persistence: "durable",
      },
      execution: {
        runId: run.id,
        events: run.events ?? [],
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        ...(run.artifacts?.length ? { artifacts: run.artifacts } : {}),
        ...(run.actualModel ? { actualModel: run.actualModel } : {}),
        ...(run.model ? { model: run.model } : {}),
        ...(run.usage ? { usage: run.usage } : {}),
        ...(run.isolation ? { isolation: run.isolation } : {}),
      },
    },
    run.sessionId,
  );
}
