import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Plus,
  Send,
  Square,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeRun,
} from "../../../../shared/agent-runtimes";
import type {
  QuickChatConversation,
  QuickChatMessage,
} from "../../../../shared/runtime-conversations";
import { summarizeTaskOutput } from "../Chat/runtimeOutput";
import { dispatchAgentsOneEvent } from "../../utils/brandMigration";
import { useI18n } from "../../components/useI18n";

const STORAGE_KEY = "agents-one.quick-chats.v1";
const HIDDEN_TASK_SESSION_IDS_KEY =
  "agents-one.quick-chat.hidden-task-session-ids.v1";
const MAX_QUICK_CHATS = 40;
const MAX_MESSAGES_PER_CHAT = 80;
const QUICK_CHAT_TIMEOUT_MS = 120_000;

type QuickChatRole = QuickChatMessage["role"];
type Translate = (key: string, options?: Record<string, unknown>) => string;

interface QuickChatPanelProps {
  open: boolean;
  runtimes: AgentRuntimeDefinition[];
  defaultRuntimeId?: string | null;
  profile: string;
  currentTaskTitle?: string | null;
  onClose: () => void;
  onAddToTask: (content: string) => void;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadQuickChats(): QuickChatConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QuickChatConversation[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === "string")
      .slice(0, MAX_QUICK_CHATS);
  } catch {
    return [];
  }
}

function saveLegacyQuickChats(chats: QuickChatConversation[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(chats.slice(0, MAX_QUICK_CHATS)),
    );
  } catch {
    // Local history is a convenience; sending must not depend on it.
  }
}

function readHiddenTaskSessionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_TASK_SESSION_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function rememberHiddenTaskSessionId(sessionId?: string | null): void {
  if (!sessionId) return;
  try {
    const ids = readHiddenTaskSessionIds();
    ids.add(sessionId);
    localStorage.setItem(HIDDEN_TASK_SESSION_IDS_KEY, JSON.stringify([...ids]));
    window.dispatchEvent(
      new CustomEvent("agents-one:hidden-task-sessions-changed"),
    );
  } catch {
    // Hiding from the task sidebar is best-effort; QuickChat history still works.
  }
}

function message(role: QuickChatRole, content: string): QuickChatMessage {
  return { id: newId("quick-msg"), role, content, createdAt: Date.now() };
}

function titleFrom(text: string, t: Translate): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 28) || t("chat.quickChat.newChat");
}

function buildPrompt(
  chat: QuickChatConversation | null,
  text: string,
  t: Translate,
): string {
  const history = (chat?.messages || [])
    .filter((item) => item.role === "user" || item.role === "agent")
    .slice(-8)
    .map((item) =>
      t(
        item.role === "user"
          ? "chat.quickChat.historyUser"
          : "chat.quickChat.historyAgent",
        { content: item.content },
      ),
    )
    .join("\n\n")
    .slice(-8_000);

  if (!history) return text;
  return [
    t("chat.quickChat.contextIntro"),
    history,
    t("chat.quickChat.currentMessage", { text }),
  ].join("\n\n");
}

function hermesHistory(
  chat: QuickChatConversation | null,
): Array<{ role: string; content: string }> {
  return (chat?.messages || [])
    .filter((item) => item.role === "user" || item.role === "agent")
    .slice(-12)
    .map((item) => ({
      role: item.role === "user" ? "user" : "assistant",
      content: item.content,
    }));
}

function finalText(run: AgentRuntimeRun, t: Translate): string {
  if (run.error) return run.error;
  const output = (run.output || "").trim();
  if (!output)
    return run.status === "succeeded"
      ? t("chat.quickChat.completed")
      : run.status;
  const summary = summarizeTaskOutput(output);
  if (summary.finalText) return summary.finalText;
  return summary.hasStructuredEvents
    ? t("chat.quickChat.noFinalResponse")
    : output;
}

function eventText(run: AgentRuntimeRun | null, t: Translate): string {
  const latest = run?.events?.at(-1);
  if (latest?.summary) return latest.summary;
  if (!run) return t("chat.quickChat.submitting");
  if (run.status === "running") return t("chat.quickChat.processing");
  return t("chat.quickChat.preparingResult");
}

function transcriptForTask(chat: QuickChatConversation, t: Translate): string {
  const lines = chat.messages
    .filter((item) => item.role === "user" || item.role === "agent")
    .slice(-12)
    .map((item) => {
      const who =
        item.role === "user"
          ? t("chat.quickChat.transcriptMe")
          : chat.runtimeName;
      return `${who}: ${item.content}`;
    })
    .join("\n\n");
  return `${t("chat.quickChat.taskTranscriptIntro")}\n\n${lines}`;
}

