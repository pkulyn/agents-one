import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../components/useI18n";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeKind,
} from "../../../../shared/agent-runtimes";
import type { ProjectFolderRecord } from "../../../../shared/project-folders";
import type { RuntimeConversationSummary } from "../../../../shared/runtime-conversations";
import type { TaskCollaborationRecord } from "../../../../shared/task-collaboration";
import type { ArchivedItem } from "../../../../shared/archives";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Folder,
  Loader,
  MoreHorizontal,
  Plus,
  X,
} from "../../assets/icons";
import SidebarSessionMenu, {
  type SidebarMenuProject,
  type SidebarMenuTarget,
} from "./SidebarSessionMenu";
import SidebarProjectMenu, {
  type SidebarProjectMenuTarget,
} from "./SidebarProjectMenu";
import { consumeNativeSessionPage } from "./sidebarSessionPagination";

interface RecentSession {
  id: string;
  title: string;
  contextFolder?: string | null;
  updatedAt?: number;
  runtimeId?: string;
  runtimeName?: string;
  runtimeKind?: AgentRuntimeKind;
  runtimeLocation?: "local" | "remote";
  runtimeColor?: string;
  runtimeAvatar?: string | null;
  runtimeSessionId?: string;
  messageCount?: number;
}

type RecentSessionRow = RecentSession & {
  startedAt?: number;
};

// ChatGPT-style paged conversation list under the pinned app navigation.
export const RECENT_SESSIONS_PAGE_SIZE = 30;

// Re-sync cadence while the list is visible. Deliberately slower than the
// Sessions screen (30s) — the sidebar is always on screen, so this interval
// runs for the whole app lifetime when the section is expanded.
const RECENT_REFRESH_MS = 60_000;

// Minimum gap between event-driven refreshes (focus, session switch) so a
// burst of focus/blur events doesn't hammer state.db.
const REFRESH_THROTTLE_MS = 5_000;
const INFINITE_SCROLL_THRESHOLD_PX = 180;
const EQUIVALENT_CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const PROJECTS_OPEN_KEY = "hermes.sidebar.projectsOpen";
const CHATS_OPEN_KEY = "hermes.sidebar.chatsOpen";
const FOLDERS_CLOSED_KEY = "hermes.sidebar.closedProjectFolders";
const PINNED_OPEN_KEY = "hermes.sidebar.pinnedOpen";
const QUICK_CHAT_STORAGE_KEY = "agents-one.quick-chats.v1";
const QUICK_CHAT_HIDDEN_SESSION_IDS_KEY =
  "agents-one.quick-chat.hidden-task-session-ids.v1";
// Pinned session ids live in localStorage like the disclosure state — pinning
// is a desktop-only UI affordance, not part of the agent session schema.
const PINNED_IDS_KEY = "hermes.sidebar.pinnedSessions";
const HERMES_RUNTIME_APPEARANCE_KEY = "__hermes__";

interface RuntimeAppearance {
  id: string;
  name: string;
  kind: AgentRuntimeKind;
  color?: string;
  avatar?: string | null;
}

function readStoredPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storePinned(ids: Set<string>): void {
  try {
    localStorage.setItem(PINNED_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore persistence failures */
  }
}

function readQuickChatHiddenSessionIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const raw = localStorage.getItem(QUICK_CHAT_HIDDEN_SESSION_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const id of parsed) {
        if (typeof id === "string" && id) ids.add(id);
      }
    }
  } catch {
    /* ignore malformed optional state */
  }
  try {
    const raw = localStorage.getItem(QUICK_CHAT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      for (const chat of parsed) {
        const id = chat?.runtimeSessionId;
        if (typeof id === "string" && id) ids.add(id);
      }
    }
  } catch {
    /* ignore malformed optional state */
  }
  return ids;
}

function hideQuickChatSessions(
  sessions: RecentSessionRow[],
): RecentSessionRow[] {
  const hidden = readQuickChatHiddenSessionIds();
  if (hidden.size === 0) return sessions;
  return sessions.filter((session) => !hidden.has(session.id));
}

function runtimeAppearanceFrom(
  runtimes: AgentRuntimeDefinition[],
): Record<string, RuntimeAppearance> {
  const appearances: Record<string, RuntimeAppearance> = {};
  for (const runtime of runtimes) {
    const appearance = {
      id: runtime.id,
      name: runtime.name,
      kind: runtime.kind,
      color: runtime.color,
      avatar: runtime.avatar,
    };
    appearances[runtime.id] = appearance;
    appearances[`kind:${runtime.kind}`] ??= appearance;
    appearances[`name:${runtime.name.trim().toLowerCase()}`] ??= appearance;
    if (
      runtime.kind === "hermes" &&
      !appearances[HERMES_RUNTIME_APPEARANCE_KEY]
    ) {
      appearances[HERMES_RUNTIME_APPEARANCE_KEY] = appearance;
    }
  }
  return appearances;
}

function resolveRuntimeAppearance(
  session: RecentSession,
  appearances: Record<string, RuntimeAppearance>,
): RuntimeAppearance | undefined {
  const id = session.runtimeId?.trim();
  if (id && appearances[id]) return appearances[id];

  const name = session.runtimeName?.trim().toLowerCase();
  if (name && appearances[`name:${name}`]) return appearances[`name:${name}`];

  const kind = session.runtimeKind?.trim();
  if (kind && appearances[`kind:${kind}`]) return appearances[`kind:${kind}`];

  if (!id && (!kind || kind === "hermes")) {
    return appearances[HERMES_RUNTIME_APPEARANCE_KEY];
  }
  return undefined;
}

function readStoredOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "false";
  } catch {
    return true;
  }
}

function readStoredClosedFolders(): Set<string> {
  try {
    const raw = localStorage.getItem(FOLDERS_CLOSED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(String) : []);
  } catch {
    return new Set();
  }
}

function storeClosedFolders(paths: Set<string>): void {
  try {
    localStorage.setItem(FOLDERS_CLOSED_KEY, JSON.stringify(Array.from(paths)));
  } catch {
    /* ignore persistence failures */
  }
}

