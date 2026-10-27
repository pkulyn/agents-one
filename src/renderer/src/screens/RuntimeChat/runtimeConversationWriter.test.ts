import { describe, expect, it, vi } from "vitest";
import { RuntimeConversationWriter } from "./runtimeConversationWriter";
import type {
  RuntimeConversation,
  SaveRuntimeConversationInput,
} from "../../../../shared/runtime-conversations";
const record = (revision = "1"): RuntimeConversation => ({
  id: "conversation-1",
  runtimeId: "runtime-1",
  runtimeName: "Original runtime",
  runtimeKind: "codex",
  runtimeLocation: "local",
  title: "User managed title",
  revision,
  createdAt: 1,
  updatedAt: 2,
  messages: [],
  messageCount: 0,
});
const input = (
  changes: Partial<SaveRuntimeConversationInput> = {},
): SaveRuntimeConversationInput => ({
  ...record(),
  profile: "owner",
  title: "First user message",
  messages: [
    { id: "user-1", role: "user", content: "New request", createdAt: 3 },
  ],
  ...changes,
});
describe("Runtime conversation Renderer writer", () => {
  it("refuses changed initial content and preserves an existing-record version requirement when its source was deleted", async () => {
    const write = vi.fn(async (_input: SaveRuntimeConversationInput) =>
      record("3"),
    );
    const source = {
      ...record("2"),
      messages: [
        {
          id: "user-1",
          role: "user" as const,
          content: "Updated canonical content",
          createdAt: 3,
        },
      ],
    };
    const writer = new RuntimeConversationWriter(
      vi.fn(async () => source),
      write,
    );
    await expect(writer.save(input())).rejects.toThrow("revision_conflict");
    expect(write).not.toHaveBeenCalled();
    const deleted = new RuntimeConversationWriter(
      vi.fn(async () => null),
      write,
    );
    await deleted.save(input({ expectedRevision: "1" }));
    expect(write.mock.calls[0][0].expectedRevision).toBe("1");
  });
  it("serializes native session and final saves, freezes message input and carries the returned original revision", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = vi.fn(async (next: SaveRuntimeConversationInput) => {
      if (write.mock.calls.length === 1) await gate;
      return {
        ...record(String(BigInt(next.expectedRevision!) + 1n)),
        ...next,
        activeRuntimeRunId: next.activeRuntimeRunId || undefined,
        activeRuntimeRunOwner:
          next.activeRuntimeRunOwner === "main" ? ("main" as const) : undefined,
        revision: String(BigInt(next.expectedRevision!) + 1n),
      };
    });
    const writer = new RuntimeConversationWriter(vi.fn(), write);
    writer.observe(record(), "owner");
    const firstInput = input();
    const first = writer.save(firstInput);
    firstInput.messages[0].content = "Mutated after checkpoint";
    const final = writer.save(input({ activeRuntimeRunId: null }));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(writer.observe(record("99"), "owner")).toBe(false);
    release();
    await Promise.all([first, final]);
    expect(write.mock.calls.map(([value]) => value.expectedRevision)).toEqual([
      "1",
      "2",
    ]);
    expect(write.mock.calls[0][0].messages[0].content).toBe("New request");
    expect(write.mock.calls[1][0].title).toBe("User managed title");
    expect(writer.observe(record("1"), "owner")).toBe(false);
  });
  it("does not rebase a stale checkpoint onto a mobile revision or retry the write after a conflict", async () => {
    const write = vi.fn().mockRejectedValueOnce(
      Object.assign(Error("revision_conflict"), {
        code: "revision_conflict",
      }),
    );
    const writer = new RuntimeConversationWriter(vi.fn(), write);
    writer.observe(record("4"), "owner");
    await expect(writer.save(input())).rejects.toThrow("revision_conflict");
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].expectedRevision).toBe("4");
    expect(writer.observe(record("5"), "owner")).toBe(true);
  });
  it("reads the target profile again instead of borrowing a same-ID baseline from another profile", async () => {
    const read = vi.fn(async () => record("7"));
    const write = vi.fn(async (_input: SaveRuntimeConversationInput) =>
      record("8"),
    );
    const writer = new RuntimeConversationWriter(read, write);
    writer.observe(record("3"), "another-owner");
    await writer.save(input());
    expect(read).toHaveBeenCalledWith("conversation-1", "owner");
    expect(write.mock.calls[0][0]).toMatchObject({
      profile: "owner",
      expectedRevision: "7",
    });
  });
  it("refuses Renderer writes to a Main-owned task and rejects changed original Runtime identity", async () => {
    const write = vi.fn();
    const writer = new RuntimeConversationWriter(vi.fn(), write);
    writer.observe(
      {
        ...record(),
        activeRuntimeRunId: "run-1",
        activeRuntimeRunOwner: "main",
      },
      "owner",
    );
    await expect(writer.save(input())).rejects.toThrow("run_active");
    writer.observe({ ...record("2"), runtimeId: "another-runtime" }, "owner");
    await expect(writer.save(input())).rejects.toThrow("revision_conflict");
    expect(write).not.toHaveBeenCalled();
  });
});
