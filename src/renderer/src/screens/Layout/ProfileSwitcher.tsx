import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Check, ChevronDown, Settings } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import { addMigratedEventListener } from "../../utils/brandMigration";

interface ProfileSwitcherProps {
  /** Id of the currently active profile ("default" for the base workspace). */
  activeProfile: string;
  /** Called after a successful switch so the shell can reset chat state. */
  onSwitch: (name: string) => void;
  /** Open the global settings modal. */
  onManage: () => void;
  /** Start a lightweight chat with a runtime adapter. */
  onRuntimeChat?: (runtime: AgentRuntimeDefinition) => void;
  /** Runtime used by default when creating a new task. */
  defaultRuntimeId?: string | null;
  /** Persist a new default runtime choice. */
  onDefaultRuntimeChange?: (runtimeId: string) => void;
  /** Render as an icon-only sidebar footer affordance. */
  compact?: boolean;
}

const RUNTIME_LABELS: Record<string, string> = {
  hermes: "Hermes Agent Runtime",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
};

/**
 * Sidebar footer control: shows the active profile and, on click, opens a
 * popover to switch between profiles or jump to the management screen.
 */
export default function ProfileSwitcher({
  onManage,
  defaultRuntimeId,
  onDefaultRuntimeChange,
  compact = false,
}: ProfileSwitcherProps): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    window.agentsOneAPI
      .listAgentRuntimes()
      .then(setRuntimes)
      .catch(() => {
        /* keep last-known runtime list */
      });
  }, []);

  // Load once on mount so the sidebar trigger shows the correct gateway
  // status immediately, without requiring the user to open the menu first.
  useEffect(() => {
    load();
  }, [load]);

  // Refresh the list each time the menu opens — model/skill counts and the
  // gateway-running dot can change while the app is open.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    window.addEventListener("agents-one:runtime-appearance-changed", load);
    const removeRuntimeChangedListener = addMigratedEventListener(
      "runtimeChanged",
      load,
    );
    return () => {
      window.removeEventListener("agents-one:runtime-appearance-changed", load);
      removeRuntimeChangedListener();
    };
  }, [load]);

  // Dismiss on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const defaultRuntime =
    runtimes.find((runtime) => runtime.id === defaultRuntimeId) ??
    runtimes.find((runtime) => runtime.kind === "hermes" && runtime.enabled) ??
    runtimes.find((runtime) => runtime.enabled) ??
    runtimes[0];
  const label = defaultRuntime?.name || t("common.appName");
  const runtimeMeta = (runtime: AgentRuntimeDefinition): string =>
    t("navigation.profile.runtimeMeta", {
      kind:
        RUNTIME_LABELS[runtime.kind] ||
        (runtime.kind === "web-agent"
          ? t("navigation.profile.webAgent")
          : runtime.kind),
      location: t(
        runtime.location === "local"
          ? "navigation.profile.local"
          : "navigation.profile.remote",
      ),
    });

  function handleDefaultRuntime(runtime: AgentRuntimeDefinition): void {
    setOpen(false);
    onDefaultRuntimeChange?.(runtime.id);
  }

  function renderRuntimeAvatar(
    runtime: AgentRuntimeDefinition | undefined,
    size: number,
  ): React.JSX.Element {
    return (
      <span
        className={`profile-menu-runtime ${runtime?.kind ?? "hermes"}`}
        style={
          runtime?.color
            ? {
                background: runtime.color,
                color: "#fff",
                width: size,
                height: size,
              }
            : { width: size, height: size }
        }
      >
        {runtime?.avatar ? (
          <img src={runtime.avatar} alt="" />
        ) : (
          <Bot size={Math.max(13, size - 7)} />
        )}
      </span>
    );
  }

  return (
    <div
      className={`profile-switcher ${compact ? "compact" : ""}`}
      ref={rootRef}
    >
      {open && (
        <div className="profile-menu" role="menu">
          <div className="profile-menu-active-section profile-menu-default-agent">
            <div className="profile-menu-avatar">
              {renderRuntimeAvatar(defaultRuntime, 34)}
            </div>
            <span className="profile-menu-info">
              <span className="profile-menu-name">
                {label}
                <span className="profile-menu-tag">
                  {t("navigation.profile.defaultAgent")}
                </span>
              </span>
              <span className="profile-menu-meta">
                {defaultRuntime
                  ? runtimeMeta(defaultRuntime)
                  : t("navigation.profile.connectAgent")}
              </span>
            </span>
          </div>
          {runtimes.length > 0 && (
            <>
              <div className="profile-menu-divider" />
              <div className="profile-menu-section-label">
                {t("navigation.profile.selectDefault")}
              </div>
              <div className="profile-menu-list">
                {runtimes.map((runtime) => {
                  const selected = runtime.id === defaultRuntime?.id;
                  return (
                    <button
                      key={runtime.id}
                      className={`profile-menu-item ${selected ? "active" : ""}`}
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={!runtime.enabled}
                      onClick={() => handleDefaultRuntime(runtime)}
                    >
                      {renderRuntimeAvatar(runtime, 20)}
                      <span className="profile-menu-info">
                        <span className="profile-menu-name">
                          {runtime.name}
                          {selected && (
                            <span className="profile-menu-tag">
                              {t("navigation.profile.default")}
                            </span>
                          )}
                        </span>
                        <span className="profile-menu-meta">
                          {runtimeMeta(runtime)}
                        </span>
                      </span>
                      {selected && (
                        <Check className="profile-menu-check" size={14} />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <button
            className="profile-menu-manage"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <Settings size={14} />
            {t("navigation.settings")}
          </button>
        </div>
      )}

      <button
        className={`profile-switcher-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={t("navigation.profile.defaultAgentTitle", { name: label })}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {renderRuntimeAvatar(defaultRuntime, compact ? 22 : 18)}
        {!compact && <span className="profile-switcher-name">{label}</span>}
        {!compact && (
          <ChevronDown size={14} className="profile-switcher-chevron" />
        )}
      </button>
    </div>
  );
}
