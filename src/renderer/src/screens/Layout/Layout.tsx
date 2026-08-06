import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import toast from "react-hot-toast";
import Chat from "../Chat/Chat";
import RuntimeChat from "../RuntimeChat/RuntimeChat";
import {
  dbItemsToChatMessages,
  type DbHistoryItem,
} from "../Chat/sessionHistory";
import {
  type ChatRun,
  mintRun,
  mintRuntimeRun,
  patchRun,
  isScratchRun,
  openSessionRunTransition,
  selectProfileRunTransition,
  findRunBySession,
  cycleRunId,
  runIdAtOrdinal,
  usesLegacyHermesChat,
  loadingSessionIds as deriveLoadingSessionIds,
} from "./chatRuns";
import { ActiveSessionsBar } from "./ActiveSessionsBar";
import Sessions from "../Sessions/Sessions";
import Agents from "../Agents/Agents";
import Discover from "../Discover/Discover";
import ProfileSwitcher from "./ProfileSwitcher";
import SidebarRecentSessions from "./SidebarRecentSessions";
import QuickChatPanel from "./QuickChatPanel";
import TaskCollaborationDialog, {
  type CollaborationTaskDraft,
} from "./TaskCollaborationDialog";
import type { TaskCollaborationProposal } from "../../../../shared/task-collaboration-proposals";
import TaskCollaborationWorkspace, {
  type CollaborationWorkspaceState,
} from "./TaskCollaborationWorkspace";
import Skills from "../Skills/Skills";
import Memory from "../Memory/Memory";
import Tools from "../Tools/Tools";
import Gateway from "../Gateway/Gateway";
import Office from "../Office/Office";
import Providers from "../Providers/Providers";
import Schedules from "../Schedules/Schedules";
import { useSettingsModal } from "../../components/settings/SettingsModalContext";
import agentsOneLogo from "../../assets/agents-one-wordmark.svg";
import {
  ChatBubble,
  Clock,
  Users,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
} from "../../assets/icons";
import type { LucideIcon } from "lucide-react";
import { useI18n } from "../../components/useI18n";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import type {
  TaskCollaborationAssignment,
  TaskCollaborationRecord,
} from "../../../../shared/task-collaboration";

type View =
  | "chat"
  | "discover"
  | "agents"
  | "office"
  | "providers"
  | "skills"
  | "memory"
  | "tools"
  | "schedules"
  | "gateway";

const PINNED_NAV_ITEMS: {
  view: View;
  icon: LucideIcon;
  label: string;
  quickChat?: boolean;
}[] = [
  { view: "schedules", icon: Clock, label: "定时任务" },
  { view: "chat", icon: ChatBubble, label: "聊天", quickChat: true },
  { view: "agents", icon: Users, label: "智能体" },
];

const SIDEBAR_COLLAPSED_KEY = "hermes.sidebar.collapsed";
const DEFAULT_AGENT_RUNTIME_KEY = "agents-one.default-runtime-id.v1";

function collaborationWorkspaceFromRecord(
  record: TaskCollaborationRecord,
): CollaborationWorkspaceState {
  return {
    taskId: record.taskId,
    title: record.title,
    projectFolder: record.projectFolder,
    sourceRuntimeId: record.sourceRuntimeId,
    assignments: record.assignments,
    status: record.status,
  };
}

