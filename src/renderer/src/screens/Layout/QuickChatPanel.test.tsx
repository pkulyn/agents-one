import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type { QuickChatConversation } from "../../../../shared/runtime-conversations";
import { t as translate } from "../../../../shared/i18n";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    locale: "en",
    setLocale: vi.fn(),
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, "en", options),
  }),
}));

vi.mock("../../components/AgentMarkdown", () => ({
  AgentMarkdown: ({ children }: { children: string }) => <>{children}</>,
}));

import QuickChatPanel from "./QuickChatPanel";

const runtime: AgentRuntimeDefinition = {
  id: "codex-local",
  name: "Codex",
  kind: "codex",
  location: "local",
  enabled: true,
  managed: "user",
  config: { transport: "cli" },
};

const existingChat: QuickChatConversation = {
  id: "quick-chat-1",
  title: "Release review",
  runtimeId: runtime.id,
  runtimeName: runtime.name,
  runtimeSessionId: null,
  createdAt: 1,
  updatedAt: 2,
  messages: [
    { id: "message-1", role: "user", content: "Review it", createdAt: 1 },
    { id: "message-2", role: "agent", content: "Ready", createdAt: 2 },
  ],
};

describe("QuickChatPanel", () => {
  const startAgentRuntimeTask = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    startAgentRuntimeTask.mockReset().mockResolvedValue({
      id: "runtime-run-1",
      runtimeId: runtime.id,
      status: "succeeded",
      output: "Done",
      startedAt: 3,
      finishedAt: 4,
    });
    Object.defineProperty(window, "agentsOneAPI", {
      configurable: true,
      value: {
        listQuickChats: vi.fn().mockResolvedValue([existingChat]),
        saveQuickChats: vi.fn().mockResolvedValue(undefined),
        startAgentRuntimeTask,
        getAgentRuntimeRun: vi.fn().mockResolvedValue({
          id: "runtime-run-1",
          runtimeId: runtime.id,
          status: "succeeded",
          output: "Done",
          startedAt: 3,
          finishedAt: 4,
        }),
        cancelAgentRuntimeTask: vi.fn().mockResolvedValue(true),
        abortChat: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("renders English controls and sends English conversation context", async () => {
    render(
      <QuickChatPanel
        open
        runtimes={[runtime]}
        defaultRuntimeId={runtime.id}
        profile="default"
        currentTaskTitle="Open-source release"
        onClose={() => undefined}
        onAddToTask={() => undefined}
      />,
    );

    expect(await screen.findByLabelText("Quick chat")).toBeInTheDocument();
    expect(screen.getByText("Current task: Open-source release")).toBeVisible();
    expect(screen.getByRole("option", { name: "Codex / Local" })).toBeVisible();

    const input = screen.getByPlaceholderText("Message Codex");
    fireEvent.change(input, { target: { value: "Continue the review" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(startAgentRuntimeTask).toHaveBeenCalledTimes(1));
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "Here is the recent context from this quick chat.",
    );
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "User: Review it",
    );
    expect(startAgentRuntimeTask.mock.calls[0][1].prompt).toContain(
      "Current user message: Continue the review",
    );
  });
});
