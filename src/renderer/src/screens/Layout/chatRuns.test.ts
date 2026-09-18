import { describe, expect, it, vi } from "vitest";
import {
  cycleRunId,
  findTaskCollaborationForConversation,
  isBlankTaskRun,
  isScratchRun,
  mintRun,
  openNewTaskRunTransition,
  openSessionRunTransition,
  runIdAtOrdinal,
  selectProfileRunTransition,
  usesLegacyHermesChat,
  type ChatRun,
} from "./chatRuns";

function run(
  runId: string,
  profile: string,
  patch: Partial<ChatRun> = {},
): ChatRun {
  return {
    runId,
    profile,
    sessionId: null,
    loading: false,
    ...patch,
  };
}

describe("chat run profile transitions", () => {
  it("finds collaboration metadata by linked conversation before legacy task id", () => {
    const base = {
      title: "协作任务",
      assignments: [],
      status: "active" as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const linked = {
      ...base,
      taskId: "run-parent",
      conversationId: "runtime-conversation",
    };
    const legacy = { ...base, taskId: "legacy-conversation" };
    const recovered = {
      ...base,
      taskId: "run-before-link",
      execution: {
        status: "succeeded" as const,
        updatedAt: 3,
        roleRuns: [
          {
            assignmentId: "review",
            role: "复核",
            status: "succeeded" as const,
            runtimeRunId: "runtime-run-review",
          },
        ],
      },
    };

    expect(
      findTaskCollaborationForConversation(
        [legacy, linked],
        "runtime-conversation",
      ),
    ).toBe(linked);
    expect(
      findTaskCollaborationForConversation(
        [legacy, linked, recovered],
        "legacy-conversation",
      ),
    ).toBe(legacy);
    expect(
      findTaskCollaborationForConversation(
        [legacy, linked, recovered],
        "unlinked-conversation",
        [
          {
            id: "review-answer",
            role: "agent",
            content: "验收完成",
            createdAt: 3,
            execution: { runId: "runtime-run-review", events: [] },
          },
        ],
      ),
    ).toBe(recovered);
  });

  it("keeps a custom remote Hermes on its own Runtime conversation", () => {
    expect(
      usesLegacyHermesChat({
        id: "hers-family",
        name: "Hers",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "user",
        config: { endpoint: "https://relay.example/agents-one/v1" },
      }),
    ).toBe(false);
    expect(
      usesLegacyHermesChat({
        id: "hermes-remote",
        name: "Hermes",
        kind: "hermes",
        location: "remote",
        enabled: true,
        managed: "builtin",
        config: {},
      }),
    ).toBe(false);
    expect(
      usesLegacyHermesChat({
        id: "hermes-local",
        name: "Hermes",
        kind: "hermes",
        location: "local",
        enabled: true,
        managed: "builtin",
        config: {},
      }),
    ).toBe(true);
  });

  it("re-homes a scratch run when switching profiles", () => {
    const runs = [run("run-a", "kitt")];

    const next = selectProfileRunTransition(runs, "run-a", "alfie");

    expect(next.activeRunId).toBe("run-a");
    expect(next.runs).toEqual([{ ...runs[0], profile: "alfie" }]);
  });

  it("activates an existing scratch run for the selected profile", () => {
    const runs = [
      run("run-kitt", "kitt", { sessionId: "session-kitt" }),
      run("run-alfie", "alfie"),
    ];

    const next = selectProfileRunTransition(runs, "run-kitt", "alfie");

    expect(next.activeRunId).toBe("run-alfie");
    expect(next.runs).toBe(runs);
  });

  it("creates a scratch run instead of showing an old-profile chat", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000001");
    const runs = [run("run-kitt", "kitt", { sessionId: "session-kitt" })];

    const next = selectProfileRunTransition(runs, "run-kitt", "alfie");

    expect(next.activeRunId).toBe("run-00000000-0000-4000-8000-000000000001");
    expect(next.runs).toEqual([
      runs[0],
      {
        runId: "run-00000000-0000-4000-8000-000000000001",
        profile: "alfie",
        sessionId: null,
        loading: false,
      },
    ]);
    randomUUID.mockRestore();
  });

  it("recognizes only blank unused runs as scratch", () => {
    expect(isScratchRun(run("blank", "alfie"))).toBe(true);
    expect(isScratchRun(run("session", "alfie", { sessionId: "s1" }))).toBe(
      false,
    );
    expect(isScratchRun(run("loading", "alfie", { loading: true }))).toBe(
      false,
    );
    expect(isScratchRun(run("titled", "alfie", { title: "hello" }))).toBe(
      false,
    );
  });

  it("recognizes unused Runtime and Hermes tabs as blank task placeholders", () => {
    expect(isBlankTaskRun(run("hermes-blank", "default"))).toBe(true);
    expect(
      isBlankTaskRun(
        run("pi-blank", "default", {
          runtimeId: "pi",
          runtimeName: "Pi",
          runtimeKind: "pi",
        }),
      ),
    ).toBe(true);
    expect(
      isBlankTaskRun(
        run("pi-history", "default", {
          runtimeId: "pi",
          runtimeConversationId: "conversation-pi",
        }),
      ),
    ).toBe(false);
  });

  it("mints runs under the requested profile", () => {
    const randomUUID = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");

    expect(mintRun("alfie")).toEqual({
      runId: "run-00000000-0000-4000-8000-000000000002",
      profile: "alfie",
      sessionId: null,
      loading: false,
      seed: undefined,
    });
    randomUUID.mockRestore();
  });

  it("replaces the active same-profile scratch run when opening a session", () => {
    const scratch = run("run-scratch", "test-writer");
    const saved = run("run-saved", "test-writer", {
      sessionId: "session-saved",
      title: "ok my bro",
    });

    const next = openSessionRunTransition(
      [run("run-old", "default", { sessionId: "session-old" }), scratch],
      "run-scratch",
      saved,
    );

    expect(next.activeRunId).toBe("run-saved");
    expect(next.runs).toEqual([
      run("run-old", "default", { sessionId: "session-old" }),
      saved,
    ]);
  });

  it("appends a saved session when the active run is not a scratch placeholder", () => {
    const active = run("run-active", "test-writer", {
      sessionId: "session-active",
      title: "existing",
    });
    const saved = run("run-saved", "test-writer", {
      sessionId: "session-saved",
      title: "ok my bro",
    });

    const next = openSessionRunTransition([active], "run-active", saved);

    expect(next.activeRunId).toBe("run-saved");
    expect(next.runs).toEqual([active, saved]);
  });

  it("replaces the unused Hermes placeholder with the default Runtime task", () => {
    const placeholder = run("run-hermes-placeholder", "default");
    const runtimeTask = run("run-pi", "default", {
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
    });

    const next = openNewTaskRunTransition(
      [placeholder],
      placeholder.runId,
      runtimeTask,
    );

    expect(next.activeRunId).toBe("run-pi");
    expect(next.runs).toEqual([runtimeTask]);
  });

  it("preserves an existing task when opening a new default Runtime task", () => {
    const active = run("run-existing", "default", {
      sessionId: "session-existing",
      title: "已有任务",
    });
    const runtimeTask = run("run-pi", "default", {
      runtimeId: "pi",
      runtimeName: "Pi",
      runtimeKind: "pi",
    });

    const next = openNewTaskRunTransition([active], active.runId, runtimeTask);

    expect(next.activeRunId).toBe("run-pi");
    expect(next.runs).toEqual([active, runtimeTask]);
  });
});

