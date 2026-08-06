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
import { summarizeTaskOutput } from "../TaskCenter/taskOutput";

const STORAGE_KEY = "agents-one.quick-chats.v1";
const HIDDEN_TASK_SESSION_IDS_KEY = "agents-one.quick-chat.hidden-task-session-ids.v1";
const MAX_QUICK_CHATS = 40;
const MAX_MESSAGES_PER_CHAT = 80;
const QUICK_CHAT_TIMEOUT_MS = 120_000;

type QuickChatRole = "user" | "agent" | "system";

interface QuickChatMessage {
  id: string;
  role: QuickChatRole;
  content: string;
  createdAt: number;
}

interface QuickChatConversation {
  id: string;
  title: string;
  runtimeId: string;
  runtimeName: string;
  runtimeSessionId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: QuickChatMessage[];
}

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

function saveQuickChats(chats: QuickChatConversation[]): void {
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

function message(
  role: QuickChatRole,
  content: string,
): QuickChatMessage {
  return { id: newId("quick-msg"), role, content, createdAt: Date.now() };
}

function titleFrom(text: string): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.slice(0, 28) || "新聊天";
}

function buildPrompt(
  chat: QuickChatConversation | null,
  text: string,
): string {
  const history = (chat?.messages || [])
    .filter((item) => item.role === "user" || item.role === "agent")
    .slice(-8)
    .map((item) => `${item.role === "user" ? "用户" : "智能体"}：${item.content}`)
    .join("\n\n")
    .slice(-8_000);

  if (!history) return text;
  return [
    "以下是本次轻量聊天的近期上下文，请据此继续回答。",
    history,
    `当前用户消息：${text}`,
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

function finalText(run: AgentRuntimeRun): string {
  if (run.error) return run.error;
  const output = (run.output || "").trim();
  if (!output) return run.status === "succeeded" ? "已完成。" : run.status;
  const summary = summarizeTaskOutput(output);
  if (summary.finalText) return summary.finalText;
  return summary.hasStructuredEvents
    ? "智能体本轮没有返回可显示的最终答复，请继续提问或稍后重试。"
    : output;
}

function eventText(run: AgentRuntimeRun | null): string {
  const latest = run?.events?.at(-1);
  if (latest?.summary) return latest.summary;
  if (!run) return "正在提交给智能体...";
  if (run.status === "running") return "智能体正在处理...";
  return "正在整理结果...";
}

function transcriptForTask(chat: QuickChatConversation): string {
  const lines = chat.messages
    .filter((item) => item.role === "user" || item.role === "agent")
    .slice(-12)
    .map((item) => {
      const who = item.role === "user" ? "我" : chat.runtimeName;
      return `${who}: ${item.content}`;
    })
    .join("\n\n");
  return `请参考这段轻量聊天，并结合当前任务继续处理：\n\n${lines}`;
}

function runtimeLabel(runtime: AgentRuntimeDefinition): string {
  const location = runtime.location === "local" ? "本地" : "远程";
  return `${runtime.name} / ${location}`;
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
      {runtime?.avatar ? <img src={runtime.avatar} alt="" /> : <Bot size={size} />}
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
  const [progress, setProgress] = useState("正在提交给智能体...");
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const cancelledRef = useRef(false);

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
    saveQuickChats(chats);
  }, [chats]);

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
      title: "新聊天",
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
  }, [runtimeOptions, selectedRuntime, upsertChat]);

  const updateChatMessages = useCallback(
    (
      chat: QuickChatConversation,
      messages: QuickChatMessage[],
      patch: Partial<QuickChatConversation> = {},
    ) => {
      const next: QuickChatConversation = {
        ...chat,
        ...patch,
        title:
          chat.title === "新聊天"
            ? titleFrom(messages.find((item) => item.role === "user")?.content || "")
            : chat.title,
        messages: messages.slice(-MAX_MESSAGES_PER_CHAT),
        updatedAt: Date.now(),
      };
      upsertChat(next);
      return next;
    },
    [upsertChat],
  );

  const stop = useCallback(async () => {
    cancelledRef.current = true;
    if (currentRunId) {
      await Promise.all([
        window.hermesAPI.cancelAgentRuntimeTask(currentRunId).catch(() => false),
        window.hermesAPI.abortChat(currentRunId).catch(() => undefined),
      ]);
    }
    setCurrentRunId(null);
    setLoading(false);
    setProgress("已停止。");
  }, [currentRunId]);

  const pollRun = useCallback(
    async (
      runId: string,
      chat: QuickChatConversation,
      baseMessages: QuickChatMessage[],
    ) => {
      while (!cancelledRef.current) {
        const run = await window.hermesAPI.getAgentRuntimeRun(runId);
        if (!run) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          continue;
        }
        setProgress(eventText(run));
        if (run.status === "running") {
          await new Promise((resolve) => setTimeout(resolve, 900));
          continue;
        }
        const doneMessages = [
          ...baseMessages,
          message(run.status === "succeeded" ? "agent" : "system", finalText(run)),
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
    [updateChatMessages],
  );

  const sendHermesMessage = useCallback(
    async (
      runtime: AgentRuntimeDefinition,
      chat: QuickChatConversation,
      text: string,
    ) => {
      const runId = newId("quick-hermes-run");
      const agentMessageId = newId("quick-msg");
      const runtimeName = runtime.name || "Hermes";
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
          void window.hermesAPI
            .deleteSession(sessionId)
            .catch(() => undefined)
            .finally(() => {
              window.dispatchEvent(
                new CustomEvent("hermes-session-transcript-changed"),
              );
            });
        }
        if (!response.trim()) {
          updateChatById(chat.id, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              message("system", "智能体没有返回可显示内容。"),
            ].slice(-MAX_MESSAGES_PER_CHAT),
            updatedAt: Date.now(),
          }));
        }
        setLoading(false);
        setCurrentRunId(null);
        setProgress("");
      };

      cleanup.push(
        window.hermesAPI.onChatChunk((eventRunId, chunk) => {
          if (eventRunId !== runId || !chunk) return;
          setProgress(`${runtimeName} 正在回复...`);
          appendAgentChunk(chunk);
        }),
        window.hermesAPI.onChatReasoningChunk((eventRunId) => {
          if (eventRunId !== runId) return;
          setProgress(`${runtimeName} 正在思考...`);
        }),
        window.hermesAPI.onChatToolProgress((eventRunId, tool) => {
          if (eventRunId !== runId) return;
          setProgress(tool || `${runtimeName} 正在调用工具...`);
        }),
        window.hermesAPI.onChatSessionStarted((eventRunId, sessionId) => {
          if (eventRunId !== runId) return;
          rememberHiddenTaskSessionId(sessionId);
          updateChatById(chat.id, (current) => ({
            ...current,
            runtimeSessionId: null,
            updatedAt: Date.now(),
          }));
        }),
        window.hermesAPI.onChatDone((eventRunId, sessionId) => {
          if (eventRunId !== runId) return;
          finish(sessionId);
        }),
        window.hermesAPI.onChatError((eventRunId, error) => {
          if (eventRunId !== runId) return;
          if (completed) return;
          completed = true;
          cleanup.forEach((dispose) => dispose());
          updateChatById(chat.id, (current) => ({
            ...current,
            messages: [
              ...current.messages,
              message("system", error || "Hermes 聊天请求失败。"),
            ].slice(-MAX_MESSAGES_PER_CHAT),
            updatedAt: Date.now(),
          }));
          setLoading(false);
          setCurrentRunId(null);
          setProgress("");
        }),
      );

      setCurrentRunId(runId);
      setProgress(`正在提交给 ${runtimeName}...`);
      try {
        const result = await window.hermesAPI.sendMessage(
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
              error instanceof Error ? error.message : "Hermes 聊天请求失败。",
            ),
          ].slice(-MAX_MESSAGES_PER_CHAT),
          updatedAt: Date.now(),
        }));
        setLoading(false);
        setCurrentRunId(null);
        setProgress("");
      }
    },
    [profile, updateChatById],
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    const runtime = selectedRuntime;
    if (!runtime) {
      toast.error("请先选择一个可用智能体。");
      return;
    }

    let chat = activeChat;
    if (!chat || chat.runtimeId !== runtime.id) {
      const now = Date.now();
      chat = {
        id: newId("quick-chat"),
        title: titleFrom(text),
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
    setProgress("正在提交给智能体...");
    setHistoryOpen(false);

    try {
      if (runtime.kind === "hermes") {
        await sendHermesMessage(runtime, nextChat, text);
        return;
      }
      const run = await window.hermesAPI.startAgentRuntimeTask(runtime.id, {
        prompt: buildPrompt(chat, text),
        mode: "analysis",
        sessionId: chat.runtimeSessionId || undefined,
        timeoutMs: QUICK_CHAT_TIMEOUT_MS,
      });
      setCurrentRunId(run.id);
      setProgress(eventText(run));
      void pollRun(run.id, nextChat, nextMessages);
    } catch (error) {
      updateChatMessages(nextChat, [
        ...nextMessages,
        message(
          "system",
          error instanceof Error ? error.message : "聊天请求失败。",
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
    updateChatMessages,
  ]);

  const addToTask = useCallback(() => {
    if (!activeChat || activeChat.messages.length === 0) {
      toast.error("当前聊天还没有可加入任务的内容。");
      return;
    }
    onAddToTask(transcriptForTask(activeChat));
  }, [activeChat, onAddToTask]);

  if (!open) return null;

  return (
    <section className="quick-chat-panel" aria-label="轻量聊天">
      <header className="quick-chat-header">
        <div className="quick-chat-title">
          <span className="quick-chat-title-main">
            {activeChat?.title || "新聊天"}
          </span>
          <span className="quick-chat-title-sub">
            {currentTaskTitle ? `当前任务：${currentTaskTitle}` : "可加入当前任务"}
          </span>
        </div>
        <div className="quick-chat-actions">
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={startNewChat}
            title="新聊天"
            aria-label="新聊天"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            className={`quick-chat-icon-btn ${historyOpen ? "active" : ""}`}
            onClick={() => setHistoryOpen((value) => !value)}
            title="最近聊天"
            aria-label="最近聊天"
          >
            <History size={16} />
          </button>
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={addToTask}
            title="加入当前任务"
            aria-label="加入当前任务"
          >
            <MessageSquarePlus size={16} />
          </button>
          <button
            type="button"
            className="quick-chat-icon-btn"
            onClick={onClose}
            title="关闭"
            aria-label="关闭"
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
          aria-label="选择智能体"
        >
          {runtimeOptions.map((runtime) => (
            <option key={runtime.id} value={runtime.id}>
              {runtimeLabel(runtime)}
            </option>
          ))}
        </select>
      </div>

      {historyOpen && (
        <div className="quick-chat-history" role="list">
          {chats.length === 0 ? (
            <div className="quick-chat-empty-history">暂无聊天记录</div>
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
            <strong>新聊天</strong>
            <span>快速问答、临时讨论，需要时可加入当前任务。</span>
            {chats.length > 0 && (
              <div className="quick-chat-recent">
                <span>最近聊天</span>
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
            <span>{progress || "智能体正在处理..."}</span>
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
              ? `给 ${selectedRuntime.name} 发送消息`
              : "选择智能体后发送消息"
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
            title="停止"
            aria-label="停止"
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            type="button"
            className="quick-chat-send"
            onClick={() => void send()}
            disabled={!input.trim() || !selectedRuntime}
            title="发送"
            aria-label="发送"
          >
            <Send size={16} />
          </button>
        )}
      </footer>
    </section>
  );
}
