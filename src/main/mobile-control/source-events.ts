import { assertMobileSchema } from "../../shared/mobile-control";
import type {
  ConversationRepository,
  Json,
  SourceConversation,
} from "./conversation-projection";
import type { MobileOwnerLedgerPort } from "./owner-ledger-port";
import type { MobileScheduleReadRepository } from "./schedule-read";

/** Complete source observations publish public projections and retain original identities. */
export class MobileSourceEventPublisher {
  constructor(
    private readonly ledger: MobileOwnerLedgerPort,
    private readonly repository: ConversationRepository,
    private readonly messages: (row: SourceConversation) => Json[] | Promise<Json[]>,
    private readonly conversation: (
      row: SourceConversation,
      messages: Json[],
    ) => Json | Promise<Json>,
    private readonly guard: () => void,
    private readonly schedules?: MobileScheduleReadRepository,
    private readonly runs?: () => Json[] | Promise<Json[]>,
  ) {}
  async sync(): Promise<void> {
    this.guard();
    const entries: Array<{ key: string; event: Json; deletion: Json }> = [];
    const add = (
      key: unknown[],
      type: string,
      resourceRef: Json,
      revision: unknown,
      payload: Json,
      deletion: Json,
    ): void => {
      entries.push({
        key: JSON.stringify(key),
        event: {
          type,
          resourceRef,
          resourceRevision: revision,
          payload,
          ...(type === "run.updated"
            ? { runId: payload.runId, runEventSeq: payload.lastRunEventSeq }
            : {}),
        },
        deletion: {
          type: "resource.deleted",
          resourceRef,
          resourceRevision: revision,
          payload: deletion,
        },
      });
    };
    for (const row of this.repository.list()) {
      const messages = await this.messages(row);
      const conversation = await this.conversation(row, messages);
      const ref = { type: "conversation", id: row.id };
      add(
        ["conversation", row.id],
        "conversation.updated",
        ref,
        conversation.revision,
        conversation,
        { kind: "conversation", id: row.id },
      );
      for (const message of messages)
        add(
          ["message", row.id, message.id],
          "message.upsert",
          ref,
          message.messageRevision,
          message,
          { kind: "message", id: message.id, conversationId: row.id },
        );
    }
    if (this.schedules)
      for (const summary of this.schedules.list()) {
        const id = String(summary.id);
        const schedule = this.schedules.get(id);
        assertMobileSchema("Schedule", schedule);
        const ref = { type: "schedule", id };
        add(
          ["schedule", id],
          "schedule.updated",
          ref,
          schedule.revision,
          schedule,
          { kind: "schedule", id },
        );
        for (const execution of this.schedules.executions(id)) {
          assertMobileSchema("ScheduleExecution", execution);
          const revision = await this.ledger.observeReadonlySource(
            JSON.stringify(["schedule-execution", id, execution.id]),
            execution,
          );
          add(
            ["schedule_execution", id, execution.id],
            "schedule.execution.updated",
            ref,
            revision,
            execution,
            { kind: "schedule_execution", id: execution.id, scheduleId: id },
          );
        }
      }
    for (const run of (await this.runs?.()) ?? []) {
      assertMobileSchema("Run", run);
      add(
        ["original-run", run.runId],
        "run.updated",
        { type: "run", id: run.runId },
        run.lastRunEventSeq,
        run,
        { kind: "run", id: run.runId },
      );
    }
    this.guard();
    await this.ledger.observeSourceEvents(entries);
  }
}