function runtimeLabel(runtime: AgentRuntimeDefinition, t: Translate): string {
  const location = t(
    runtime.location === "local"
      ? "chat.quickChat.local"
      : "chat.quickChat.remote",
  );
  return t("chat.quickChat.runtimeLabel", { name: runtime.name, location });
}

function QuickRuntimeAvatar({
  runtime,
  size = 16,
}: {
  runtime?: AgentRuntimeDefinition;
  size?: number;
}): React.JSX.Element {
  return (
    <span
      className="quick-chat-avatar"
      style={runtime?.color ? { background: runtime.color } : undefined}
    >
      {runtime?.avatar ? (
        <img src={runtime.avatar} alt="" />
      ) : (
        <Bot size={size} />
      )}
    </span>
  );
}

export default function QuickChatPanel({
  open,
  runtimes,
  defaultRuntimeId,
  profile,
  currentTaskTitle,
  onClose,
  onAddToTask,
}: QuickChatPanelProps): React.JSX.Element | null {
  const { t } = useI18n();
  const [chats, setChats] = useState<QuickChatConversation[]>(() =>
    loadQuickChats(),
  );
  const [activeChatId, setActiveChatId] = useState<string | null>(
    () => loadQuickChats()[0]?.id ?? null,
  );
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>(
    defaultRuntimeId || runtimes[0]?.id || "",
  );
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(() =>
    t("chat.quickChat.submitting"),
  );
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelledRef = useRef(false);
  const loadedProfileRef = useRef<string | null>(null);

  const runtimeOptions = useMemo(
    () => runtimes.filter((runtime) => runtime.enabled),
    [runtimes],
  );
  const selectedRuntime = runtimeOptions.find(
    (runtime) => runtime.id === selectedRuntimeId,
  );
  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;

  useEffect(() => {
    if (!selectedRuntimeId && runtimeOptions[0]) {
      setSelectedRuntimeId(defaultRuntimeId || runtimeOptions[0].id);
    }
  }, [defaultRuntimeId, runtimeOptions, selectedRuntimeId]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (loadedProfileRef.current !== profile) return;
    saveLegacyQuickChats(chats);
    void window.agentsOneAPI
      .saveQuickChats(chats, profile)
      .catch(() => undefined);
  }, [chats, profile]);

  useEffect(() => {
    let active = true;
    setChats([]);
    setActiveChatId(null);
    void window.agentsOneAPI
      .listQuickChats(profile)
      .then((persisted) => {
        if (!active) return;
        const next =
          persisted.length > 0
            ? persisted
            : loadedProfileRef.current === null
              ? loadQuickChats()
              : [];
        loadedProfileRef.current = profile;
        setChats(next);
        setActiveChatId(next[0]?.id ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeChat?.messages.length, loading, progress]);

  const upsertChat = useCallback((next: QuickChatConversation) => {
    setChats((current) => {
      const without = current.filter((chat) => chat.id !== next.id);
      return [next, ...without].slice(0, MAX_QUICK_CHATS);
    });
    setActiveChatId(next.id);
  }, []);

  const updateChatById = useCallback(
    (
      chatId: string,
      updater: (chat: QuickChatConversation) => QuickChatConversation,
    ) => {
      setChats((current) => {
        const existing = current.find((chat) => chat.id === chatId);
        if (!existing) return current;
        const next = updater(existing);
        const without = current.filter((chat) => chat.id !== chatId);
        return [next, ...without].slice(0, MAX_QUICK_CHATS);
      });
    },
    [],
  );

  const startNewChat = useCallback(() => {
    const runtime = selectedRuntime ?? runtimeOptions[0];
    if (!runtime) return;
    const now = Date.now();
    const chat: QuickChatConversation = {
      id: newId("quick-chat"),
      title: t("chat.quickChat.newChat"),
      runtimeId: runtime.id,
      runtimeName: runtime.name,
      runtimeSessionId: null,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    upsertChat(chat);
    setSelectedRuntimeId(runtime.id);
    setHistoryOpen(false);
  }, [runtimeOptions, selectedRuntime, t, upsertChat]);

  const updateChatMessages = useCallback(
    (
      chat: QuickChatConversation,
      messages: QuickChatMessage[],
      patch: Partial<QuickChatConversation> = {},
    ) => {
      const next: QuickChatConversation = {
        ...chat,
        ...patch,
        title: ["新聊天", "New chat", t("chat.quickChat.newChat")].includes(
          chat.title,
        )
          ? titleFrom(
              messages.find((item) => item.role === "user")?.content || "",
              t,
            )
          : chat.title,
        messages: messages.slice(-MAX_MESSAGES_PER_CHAT),
        updatedAt: Date.now(),
      };
      upsertChat(next);
      return next;
    },
    [t, upsertChat],
  );

  const stop = useCallback(async () => {
    cancelledRef.current = true;
    if (currentRunId) {
      await Promise.all([
        window.agentsOneAPI
          .cancelAgentRuntimeTask(currentRunId)
          .catch(() => false),
        window.agentsOneAPI.abortChat(currentRunId).catch(() => undefined),
      ]);
    }
    setCurrentRunId(null);
    setLoading(false);
    setProgress(t("chat.quickChat.stopped"));
  }, [currentRunId, t]);

  const pollRun = useCallback(
    async (
      runId: string,
      chat: QuickChatConversation,
      baseMessages: QuickChatMessage[],
    ) => {
      while (!cancelledRef.current) {
        const run = await window.agentsOneAPI.getAgentRuntimeRun(runId);
        if (!run) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        setProgress(eventText(run, t));
        if (run.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 900));
          continue;
        }
        const doneMessages = [
          ...baseMessages,
          message(
            run.status === "succeeded" ? "agent" : "system",
            finalText(run, t),
          ),
        ];
        updateChatMessages(chat, doneMessages, {
          runtimeSessionId: run.sessionId || chat.runtimeSessionId || null,
        });
        setLoading(false);
        setCurrentRunId(null);
        setProgress("");
        return;
      }
    },
    [t, updateChatMessages],
  );

  const sendHermesMessage = useCallback(
    async (
      runtime: AgentRuntimeDefinition,
      chat: QuickChatConversation,
      text: string,
    ) => {
      const runId = newId("quick-hermes-run");
      const agentMessageId = newId("quick-msg");
      const runtimeName = runtime.name || "Agent";
      let response = "";
      let completed = false;
      const cleanup: Array<() => void> = [];

      const appendAgentChunk = (chunk: string): void => {
        response += chunk;
        updateChatById(chat.id, (current) => {
          const exists = current.messages.some(
            (item) => item.id === agentMessageId,
          );
          const messages = exists
            ? current.messages.map((item) =>
                item.id === agentMessageId
                  ? { ...item, content: response }
                  : item,
              )
            : [
                ...current.messages,
                {
                  id: agentMessageId,
                  role: "agent" as const,
                  content: response,
                  createdAt: Date.now(),
                },
              ];
          return {
            ...current,
            messages: messages.slice(-MAX_MESSAGES_PER_CHAT),
            updatedAt: Date.now(),
          };
        });
      };

      const finish = (sessionId?: string | null): void => {
        if (completed) return;
        completed = true;
        cleanup.forEach((dispose) => dispose());
        rememberHiddenTaskSessionId(sessionId);
        updateChatById(chat.id, (current) => ({
          ...current,
          runtimeSessionId: null,
          updatedAt: Date.now(),
        }));
        if (sessionId) {
          void window.agentsOneAPI
            .deleteSession(sessionId)
            .catch(() => undefined)
            .finally(() => {
              dispatchAgentsOneEvent("sessionTranscriptChanged");
            });
        }
        if (!response.trim()) {
          updateChatById(chat.id, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              message("system", t("chat.quickChat.emptyResponse")),
            ].slice(-MAX_MESSAGES_PER_CHAT),
            updatedAt: Date.now(),
          }));
        }
        setLoading(false);
        setCurrentRunId(null);
        setProgress("");
      };

      cleanup.push(
        window.agentsOneAPI.onChatChunk((eventRunId, chunk) => {
          if (eventRunId !== runId || !chunk) return;
          setProgress(t("chat.quickChat.replying", { name: runtimeName }));
          appendAgentChunk(chunk);
        }),
        window.agentsOneAPI.onChatReasoningChunk((eventRunId) => {
          if (eventRunId !== runId) return;
          setProgress(t("chat.quickChat.reasoning", { name: runtimeName }));
        }),
        window.agentsOneAPI.onChatToolProgress((eventRunId, tool) => {
          if (eventRunId !== runId) return;
          setProgress(
            tool || t("chat.quickChat.usingTool", { name: runtimeName }),
          );
        }),
        window.agentsOneAPI.onChatSessionStarted((eventRunId, sessionId) => {
          if (eventRunId !== runId) return;
          rememberHiddenTaskSessionId(sessionId);
          updateChatById(chat.id, (current) => ({
            ...current,
            runtimeSessionId: null,
            updatedAt: Date.now(),
          }));
        }),
        window.agentsOneAPI.onChatDone((eventRunId, sessionId) => {
          if (eventRunId !== runId) return;
          finish(sessionId);
        }),
        window.agentsOneAPI.onChatError((eventRunId, error) => {
          if (eventRunId !== runId) return;
          if (completed) return;
          completed = true;
          cleanup.forEach((dispose) => dispose());
          updateChatById(chat.id, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              message("system", error || t("chat.quickChat.requestFailed")),
            ].slice(-MAX_MESSAGES_PER_CHAT),
            updatedAt: Date.now(),
          }));
          setLoading(false);
          setCurrentRunId(null);
          setProgress("");
        }),
      );

      setCurrentRunId(runId);
      setProgress(t("chat.quickChat.submittingTo", { name: runtimeName }));
      try {
        const result = await window.agentsOneAPI.sendMessage(
          text,
          profile,
          undefined,
          hermesHistory(chat),
          [],
          undefined,
          runId,
        );
        if (!response.trim() && result.response?.trim()) {
          appendAgentChunk(result.response.trim());
        }
        finish(result.sessionId || chat.runtimeSessionId || null);
      } catch (error) {
        if (completed) return;
        completed = true;
        cleanup.forEach((dispose) => dispose());
        updateChatById(chat.id, (current) => ({
          ...current,
          messages: [
            ...current.messages,
            message(
              "system",
              error instanceof Error
                ? error.message
                : t("chat.quickChat.requestFailed"),
            ),
          ].slice(-MAX_MESSAGES_PER_CHAT),
          updatedAt: Date.now(),
        }));
        setLoading(false);
        setCurrentRunId(null);
        setProgress("");
      }
    },
    [profile, t, updateChatById],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const runtime = selectedRuntime;
    if (!runtime) {
      toast.error(t("chat.quickChat.selectRuntimeError"));
      return;
    }

    let chat = activeChat;
    if (!chat || chat.runtimeId !== runtime.id) {
      const now = Date.now();
      chat = {
        id: newId("quick-chat"),
        title: titleFrom(text, t),
        runtimeId: runtime.id,
        runtimeName: runtime.name,
        runtimeSessionId: null,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
    }

    cancelledRef.current = false;
    const nextMessages = [...chat.messages, message("user", text)];
    const nextChat = updateChatMessages(chat, nextMessages, {
      runtimeId: runtime.id,
      runtimeName: runtime.name,
    });
    setInput("");
    setLoading(true);
    setProgress(t("chat.quickChat.submitting"));
    setHistoryOpen(false);

    try {
      if (runtime.kind === "hermes") {
        await sendHermesMessage(runtime, nextChat, text);
        return;
      }
      const run = await window.agentsOneAPI.startAgentRuntimeTask(runtime.id, {
        prompt: buildPrompt(chat, text, t),
        mode: "analysis",
        sessionId: chat.runtimeSessionId || undefined,
        timeoutMs: QUICK_CHAT_TIMEOUT_MS,
      });
      setCurrentRunId(run.id);
      setProgress(eventText(run, t));
      void pollRun(run.id, nextChat, nextMessages);
    } catch (error) {
      updateChatMessages(nextChat, [
        ...nextMessages,
        message(
          "system",
          error instanceof Error
            ? error.message
            : t("chat.quickChat.chatRequestFailed"),
        ),
      ]);
      setLoading(false);
      setCurrentRunId(null);
    }
  }, [
    activeChat,
    input,
    loading,
    pollRun,
    selectedRuntime,
    sendHermesMessage,
    t,
    updateChatMessages,
  ]);

  const addToTask = useCallback(() => {
    if (!activeChat || activeChat.messages.length === 0) {
      toast.error(t("chat.quickChat.addToTaskEmpty"));
      return;
    }
    onAddToTask(transcriptForTask(activeChat, t));
  }, [activeChat, onAddToTask, t]);

  if (!open) return null;

  return (
    <section
      className="quick-chat-panel"
      aria-label={t("chat.quickChat.panelLabel")}
    >
      <header className="quick-chat-header">
        <div className="quick-chat-title">
          <span className="quick-chat-title-main">
            {activeChat?.title || t("chat.quickChat.newChat")}
          </span>
          <span className="quick-chat-title-sub">
            {currentTaskTitle
              ? t("chat.quickChat.currentTask", { title: currentTaskTitle })
              : t("chat.quickChat.canAddToTask")}
          </span>
        </div>
        <div className="quick-chat-actions">
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={startNewChat}
            title={t("chat.quickChat.newChat")}
            aria-label={t("chat.quickChat.newChat")}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className={`quick-chat-icon-btn ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen((value) => !value)}
            title={t("chat.quickChat.recentChats")}
            aria-label={t("chat.quickChat.recentChats")}
          >
            <History size={16} />
          </button>
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={addToTask}
            title={t("chat.quickChat.addToTask")}
            aria-label={t("chat.quickChat.addToTask")}
          >
            <MessageSquarePlus size={16} />
          </button>
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={onClose}
            title={t("chat.quickChat.close")}
            aria-label={t("chat.quickChat.close")}
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="quick-chat-agent-row">
        <QuickRuntimeAvatar runtime={selectedRuntime} />
        <select
          value={selectedRuntimeId}
          onChange={(event) => {
            const next = event.target.value;
            setSelectedRuntimeId(next);
            const existing = chats.find((chat) => chat.runtimeId === next);
            if (existing) setActiveChatId(existing.id);
          }}
          aria-label={t("chat.quickChat.selectRuntime")}
        >
          {runtimeOptions.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtimeLabel(runtime, t)}
            </option>
          ))}
        </select>
      </div>

      {historyOpen && (
        <div className="quick-chat-history" role="list">
          {chats.length === 0 ? (
            <div className="quick-chat-empty-history">
              {t("chat.quickChat.noHistory")}
            </div>
          ) : (
            chats.map((chat) => (
              <button
                type="button"
                key={chat.id}
                className={`quick-chat-history-item ${
                  chat.id === activeChatId ? "active" : ""
                }`}
                onClick={() => {
                  setActiveChatId(chat.id);
                  setSelectedRuntimeId(chat.runtimeId);
                  setHistoryOpen(false);
                }}
              >
                <span>{chat.title}</span>
                <small>{chat.runtimeName}</small>
              </button>
            ))
          )}
        </div>
      )}

      <div className="quick-chat-messages" ref={scrollRef}>
        {!activeChat || activeChat.messages.length === 0 ? (
          <div className="quick-chat-empty">
            <QuickRuntimeAvatar runtime={selectedRuntime} size={18} />
            <strong>{t("chat.quickChat.newChat")}</strong>
            <span>{t("chat.quickChat.emptyDescription")}</span>
            {chats.length > 0 && (
              <div className="quick-chat-recent">
                <span>{t("chat.quickChat.recentChats")}</span>
                {chats.slice(0, 3).map((chat) => (
                  <button
                    type="button"
                    key={chat.id}
                    onClick={() => {
                      setActiveChatId(chat.id);
                      setSelectedRuntimeId(chat.runtimeId);
                    }}
                  >
                    <span>{chat.title}</span>
                    <small>{chat.runtimeName}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          activeChat.messages.map((item) => (
            <div
              key={item.id}
              className={`quick-chat-message quick-chat-message-${item.role}`}
            >
              {item.role !== "user" && (
                <QuickRuntimeAvatar runtime={selectedRuntime} size={14} />
              )}
              <div className="quick-chat-bubble">
                <AgentMarkdown>{item.content}</AgentMarkdown>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="quick-chat-progress" role="status" aria-live="polite">
            <LoaderCircle size={15} />
            <span>{progress || t("chat.quickChat.processing")}</span>
          </div>
        )}
      </div>

      <footer className="quick-chat-composer">
        <textarea
          ref={textareaRef}
          value={input}
          rows={1}
          placeholder={
            selectedRuntime
              ? t("chat.quickChat.messagePlaceholder", {
                  name: selectedRuntime.name,
                })
              : t("chat.quickChat.selectRuntimePlaceholder")
          }
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          disabled={!selectedRuntime}
        />
        {loading ? (
          <button
            type="button"
            className="quick-chat-send"
            onClick={() => void stop()}
            title={t("chat.quickChat.stop")}
            aria-label={t("chat.quickChat.stop")}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="quick-chat-send"
            onClick={() => void send()}
            disabled={!input.trim() || !selectedRuntime}
            title={t("chat.quickChat.send")}
            aria-label={t("chat.quickChat.send")}
          >
            <Send size={16} />
          </button>
        )}
      </footer>
    </section>
  );
}
