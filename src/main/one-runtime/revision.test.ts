import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  oneDefinitionRevision,
  oneRunSnapshotHash,
  persistOneRunBinding,
  reconcileOneSessionBinding,
  verifyOneSessionBinding,
  commitOneRunBinding,
  reconcileEarlierOneBindings,
} from "./revision";

describe("One definition and run bindings", () => {
  it("distinguishes an unflushed binding from a persisted session message", async () => {
    const root = mkdtempSync(join(tmpdir(), "one-reconcile-"));
    try {
      const file = join(root, "session.jsonl");
      const expected = {
        sessionId: "session",
        runId: "run",
        definitionRevision: "a".repeat(64),
        snapshotHash: "b".repeat(64),
      };
      expect(await reconcileOneSessionBinding(file, expected)).toBe("missing");
      const header = { type: "session", id: "session" };
      const custom = {
        type: "custom",
        id: "binding",
        parentId: null,
        customType: "agents-one-run-binding-v1",
        data: {
          runId: "run",
          definitionRevision: expected.definitionRevision,
          snapshotHash: expected.snapshotHash,
        },
      };
      const save = (entries: unknown[]) =>
        writeFileSync(
          file,
          entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
        );
      save([header, custom]);
      expect(await reconcileOneSessionBinding(file, expected)).toBe("missing");
      save([
        header,
        custom,
        {
          type: "custom",
          id: "later",
          parentId: "binding",
          customType: "agents-one-run-binding-v1",
          data: { ...custom.data, runId: "later-run" },
        },
        {
          type: "message",
          id: "later-user",
          parentId: "later",
          message: { role: "user", content: "later" },
        },
      ]);
      expect(await reconcileOneSessionBinding(file, expected)).toBe("missing");
      save([
        header,
        custom,
        {
          type: "message",
          id: "user",
          parentId: "binding",
          message: { role: "user", content: "hello" },
        },
      ]);
      expect(await reconcileOneSessionBinding(file, expected)).toBe(
        "committed",
      );
      expect(await verifyOneSessionBinding(root, file, expected)).toBe(false);
      mkdirSync(join(root, "sessions"));
      const sessionFile = join(root, "sessions", "session.jsonl");
      copyFileSync(file, sessionFile);
      expect(await verifyOneSessionBinding(root, sessionFile, expected)).toBe(
        true,
      );
      persistOneRunBinding(root, { agentId: "one", ...expected });
      expect(
        await reconcileEarlierOneBindings(
          root,
          "one",
          "session",
          sessionFile,
          "later-run",
        ),
      ).toBe(1);
      expect(
        await reconcileEarlierOneBindings(
          root,
          "one",
          "session",
          sessionFile,
          "later-run",
        ),
      ).toBe(0);
      const recoveryDir = join(root, "run-bindings");
      const receiptName = readdirSync(recoveryDir).find((name) =>
        name.endsWith(".session.json"),
      );
      expect(
        JSON.parse(readFileSync(join(recoveryDir, receiptName!), "utf8")),
      ).toMatchObject({ status: "session-persisted", runId: "run" });
      expect(
        readdirSync(recoveryDir).some((name) =>
          name.endsWith(".committed.json"),
        ),
      ).toBe(false);
      expect(
        await reconcileOneSessionBinding(file, {
          ...expected,
          snapshotHash: "c".repeat(64),
        }),
      ).toBe("mismatch");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("records immutable prepared bindings without storing instruction or memory contents", () => {
    const root = mkdtempSync(join(tmpdir(), "one-revision-"));
    try {
      const definition = {
        instructions: "private instruction",
        skillIds: ["skill"],
        skillInstructions: ["private skill"],
        endpoint: "https://example.test/v1",
        defaultModel: "model",
        imageInput: false,
        memoryEnabled: true,
      };
      const revision = oneDefinitionRevision(definition);
      expect(oneDefinitionRevision(definition)).toBe(revision);
      expect(
        oneDefinitionRevision({ ...definition, instructions: "changed" }),
      ).not.toBe(revision);
      expect(
        oneDefinitionRevision({
          ...definition,
          skillInstructions: ["changed"],
        }),
      ).not.toBe(revision);
      const snapshotHash = oneRunSnapshotHash({
        definitionRevision: revision,
        modelId: "model",
        mode: "analysis",
        workspace: root,
        memory: "private memory",
      });
      const binding = {
        agentId: "one",
        runId: "run-1",
        sessionId: "session-1",
        conversationId: "conversation-1",
        definitionRevision: revision,
        snapshotHash,
      };
      persistOneRunBinding(root, binding);
      persistOneRunBinding(root, binding);
      commitOneRunBinding(root, binding.runId);
      commitOneRunBinding(root, binding.runId);
      expect(() =>
        persistOneRunBinding(root, { ...binding, sessionId: "other" }),
      ).toThrow();
      const dir = join(root, "run-bindings");
      const text = readFileSync(
        join(
          dir,
          readdirSync(dir).find((name) => !name.endsWith(".committed.json"))!,
        ),
        "utf8",
      );
      expect(JSON.parse(text)).toMatchObject({
        status: "prepared",
        ...binding,
      });
      expect(text).not.toContain("private");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