function sameSessions(a: RecentSession[], b: RecentSession[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].title !== b[i].title ||
      (a[i].contextFolder ?? null) !== (b[i].contextFolder ?? null) ||
      (a[i].updatedAt ?? null) !== (b[i].updatedAt ?? null) ||
      (a[i].runtimeId ?? null) !== (b[i].runtimeId ?? null) ||
      (a[i].runtimeName ?? null) !== (b[i].runtimeName ?? null) ||
      (a[i].runtimeKind ?? null) !== (b[i].runtimeKind ?? null) ||
      (a[i].runtimeLocation ?? null) !== (b[i].runtimeLocation ?? null) ||
      (a[i].runtimeColor ?? null) !== (b[i].runtimeColor ?? null) ||
      (a[i].runtimeAvatar ?? null) !== (b[i].runtimeAvatar ?? null)
    ) {
      return false;
    }
  }
  return true;
}

function mergeSessionRows(
  sessions: RecentSessionRow[],
  runtimeConversations: RuntimeConversationSummary[],
): RecentSessionRow[] {
  const rows = new Map<string, RecentSessionRow>();
  for (const session of sessions) rows.set(session.id, session);
  for (const conversation of runtimeConversations) {
    rows.set(conversation.id, {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      runtimeId: conversation.runtimeId,
      runtimeName: conversation.runtimeName,
      runtimeKind: conversation.runtimeKind,
      runtimeLocation: conversation.runtimeLocation,
      runtimeColor: conversation.runtimeColor,
      runtimeAvatar: conversation.runtimeAvatar,
      runtimeSessionId: conversation.runtimeSessionId,
      messageCount: conversation.messageCount,
      contextFolder: conversation.workspace ?? null,
    });
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      (b.updatedAt ?? b.startedAt ?? 0) - (a.updatedAt ?? a.startedAt ?? 0),
  );
}

function equivalentConversationKey(session: RecentSessionRow): string {
  const agent = session.runtimeId || "hermes";
  const title = (session.title || "").trim().replace(/\s+/g, " ").toLowerCase();
  const folder = (session.contextFolder || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
  return `${agent}:${folder}:${title}`;
}

/** Keep one visible representative of duplicate remote records without
 * deleting their source data. */
function collapseEquivalentConversations(
  sessions: RecentSessionRow[],
): RecentSessionRow[] {
  const newestByKey = new Map<string, RecentSessionRow>();
  const collapsed: RecentSessionRow[] = [];
  for (const session of sessions) {
    const key = equivalentConversationKey(session);
    const previous = newestByKey.get(key);
    const timestamp = session.updatedAt ?? session.startedAt ?? 0;
    const previousTimestamp = previous?.updatedAt ?? previous?.startedAt ?? 0;
    if (
      previous &&
      Math.abs(previousTimestamp - timestamp) <=
        EQUIVALENT_CONVERSATION_WINDOW_MS
    ) {
      continue;
    }
    newestByKey.set(key, session);
    collapsed.push(session);
  }
  return collapsed;
}

function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || path;
}

function newestTimestamp(session: RecentSession): number {
  return session.updatedAt ?? 0;
}

function sortSessionsNewestFirst<T extends RecentSession>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => newestTimestamp(b) - newestTimestamp(a));
}

function groupSessionsByWorkspace(
  sessions: RecentSession[],
  projectFolders: ProjectFolderRecord[] = [],
): {
  projectGroups: Array<{
    path: string;
    name: string;
    sessions: RecentSession[];
    updatedAt: number;
    pinned: boolean;
  }>;
  chats: RecentSession[];
} {
  const projects = new Map<string, RecentSession[]>();
  const folderMeta = new Map<string, ProjectFolderRecord>();
  const chats: RecentSession[] = [];

  for (const folder of projectFolders) {
    const path = folder.path.trim();
    if (!path) continue;
    folderMeta.set(path, folder);
    if (!projects.has(path)) projects.set(path, []);
  }

  for (const session of sessions) {
    const contextFolder = session.contextFolder?.trim();
    if (!contextFolder) {
      chats.push(session);
      continue;
    }
    const existing = projects.get(contextFolder);
    if (existing) existing.push(session);
    else projects.set(contextFolder, [session]);
  }

  return {
    projectGroups: Array.from(projects.entries())
      .map(([path, list]) => {
        const sortedSessions = sortSessionsNewestFirst(list);
        return {
          path,
          name: folderMeta.get(path)?.name || folderName(path),
          sessions: sortedSessions,
          updatedAt: Math.max(
            folderMeta.get(path)?.updatedAt ?? 0,
            sortedSessions[0] ? newestTimestamp(sortedSessions[0]) : 0,
          ),
          pinned: Boolean(folderMeta.get(path)?.pinned),
        };
      })
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
      ),
    chats: sortSessionsNewestFirst(chats),
  };
}

/**
 * Recent-sessions list rendered under the "Sessions" nav item in the sidebar
 * (like ChatGPT's sidebar chat list). Owns its own data so Layout re-renders
 * (view switches, update banners, …) never trigger fetches, and `memo` keeps
 * it off the render hot path entirely.
 *
 * Fetch strategy, cheapest first:
 *  - on open: instant read from the sessions.json cache (no DB), then one
 *    sync against state.db to pick up sessions created since the last sync
 *  - while open: refresh on window focus and on a slow interval, throttled
 *  - closed (collapsed section or icon-only sidebar): zero work, renders null
 */
