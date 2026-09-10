import { useCallback, useEffect, useRef } from "react";
import { isBubbleMessage, markActiveTurnFailed } from "../chatMessages";
import type {
  ActiveTurn,
  ChatBubbleMessage,
  ChatMessage,
  UsageState,
} from "../types";
import {
  dbItemsToChatMessages,
  reconcileAfterDbRefresh,
  type DbHistoryItem,
} from "../sessionHistory";
import {
  liveToolEventFromProgress,
  upsertLiveToolEvent,
} from "../liveToolEvents";
import { upsertLiveReasoningChunk } from "../liveReasoningEvents";

interface UseChatIPCArgs {
  /** This conversation's run id. Events tagged with a different runId belong
   *  to another mounted/background chat and are ignored. */
  runId: string;
  /** The session currently visible in this Chat, if already known. */
  sessionScopeId: string | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHermesSessionId: (id: string) => void;
  setToolProgress: (tool: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setUsage: React.Dispatch<React.SetStateAction<UsageState | null>>;
  activeTurnRef: React.MutableRefObject<ActiveTurn | null>;
}

function normalizedPersistedTurnText(text: string): string {
  return text
    .replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Return a stable signature only when the persisted transcript contains the
 * active user occurrence followed by a final assistant bubble. Tool rows after
 * that bubble keep the turn active, preventing an intermediate tool preamble
 * from being mistaken for completion.
 */
export function persistedTurnCompletionSignature(
  current: ReadonlyArray<ChatMessage>,
  persisted: ReadonlyArray<ChatMessage>,
  activeTurn: ActiveTurn | null | undefined,
): string | null {
  if (!activeTurn || activeTurn.status !== "running") return null;
  const activeUserIndex = current.findIndex(
    (message) =>
      isBubbleMessage(message) &&
      message.role === "user" &&
      (message.id === activeTurn.userId ||
        message.turnId === activeTurn.turnId),
  );
  if (activeUserIndex < 0) return null;

  const activeUser = current[activeUserIndex];
  if (!isBubbleMessage(activeUser)) return null;
  const userKey = normalizedPersistedTurnText(activeUser.content);
  if (!userKey) return null;

  const expectedOccurrence = current
    .slice(0, activeUserIndex + 1)
    .filter(
      (message) =>
        isBubbleMessage(message) &&
        message.role === "user" &&
        normalizedPersistedTurnText(message.content) === userKey,
    ).length;
  const persistedUserIndexes = persisted
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        isBubbleMessage(message) &&
        message.role === "user" &&
        normalizedPersistedTurnText(message.content) === userKey,
    )
    .map(({ index }) => index);
  if (persistedUserIndexes.length < expectedOccurrence) return null;

  const persistedUserIndex = persistedUserIndexes[expectedOccurrence - 1];
  let finalAssistant: ChatBubbleMessage | null = null;
  let finalAssistantIndex = -1;
  for (let index = persistedUserIndex + 1; index < persisted.length; index++) {
    const message = persisted[index];
    if (isBubbleMessage(message) && message.role === "user") return null;
    if (
      isBubbleMessage(message) &&
      message.role === "agent" &&
      !message.error &&
      normalizedPersistedTurnText(message.content)
    ) {
      finalAssistant = message;
      finalAssistantIndex = index;
    }
  }
  if (!finalAssistant) return null;

  const hasTrailingToolActivity = persisted
    .slice(finalAssistantIndex + 1)
    .some(
      (message) =>
        message.kind === "tool_call" || message.kind === "tool_result",
    );
  if (hasTrailingToolActivity) return null;

  return `${finalAssistant.id}:${normalizedPersistedTurnText(finalAssistant.content)}`;
}

/**
 * True when an incoming event belongs to this conversation. Multiple chats run
 * concurrently and share the same global IPC channels, so each listener must
 * drop events whose runId isn't ours.
 */
export function eventMatchesRun(eventRunId: string, ownRunId: string): boolean {
  return eventRunId === ownRunId;
}

/**
 * Registers all chat-related IPC listeners once and tears them down on unmount.
 *
 * The dashboard/gateway is the canonical event source where possible; the
 * polling refresh bridges persisted DB rows that the streaming API still omits
 * today, especially reasoning and tool result rows.
 */
export function useChatIPC({
  runId,
  sessionScopeId,
  messages,
  setMessages,
  setHermesSessionId,
  setToolProgress,
  setIsLoading,
  setUsage,
  activeTurnRef,
}: UseChatIPCArgs): void {
  const reasoningSegmentClosedRef = useRef(false);
  const dbPollRef = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const dbPollInFlightRef = useRef(false);
  const acceptedSessionIdRef = useRef<string | null>(sessionScopeId);
  const messagesRef = useRef(messages);
  const persistedCompletionRef = useRef<{
    turnId: string;
    signature: string;
    confirmations: number;
  } | null>(null);
  messagesRef.current = messages;

  const stopDbPolling = useCallback((): void => {
    if (dbPollRef.current !== null) {
      window.clearInterval(dbPollRef.current);
      dbPollRef.current = null;
    }
    dbPollInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (sessionScopeId === acceptedSessionIdRef.current) return;
    acceptedSessionIdRef.current = sessionScopeId;
    reasoningSegmentClosedRef.current = false;
    persistedCompletionRef.current = null;
    stopDbPolling();
  }, [sessionScopeId, stopDbPolling]);

  useEffect(() => {
    let disposed = false;

    const refreshFromDb = async (sessionId: string): Promise<void> => {
      if (
        !sessionId ||
        disposed ||
        dbPollInFlightRef.current ||
        acceptedSessionIdRef.current !== sessionId
      ) {
        return;
      }
      dbPollInFlightRef.current = true;
      const activeTurn = activeTurnRef.current ?? undefined;
      try {
        const items = (await window.agentsOneAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        if (
          disposed ||
          acceptedSessionIdRef.current !== sessionId ||
          items.length === 0
        ) {
          return;
        }
        const dbMessages = dbItemsToChatMessages(items);
        if (dbMessages.length === 0) return;
        const completionSignature = persistedTurnCompletionSignature(
          messagesRef.current,
          dbMessages,
          activeTurn,
        );
        setMessages((prev) => {
          const next = reconcileAfterDbRefresh(prev, dbMessages, {
            activeTurn,
          });
          messagesRef.current = next;
          return next;
        });

        if (
          completionSignature &&
          activeTurn &&
          activeTurnRef.current === activeTurn
        ) {
          const previous = persistedCompletionRef.current;
          const nextConfirmation =
            previous?.turnId === activeTurn.turnId &&
            previous.signature === completionSignature
              ? previous.confirmations + 1
              : 1;
          persistedCompletionRef.current = {
            turnId: activeTurn.turnId,
            signature: completionSignature,
            confirmations: nextConfirmation,
          };
          if (nextConfirmation >= 2) {
            activeTurn.status = "completed";
            activeTurnRef.current = null;
            persistedCompletionRef.current = null;
            stopDbPolling();
            setToolProgress(null);
            setIsLoading(false);
          }
        } else {
          persistedCompletionRef.current = null;
        }
      } catch {
        // Mid-stream DB refresh is opportunistic; final refresh still runs.
      } finally {
        dbPollInFlightRef.current = false;
      }
    };

    const startDbPolling = (sessionId: string): void => {
      stopDbPolling();
      void refreshFromDb(sessionId);
      dbPollRef.current = window.setInterval(() => {
        void refreshFromDb(sessionId);
      }, 750);
    };

    const cleanupSessionStarted = window.agentsOneAPI.onChatSessionStarted(
      (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId) || !sessionId) return;
        acceptedSessionIdRef.current = sessionId;
        persistedCompletionRef.current = null;
        setHermesSessionId(sessionId);
        startDbPolling(sessionId);
      },
    );

    const cleanupChunk = window.agentsOneAPI.onChatChunk(
      (eventRunId, chunk) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        persistedCompletionRef.current = null;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (
            last &&
            last.role === "agent" &&
            isBubbleMessage(last) &&
            !last.error
          ) {
            if (chunk === last.content) return prev;
            const nextContent = chunk.startsWith(last.content)
              ? chunk
              : last.content + chunk;
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: nextContent,
                pending: true,
                turnId: last.turnId || activeTurnRef.current?.turnId,
              },
            ];
          }
          if (!chunk || !chunk.trim()) return prev;
          return [
            ...prev,
            {
              id: `agent-${Date.now()}`,
              role: "agent",
              content: chunk,
              pending: true,
              ...(activeTurnRef.current?.turnId
                ? { turnId: activeTurnRef.current.turnId }
                : {}),
            },
          ];
        });
      },
    );

    const cleanupReasoning = window.agentsOneAPI.onChatReasoningChunk(
      (eventRunId, chunk) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        if (!chunk) return;
        persistedCompletionRef.current = null;
        const forceNewSegment = reasoningSegmentClosedRef.current;
        reasoningSegmentClosedRef.current = false;
        persistedCompletionRef.current = null;
        setMessages((prev) =>
          upsertLiveReasoningChunk(prev, chunk, Date.now(), forceNewSegment),
        );
      },
    );

    const cleanupDone = window.agentsOneAPI.onChatDone(
      async (eventRunId, sessionId) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = false;
        stopDbPolling();
        const activeTurn = activeTurnRef.current;
        const acceptedSessionId = acceptedSessionIdRef.current;
        if (sessionId && acceptedSessionId && acceptedSessionId !== sessionId) {
          return;
        }
        if (sessionId && !acceptedSessionId && !activeTurn) {
          return;
        }
        if (sessionId) {
          acceptedSessionIdRef.current = sessionId;
          setHermesSessionId(sessionId);
        }
        if (!sessionId || activeTurn?.status === "failed") {
          activeTurnRef.current = null;
          setToolProgress(null);
          setIsLoading(false);
          return;
        }
        try {
          const items = (await window.agentsOneAPI.getSessionMessages(
            sessionId,
          )) as DbHistoryItem[];
          const dbMessages = dbItemsToChatMessages(items);
          if (dbMessages.length > 0) {
            setMessages((prev) =>
              reconcileAfterDbRefresh(prev, dbMessages, { activeTurn }),
            );
          }
          if (activeTurn) activeTurn.status = "completed";
        } catch {
          // Merge is a UX nicety; do not break chat completion on failure.
        } finally {
          setToolProgress(null);
          setIsLoading(false);
          if (activeTurnRef.current === activeTurn) {
            activeTurnRef.current = null;
          }
        }
      },
    );

    const cleanupError = window.agentsOneAPI.onChatError(
      (eventRunId, error) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = false;
        persistedCompletionRef.current = null;
        stopDbPolling();
        const activeTurn = activeTurnRef.current;
        if (!activeTurn) return;
        activeTurn.status = "failed";
        setMessages((prev) => markActiveTurnFailed(prev, error, activeTurn));
        setToolProgress(null);
        setIsLoading(false);
      },
    );

    const cleanupClarify = window.agentsOneAPI.onClarifyRequest(
      (eventRunId, req) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        reasoningSegmentClosedRef.current = true;
        setToolProgress(null);
        setIsLoading(true);
        setMessages((prev) => {
          if (
            prev.some(
              (m) => m.kind === "clarify" && m.requestId === req.requestId,
            )
          ) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `clarify-${req.requestId}`,
              kind: "clarify",
              role: "agent",
              requestId: req.requestId,
              question: req.question,
              choices: Array.isArray(req.choices) ? req.choices : [],
            },
          ];
        });
      },
    );

    const cleanupToolProgress = window.agentsOneAPI.onChatToolProgress(
      (eventRunId, tool) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        persistedCompletionRef.current = null;
        setToolProgress(null);
        if (!tool.trim()) return;
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) =>
          upsertLiveToolEvent(prev, liveToolEventFromProgress(tool)),
        );

        // Also check progress text for URLs, but only if it's a web tool
        const toolEventName =
          liveToolEventFromProgress(tool).name.toLowerCase();
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEventName);

        if (isWebTool) {
          const urlMatch = tool.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const event = new CustomEvent("web-preview:navigate", {
              detail: urlMatch[0],
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupToolEvent = window.agentsOneAPI.onChatToolEvent(
      (eventRunId, toolEvent) => {
        if (!eventMatchesRun(eventRunId, runId)) return;
        if (!activeTurnRef.current) return;
        persistedCompletionRef.current = null;
        setToolProgress(null);
        reasoningSegmentClosedRef.current = true;
        setMessages((prev) => upsertLiveToolEvent(prev, toolEvent));

        // Auto-open webview if the agent is using a browser/web tool to navigate
        const isWebTool = [
          "browser",
          "web",
          "browse",
          "web_search",
          "search_web",
          "computer_use",
          "computer",
        ].includes(toolEvent.name.toLowerCase());
        if (isWebTool) {
          const textToSearch = `${toolEvent.preview || ""} ${toolEvent.result || ""}`;
          const urlMatch = textToSearch.match(/https?:\/\/[^\s)]+/i);
          if (urlMatch) {
            const url = urlMatch[0];
            const event = new CustomEvent("web-preview:navigate", {
              detail: url,
            });
            document.dispatchEvent(event);
          }
        }
      },
    );

    const cleanupUsage = window.agentsOneAPI.onChatUsage((eventRunId, u) => {
      if (!eventMatchesRun(eventRunId, runId)) return;
      setUsage((prev) => ({
        promptTokens: (prev?.promptTokens || 0) + u.promptTokens,
        completionTokens: (prev?.completionTokens || 0) + u.completionTokens,
        totalTokens: (prev?.totalTokens || 0) + u.totalTokens,
        cost: u.cost != null ? (prev?.cost || 0) + u.cost : prev?.cost,
        contextTokens: u.promptTokens || prev?.contextTokens,
        cacheReadTokens: u.cacheReadTokens ?? prev?.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens ?? prev?.cacheWriteTokens,
      }));
    });

    return () => {
      disposed = true;
      stopDbPolling();
      cleanupSessionStarted();
      cleanupChunk();
      cleanupReasoning();
      cleanupDone();
      cleanupError();
      cleanupClarify();
      cleanupToolProgress();
      cleanupToolEvent();
      cleanupUsage();
    };
  }, [
    runId,
    setMessages,
    setHermesSessionId,
    setToolProgress,
    setIsLoading,
    setUsage,
    activeTurnRef,
    stopDbPolling,
  ]);
}
