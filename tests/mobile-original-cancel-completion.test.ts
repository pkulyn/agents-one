import { expect, it, vi } from "vitest";
import { completeOriginalCancelledRun } from "../src/main/mobile-control/original-cancel-completion";
import type { AgentRuntimeRun } from "../src/shared/agent-runtimes";
import type { RuntimeConversation } from "../src/shared/runtime-conversations";

const run = {
  id: "run-one",
  runtimeId: "runtime-one",
  status: "cancelled",
  startedAt: 100,
  completedAt: 200,
  sessionId: "native-session",
  output: "",
  events: [{ type: "cancelled", timestamp: 200, message: "cancelled" }],
} as AgentRuntimeRun;
const conversation = {
  id: "original",
  runtimeId: "runtime-one",
  activeRuntimeRunId: "run-one",
  messages: [{ id: "user-one", role: "user", content: "Wait", createdAt: 100 }],
} as RuntimeConversation;

// @lat: [[mobile-data#Mobile data#Original Native cancellation history completion]]
it("commits the observed Native cancellation with real event and session identity and no model context for the platform notice", () => {
  const finish = vi.fn();
  completeOriginalCancelledRun(run, [conversation], finish);
  expect(finish).toHaveBeenCalledExactlyOnceWith(
    "original",
    "run-one",
    expect.objectContaining({
      id: "run-one-result",
      role: "system",
      content: "任务已取消。",
      createdAt: 200,
      meta: {
        audience: ["user", "audit"],
        origin: "platform",
        persistence: "durable",
      },
      execution: {
        runId: "run-one",
        startedAt: 100,
        completedAt: 200,
        events: run.events,
      },
    }),
    "native-session",
  );
});

// @lat: [[mobile-data#Mobile data#Original cancellation completion admission]]
it("refuses acknowledgement-only, unrelated, Main-owned and ambiguous histories and preserves an existing Renderer final", () => {
  const finish = vi.fn();
  for (const status of ["running", "succeeded", "failed", "timed_out"] as const)
    completeOriginalCancelledRun({ ...run, status }, [conversation], finish);
  for (const source of [
    { ...conversation, activeRuntimeRunId: "other" },
    { ...conversation, runtimeId: "other" },
    { ...conversation, activeRuntimeRunOwner: "main" as const },
    {
      ...conversation,
      messages: [
        {
          id: "desktop-result",
          role: "system" as const,
          content: "Desktop cancellation",
          createdAt: 200,
          execution: { runId: run.id, events: [] },
        },
      ],
    },
  ])
    completeOriginalCancelledRun(run, [source], finish);
  completeOriginalCancelledRun(
    run,
    [conversation, { ...conversation, id: "branch" }],
    finish,
  );
  completeOriginalCancelledRun(run, [], finish);
  expect(finish).not.toHaveBeenCalled();
});

// @lat: [[mobile-data#Mobile data#Original cancellation result fidelity and failure]]
it("preserves a real reply and Native execution metadata and propagates persistence failures", () => {
  const finish = vi.fn(() => {
    throw Error("disk_unavailable");
  });
  const native = {
    ...run,
    output: "Visible partial reply",
    artifacts: [],
    usage: { inputTokens: 12 },
  } as AgentRuntimeRun;
  expect(() =>
    completeOriginalCancelledRun(native, [conversation], finish),
  ).toThrow("disk_unavailable");
  expect(finish.mock.calls[0][2]).toMatchObject({
    role: "agent",
    content: "Visible partial reply",
    execution: { usage: native.usage },
  });
});
