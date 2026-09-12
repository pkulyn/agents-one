import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Bot,
  Check,
  ChevronDown,
  FileUp,
  FolderPlus,
  GripVertical,
  Paperclip,
  X,
} from "lucide-react";
import { ChatInput, type ChatInputHandle } from "../Chat/ChatInput";
import { usesLegacyHermesChat } from "../Layout/chatRuns";
import type { Attachment } from "../../../../shared/attachments";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { addMigratedEventListener } from "../../utils/brandMigration";
import { useI18n } from "../../components/useI18n";

const DEFAULT_AGENT_RUNTIME_KEY = "agents-one.default-runtime-id.v1";

const RUNTIME_LABELS: Record<string, string> = {
  hermes: "Hermes Agent Runtime",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
};

function initialRuntimeId(): string | null {
  try {
    return localStorage.getItem(DEFAULT_AGENT_RUNTIME_KEY);
  } catch {
    return null;
  }
}

function RuntimeAvatar({
  runtime,
  size,
}: {
  runtime?: AgentRuntimeDefinition;
  size: number;
}): React.JSX.Element {
  return (
    <span
      className={`tray-composer-agent-avatar ${runtime?.kind ?? "hermes"}`}
      style={{
        width: size,
        height: size,
        ...(runtime?.color
          ? { backgroundColor: runtime.color, color: "#ffffff" }
          : {}),
      }}
    >
      {runtime?.avatar ? (
        <img src={runtime.avatar} alt="" />
      ) : (
        <Bot size={Math.max(14, size - 10)} aria-hidden="true" />
      )}
      {runtime?.enabled !== false && (
        <span className="tray-composer-agent-online" aria-hidden="true" />
      )}
    </span>
  );
}

