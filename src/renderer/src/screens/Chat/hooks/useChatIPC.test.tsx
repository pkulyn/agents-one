import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRef, useState } from "react";
import {
  persistedTurnCompletionSignature,
  useChatIPC,
} from "./useChatIPC";
import type { ActiveTurn, ChatMessage, UsageState } from "../types";

type Callback<T extends unknown[]> = (...args: T) => void;

interface ChatIpcCallbacks {
  sessionStarted?: Callback<[string, string]>;
  chunk?: Callback<[string, string]>;
  reasoning?: Callback<[string, string]>;
  done?: Callback<[string, string]>;
  error?: Callback<[string, string]>;
  toolProgress?: Callback<[string, string]>;
  toolEvent?: Callback<[string, unknown]>;
  usage?: Callback<[string, UsageState]>;
}

function installHermesApi(callbacks: ChatIpcCallbacks): {
  getSessionMessages: ReturnType<typeof vi.fn>;
} {
  const getSessionMessages = vi.fn(async (sessionId: string) => {
    if (sessionId === "old-session") {
      return [
        { kind: "user", id: 1, content: "old prompt" },
        { kind: "assistant", id: 2, content: "old answer" },
      ];
    }
    return [];
  });

  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: {
      getSessionMessages,
      onChatSessionStarted: (cb: Callback<[string, string]>) => {
        callbacks.sessionStarted = cb;
        return vi.fn();
      },
      onChatChunk: (cb: Callback<[string, string]>) => {
        callbacks.chunk = cb;
        return vi.fn();
      },
      onChatReasoningChunk: (cb: Callback<[string, string]>) => {
        callbacks.reasoning = cb;
        return vi.fn();
      },
      onChatDone: (cb: Callback<[string, string]>) => {
        callbacks.done = cb;
        return vi.fn();
      },
      onChatError: (cb: Callback<[string, string]>) => {
        callbacks.error = cb;
        return vi.fn();
      },
      onChatToolProgress: (cb: Callback<[string, string]>) => {
        callbacks.toolProgress = cb;
        return vi.fn();
      },
      onChatToolEvent: (cb: Callback<[string, unknown]>) => {
        callbacks.toolEvent = cb;
        return vi.fn();
      },
      onClarifyRequest: vi.fn(() => vi.fn()),
      onChatUsage: (cb: Callback<[string, UsageState]>) => {
        callbacks.usage = cb;
        return vi.fn();
      },
    },
  });

  return { getSessionMessages };
}

function Harness({
  sessionScopeId,
  initialMessages = [],
  initialActiveTurn = null,
}: {
  sessionScopeId: string | null;
  initialMessages?: ChatMessage[];
  initialActiveTurn?: ActiveTurn | null;
}): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [, setHermesSessionId] = useState<string | null>(sessionScopeId);
  const [, setToolProgress] = useState<string | null>(null);
  const [, setIsLoading] = useState(false);
  const [, setUsage] = useState<UsageState | null>(null);
  const activeTurnRef = useRef<ActiveTurn | null>(initialActiveTurn);

  useChatIPC({
    runId: "run-1",
    sessionScopeId,
    messages,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
  });

  return (
    <output data-testid="ids">
      {JSON.stringify(messages.map((message) => message.id))}
      <span data-testid="contents">
        {JSON.stringify(
          messages.map((message) =>
            "content" in message ? message.content : "",
          ),
        )}
      </span>
    </output>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "hermesAPI");
});

describe("useChatIPC session scoping", () => {
  it("does not append the same complete Hermes chunk twice", async () => {
    const callbacks: ChatIpcCallbacks = {};
    installHermesApi(callbacks);
    render(
      <Harness
        sessionScopeId="active-session"
        initialMessages={[
          {
            id: "user-1",
            role: "user",
            content: "Recall marker",
            turnId: "turn-1",
          },
        ]}
        initialActiveTurn={{
          turnId: "turn-1",
          userId: "user-1",
          startIndex: 0,
          status: "running",
        }}
      />,
    );

    await act(async () => {
      callbacks.chunk?.("run-1", "AO-U5-20260717");
      callbacks.chunk?.("run-1", "AO-U5-20260717");
    });

    expect(screen.getByTestId("contents")).toHaveTextContent(
      JSON.stringify(["Recall marker", "AO-U5-20260717"]),
    );
  });

  it("ignores late DB refreshes from an old session after the visible chat is cleared", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    const view = render(<Harness sessionScopeId="old-session" />);

    view.rerender(<Harness sessionScopeId={null} />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).not.toHaveBeenCalled();
    expect(screen.getByTestId("ids")).toHaveTextContent("[]");
  });

  it("accepts DB refreshes for the visible session", async () => {
    const callbacks: ChatIpcCallbacks = {};
    const api = installHermesApi(callbacks);
    render(<Harness sessionScopeId="old-session" />);

    await act(async () => {
      callbacks.done?.("run-1", "old-session");
    });

    expect(api.getSessionMessages).toHaveBeenCalledWith("old-session");
    expect(screen.getByTestId("ids")).toHaveTextContent(
      JSON.stringify(["db-1", "db-2"]),
    );
  });
});

describe("persistedTurnCompletionSignature", () => {
  const activeTurn: ActiveTurn = {
    turnId: "turn-2",
    userId: "user-2",
    startIndex: 2,
    status: "running",
  };

  it("recognizes an attachment turn persisted with a file wrapper", () => {
    const current: ChatMessage[] = [
      { id: "user-2", role: "user", content: "读取附件", turnId: "turn-2" },
    ];
    const persisted: ChatMessage[] = [
      {
        id: "db-1",
        role: "user",
        content: '读取附件\n<file name="fixture.txt">AO-U5-20260717</file>',
      },
      { id: "db-2", role: "agent", content: "AO-U5-20260717" },
    ];

    expect(
      persistedTurnCompletionSignature(current, persisted, activeTurn),
    ).toContain("AO-U5-20260717".toLocaleLowerCase());
  });

  it("does not complete from an older identical prompt occurrence", () => {
    const current: ChatMessage[] = [
      { id: "db-old-u", role: "user", content: "继续" },
      { id: "db-old-a", role: "agent", content: "旧答复" },
      { id: "user-2", role: "user", content: "继续", turnId: "turn-2" },
    ];
    const persisted: ChatMessage[] = [
      { id: "db-1", role: "user", content: "继续" },
      { id: "db-2", role: "agent", content: "旧答复" },
    ];

    expect(
      persistedTurnCompletionSignature(current, persisted, activeTurn),
    ).toBeNull();
  });

  it("does not complete while tool activity trails the assistant bubble", () => {
    const current: ChatMessage[] = [
      { id: "user-2", role: "user", content: "检查项目", turnId: "turn-2" },
    ];
    const persisted: ChatMessage[] = [
      { id: "db-1", role: "user", content: "检查项目" },
      { id: "db-2", role: "agent", content: "我先检查。" },
      {
        id: "db-tc-3-call",
        kind: "tool_call",
        role: "agent",
        callId: "call",
        name: "terminal",
        args: "pwd",
      },
    ];

    expect(
      persistedTurnCompletionSignature(current, persisted, activeTurn),
    ).toBeNull();
  });
});