describe("chrome-style tab shortcuts", () => {
  const three = [run("run-1", "a"), run("run-2", "b"), run("run-3", "c")];

  it("cycles forward and backward with wrap-around", () => {
    expect(cycleRunId(three, "run-1", 1)).toBe("run-2");
    expect(cycleRunId(three, "run-3", 1)).toBe("run-1");
    expect(cycleRunId(three, "run-1", -1)).toBe("run-3");
    expect(cycleRunId(three, "run-2", -1)).toBe("run-1");
  });

  it("returns null when there is nothing to cycle to", () => {
    expect(cycleRunId([], "run-x", 1)).toBeNull();
    expect(cycleRunId([run("run-1", "a")], "run-1", 1)).toBeNull();
  });

  it("falls back to the first run when the active id is unknown", () => {
    expect(cycleRunId(three, "run-gone", 1)).toBe("run-1");
  });

  it("selects the Nth tab by ordinal", () => {
    expect(runIdAtOrdinal(three, 1)).toBe("run-1");
    expect(runIdAtOrdinal(three, 3)).toBe("run-3");
  });

  it("maps 9 to the last tab regardless of count", () => {
    expect(runIdAtOrdinal(three, 9)).toBe("run-3");
    expect(runIdAtOrdinal([run("run-only", "a")], 9)).toBe("run-only");
  });

  it("returns null for ordinals without a tab", () => {
    expect(runIdAtOrdinal(three, 4)).toBeNull();
    expect(runIdAtOrdinal([], 1)).toBeNull();
    expect(runIdAtOrdinal([], 9)).toBeNull();
  });
});
