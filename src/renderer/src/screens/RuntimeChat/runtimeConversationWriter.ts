import type {
  RuntimeConversation,
  SaveRuntimeConversationInput,
} from "../../../../shared/runtime-conversations";

/** Serializes one tab's checkpoints against the exact last observed Owner revision. */
export class RuntimeConversationWriter {
  private record: RuntimeConversation | null = null;
  private profile: string | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  constructor(
    private readonly read: (
      id: string,
      profile?: string,
    ) => Promise<RuntimeConversation | null>,
    private readonly write: (
      input: SaveRuntimeConversationInput,
    ) => Promise<RuntimeConversation>,
  ) {}
  observe(record: RuntimeConversation, profile?: string): boolean {
    if (this.pending) return false;
    if (
      this.profile === profile &&
      this.record?.id === record.id &&
      BigInt(record.revision ?? "1") < BigInt(this.record.revision ?? "1")
    )
      return false;
    this.record = structuredClone(record);
    this.profile = profile;
    return true;
  }
  save(input: SaveRuntimeConversationInput): Promise<RuntimeConversation> {
    // Freeze the caller's messages before another turn or event can mutate them.
    const checkpoint = structuredClone(input);
    this.pending++;
    const work = this.tail.then(async () => {
      const known =
        this.profile === checkpoint.profile &&
        this.record?.id === checkpoint.id;
      const previous = known
        ? this.record
        : await this.read(checkpoint.id, checkpoint.profile);
      if (!known && previous) {
        const latest = new Map(
          previous.messages.map((message) => [message.id, message]),
        );
        if (
          checkpoint.messages.some(
            (message) =>
              latest.has(message.id) &&
              JSON.stringify(latest.get(message.id)) !==
                JSON.stringify(message),
          )
        )
          throw Object.assign(Error("revision_conflict"), {
            code: "revision_conflict",
          });
        if (
          checkpoint.workspaceId !== previous.workspaceId ||
          checkpoint.workspace !== previous.workspace ||
          (checkpoint.accessMode ?? "auto") !== (previous.accessMode ?? "auto")
        )
          throw Object.assign(Error("revision_conflict"), {
            code: "revision_conflict",
          });
      }
      if (previous?.activeRuntimeRunOwner === "main")
        throw Object.assign(Error("run_active"), { code: "run_active" });
      if (previous && previous.runtimeId !== checkpoint.runtimeId)
        throw Object.assign(Error("revision_conflict"), {
          code: "revision_conflict",
        });
      const saved = await this.write({
        ...checkpoint,
        ...(previous
          ? {
              expectedRevision: previous.revision ?? "1",
              title: previous.title,
            }
          : {}),
      });
      if (
        !saved ||
        saved.id !== checkpoint.id ||
        saved.runtimeId !== checkpoint.runtimeId
      )
        throw Error("invalid_conversation_checkpoint");
      this.record = structuredClone(saved);
      this.profile = checkpoint.profile;
      return saved;
    });
    this.tail = work.catch(() => undefined);
    return work.finally(() => {
      this.pending--;
    });
  }
}