function Layout(): React.JSX.Element {
  const { t } = useI18n();
  const { openSettings } = useSettingsModal();
  const [view, setView] = useState<View>("chat");
  // Multiple conversations coexist (background sessions + multi-agent). Each is
  // a ChatRun; all are mounted, only the active one is shown. Profile switches
  // preserve existing conversations and activate a scratch run for the selected
  // agent so `activeProfile` stays aligned with the visible chat transport.
  const [activeProfile, setActiveProfile] = useState("default");
  const [runs, setRuns] = useState<ChatRun[]>(() => [mintRun("default")]);
  const runsRef = useRef<ChatRun[]>(runs);
  const [activeRunId, setActiveRunId] = useState<string>(() => runs[0].runId);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [quickChatRuntimeId, setQuickChatRuntimeId] = useState<string | null>(
    null,
  );
  const [collaborationDraft, setCollaborationDraft] = useState<CollaborationTaskDraft | null>(null);
  const [collaborationWorkspace, setCollaborationWorkspace] =
    useState<CollaborationWorkspaceState | null>(null);
  const [defaultRuntimeId, setDefaultRuntimeId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DEFAULT_AGENT_RUNTIME_KEY);
    } catch {
      return null;
    }
  });
  const [runtimeCatalog, setRuntimeCatalog] = useState<
    Record<string, AgentRuntimeDefinition>
  >({});
  // While a resume's history is loading, show its spinner immediately.
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null);
  // Sessions whose resume is in flight — dedupes rapid double-clicks that would
  // otherwise mount two tabs for the same session (the live check straddles an
  // await, so it can't rely on `runs` state alone).
  const resumingRef = useRef<Set<string>>(new Set());
  const sidebarTaskScrollRef = useRef<HTMLDivElement | null>(null);

  const activeRun = runs.find((r) => r.runId === activeRunId);
  const runtimeList = useMemo(
    () => Object.values(runtimeCatalog),
    [runtimeCatalog],
  );
  const defaultRuntime = useMemo(
    () =>
      runtimeList.find((runtime) => runtime.id === defaultRuntimeId) ??
      runtimeList.find((runtime) => runtime.kind === "hermes" && runtime.enabled) ??
      runtimeList.find((runtime) => runtime.enabled) ??
      runtimeList[0],
    [defaultRuntimeId, runtimeList],
  );
  const builtinHermesRuntime = useMemo(
    () =>
      runtimeList.find(
        (runtime) =>
          runtime.id === "hermes-remote" &&
          runtime.enabled &&
          runtime.managed === "builtin",
      ) ??
      runtimeList.find(
        (runtime) =>
          runtime.kind === "hermes" &&
          runtime.enabled &&
          runtime.managed === "builtin",
      ),
    [runtimeList],
  );
  const currentSessionId =
    activeRun?.runtimeConversationId ?? activeRun?.sessionId ?? null;
  const loadingSessionIds = useMemo(
    () => deriveLoadingSessionIds(runs),
    [runs],
  );


  // Profile appearance remains the source for Hermes conversations. Runtime
  // conversations resolve their own user-configured name/avatar/colour from
  // the runtime catalog, so top tabs match the project/task sidebar.
  const [profileAppearance, setProfileAppearance] = useState<
    Record<string, { color?: string | null; avatar?: string | null }>
  >({});
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((list) => {
        if (cancelled) return;
        const map: Record<string, { color?: string; avatar?: string | null }> =
          {};
        for (const p of list) map[p.id] = { color: p.color, avatar: p.avatar };
        setProfileAppearance(map);
      })
      .catch(() => {
        /* keep last-known appearance */
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfile, view]);
  const getAppearance = useCallback(
    (run: ChatRun) => {
      const runtime = run.runtimeId ? runtimeCatalog[run.runtimeId] : null;
      if (runtime) {
        return {
          name: runtime.name,
          color: runtime.color,
          avatar: runtime.avatar,
        };
      }
      const profile = profileAppearance[run.profile] ?? {};
      if (builtinHermesRuntime) {
        return {
          name:
            builtinHermesRuntime.name ||
            (run.profile === "default" ? "Hermes" : run.profile),
          color: builtinHermesRuntime.color ?? profile.color,
          avatar: builtinHermesRuntime.avatar ?? profile.avatar,
        };
      }
      return {
        name: run.profile === "default" ? "Hermes" : run.profile,
        ...profile,
      };
    },
    [builtinHermesRuntime, profileAppearance, runtimeCatalog],
  );

  useEffect(() => {
    let cancelled = false;
    const loadRuntimeCatalog = (): void => {
      window.hermesAPI
        .listAgentRuntimes()
        .then((list) => {
          if (cancelled) return;
          setRuntimeCatalog(
            Object.fromEntries(list.map((runtime) => [runtime.id, runtime])),
          );
        })
        .catch(() => {
          /* keep last-known runtime catalog */
        });
    };
    loadRuntimeCatalog();
    window.addEventListener("hermes-agent-runtime-changed", loadRuntimeCatalog);
    window.addEventListener(
      "agents-one:runtime-appearance-changed",
      loadRuntimeCatalog,
    );
    return () => {
      cancelled = true;
      window.removeEventListener(
        "hermes-agent-runtime-changed",
        loadRuntimeCatalog,
      );
      window.removeEventListener(
        "agents-one:runtime-appearance-changed",
        loadRuntimeCatalog,
      );
    };
  }, [view]);

  const handleDefaultRuntimeChange = useCallback((runtimeId: string): void => {
    setDefaultRuntimeId(runtimeId);
    try {
      localStorage.setItem(DEFAULT_AGENT_RUNTIME_KEY, runtimeId);
    } catch {
      /* keep the in-memory choice */
    }
  }, []);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

  const linkRunCollaboration = useCallback(
    (runId: string, link: { conversationId?: string; sourceSessionId?: string }): void => {
      const run = runsRef.current.find((item) => item.runId === runId);
      const taskId = run?.collaboration?.persistedTaskId;
      if (!taskId) return;
      void window.hermesAPI
        .linkTaskCollaboration({ taskId, ...link }, activeProfile)
        .then(() => window.dispatchEvent(new Event("agents-one:task-collaboration-changed")))
        .catch(() => {
          // A transcript may still be saved even when the optional link write
          // fails. Never create a second collaboration record as a fallback.
        });
    },
    [activeProfile],
  );

  // Per-run reporters wired into each <Chat>.
  const handleRunLoading = useCallback((runId: string, loading: boolean) => {
    setRuns((prev) => patchRun(prev, runId, { loading }));
  }, []);
  const handleRunSessionId = useCallback(
    (runId: string, sessionId: string | null) => {
      setRuns((prev) => patchRun(prev, runId, { sessionId }));
      if (sessionId) linkRunCollaboration(runId, { sourceSessionId: sessionId });
    },
    [linkRunCollaboration],
  );
  const handleRuntimeConversationId = useCallback(
    (runId: string, runtimeConversationId: string) => {
      setRuns((prev) => patchRun(prev, runId, { runtimeConversationId }));
      linkRunCollaboration(runId, { conversationId: runtimeConversationId });
    },
    [linkRunCollaboration],
  );
  const handleRunTitle = useCallback((runId: string, title: string) => {
    setRuns((prev) => patchRun(prev, runId, { title }));
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  // Full-list sessions modal (opened from the sidebar "Show more" affordance or
  // the Cmd/Ctrl+K menu action). Reuses the Sessions screen inside a modal —
  // there is no longer a top-level Sessions view.
  const [sessionsModalOpen, setSessionsModalOpen] = useState(false);
  // Tabs lazy-mount on first visit, then stay mounted (display:none toggle).
  // Keeps IPC refetch / DOM rebuild off the tab-switch hot path.
  const [visitedViews, setVisitedViews] = useState<Set<View>>(
    () => new Set<View>(["chat"]),
  );
  // Remote-only mode — SSH tunnel has full access; only pure HTTP remote mode restricts screens
  const [remoteMode, setRemoteMode] = useState(false);
  // Set by the Capabilities screen's "Browse" actions to focus a Discover tab
  // (Skills → Community, or MCPs). The nonce re-fires Discover's effect.
  const [discoverFocus, setDiscoverFocus] = useState<{
    kind: "skills" | "mcps";
    nonce: number;
  } | null>(null);

  const paneStyle = (target: View): React.CSSProperties => ({
    display: view === target ? "flex" : "none",
    flex: 1,
    flexDirection: "column",
    overflow: "hidden",
  });

  const goTo = useCallback((v: View) => {
    setVisitedViews((prev) => (prev.has(v) ? prev : new Set(prev).add(v)));
    setView(v);
  }, []);

  useEffect(() => {
    const handleNavigation = (e: Event): void => {
      const detail = (e as CustomEvent<
        View | { view: View; taskId?: string }
      >).detail;
      const targetView = typeof detail === "string" ? detail : detail?.view;
      if (targetView === "schedules") {
        goTo("schedules");
        return;
      }
      if (targetView) goTo(targetView);
    };
    window.addEventListener("navigation:goto", handleNavigation);
    return () =>
      window.removeEventListener("navigation:goto", handleNavigation);
  }, [goTo]);

  // Cmd/Ctrl+, opens the settings modal from anywhere (the conventional
  // "preferences" shortcut).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettings(undefined, { profile: activeProfile });
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [openSettings, activeProfile]);

  const focusDiscover = useCallback(
    (kind: "skills" | "mcps") => {
      setDiscoverFocus((prev) => ({ kind, nonce: (prev?.nonce ?? 0) + 1 }));
      goTo("discover");
    },
    [goTo],
  );

  // Re-check remote mode on tab switch (picks up Settings changes)
  useEffect(() => {
    window.hermesAPI.isRemoteOnlyMode().then(setRemoteMode);
  }, [view]);

  // Restore the last-activated profile on launch. The main process persists it
  // in ~/.hermes/active_profile (via `hermes profile use`), so the desktop
  // should reopen on that profile rather than always resetting to "default".
  useEffect(() => {
    let cancelled = false;
    window.hermesAPI
      .listProfiles()
      .then((profiles) => {
        if (cancelled) return;
        const active = profiles.find((p) => p.isActive);
        if (active && active.id !== "default") {
          setActiveProfile(active.id);
          // Re-home the initial pristine run onto the restored profile so the
          // first chat runs under the right agent (no session/turn yet).
          setRuns((prev) =>
            prev.length === 1 && !prev[0].sessionId && !prev[0].loading
              ? [{ ...prev[0], profile: active.id }]
              : prev,
          );
        }
      })
      .catch(() => {
        /* fall back to the default profile */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-update state
  const [updateState, setUpdateState] = useState<
    "available" | "downloading" | "ready" | "error" | null
  >(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updatePercent, setUpdatePercent] = useState<number | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Surface a startup upgrade button as soon as GitHub reports a newer
    // release. If auto-upgrade is enabled, electron-updater also downloads in
    // the background and this state advances to downloading/ready.
    const cleanupAvailable = window.hermesAPI.onUpdateAvailable((info) => {
      setUpdateState("available");
      setUpdateVersion(info.version);
      setUpdateError(null);
    });
    const cleanupProgress = window.hermesAPI.onUpdateDownloadProgress(
      (info) => {
        setUpdateState("downloading");
        setUpdatePercent(info.percent);
        setUpdateError(null);
      },
    );
    const cleanupDownloaded = window.hermesAPI.onUpdateDownloaded(() => {
      setUpdateState("ready");
      setUpdatePercent(null);
      setUpdateError(null);
    });
    const cleanupError = window.hermesAPI.onUpdateError((message) => {
      setUpdateState("error");
      setUpdateError(message);
    });
    return () => {
      cleanupAvailable();
      cleanupProgress();
      cleanupDownloaded();
      cleanupError();
    };
  }, []);

  async function handleUpdate(): Promise<void> {
    if (updateState === "ready") {
      // The only user action: restart into the already-downloaded update.
      await window.hermesAPI.installUpdate();
    } else if (updateState === "available" || updateState === "error") {
      // Download the available update (or retry a failed auto-download).
      // Set downloading state immediately to prevent re-entrancy.
      setUpdateState("downloading");
      setUpdatePercent(null);
      setUpdateError(null);
      try {
        const ok = await window.hermesAPI.downloadUpdate();
        if (!ok) setUpdateState("error");
        // On success, we wait for the onUpdateDownloaded callback to set "ready"
      } catch (err) {
        setUpdateError(err instanceof Error ? err.message : String(err));
        setUpdateState("error");
      }
    }
  }

  const updateButtonTitle =
    updateError ??
    (updateState === "available" && updateVersion
      ? t("common.updateAvailable", { version: updateVersion })
      : updateState === "downloading"
        ? updatePercent === null
          ? t("common.downloading", { percent: 0 })
          : t("common.downloading", { percent: updatePercent })
        : updateState === "ready"
          ? t("common.restartToUpdate")
          : updateState === "error"
            ? t("common.updateFailed")
            : undefined);

  const handleOpenQuickChat = useCallback((runtimeId?: string | null) => {
    if (runtimeId) setQuickChatRuntimeId(runtimeId);
    setQuickChatOpen(true);
  }, []);

  const handleNewChat = useCallback(() => {
    handleOpenQuickChat(activeRun?.runtimeId ?? quickChatRuntimeId);
  }, [activeRun?.runtimeId, handleOpenQuickChat, quickChatRuntimeId]);

  const handleAddQuickChatToTask = useCallback(
    (content: string) => {
      if (!activeRunId) {
        toast.error("请先打开一个任务。");
        return;
      }
      window.dispatchEvent(
        new CustomEvent("agents-one:add-chat-to-task", {
          detail: { runId: activeRunId, content },
        }),
      );
      setQuickChatOpen(false);
      goTo("chat");
      toast.success("已放入当前任务输入框。");
    },
    [activeRunId, goTo],
  );

  const isBlankTaskRun = useCallback(
    (run: ChatRun): boolean =>
      !run.sessionId &&
      !run.runtimeConversationId &&
      !run.loading &&
      !run.title &&
      !run.seed &&
      !run.runtimeSeed,
    [],
  );

  const mintDefaultTaskRun = useCallback(
    (folder?: string | null): ChatRun => {
      if (!defaultRuntime || defaultRuntime.kind === "hermes") {
        return mintRun(activeProfile, undefined, folder ?? undefined);
      }
      return mintRuntimeRun({
        profile: activeProfile,
        runtimeId: defaultRuntime.id,
        runtimeName: defaultRuntime.name,
        runtimeKind: defaultRuntime.kind,
        runtimeWorkspace: folder ?? defaultRuntime.config.workspace,
      });
    },
    [activeProfile, defaultRuntime],
  );

  const handleNewTask = useCallback(() => {
    const active = runs.find((r) => r.runId === activeRunId);
    const defaultRuntimeTask =
      defaultRuntime && defaultRuntime.kind !== "hermes"
        ? defaultRuntime.id
        : null;
    if (
      active &&
      isBlankTaskRun(active) &&
      (defaultRuntimeTask
        ? active.runtimeId === defaultRuntimeTask
        : !active.runtimeId)
    ) {
      goTo("chat");
      return;
    }
    const run = mintDefaultTaskRun();
    setRuns((prev) => [...prev, run]);
    setActiveRunId(run.runId);
    goTo("chat");
  }, [
    runs,
    activeRunId,
    defaultRuntime,
    goTo,
    isBlankTaskRun,
    mintDefaultTaskRun,
  ]);

  const handleProjectFolderChoice = useCallback(
    async (mode: "new" | "existing") => {
      let folder: string | null = null;
      try {
        folder =
          mode === "new"
            ? await window.hermesAPI.createProjectFolder()
            : await window.hermesAPI.selectFolder({
                title: "选择现有项目文件夹",
                buttonLabel: "使用此文件夹",
              });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "无法创建项目文件夹",
        );
        return;
      }
      if (!folder) return;
      await window.hermesAPI.registerProjectFolder(folder);
      window.dispatchEvent(new CustomEvent("agents-one:project-folders-changed"));

      const active = runs.find((run) => run.runId === activeRunId);
      if (active && isScratchRun(active)) {
        setRuns((previous) =>
          previous.map((run) =>
            run.runId === active.runId
              ? { ...run, contextFolder: folder }
              : run,
          ),
        );
      } else if (
        active &&
        isBlankTaskRun(active) &&
        active.runtimeId &&
        active.runtimeId === defaultRuntime?.id
      ) {
        setRuns((previous) =>
          previous.map((run) =>
            run.runId === active.runId
              ? { ...run, runtimeWorkspace: folder }
              : run,
          ),
        );
      } else {
        const run = mintDefaultTaskRun(folder);
        setRuns((previous) => [...previous, run]);
        setActiveRunId(run.runId);
      }
      goTo("chat");
    },
    [
      runs,
      activeRunId,
      defaultRuntime?.id,
      goTo,
      isBlankTaskRun,
      mintDefaultTaskRun,
    ],
  );

  const handleCreateProjectTask = useCallback(
    (folder: string): void => {
      const run = mintDefaultTaskRun(folder);
      setRuns((previous) => [...previous, run]);
      setActiveRunId(run.runId);
      goTo("chat");
    },
    [goTo, mintDefaultTaskRun],
  );

  const handleOpenTaskCollaboration = useCallback(
    (task: ChatRun, proposal?: TaskCollaborationProposal): void => {
      setCollaborationDraft({
        runId: task.runId,
        taskId: task.runtimeConversationId || task.sessionId || undefined,
        title: proposal?.title || task.title || "当前任务的协作方案",
        projectFolder: task.runtimeWorkspace || task.contextFolder || null,
        sourceRuntimeId: task.runtimeId,
        assignments: proposal?.assignments,
        message: proposal?.brief,
      });
    },
    [],
  );

  const handleStartTaskCollaboration = useCallback(
    (assignments: TaskCollaborationAssignment[], message: string): void => {
      const draft = collaborationDraft;
      if (!draft) return;
      if (draft.taskId) {
        void window.hermesAPI
          .saveTaskCollaboration(
            {
              taskId: draft.taskId,
              title: draft.title,
              projectFolder: draft.projectFolder || undefined,
              sourceRuntimeId: draft.sourceRuntimeId,
              assignments,
              status: "active",
            },
            activeProfile,
          )
          .then((record) => {
            window.dispatchEvent(new Event("agents-one:task-collaboration-changed"));
            setCollaborationDraft(null);
            const live = findRunBySession(runs, record.taskId);
            if (!live) {
              toast.success("协作设置已保存。请打开该任务后发送任务说明。");
              return;
            }
            setRuns((previous) =>
              patchRun(previous, live.runId, {
                collaboration: {
                  assignments: record.assignments,
                  ...(record.projectFolder
                    ? { projectFolder: record.projectFolder }
                    : {}),
                  persistedTaskId: record.taskId,
                  status: record.status,
                },
              }),
            );
            setActiveRunId(live.runId);
            goTo("chat");
            requestAnimationFrame(() => {
              window.dispatchEvent(
                new CustomEvent("agents-one:submit-task-message", {
                  detail: {
                    runId: live.runId,
                    content: message,
                    collaboration: {
                      taskId: record.taskId,
                      assignments: record.assignments,
                      projectFolder: record.projectFolder,
                    },
                  },
                }),
              );
            });
          })
          .catch((error) =>
            toast.error(error instanceof Error ? error.message : "无法保存协作设置。"),
          );
      } else if (draft.runId) {
        // A newly created task has no transport session yet. Persist against
        // its stable UI run id before emitting the first message; later
        // conversation/session ids only link back to this parent record.
        const parentTaskId = draft.runId;
        void window.hermesAPI
          .saveTaskCollaboration(
            {
              taskId: parentTaskId,
              title: draft.title,
              projectFolder: draft.projectFolder || undefined,
              sourceRuntimeId: draft.sourceRuntimeId,
              assignments,
              status: "active",
            },
            activeProfile,
          )
          .then((record) => {
            setRuns((previous) =>
              patchRun(previous, parentTaskId, {
                collaboration: {
                  assignments: record.assignments,
                  ...(record.projectFolder ? { projectFolder: record.projectFolder } : {}),
                  persistedTaskId: record.taskId,
                  status: record.status,
                },
              }),
            );
            window.dispatchEvent(new Event("agents-one:task-collaboration-changed"));
            setCollaborationDraft(null);
            setActiveRunId(parentTaskId);
            goTo("chat");
            requestAnimationFrame(() => {
              window.dispatchEvent(
                new CustomEvent("agents-one:submit-task-message", {
                  detail: {
                    runId: parentTaskId,
                    content: message,
                    collaboration: {
                      taskId: record.taskId,
                      assignments: record.assignments,
                      projectFolder: record.projectFolder,
                    },
                  },
                }),
              );
            });
          })
          .catch((error) =>
            toast.error(error instanceof Error ? error.message : "无法保存协作设置。"),
          );
      }
    },
    [activeProfile, collaborationDraft, goTo, runs],
  );

  const handleStartCollaboration = useCallback((): void => {
    const workspace = collaborationWorkspace;
    if (!workspace?.taskId) {
      toast.error("请先向协调者发送首条任务说明，创建可恢复的协作任务。");
      return;
    }
    void window.hermesAPI
      .saveTaskCollaboration(
        {
          taskId: workspace.taskId,
          title: workspace.title,
          projectFolder: workspace.projectFolder || undefined,
          sourceRuntimeId: workspace.sourceRuntimeId,
          assignments: workspace.assignments,
          status: "active",
        },
        activeProfile,
      )
      .then((record) => {
        setCollaborationWorkspace(collaborationWorkspaceFromRecord(record));
        window.dispatchEvent(new Event("agents-one:task-collaboration-changed"));
      })
      .catch((error) =>
        toast.error(error instanceof Error ? error.message : "无法启动协作。"),
      );
  }, [activeProfile, collaborationWorkspace]);

  useEffect(() => {
    const openWorkspace = (event: Event): void => {
      const taskId = (event as CustomEvent<string>).detail;
      if (!taskId || typeof taskId !== "string") return;
      void window.hermesAPI
        .getTaskCollaboration(taskId, activeProfile)
        .then((record) => {
          if (record) setCollaborationWorkspace(collaborationWorkspaceFromRecord(record));
        })
        .catch(() => {
          toast.error("无法读取协作任务配置。 ");
        });
    };
    window.addEventListener("agents-one:open-task-collaboration", openWorkspace);
    return () =>
      window.removeEventListener("agents-one:open-task-collaboration", openWorkspace);
  }, [activeProfile]);

  // Listen for menu IPC events (Cmd+N, Cmd+K from app menu)
  useEffect(() => {
    const cleanupNewChat = window.hermesAPI.onMenuNewChat(() => {
      handleNewTask();
    });
    const cleanupSearch = window.hermesAPI.onMenuSearchSessions(() => {
      setSessionsModalOpen(true);
    });
    return () => {
      cleanupNewChat();
      cleanupSearch();
    };
  }, [handleNewTask]);

  // Esc closes the full-list sessions modal.
  useEffect(() => {
    if (!sessionsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setSessionsModalOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionsModalOpen]);

  const handleSelectProfile = useCallback(
    (name: string) => {
      // Selecting an agent is administrative: switch the active profile (the
      // component already started its gateway via setActiveProfile). Existing
      // chats remain on their original profile, but the visible chat must move
      // to a scratch run for the selected profile so the footer and transport
      // never point at different agents.
      setActiveProfile(name);
      const next = selectProfileRunTransition(runs, activeRunId, name);
      setRuns(next.runs);
      setActiveRunId(next.activeRunId);
    },
    [runs, activeRunId],
  );

  const handleChatWithRuntime = useCallback(
    (runtime: AgentRuntimeDefinition) => {
      setRuntimeCatalog((current) => ({ ...current, [runtime.id]: runtime }));
      const run =
        usesLegacyHermesChat(runtime)
          ? mintRun(activeProfile)
          : mintRuntimeRun({
              profile: activeProfile,
              runtimeId: runtime.id,
              runtimeName: runtime.name,
              runtimeKind: runtime.kind,
              runtimeWorkspace: runtime.config.workspace,
            });
      setRuns((current) => [...current, run]);
      setActiveRunId(run.runId);
      goTo("chat");
    },
    [activeProfile, goTo],
  );

  // Jump to an already-open run (e.g. from the active-sessions bar), switching
  // the selected profile so the rest of the app follows the agent.
  const handleActivateRun = useCallback(
    (runId: string) => {
      const run = runs.find((r) => r.runId === runId);
      if (!run) return;
      setActiveRunId(runId);
      setActiveProfile(run.profile);
      goTo("chat");
    },
    [runs, goTo],
  );

  // Close a conversation tab: stop it if it's running, drop it from the list,
  // and (if it was active) move to a neighbour. Always keep at least one chat
  // open so the chat view is never empty.
  const handleCloseRun = useCallback(
    (runId: string) => {
      window.hermesAPI.abortChat(runId);
      const idx = runs.findIndex((r) => r.runId === runId);
      const remaining = runs.filter((r) => r.runId !== runId);
      if (remaining.length === 0) {
        const fresh = mintDefaultTaskRun();
        setRuns([fresh]);
        setActiveRunId(fresh.runId);
        return;
      }
      setRuns(remaining);
      if (runId === activeRunId) {
        const neighbour = remaining[Math.min(idx, remaining.length - 1)];
        setActiveRunId(neighbour.runId);
        setActiveProfile(neighbour.profile);
      }
    },
    [runs, activeRunId, mintDefaultTaskRun],
  );

  // Chrome/iTerm-style tab shortcuts for the conversation tabs: Ctrl+Tab /
  // Ctrl+Shift+Tab, Cmd/Ctrl+Shift+[ / ], Cmd/Ctrl+Option+←/→ and
  // Cmd/Ctrl+Shift+←/→ cycle; Cmd/Ctrl+1..8 jump to the Nth tab and 9 to the
  // last; Cmd/Ctrl+W closes the active tab. Matches on e.code so the
  // shortcuts keep working while a CJK IME is active. Cmd+Shift+arrow is
  // skipped inside editable fields where it means "select to line start/end".
  useEffect(() => {
    const isEditable = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      return (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t.isContentEditable
      );
    };
    const handleKey = (e: KeyboardEvent): void => {
      const primary = e.metaKey || e.ctrlKey;
      let target: string | null = null;
      let matched = false;
      if (primary && !e.shiftKey && !e.altKey && e.code === "KeyW") {
        // Close the active conversation tab (iTerm/Chrome). handleCloseRun
        // keeps at least one chat open, so the window itself never closes.
        e.preventDefault();
        handleCloseRun(activeRunId);
        return;
      }
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === "Tab") {
        matched = true;
        target = cycleRunId(runs, activeRunId, e.shiftKey ? -1 : 1);
      } else if (
        primary &&
        e.shiftKey &&
        !e.altKey &&
        (e.code === "BracketRight" || e.code === "BracketLeft")
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "BracketRight" ? 1 : -1,
        );
      } else if (
        primary &&
        (e.code === "ArrowRight" || e.code === "ArrowLeft") &&
        // Cmd+Option+arrow (Chrome macOS) or Cmd+Shift+arrow — the latter
        // only outside editable fields, where it selects text instead.
        ((e.altKey && !e.shiftKey) ||
          (e.shiftKey && !e.altKey && !isEditable(e.target)))
      ) {
        matched = true;
        target = cycleRunId(
          runs,
          activeRunId,
          e.code === "ArrowRight" ? 1 : -1,
        );
      } else if (primary && !e.shiftKey && !e.altKey) {
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (digit) {
          matched = true;
          target = runIdAtOrdinal(runs, Number(digit[1]));
        }
      }
      if (!matched) return;
      e.preventDefault();
      if (target) handleActivateRun(target);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [runs, activeRunId, handleActivateRun, handleCloseRun]);

  const handleResumeSession = useCallback(
    async (sessionId: string) => {
      // Already open as a live run? Re-attach to it (keeps live streaming).
      const live = findRunBySession(runs, sessionId);
      if (live) {
        handleActivateRun(live.runId);
        return;
      }
      // Guard against a double-click resuming the same session twice: the live
      // check above and the setRuns below straddle an await, so without this a
      // second click would pass the stale guard and mount a duplicate tab.
      if (resumingRef.current.has(sessionId)) return;
      resumingRef.current.add(sessionId);
      setResumingSessionId(sessionId);
      try {
        const runtimeConversation =
          await window.hermesAPI.getRuntimeConversation(
            sessionId,
            activeProfile,
          );
        if (runtimeConversation) {
          const runtime = {
            id: runtimeConversation.runtimeId,
            name: runtimeConversation.runtimeName,
            kind: runtimeConversation.runtimeKind,
            location: runtimeConversation.runtimeLocation,
            enabled: true,
            managed: "user" as const,
            color: runtimeConversation.runtimeColor,
            avatar: runtimeConversation.runtimeAvatar,
            config: {},
          };
          setRuntimeCatalog((current) => ({
            ...current,
            [runtime.id]: current[runtime.id] ?? runtime,
          }));
          const run = mintRuntimeRun({
            profile: activeProfile,
            runtimeId: runtime.id,
            runtimeName: runtime.name,
            runtimeKind: runtime.kind,
            title: runtimeConversation.title,
            runtimeConversationId: runtimeConversation.id,
            runtimeSeed: runtimeConversation.messages,
            runtimeWorkspace: runtimeConversation.workspace,
            sessionId: runtimeConversation.runtimeSessionId ?? null,
          });
          setRuns(
            (prev) => openSessionRunTransition(prev, activeRunId, run).runs,
          );
          setActiveRunId(run.runId);
          goTo("chat");
          return;
        }
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as DbHistoryItem[];
        const run = mintRun(activeProfile, dbItemsToChatMessages(items));
        run.sessionId = sessionId;
        setRuns(
          (prev) => openSessionRunTransition(prev, activeRunId, run).runs,
        );
        setActiveRunId(run.runId);
        goTo("chat");
      } finally {
        resumingRef.current.delete(sessionId);
        setResumingSessionId(null);
      }
    },
    [runs, activeRunId, handleActivateRun, activeProfile, goTo],
  );

  useEffect(() => {
    const handleOpenRuntimeConversation = (event: Event): void => {
      const conversationId = (event as CustomEvent<unknown>).detail;
      if (typeof conversationId === "string" && conversationId) {
        void handleResumeSession(conversationId);
      }
    };
    window.addEventListener(
      "agents-one:open-runtime-conversation",
      handleOpenRuntimeConversation,
    );
    return () => window.removeEventListener(
      "agents-one:open-runtime-conversation",
      handleOpenRuntimeConversation,
    );
  }, [handleResumeSession]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  }, []);

  const sidebarToggleLabel = sidebarCollapsed
    ? t("navigation.expandSidebar")
    : t("navigation.collapseSidebar");

  return (
    <div className={`layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            className="sidebar-logo"
            aria-label="Agents One"
            src={agentsOneLogo}
          />
          <button
            className="sidebar-collapse-toggle"
            type="button"
            onClick={toggleSidebar}
            title={sidebarToggleLabel}
            aria-label={sidebarToggleLabel}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? (
              // Collapsed: show the circular brand mark by default and swap to
              // the expand icon on hover/focus. Both sit in a fixed-size box so
              // the swap never changes the button's footprint.
              <span className="sidebar-collapse-swap">
                <span className="sidebar-collapse-mark" aria-hidden="true" />
                <PanelLeftOpen
                  size={16}
                  className="sidebar-collapse-expand-icon"
                />
              </span>
            ) : (
              <PanelLeftClose size={16} />
            )}
          </button>
        </div>

        <nav className="sidebar-nav sidebar-nav-pinned">
          <button
            className="sidebar-nav-item sidebar-new-chat"
            onClick={handleNewTask}
            title="新建任务"
            aria-label="新建任务"
          >
            <Plus size={16} />
            <span className="sidebar-nav-label">新建任务</span>
          </button>
          {PINNED_NAV_ITEMS.map(({ view: v, icon: Icon, label, quickChat }) => {
            const active = quickChat ? quickChatOpen : view === v;
            return (
              <button
                key={v}
                className={`sidebar-nav-item ${active ? "active" : ""}`}
                onClick={() => {
                  if (quickChat) {
                    handleNewChat();
                    return;
                  }
                  goTo(v);
                }}
                title={label}
                aria-label={label}
              >
                <Icon size={16} />
                <span className="sidebar-nav-label">{label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-chat-section">
          <div className="sidebar-chat-scroll" ref={sidebarTaskScrollRef}>
            <SidebarRecentSessions
              open={!sidebarCollapsed}
              activeProfile={activeProfile}
              currentSessionId={currentSessionId}
              loadingSessionIds={loadingSessionIds}
              resumingSessionId={resumingSessionId}
              onSelect={(sessionId) => void handleResumeSession(sessionId)}
              onSessionDeleted={(id) => {
                if (id === currentSessionId) handleNewTask();
              }}
              scrollRootRef={sidebarTaskScrollRef}
              sectionLabel="任务"
              onCreateProjectFolder={(mode) =>
                void handleProjectFolderChoice(mode)
              }
              onCreateProjectTask={handleCreateProjectTask}
            />
          </div>
        </div>

        <div className="sidebar-footer">
          {/* Show an upgrade affordance at startup when GitHub has a newer
              release; it becomes a restart action once downloaded. */}
          {updateState && (
            <button
              className={`sidebar-update-btn ${
                updateState === "error" ? "error" : ""
              }`}
              onClick={handleUpdate}
              disabled={updateState === "downloading"}
              title={updateButtonTitle}
              aria-label={updateButtonTitle}
            >
              <Download size={13} />
              {updateState === "available" && (
                <span>
                  {updateVersion
                    ? t("common.updateAvailable", { version: updateVersion })
                    : t("common.updateAvailable", { version: "" })}
                </span>
              )}
              {updateState === "downloading" && (
                <span>
                  {t("common.downloading", { percent: updatePercent ?? 0 })}
                </span>
              )}
              {updateState === "ready" && (
                <span>{t("common.restartToUpdate")}</span>
              )}
              {updateState === "error" && (
                <span>{t("common.updateFailed")}</span>
              )}
            </button>
          )}
          <ProfileSwitcher
            activeProfile={activeProfile}
            onSwitch={handleSelectProfile}
            onManage={() => openSettings(undefined, { profile: activeProfile })}
            onRuntimeChat={handleChatWithRuntime}
            defaultRuntimeId={defaultRuntime?.id ?? defaultRuntimeId}
            onDefaultRuntimeChange={handleDefaultRuntimeChange}
            compact={sidebarCollapsed}
          />
        </div>
      </aside>

      <main className="content">
        {/* Doubles as the window drag strip — keep it first so it owns the top
            band; the warning banner (if any) sits just below it. */}
        {view === "chat" && (
          <ActiveSessionsBar
            runs={runs}
            activeRunId={activeRunId}
            onSelect={handleActivateRun}
            onClose={handleCloseRun}
            onNew={handleNewTask}
            getAppearance={getAppearance}
          />
        )}
        <div style={paneStyle("chat")}>
          {runs.map((run) => (
            <div
              key={run.runId}
              style={{
                display:
                  view === "chat" && run.runId === activeRunId
                    ? "flex"
                    : "none",
                flex: 1,
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              {run.runtimeId ? (
                <RuntimeChat
                  runId={run.runId}
                  runtime={
                    runtimeCatalog[run.runtimeId] ?? {
                      id: run.runtimeId,
                      name: run.runtimeName || run.runtimeId,
                      kind: run.runtimeKind || "hermes",
                      location: "remote",
                      enabled: true,
                      managed: "user",
                      config: {},
                    }
                  }
                  active={view === "chat" && run.runId === activeRunId}
                  profile={run.profile}
                  initialConversationId={run.runtimeConversationId ?? null}
                  initialRuntimeSessionId={run.sessionId}
                  initialMessages={run.runtimeSeed}
                  initialWorkspace={run.runtimeWorkspace}
                  collaboration={
                    run.collaboration
                      ? {
                          assignments: run.collaboration.assignments,
                          projectFolder: run.collaboration.projectFolder,
                          taskId: run.collaboration.persistedTaskId,
                        }
                      : undefined
                  }
                  runtimeCatalog={runtimeCatalog}
                  onRequestCollaboration={(proposal) => handleOpenTaskCollaboration(run, proposal)}
                  onLoadingChange={handleRunLoading}
                  onSessionIdChange={handleRunSessionId}
                  onConversationIdChange={handleRuntimeConversationId}
                  onTitleChange={handleRunTitle}
                />
              ) : (
                <Chat
                  key={`${run.runId}:${run.contextFolder ?? ""}`}
                  runId={run.runId}
                  initialMessages={run.seed}
                  initialSessionId={run.sessionId}
                  initialContextFolder={run.contextFolder}
                  active={view === "chat" && run.runId === activeRunId}
                  profile={run.profile}
                  onNewChat={handleNewChat}
                  onOpenDiagnose={(section?: string) =>
                    openSettings(section, { profile: run.profile })
                  }
                  onLoadingChange={handleRunLoading}
                  onSessionIdChange={handleRunSessionId}
                  onTitleChange={handleRunTitle}
                  collaboration={run.collaboration}
                  runtimeCatalog={runtimeCatalog}
                  agentAppearance={getAppearance(run)}
                  onRequestCollaboration={() => handleOpenTaskCollaboration(run)}
                />
              )}
            </div>
          ))}
        </div>

        {sessionsModalOpen && (
          <div
            className="models-modal-overlay"
            onClick={() => setSessionsModalOpen(false)}
          >
            <div
              className="sessions-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <Sessions
                onResumeSession={(id) => {
                  setSessionsModalOpen(false);
                  void handleResumeSession(id);
                }}
                onNewChat={() => {
                  setSessionsModalOpen(false);
                  handleNewTask();
                }}
                currentSessionId={currentSessionId}
                visible={sessionsModalOpen}
              />
            </div>
          </div>
        )}

        {visitedViews.has("discover") && (
          <div style={paneStyle("discover")}>
            <Discover
              profile={activeProfile}
              visible={view === "discover"}
              focusKind={discoverFocus ?? undefined}
            />
          </div>
        )}

        {visitedViews.has("agents") && (
          <div style={paneStyle("agents")}>
            <Agents
              onChatWithRuntime={handleChatWithRuntime}
            />
          </div>
        )}

        {visitedViews.has("office") && (
          <div style={paneStyle("office")}>
            <Office profile={activeProfile} visible={view === "office"} />
          </div>
        )}

        {visitedViews.has("providers") && (
          <div style={paneStyle("providers")}>
            <Providers profile={activeProfile} visible={view === "providers"} />
          </div>
        )}

        {visitedViews.has("skills") && (
          <div style={paneStyle("skills")}>
            <Skills profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("memory") && (
          <div style={paneStyle("memory")}>
            <Memory profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("tools") && (
          <div style={paneStyle("tools")}>
            <Tools
              profile={activeProfile}
              showPlatformToolsets
              remoteMode={remoteMode}
              visible={view === "tools"}
              onBrowseSkills={() => focusDiscover("skills")}
              onBrowseMcps={() => focusDiscover("mcps")}
            />
          </div>
        )}

        {visitedViews.has("schedules") && (
          <div style={paneStyle("schedules")}>
            <Schedules profile={activeProfile} />
          </div>
        )}

        {visitedViews.has("gateway") && (
          <div style={paneStyle("gateway")}>
            <Gateway profile={activeProfile} />
          </div>
        )}

        <QuickChatPanel
          open={quickChatOpen}
          runtimes={runtimeList}
          profile={activeProfile}
          defaultRuntimeId={
            quickChatRuntimeId ??
            activeRun?.runtimeId ??
            defaultRuntime?.id ??
            null
          }
          currentTaskTitle={activeRun?.title ?? null}
          onClose={() => setQuickChatOpen(false)}
          onAddToTask={handleAddQuickChatToTask}
        />
        {collaborationDraft && (
          <TaskCollaborationDialog
            draft={collaborationDraft}
            runtimes={runtimeList}
            onClose={() => setCollaborationDraft(null)}
            onStart={handleStartTaskCollaboration}
          />
        )}
        {collaborationWorkspace && (
          <TaskCollaborationWorkspace
            state={collaborationWorkspace}
            runtimes={runtimeList}
            onClose={() => setCollaborationWorkspace(null)}
            onConfigure={() => {
              setCollaborationDraft({
                runId: collaborationWorkspace.runId,
                taskId: collaborationWorkspace.taskId,
                title: collaborationWorkspace.title,
                projectFolder: collaborationWorkspace.projectFolder,
                sourceRuntimeId: collaborationWorkspace.sourceRuntimeId,
                assignments: collaborationWorkspace.assignments,
              });
              setCollaborationWorkspace(null);
            }}
            onStart={handleStartCollaboration}
            onOpenTask={() => {
              setCollaborationWorkspace(null);
              goTo("chat");
            }}
          />
        )}
      </main>
    </div>
  );
}

export default Layout;
