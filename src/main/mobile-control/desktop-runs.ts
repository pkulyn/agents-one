import {
  getAgentRuntimeRun,
  requestAgentRuntimeTaskCancellation,
} from "../agent-runtimes";
import {
  completeRuntimeConversationTurn,
  listFullRuntimeConversations,
} from "../runtime-conversation-store";
import { listFullTaskSchedules } from "../task-schedules";
import { OriginalMobileRunRepository } from "./run-read";
import type { MobileArtifactRepository } from "./artifact-repository";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import { OriginalMobileRunControl } from "./original-run-control";
import { completeOriginalCancelledRun } from "./original-cancel-completion";

export function createDesktopMobileRunReader(
  profile: string,
  ledger: MobileOwnerLedgerPort,
  artifacts: MobileArtifactRepository,
  guard: () => void,
): OriginalMobileRunRepository {
  return new OriginalMobileRunRepository(
    {
      guard,
      conversations: () => {
        guard();
        return listFullRuntimeConversations(profile);
      },
      schedules: () => {
        guard();
        return listFullTaskSchedules(profile, true);
      },
      native: async (id) => {
        guard();
        const value = await getAgentRuntimeRun(id);
        guard();
        return value;
      },
    },
    ledger,
    artifacts,
    () => true,
  );
}
export function createDesktopMobileRunControl(
  profile: string,
  reader: OriginalMobileRunRepository,
  ledger: MobileOwnerLedgerPort,
  guard: () => void,
): OriginalMobileRunControl {
  return new OriginalMobileRunControl(reader, ledger, {
    guard,
    scheduled: (id) => {
      guard();
      return listFullTaskSchedules(profile, true).some(
        (schedule) =>
          schedule.activeRuntimeRunId === id ||
          schedule.runs.some((run) => run.runtimeRunId === id),
      );
    },
    native: async (id) => {
      guard();
      const value = await getAgentRuntimeRun(id);
      guard();
      return value;
    },
    cancel: async (id) => {
      guard();
      const result = await requestAgentRuntimeTaskCancellation(id);
      guard();
      if (result.accepted && !result.uncertain && result.run?.id === id) {
        completeOriginalCancelledRun(
          result.run,
          listFullRuntimeConversations(profile),
          (conversationId, runId, message, sessionId) => {
            guard();
            return completeRuntimeConversationTurn(
              conversationId,
              runId,
              message,
              sessionId,
              profile,
            );
          },
        );
      }
      return result;
    },
  });
}