export default function QuickComposer(): React.JSX.Element {
  const { t } = useI18n();
  const shellRef = useRef<HTMLElement>(null);
  const inputRef = useRef<ChatInputHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  const attachmentMenuRef = useRef<HTMLDivElement>(null);
  const sendRunIdRef = useRef<string | null>(null);
  const runtimeRunIdRef = useRef<string | null>(null);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string | null>(
    initialRuntimeId,
  );
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [contextFolder, setContextFolder] = useState<string | null>(null);
  const [contextWorkspaceId, setContextWorkspaceId] = useState<string | null>(
    null,
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabledRuntimes = useMemo(
    () => runtimes.filter((runtime) => runtime.enabled),
    [runtimes],
  );
  const selectedRuntime = useMemo(
    () =>
      enabledRuntimes.find((runtime) => runtime.id === selectedRuntimeId) ??
      enabledRuntimes.find((runtime) => runtime.kind === "hermes") ??
      enabledRuntimes[0],
    [enabledRuntimes, selectedRuntimeId],
  );
  const selectedRuntimeLabel =
    selectedRuntime?.name || t("chat.quickComposer.defaultAgent");
  const voiceProfile =
    selectedRuntime?.kind === "hermes"
      ? selectedRuntime.config.agent || "default"
      : "default";

  const loadRuntimes = useCallback((): void => {
    void window.agentsOneAPI
      .listAgentRuntimes()
      .then(setRuntimes)
      .catch(() => {
        /* Keep the last known list; the built-in default remains usable. */
      });
  }, []);

  useEffect(() => {
    loadRuntimes();
    const removeRuntimeChangedListener = addMigratedEventListener(
      "runtimeChanged",
      loadRuntimes,
    );
    window.addEventListener(
      "agents-one:runtime-appearance-changed",
      loadRuntimes,
    );
    return () => {
      removeRuntimeChangedListener();
      window.removeEventListener(
        "agents-one:runtime-appearance-changed",
        loadRuntimes,
      );
    };
  }, [loadRuntimes]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    let frame = 0;
    const syncHeight = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        window.agentsOneAPI.resizeTrayComposer(
          Math.ceil(shell.getBoundingClientRect().height),
        );
      });
    };
    syncHeight();
    if (typeof ResizeObserver === "undefined") {
      const mutationObserver = new MutationObserver(syncHeight);
      mutationObserver.observe(shell, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      return () => {
        mutationObserver.disconnect();
        cancelAnimationFrame(frame);
      };
    }
    const observer = new ResizeObserver(syncHeight);
    observer.observe(shell, { box: "border-box" });
    // Opening either popover changes padding and children. Content-box-only
    // observation misses that transition in Chromium, which used to leave the
    // 96px BrowserWindow unchanged and clip the upward menu below the taskbar.
    const mutationObserver = new MutationObserver(syncHeight);
    mutationObserver.observe(shell, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!agentMenuOpen && !attachmentMenuOpen) return;
    const handleOutsideClick = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (agentMenuOpen && !agentMenuRef.current?.contains(target)) {
        setAgentMenuOpen(false);
      }
      if (attachmentMenuOpen && !attachmentMenuRef.current?.contains(target)) {
        setAttachmentMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [agentMenuOpen, attachmentMenuOpen]);

  const applyProjectFolder = useCallback(
    async (path: string): Promise<void> => {
      const registered =
        await window.agentsOneAPI.registerProjectWorkspace(path);
      if (!registered)
        throw new Error(t("chat.quickComposer.workspaceUnauthorized"));
      setContextFolder(registered.name);
      setContextWorkspaceId(registered.id);
      setError(null);
    },
    [t],
  );

  const handlePickFolder = useCallback(async (): Promise<void> => {
    setAttachmentMenuOpen(false);
    try {
      const path = await window.agentsOneAPI.selectFolder({
        title: t("chat.quickComposer.addProjectTitle"),
        buttonLabel: t("chat.quickComposer.addProjectButton"),
      });
      if (path) await applyProjectFolder(path);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("chat.quickComposer.addProjectFailed"),
      );
    }
  }, [applyProjectFolder, t]);

  const handleFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = event.target.files;
      if (!files?.length) return;
      await inputRef.current?.addFiles(files);
      event.target.value = "";
      setAttachmentMenuOpen(false);
    },
    [],
  );

  const handleSelectRuntime = useCallback(
    (runtime: AgentRuntimeDefinition): void => {
      setSelectedRuntimeId(runtime.id);
      setAgentMenuOpen(false);
      setError(null);
      inputRef.current?.focus();
    },
    [],
  );

  const handleSubmit = useCallback(
    (text: string, attachments: Attachment[]): void => {
      if (isSending) return;
      const runId = `tray-${crypto.randomUUID()}`;
      sendRunIdRef.current = runId;
      setIsSending(true);
      setError(null);

      const request =
        selectedRuntime && !usesLegacyHermesChat(selectedRuntime)
          ? window.agentsOneAPI
              .startAgentRuntimeTask(selectedRuntime.id, {
                prompt: text,
                mode: "analysis",
                conversation: true,
                ...(contextWorkspaceId
                  ? { workspaceId: contextWorkspaceId }
                  : {}),
                attachments,
              })
              .then((run) => {
                runtimeRunIdRef.current = run.id;
              })
          : window.agentsOneAPI
              .sendMessage(
                text,
                selectedRuntime?.config.agent || "default",
                undefined,
                [],
                attachments,
                contextFolder || undefined,
                runId,
                undefined,
                contextWorkspaceId || undefined,
              )
              .then(() => undefined);

      void request
        .then(() => {
          setIsSending(false);
          sendRunIdRef.current = null;
          runtimeRunIdRef.current = null;
          window.agentsOneAPI.closeTrayComposer();
        })
        .catch((cause: unknown) => {
          inputRef.current?.restore(text, attachments);
          setIsSending(false);
          sendRunIdRef.current = null;
          runtimeRunIdRef.current = null;
          setError(
            cause instanceof Error
              ? cause.message
              : t("chat.quickComposer.sendFailed"),
          );
        });
    },
    [contextFolder, contextWorkspaceId, isSending, selectedRuntime, t],
  );

  const handleAbort = useCallback((): void => {
    const runtimeRunId = runtimeRunIdRef.current;
    const runId = sendRunIdRef.current;
    const request = runtimeRunId
      ? window.agentsOneAPI
          .cancelAgentRuntimeTask(runtimeRunId)
          .then(() => undefined)
      : window.agentsOneAPI.abortChat(runId || undefined);
    void request.finally(() => {
      setIsSending(false);
      sendRunIdRef.current = null;
      runtimeRunIdRef.current = null;
    });
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (agentMenuOpen || attachmentMenuOpen) {
        setAgentMenuOpen(false);
        setAttachmentMenuOpen(false);
        return;
      }
      window.agentsOneAPI.closeTrayComposer();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [agentMenuOpen, attachmentMenuOpen]);

  const leadingExtras = (
    <>
      <span
        className="tray-composer-drag-handle"
        title={t("chat.quickComposer.drag")}
        aria-label={t("chat.quickComposer.drag")}
      >
        <GripVertical size={15} aria-hidden="true" />
      </span>
      <div className="tray-composer-agent" ref={agentMenuRef}>
        {agentMenuOpen && (
          <div className="tray-composer-agent-menu" role="menu">
            <div className="tray-composer-menu-title">
              {t("chat.quickComposer.switchAgent")}
            </div>
            {enabledRuntimes.length ? (
              enabledRuntimes.map((runtime) => {
                const selected = runtime.id === selectedRuntime?.id;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    className={`tray-composer-agent-item${selected ? " is-selected" : ""}`}
                    key={runtime.id}
                    onClick={() => handleSelectRuntime(runtime)}
                  >
                    <RuntimeAvatar runtime={runtime} size={28} />
                    <span className="tray-composer-agent-copy">
                      <strong>{runtime.name}</strong>
                      <small>
                        {RUNTIME_LABELS[runtime.kind] ||
                          (runtime.kind === "web-agent"
                            ? t("chat.quickComposer.webAgent")
                            : runtime.kind)}{" "}
                        ·{" "}
                        {t(
                          runtime.location === "local"
                            ? "chat.quickComposer.local"
                            : "chat.quickComposer.remote",
                        )}
                      </small>
                    </span>
                    {selected && <Check size={15} aria-hidden="true" />}
                  </button>
                );
              })
            ) : (
              <div className="tray-composer-menu-empty">
                {t("chat.quickComposer.noAgents")}
              </div>
            )}
          </div>
        )}
        <button
          className={`tray-composer-agent-trigger${agentMenuOpen ? " is-open" : ""}`}
          type="button"
          title={t("chat.quickComposer.currentAgent", {
            name: selectedRuntimeLabel,
          })}
          aria-label={t("chat.quickComposer.currentAgent", {
            name: selectedRuntimeLabel,
          })}
          aria-haspopup="menu"
          aria-expanded={agentMenuOpen}
          onClick={() => {
            setAgentMenuOpen((open) => !open);
            setAttachmentMenuOpen(false);
          }}
        >
          <RuntimeAvatar runtime={selectedRuntime} size={32} />
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
      <span className="tray-composer-divider" aria-hidden="true" />
    </>
  );

  const toolbarExtras = (
    <>
      <div className="tray-composer-attachment" ref={attachmentMenuRef}>
        {attachmentMenuOpen && (
          <div className="tray-composer-attachment-menu" role="menu">
            <div className="tray-composer-menu-title">
              {t("chat.quickComposer.add")}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={17} aria-hidden="true" />
              <span>
                <strong>{t("chat.quickComposer.uploadFile")}</strong>
                <small>{t("chat.quickComposer.uploadFileDescription")}</small>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handlePickFolder()}
            >
              <FolderPlus size={17} aria-hidden="true" />
              <span>
                <strong>{t("chat.quickComposer.addProject")}</strong>
                <small>{t("chat.quickComposer.addProjectDescription")}</small>
              </span>
            </button>
            {contextFolder && (
              <div className="tray-composer-current-project">
                <span title={contextFolder}>{contextFolder}</span>
                <button
                  type="button"
                  title={t("chat.quickComposer.removeProject")}
                  aria-label={t("chat.quickComposer.removeProject")}
                  onClick={() => {
                    setContextFolder(null);
                    setContextWorkspaceId(null);
                  }}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}
        <button
          className={`tray-composer-attach${contextFolder ? " has-project" : ""}`}
          type="button"
          title={
            contextFolder
              ? t("chat.quickComposer.projectAdded", { name: contextFolder })
              : t("chat.quickComposer.addFileOrProject")
          }
          aria-label={t("chat.quickComposer.addFileOrProject")}
          aria-haspopup="menu"
          aria-expanded={attachmentMenuOpen}
          disabled={isSending}
          onClick={() => {
            setAttachmentMenuOpen((open) => !open);
            setAgentMenuOpen(false);
          }}
        >
          <Paperclip size={18} aria-hidden="true" />
          {contextFolder && <span className="tray-composer-project-dot" />}
        </button>
      </div>
    </>
  );

  return (
    <main
      ref={shellRef}
      className={`tray-composer${agentMenuOpen ? " has-agent-menu" : ""}${attachmentMenuOpen ? " has-attachment-menu" : ""}`}
      aria-label={t("chat.quickComposer.taskLabel")}
    >
      <input
        ref={fileInputRef}
        className="tray-composer-file-input"
        type="file"
        multiple
        tabIndex={-1}
        onChange={(event) => void handleFileInputChange(event)}
      />
      <ChatInput
        ref={inputRef}
        isLoading={isSending}
        hasSession={false}
        attachmentsEnabled
        allowAttachmentsWhileLoading={false}
        placeholder={t("chat.quickComposer.placeholder", {
          name: selectedRuntimeLabel,
        })}
        profile={voiceProfile}
        leadingExtras={leadingExtras}
        toolbarExtras={toolbarExtras}
        showAttachmentButton={false}
        showVoiceInput
        onSubmit={handleSubmit}
        onQuickAsk={handleSubmit}
        onAbort={handleAbort}
      />
      {error && (
        <div className="tray-composer-error" role="alert">
          {error}
        </div>
      )}
    </main>
  );
}