const SidebarRecentSessions = memo(function SidebarRecentSessions({
  open,
  activeProfile,
  currentSessionId,
  loadingSessionIds,
  resumingSessionId,
  onSelect,
  onSessionDeleted,
  scrollRootRef,
  sectionLabel,
  showSessionFolders = true,
  onCreateProjectFolder,
  onCreateProjectTask,
}: {
  open: boolean;
  /** Active profile — the list is per-profile, so switching forces a reload. */
  activeProfile: string;
  currentSessionId: string | null;
  /** Session ids of every run currently generating (multiple run at once). */
  loadingSessionIds: Set<string>;
  /** A session whose history is being fetched for resume (transient spinner). */
  resumingSessionId: string | null;
  onSelect: (sessionId: string) => void;
  /** Notifies Layout when a row is deleted so it can leave a stale active chat. */
  onSessionDeleted?: (sessionId: string) => void;
  /** Scroll container owned by Layout; nearing its bottom loads the next page. */
  scrollRootRef: RefObject<HTMLDivElement | null>;
  /** Product terminology can present these durable conversations as tasks. */
  sectionLabel?: string;
  /** Shows task conversations grouped by their selected project folder. */
  showSessionFolders?: boolean;
  /** Creates a folder-backed task after a native folder selection. */
  onCreateProjectFolder?: (mode: "new" | "existing") => void;
  /** Starts a normal task within a project folder. Collaboration is established
   * from inside an existing task only after an explicit user confirmation. */
  onCreateProjectTask?: (folder: string) => void;
}): React.JSX.Element | null {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<RecentSession[]>([]);
  // True when the profile has more cache rows than the sidebar has loaded.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(() =>
    readStoredOpen(PROJECTS_OPEN_KEY),
  );
  const [chatsOpen, setChatsOpen] = useState(() =>
    readStoredOpen(CHATS_OPEN_KEY),
  );
  const [closedProjectFolders, setClosedProjectFolders] = useState<Set<string>>(
    () => readStoredClosedFolders(),
  );
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(() =>
    readStoredPinned(),
  );
  const [pinnedOpen, setPinnedOpen] = useState(() =>
    readStoredOpen(PINNED_OPEN_KEY),
  );
  const [runtimeAppearances, setRuntimeAppearances] = useState<
    Record<string, RuntimeAppearance>
  >({});
  const [projectFolders, setProjectFolders] = useState<ProjectFolderRecord[]>(
    [],
  );
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectTaskMenuPath, setProjectTaskMenuPath] = useState<string | null>(
    null,
  );
  const [projectMenuTarget, setProjectMenuTarget] =
    useState<SidebarProjectMenuTarget | null>(null);
  const [editingProjectPath, setEditingProjectPath] = useState<string | null>(
    null,
  );
  const [editingProjectName, setEditingProjectName] = useState("");
  const [archivedItems, setArchivedItems] = useState<ArchivedItem[]>([]);
  const [collaborationTaskIds, setCollaborationTaskIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Row whose context menu is open, anchored to viewport coordinates.
  const [menuTarget, setMenuTarget] = useState<SidebarMenuTarget | null>(null);
  // Inline rename: the row id being edited and its working title.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingIdRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const projectRenameInputRef = useRef<HTMLInputElement>(null);
  const projectRenameCancelledRef = useRef(false);
  // Pending delete confirmation (small inline dialog in a portal-free overlay).
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const lastRefreshRef = useRef(0);
  const sessionsRef = useRef<RecentSession[]>([]);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  // Native Hermes sessions are the only paged source. Runtime conversations
  // are merged separately and must never affect the native cache offset.
  const loadedNativeCountRef = useRef(0);

  const refreshRuntimeAppearances = useCallback((): void => {
    window.hermesAPI
      .listAgentRuntimes()
      .then((runtimes) =>
        setRuntimeAppearances(runtimeAppearanceFrom(runtimes)),
      )
      .catch(() => {
        /* keep last-known runtime appearance */
      });
  }, []);

  const refreshProjectFolders = useCallback((): void => {
    window.hermesAPI
      .listProjectFolders()
      .then((folders) => setProjectFolders(folders))
      .catch(() => {
        /* keep last-known project folder list */
      });
  }, []);

  const refreshArchives = useCallback((): void => {
    window.hermesAPI
      .listArchivedItems(activeProfile)
      .then(setArchivedItems)
      .catch(() => {
        /* keep last-known archive state */
      });
  }, [activeProfile]);

  const refreshCollaborations = useCallback((): void => {
    window.hermesAPI
      .listTaskCollaborations(activeProfile)
      .then((records: TaskCollaborationRecord[]) =>
        setCollaborationTaskIds(
          new Set(
            records.flatMap((record) =>
              record.conversationId
                ? [record.taskId, record.conversationId]
                : [record.taskId],
            ),
          ),
        ),
      )
      .catch(() => {
        /* collaboration hints must not affect task history */
      });
  }, [activeProfile]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  useEffect(() => {
    storePinned(pinnedIds);
  }, [pinnedIds]);

  useEffect(() => {
    if (!open) return;
    refreshRuntimeAppearances();
    refreshProjectFolders();
    refreshCollaborations();
    refreshArchives();
    window.addEventListener(
      "agents-one:runtime-appearance-changed",
      refreshRuntimeAppearances,
    );
    window.addEventListener(
      "agents-one:project-folders-changed",
      refreshProjectFolders,
    );
    window.addEventListener(
      "agents-one:task-collaboration-changed",
      refreshCollaborations,
    );
    window.addEventListener("agents-one:archives-changed", refreshArchives);
    return () => {
      window.removeEventListener(
        "agents-one:runtime-appearance-changed",
        refreshRuntimeAppearances,
      );
      window.removeEventListener(
        "agents-one:project-folders-changed",
        refreshProjectFolders,
      );
      window.removeEventListener(
        "agents-one:task-collaboration-changed",
        refreshCollaborations,
      );
      window.removeEventListener(
        "agents-one:archives-changed",
        refreshArchives,
      );
    };
  }, [
    open,
    refreshArchives,
    refreshCollaborations,
    refreshProjectFolders,
    refreshRuntimeAppearances,
  ]);

  const normalizeRows = useCallback(
    (
      list: RecentSessionRow[],
      limit = RECENT_SESSIONS_PAGE_SIZE,
    ): RecentSession[] =>
      hideQuickChatSessions(list)
        .slice(0, limit)
        .map((row) => {
          const {
            id,
            title,
            contextFolder,
            updatedAt,
            runtimeId,
            runtimeName,
            runtimeKind,
            runtimeLocation,
            runtimeSessionId,
            messageCount,
          } = row;
          return {
            id,
            title,
            contextFolder: contextFolder?.trim() || null,
            updatedAt,
            runtimeId,
            runtimeName,
            runtimeKind,
            runtimeLocation,
            runtimeSessionId,
            messageCount,
          };
        }),
    [],
  );

  const applyFirstPage = useCallback(
    (list: RecentSessionRow[], nativeHasMore: boolean): void => {
      const collapsed = collapseEquivalentConversations(
        hideQuickChatSessions(list),
      );
      setHasMore(nativeHasMore);
      const next = normalizeRows(collapsed, collapsed.length);
      // Skip the state update (and re-render) when nothing changed — the
      // common case for periodic refreshes.
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const applyLoadedWindow = useCallback(
    (list: RecentSessionRow[], nativeHasMore: boolean): void => {
      const collapsed = collapseEquivalentConversations(
        hideQuickChatSessions(list),
      );
      setHasMore(nativeHasMore);
      const next = normalizeRows(collapsed, collapsed.length);
      setSessions((prev) => (sameSessions(prev, next) ? prev : next));
    },
    [normalizeRows],
  );

  const appendPage = useCallback(
    (list: RecentSessionRow[], nativeHasMore: boolean): void => {
      const filtered = hideQuickChatSessions(list);
      setHasMore(nativeHasMore);
      const collapsed = collapseEquivalentConversations(filtered);
      const page = normalizeRows(collapsed, collapsed.length);
      if (page.length === 0) return;
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        const next = [...prev];
        for (const session of page) {
          if (!seen.has(session.id)) next.push(session);
        }
        return sameSessions(prev, next) ? prev : next;
      });
    },
    [normalizeRows],
  );

  const refresh = useCallback(
    async (force = false): Promise<void> => {
      const now = Date.now();
      if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
      lastRefreshRef.current = now;
      try {
        const [synced, runtimeConversations] = await Promise.all([
          window.hermesAPI.syncSessionCache().catch(() => []),
          window.hermesAPI
            .listRuntimeConversations(activeProfile, 100)
            .catch(() => []),
        ]);
        const nativeLimit = Math.max(
          RECENT_SESSIONS_PAGE_SIZE,
          loadedNativeCountRef.current,
        );
        const nativeWindow = synced.slice(0, nativeLimit);
        loadedNativeCountRef.current = nativeWindow.length;
        applyLoadedWindow(
          mergeSessionRows(nativeWindow, runtimeConversations),
          synced.length > nativeWindow.length,
        );
      } catch {
        // keep whatever we had — the list is best-effort UI sugar
      }
    },
    [activeProfile, applyLoadedWindow],
  );

  useEffect(() => {
    if (!open || Object.keys(runtimeAppearances).length === 0) return;
    void refresh(true);
  }, [open, refresh, runtimeAppearances]);

  const loadNextPage = useCallback(async (): Promise<void> => {
    if (!open || !hasMoreRef.current || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const nextPage = await window.hermesAPI
        .listCachedSessions(
          RECENT_SESSIONS_PAGE_SIZE + 1,
          loadedNativeCountRef.current,
        )
        .catch(() => []);
      const consumed = consumeNativeSessionPage(
        nextPage,
        loadedNativeCountRef.current,
        RECENT_SESSIONS_PAGE_SIZE,
      );
      loadedNativeCountRef.current = consumed.nextOffset;
      appendPage(consumed.rows, consumed.hasMore);
    } catch {
      // keep the current list; scrolling can retry on the next event
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [appendPage, open]);

  const maybeLoadNextPage = useCallback((): void => {
    const root = scrollRootRef.current;
    if (!projectsOpen && !chatsOpen) return;
    if (!root || !hasMoreRef.current || loadingMoreRef.current) return;
    const remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
    if (remaining <= INFINITE_SCROLL_THRESHOLD_PX) void loadNextPage();
  }, [chatsOpen, loadNextPage, projectsOpen, scrollRootRef]);

  // Initial load when the section opens: paint from the JSON cache
  // immediately (no DB access), then sync once for anything new.
  // Sequenced so sync always wins over cache (avoids race where stale
  // cache overwrites fresh sync if sync resolves first).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const nativeWindowSize = Math.max(
          RECENT_SESSIONS_PAGE_SIZE,
          loadedNativeCountRef.current,
        );
        const [cached, runtimeConversations] = await Promise.all([
          window.hermesAPI
            .listCachedSessions(
              // One over the page size so the cache read alone can decide whether
              // another page exists without a separate count query.
              nativeWindowSize + 1,
            )
            .catch(() => []),
          window.hermesAPI
            .listRuntimeConversations(activeProfile, 100)
            .catch(() => []),
        ]);
        if (!cancelled) {
          const consumed = consumeNativeSessionPage(
            cached,
            0,
            nativeWindowSize,
          );
          loadedNativeCountRef.current = consumed.nextOffset;
          applyFirstPage(
            mergeSessionRows(consumed.rows, runtimeConversations),
            consumed.hasMore,
          );
        }
      } catch {
        /* ignore cache read errors */
      }
      lastRefreshRef.current = Date.now();
      try {
        const [synced, runtimeConversations] = await Promise.all([
          window.hermesAPI.syncSessionCache().catch(() => []),
          window.hermesAPI
            .listRuntimeConversations(activeProfile, 100)
            .catch(() => []),
        ]);
        if (!cancelled) {
          const nativeWindowSize = Math.max(
            RECENT_SESSIONS_PAGE_SIZE,
            loadedNativeCountRef.current,
          );
          const consumed = consumeNativeSessionPage(
            synced,
            0,
            nativeWindowSize,
          );
          loadedNativeCountRef.current = consumed.nextOffset;
          applyFirstPage(
            mergeSessionRows(consumed.rows, runtimeConversations),
            consumed.hasMore,
          );
        }
      } catch {
        // cache read above already painted something
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeProfile, applyFirstPage]);

  // While open: pick up background sessions (gateway, cron, other devices)
  // on focus and on a slow timer. No listeners or timers at all when closed.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void refresh(), RECENT_REFRESH_MS);
    const onFocus = (): void => {
      void refresh();
    };
    const onContextFolderChanged = (): void => {
      void refresh(true);
    };
    const onTranscriptChanged = (): void => {
      void refresh(true);
    };
    const onHiddenSessionsChanged = (): void => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(
      "hermes-session-context-folder-changed",
      onContextFolderChanged,
    );
    window.addEventListener(
      "hermes-session-transcript-changed",
      onTranscriptChanged,
    );
    window.addEventListener(
      "agents-one:hidden-task-sessions-changed",
      onHiddenSessionsChanged,
    );
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "hermes-session-context-folder-changed",
        onContextFolderChanged,
      );
      window.removeEventListener(
        "hermes-session-transcript-changed",
        onTranscriptChanged,
      );
      window.removeEventListener(
        "agents-one:hidden-task-sessions-changed",
        onHiddenSessionsChanged,
      );
    };
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const root = scrollRootRef.current;
    if (!root) return;
    const onScroll = (): void => {
      maybeLoadNextPage();
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    maybeLoadNextPage();
    return () => {
      root.removeEventListener("scroll", onScroll);
    };
  }, [maybeLoadNextPage, open, scrollRootRef]);

  // If the first page does not fill the sidebar, keep paging until the scroll
  // container has real overflow or the cache runs out.
  useEffect(() => {
    if (open) maybeLoadNextPage();
  }, [hasMore, maybeLoadNextPage, open, sessions.length]);

  // Resuming/switching sessions reorders recency — refresh (throttled).
  // Also refreshes when going to "New Chat" (currentSessionId becomes null)
  // so the just-left session appears in the list immediately.
  useEffect(() => {
    if (open) void refresh();
  }, [open, currentSessionId, refresh]);

  // Switching agent points the list at a different profile's DB. Force a
  // reload immediately (bypassing the throttle) so the list isn't stale.
  const prevProfileRef = useRef(activeProfile);
  useEffect(() => {
    if (prevProfileRef.current === activeProfile) return;
    prevProfileRef.current = activeProfile;
    loadedNativeCountRef.current = 0;
    void refresh(true);
  }, [activeProfile, refresh]);

  // Keep the wrapper mounted so the collapse/expand animates with CSS grid
  // tracks. Effects above are still gated on `open`, so a collapsed sidebar
  // does no fetching while keeping the last-loaded list ready to animate.
  const expanded = open;

  // Pinned rows are pulled out of the normal grouping and shown in their own
  // section at the top (ChatGPT-style), preserving recency order.
  const archivedTaskIds = useMemo(
    () =>
      new Set(
        archivedItems
          .filter((item) => item.kind === "task")
          .map((item) => item.targetId),
      ),
    [archivedItems],
  );
  const archivedProjectPaths = useMemo(
    () =>
      new Set(
        archivedItems
          .filter((item) => item.kind === "project")
          .map((item) => item.targetId),
      ),
    [archivedItems],
  );
  const visibleSessions = useMemo(
    () =>
      sessions.filter(
        (session) =>
          !archivedTaskIds.has(session.id) &&
          !(
            session.contextFolder &&
            archivedProjectPaths.has(session.contextFolder)
          ),
      ),
    [archivedProjectPaths, archivedTaskIds, sessions],
  );
  const visibleProjectFolders = useMemo(
    () =>
      projectFolders.filter((folder) => !archivedProjectPaths.has(folder.path)),
    [archivedProjectPaths, projectFolders],
  );
  const pinnedSessions = useMemo(
    () =>
      sortSessionsNewestFirst(
        visibleSessions.filter((s) => pinnedIds.has(s.id)),
      ),
    [visibleSessions, pinnedIds],
  );
  const { projectGroups, chats } = useMemo(
    () =>
      groupSessionsByWorkspace(
        visibleSessions.filter((s) => !pinnedIds.has(s.id)),
        visibleProjectFolders,
      ),
    [visibleProjectFolders, visibleSessions, pinnedIds],
  );

  // Every distinct project folder currently in use, so "Move to project" lists
  // them all — even ones whose only conversation is pinned or filtered out.
  const projectChoices = useMemo<SidebarMenuProject[]>(() => {
    const byPath = new Map<string, SidebarMenuProject>();
    for (const s of sessions) {
      const folder = s.contextFolder?.trim();
      if (folder && !byPath.has(folder)) {
        byPath.set(folder, { path: folder, name: folderName(folder) });
      }
    }
    for (const folder of projectFolders) {
      if (folder.path && !byPath.has(folder.path)) {
        byPath.set(folder.path, { path: folder.path, name: folder.name });
      }
    }
    return Array.from(byPath.values());
  }, [projectFolders, sessions]);

  const togglePinned = (): void => {
    setPinnedOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PINNED_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const handleTogglePin = useCallback((id: string): void => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const archiveTask = useCallback(
    async (id: string): Promise<void> => {
      const session = sessionsRef.current.find((item) => item.id === id);
      if (!session) return;
      await window.hermesAPI.archiveItem(
        {
          kind: "task",
          targetId: session.id,
          title: session.title || "未命名任务",
          ...(session.contextFolder
            ? { projectPath: session.contextFolder }
            : {}),
          ...(session.runtimeId ? { runtimeId: session.runtimeId } : {}),
        },
        activeProfile,
      );
      setPinnedIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      refreshArchives();
      window.dispatchEvent(new Event("agents-one:archives-changed"));
    },
    [activeProfile, refreshArchives],
  );

  const archiveProject = useCallback(
    async (path: string, name: string): Promise<void> => {
      await window.hermesAPI.archiveItem(
        { kind: "project", targetId: path, title: name, projectPath: path },
        activeProfile,
      );
      setProjectMenuTarget(null);
      refreshArchives();
      window.dispatchEvent(new Event("agents-one:archives-changed"));
    },
    [activeProfile, refreshArchives],
  );

  const toggleProjectPin = useCallback(
    async (path: string, pinned: boolean): Promise<void> => {
      setProjectFolders((current) =>
        current.map((folder) =>
          folder.path === path
            ? { ...folder, pinned: !pinned, updatedAt: Date.now() }
            : folder,
        ),
      );
      await window.hermesAPI.updateProjectFolder({ path, pinned: !pinned });
      refreshProjectFolders();
    },
    [refreshProjectFolders],
  );

  const startProjectRename = useCallback((path: string, name: string): void => {
    projectRenameCancelledRef.current = false;
    setEditingProjectPath(path);
    setEditingProjectName(name);
    setTimeout(() => {
      projectRenameInputRef.current?.focus();
      projectRenameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelProjectRename = useCallback((): void => {
    setEditingProjectPath(null);
    setEditingProjectName("");
  }, []);

  const confirmProjectRename = useCallback(async (): Promise<void> => {
    const path = editingProjectPath;
    const name = editingProjectName.trim();
    if (!path || !name) {
      cancelProjectRename();
      return;
    }
    setProjectFolders((current) =>
      current.map((folder) =>
        folder.path === path
          ? { ...folder, name, updatedAt: Date.now() }
          : folder,
      ),
    );
    cancelProjectRename();
    await window.hermesAPI.updateProjectFolder({ path, name });
    refreshProjectFolders();
  }, [
    cancelProjectRename,
    editingProjectName,
    editingProjectPath,
    refreshProjectFolders,
  ]);

  const removeProject = useCallback(
    async (path: string): Promise<void> => {
      await window.hermesAPI.removeProjectFolder(path, activeProfile);
      setSessions((current) =>
        current.map((session) =>
          session.contextFolder === path
            ? { ...session, contextFolder: null }
            : session,
        ),
      );
      setProjectFolders((current) =>
        current.filter((folder) => folder.path !== path),
      );
      setProjectMenuTarget(null);
      window.dispatchEvent(new Event("hermes-session-context-folder-changed"));
    },
    [activeProfile],
  );

  const startRename = useCallback((s: RecentSession): void => {
    setEditingId(s.id);
    setEditingTitle(s.title || "");
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, []);

  const cancelRename = useCallback((): void => {
    setEditingId(null);
    setEditingTitle("");
  }, []);

  const confirmRename = useCallback(
    async (id: string, value: string): Promise<void> => {
      const trimmed = value.trim();
      const current = sessionsRef.current.find((s) => s.id === id);
      if (!trimmed || trimmed === (current?.title ?? "")) {
        cancelRename();
        return;
      }
      const previous = current?.title ?? "";
      // Optimistic local update; roll back if the write fails.
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title: trimmed } : s)),
      );
      if (editingIdRef.current === id) cancelRename();
      try {
        if (current?.runtimeId) {
          await window.hermesAPI.updateRuntimeConversationTitle(
            id,
            trimmed,
            activeProfile,
          );
        } else {
          await window.hermesAPI.updateSessionTitle(id, trimmed);
        }
      } catch (err) {
        console.error("Failed to rename session", id, err);
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title: previous } : s)),
        );
      }
    },
    [activeProfile, cancelRename],
  );

  const handleMoveToProject = useCallback(
    async (id: string, folder: string | null): Promise<void> => {
      const normalized = folder?.trim() || null;
      const current = sessionsRef.current.find((s) => s.id === id);
      if (current?.runtimeId) return;
      if ((current?.contextFolder ?? null) === normalized) return;
      const previous = current?.contextFolder ?? null;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, contextFolder: normalized } : s,
        ),
      );
      try {
        await window.hermesAPI.setSessionContextFolder(id, normalized);
        // Other surfaces (chat view, Sessions screen) listen for this to
        // refresh their own grouping.
        window.dispatchEvent(
          new CustomEvent("hermes-session-context-folder-changed"),
        );
      } catch (err) {
        console.error("Failed to move session to project", id, err);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, contextFolder: previous } : s,
          ),
        );
      }
    },
    [],
  );

  const handlePickNewFolder = useCallback(
    async (id: string): Promise<void> => {
      try {
        const folder = await window.hermesAPI.selectFolder();
        if (folder) await handleMoveToProject(id, folder);
      } catch (err) {
        console.error("Folder selection failed", err);
      }
    },
    [handleMoveToProject],
  );

  const confirmDelete = useCallback(
    async (id: string): Promise<void> => {
      const current = sessionsRef.current.find((s) => s.id === id);
      setDeleting(true);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setPinnedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        if (current?.runtimeId) {
          await window.hermesAPI.deleteRuntimeConversation(id, activeProfile);
        } else {
          await window.hermesAPI.deleteSession(id);
        }
        onSessionDeleted?.(id);
      } catch (err) {
        console.error("Failed to delete session", id, err);
      } finally {
        setDeleting(false);
        setPendingDeleteId(null);
        void refresh(true);
      }
    },
    [activeProfile, onSessionDeleted, refresh],
  );

  const openMenuForSession = useCallback(
    (s: RecentSession, x: number, y: number): void => {
      setProjectMenuTarget(null);
      setMenuTarget({
        id: s.id,
        title: s.title,
        contextFolder: s.contextFolder ?? null,
        runtimeId: s.runtimeId,
        x,
        y,
      });
    },
    [],
  );

  const toggleProjects = (): void => {
    setProjectsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PROJECTS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleChats = (): void => {
    setChatsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CHATS_OPEN_KEY, String(next));
      } catch {
        /* ignore persistence failures */
      }
      return next;
    });
  };

  const toggleProjectFolder = (path: string): void => {
    setClosedProjectFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      storeClosedFolders(next);
      return next;
    });
  };

  const renderSessionButton = (
    s: RecentSession,
    project = false,
    visible = expanded,
  ): React.JSX.Element => {
    const title = s.title || t("sessions.newConversation");
    const loading = resumingSessionId === s.id || loadingSessionIds.has(s.id);
    const active = !loading && currentSessionId === s.id;
    const editing = editingId === s.id;
    const menuOpen = menuTarget?.id === s.id;
    const runtimeAppearance = resolveRuntimeAppearance(s, runtimeAppearances);
    const runtimeLabel =
      runtimeAppearance?.name?.trim() || s.runtimeName?.trim() || "Hermes";
    const runtimeKind = runtimeAppearance?.kind ?? s.runtimeKind ?? "hermes";
    const runtimeColor = runtimeAppearance?.color ?? s.runtimeColor;
    const runtimeAvatar = runtimeAppearance?.avatar ?? s.runtimeAvatar;
    const isCollaboration = collaborationTaskIds.has(s.id);

    if (editing) {
      return (
        <div
          key={s.id}
          className={`sidebar-recent-session ${
            project ? "project-child" : ""
          } editing`}
        >
          <input
            ref={renameInputRef}
            className="sidebar-recent-session-rename"
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmRename(s.id, editingTitle);
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelRename();
              }
            }}
            onBlur={() => void confirmRename(s.id, editingTitle)}
            tabIndex={visible ? 0 : -1}
          />
        </div>
      );
    }

    // `div role=button` (not <button>) so the trailing "options" control can be
    // a real nested button without invalid button-in-button markup.
    return (
      <div
        key={s.id}
        role="button"
        tabIndex={visible ? 0 : -1}
        className={`sidebar-recent-session ${project ? "project-child" : ""} ${
          active ? "active" : ""
        } ${menuOpen ? "menu-open" : ""}`}
        onClick={() => onSelect(s.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(s.id);
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuForSession(s, e.clientX, e.clientY);
        }}
        title={title}
      >
        {loading ? (
          <Loader
            className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
            size={11}
          />
        ) : (
          <span
            className={`sidebar-recent-session-agent ${runtimeKind}`}
            style={
              runtimeColor
                ? { background: runtimeColor, color: "#fff" }
                : undefined
            }
          >
            {runtimeAvatar ? (
              <img src={runtimeAvatar} alt="" />
            ) : (
              <Bot size={12} />
            )}
          </span>
        )}
        <span className="sidebar-recent-session-text">
          {runtimeLabel && (
            <span className="sidebar-recent-session-agent-name">
              {runtimeLabel}
            </span>
          )}
          {isCollaboration ? (
            <span className="sidebar-recent-session-collaboration">协作</span>
          ) : null}
          <span className="sidebar-recent-session-title">{title}</span>
        </span>
        <button
          type="button"
          className="sidebar-recent-session-options"
          tabIndex={visible ? 0 : -1}
          aria-label={t("navigation.sessionMenu.options")}
          title={t("navigation.sessionMenu.options")}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openMenuForSession(s, rect.right, rect.bottom + 4);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
    );
  };

  return (
    <div
      className={`sidebar-recent-sessions-wrap ${expanded ? "expanded" : ""}`}
      aria-hidden={!expanded}
    >
      <div className="sidebar-recent-sessions">
        {pinnedSessions.length > 0 && (
          <div className="sidebar-recent-section">
            <button
              type="button"
              className="sidebar-recent-section-toggle"
              onClick={togglePinned}
              aria-expanded={pinnedOpen}
              tabIndex={expanded ? 0 : -1}
            >
              <span>{t("navigation.pinned")}</span>
              {pinnedOpen ? (
                <ChevronDown
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              ) : (
                <ChevronRight
                  className="sidebar-recent-disclosure-icon"
                  size={13}
                />
              )}
            </button>
            <div
              className={`sidebar-recent-collapse ${
                pinnedOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {pinnedSessions.map((s) =>
                  renderSessionButton(s, false, expanded && pinnedOpen),
                )}
              </div>
            </div>
          </div>
        )}
        {showSessionFolders && (
          <div className="sidebar-recent-section">
            <div className="sidebar-recent-section-heading">
              <button
                type="button"
                className="sidebar-recent-section-toggle"
                onClick={toggleProjects}
                aria-expanded={projectsOpen}
                tabIndex={expanded ? 0 : -1}
              >
                <span>{t("navigation.projects")}</span>
                {projectsOpen ? (
                  <ChevronDown
                    className="sidebar-recent-disclosure-icon"
                    size={13}
                  />
                ) : (
                  <ChevronRight
                    className="sidebar-recent-disclosure-icon"
                    size={13}
                  />
                )}
              </button>
              {onCreateProjectFolder ? (
                <button
                  type="button"
                  className="sidebar-recent-new-project"
                  title="新建项目"
                  aria-label="新建项目"
                  onClick={() => setProjectMenuOpen((open) => !open)}
                  tabIndex={expanded ? 0 : -1}
                >
                  <Plus size={15} />
                </button>
              ) : null}
              {projectMenuOpen && onCreateProjectFolder ? (
                <div className="sidebar-project-create-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onCreateProjectFolder("new");
                    }}
                  >
                    <Plus size={15} />
                    新建空白文件夹
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProjectMenuOpen(false);
                      onCreateProjectFolder("existing");
                    }}
                  >
                    <Folder size={15} />
                    使用现有文件夹
                  </button>
                </div>
              ) : null}
            </div>
            <div
              className={`sidebar-recent-collapse ${
                projectsOpen ? "expanded" : ""
              }`}
            >
              <div className="sidebar-recent-collapse-inner">
                {projectGroups.length === 0 ? (
                  <div className="sidebar-recent-empty">
                    选择项目文件夹后，相关任务会显示在这里。
                  </div>
                ) : (
                  projectGroups.map((group) => {
                    const projectOpen = !closedProjectFolders.has(group.path);
                    const visible = expanded && projectsOpen && projectOpen;
                    return (
                      <div className="sidebar-recent-project" key={group.path}>
                        <div className="sidebar-recent-project-heading-wrap">
                          {editingProjectPath === group.path ? (
                            <input
                              ref={projectRenameInputRef}
                              className="sidebar-recent-project-rename"
                              value={editingProjectName}
                              onChange={(event) =>
                                setEditingProjectName(event.target.value)
                              }
                              onKeyDown={(event) => {
                                event.stopPropagation();
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  void confirmProjectRename();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  projectRenameCancelledRef.current = true;
                                  cancelProjectRename();
                                }
                              }}
                              onBlur={() => {
                                if (projectRenameCancelledRef.current) {
                                  projectRenameCancelledRef.current = false;
                                  return;
                                }
                                void confirmProjectRename();
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              className="sidebar-recent-project-heading"
                              title={group.path}
                              onClick={() => toggleProjectFolder(group.path)}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                setMenuTarget(null);
                                setProjectMenuTarget({
                                  path: group.path,
                                  name: group.name,
                                  pinned: group.pinned,
                                  x: event.clientX,
                                  y: event.clientY,
                                });
                              }}
                              aria-expanded={projectOpen}
                              tabIndex={expanded && projectsOpen ? 0 : -1}
                            >
                              <Folder size={13} />
                              <span>{group.name}</span>
                              {projectOpen ? (
                                <ChevronDown
                                  className="sidebar-recent-disclosure-icon"
                                  size={12}
                                />
                              ) : (
                                <ChevronRight
                                  className="sidebar-recent-disclosure-icon"
                                  size={12}
                                />
                              )}
                            </button>
                          )}
                          {onCreateProjectTask ? (
                            <button
                              type="button"
                              className="sidebar-recent-project-task-add"
                              title={`在${group.name}中新建任务`}
                              aria-label={`在${group.name}中新建任务`}
                              tabIndex={expanded && projectsOpen ? 0 : -1}
                              onClick={() =>
                                setProjectTaskMenuPath((path) =>
                                  path === group.path ? null : group.path,
                                )
                              }
                            >
                              <Plus size={14} />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="sidebar-recent-project-task-add"
                            title="项目操作"
                            aria-label={`${group.name}项目操作`}
                            onClick={(event) => {
                              const rect =
                                event.currentTarget.getBoundingClientRect();
                              setMenuTarget(null);
                              setProjectMenuTarget({
                                path: group.path,
                                name: group.name,
                                pinned: group.pinned,
                                x: rect.right,
                                y: rect.bottom + 4,
                              });
                            }}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                          {projectTaskMenuPath === group.path &&
                          onCreateProjectTask ? (
                            <div
                              className="sidebar-project-task-create-menu"
                              role="menu"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setProjectTaskMenuPath(null);
                                  onCreateProjectTask(group.path);
                                }}
                              >
                                <Plus size={14} />
                                新建任务
                              </button>
                            </div>
                          ) : null}
                        </div>
                        <div
                          className={`sidebar-recent-collapse ${
                            projectOpen ? "expanded" : ""
                          }`}
                        >
                          <div className="sidebar-recent-collapse-inner">
                            {group.sessions.map((s) =>
                              renderSessionButton(s, true, visible),
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}
        <div className="sidebar-recent-section">
          <button
            type="button"
            className="sidebar-recent-section-toggle"
            onClick={toggleChats}
            aria-expanded={chatsOpen}
            tabIndex={expanded ? 0 : -1}
          >
            <span>{sectionLabel || t("navigation.chats")}</span>
            {chatsOpen ? (
              <ChevronDown
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            ) : (
              <ChevronRight
                className="sidebar-recent-disclosure-icon"
                size={13}
              />
            )}
          </button>
          <div
            className={`sidebar-recent-collapse ${chatsOpen ? "expanded" : ""}`}
          >
            <div className="sidebar-recent-collapse-inner">
              {chats.length > 0 ? (
                chats.map((s) =>
                  renderSessionButton(s, false, expanded && chatsOpen),
                )
              ) : (
                <div className="sidebar-recent-empty">
                  {t("navigation.noChats")}
                </div>
              )}
            </div>
          </div>
        </div>
        {loadingMore && (
          <div className="sidebar-recent-loading" aria-live="polite">
            <Loader
              className="sidebar-recent-session-dot sidebar-recent-session-dot--loading"
              size={11}
            />
            <span>{t("common.loadingShort")}</span>
          </div>
        )}
      </div>
      {expanded && menuTarget && (
        <SidebarSessionMenu
          target={menuTarget}
          isPinned={pinnedIds.has(menuTarget.id)}
          projects={projectChoices}
          scrollContainer={scrollRootRef.current}
          onClose={() => setMenuTarget(null)}
          onTogglePin={() => handleTogglePin(menuTarget.id)}
          onRename={() => {
            const s = sessions.find((row) => row.id === menuTarget.id);
            if (s) startRename(s);
          }}
          onMoveToProject={(path) =>
            void handleMoveToProject(menuTarget.id, path)
          }
          onPickNewFolder={() => void handlePickNewFolder(menuTarget.id)}
          onCopySessionId={() =>
            void window.hermesAPI.copyToClipboard(menuTarget.id)
          }
          onReveal={() => {
            if (menuTarget.contextFolder) {
              void window.hermesAPI.openFileInEditor(menuTarget.contextFolder);
            }
          }}
          onArchive={() => void archiveTask(menuTarget.id)}
          onDelete={() => setPendingDeleteId(menuTarget.id)}
        />
      )}
      {expanded && projectMenuTarget ? (
        <SidebarProjectMenu
          target={projectMenuTarget}
          scrollContainer={scrollRootRef.current}
          onClose={() => setProjectMenuTarget(null)}
          onTogglePin={() =>
            void toggleProjectPin(
              projectMenuTarget.path,
              projectMenuTarget.pinned,
            )
          }
          onReveal={() =>
            void window.hermesAPI.openFileInEditor(projectMenuTarget.path)
          }
          onRename={() =>
            startProjectRename(projectMenuTarget.path, projectMenuTarget.name)
          }
          onArchive={() =>
            void archiveProject(projectMenuTarget.path, projectMenuTarget.name)
          }
          onRemove={() => void removeProject(projectMenuTarget.path)}
        />
      ) : null}
      {pendingDeleteId &&
        createPortal(
          <div
            className="sidebar-session-delete-overlay"
            role="presentation"
            onClick={() => {
              if (!deleting) setPendingDeleteId(null);
            }}
          >
            <div
              className="sidebar-session-delete-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="sidebar-session-delete-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sidebar-session-delete-header">
                <h3 id="sidebar-session-delete-title">
                  {t("navigation.sessionMenu.deleteConfirmTitle")}
                </h3>
                <button
                  type="button"
                  className="btn-ghost sidebar-session-delete-close"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                  aria-label={t("navigation.sessionMenu.deleteCancel")}
                >
                  <X size={16} />
                </button>
              </div>
              <p className="sidebar-session-delete-body">
                {t("navigation.sessionMenu.deleteConfirm")}
              </p>
              <div className="sidebar-session-delete-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPendingDeleteId(null)}
                  disabled={deleting}
                >
                  {t("navigation.sessionMenu.deleteCancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void confirmDelete(pendingDeleteId)}
                  disabled={deleting}
                >
                  {deleting
                    ? t("navigation.sessionMenu.deleting")
                    : t("navigation.sessionMenu.deleteConfirmAction")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});

export default SidebarRecentSessions;
