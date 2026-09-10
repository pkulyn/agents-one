import { memo } from "react";
import { Bot, Spinner, X, Plus } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { defaultColorForName } from "../../../../shared/profileColors";
import type { ChatRun } from "./chatRuns";

export interface ProfileAppearance {
  name?: string | null;
  color?: string | null;
  avatar?: string | null;
}

/**
 * The window's top strip. Doubles as the title-bar drag region (browser-style):
 * the strip itself is draggable, while the conversation chips on top of it stay
 * clickable. When several sessions are open (background sessions / multi-agent)
 * it shows a chip per session to switch between them and watch each stream live.
 * With only a blank scratch conversation it renders empty — just a drag area —
 * so no vertical space is wasted before there is a real session to show.
 */
export const ActiveSessionsBar = memo(function ActiveSessionsBar({
  runs,
  activeRunId,
  onSelect,
  onClose,
  onNew,
  getAppearance,
}: {
  runs: ChatRun[];
  activeRunId: string;
  onSelect: (runId: string) => void;
  /** Close (and stop, if running) a conversation tab. */
  onClose: (runId: string) => void;
  /** Open a fresh conversation tab (browser-style new-tab button). */
  onNew: () => void;
  /** Resolve the current agent's display metadata for one conversation chip. */
  getAppearance?: (run: ChatRun) => ProfileAppearance;
}): React.JSX.Element {
  const { t } = useI18n();

  const anyLoading = runs.some((r) => r.loading);
  // A blank runtime selector is not a conversation yet. Keeping it out of the
  // tab strip prevents a new Codex draft from looking like a duplicate
  // of the persisted conversation that appears in the sidebar after send.
  const hasRealSession = runs.some(
    (r) => r.sessionId || r.runtimeConversationId || r.title,
  );
  // Nothing real to switch to yet → leave the strip empty (pure drag area).
  const showChips = runs.length > 1 || anyLoading || hasRealSession;

  return (
    <div className="active-sessions-bar" role="tablist">
      {showChips &&
        runs.map((run) => {
          const active = run.runId === activeRunId;
          const label = run.title || t("sessions.newConversation");
          const appearance = getAppearance?.(run);
          const agentLabel = appearance?.name || run.runtimeName || run.profile;
          const color =
            appearance?.color ||
            defaultColorForName(run.runtimeId || run.profile);
          return (
            <div
              key={run.runId}
              role="tab"
              aria-selected={active}
              className={`active-session-chip ${active ? "active" : ""} ${
                run.loading ? "loading" : ""
              }`}
              onClick={() => onSelect(run.runId)}
              title={`${agentLabel} — ${label}`}
            >
              <span className="active-session-chip-identity">
                {run.runtimeId && !appearance?.avatar ? (
                  <span
                    className={`active-session-chip-runtime ${run.runtimeKind || ""}`}
                    style={{ background: color }}
                    aria-label={agentLabel}
                  >
                    <Bot size={13} />
                  </span>
                ) : (
                  <ProfileAvatar
                    name={agentLabel}
                    color={appearance?.color}
                    avatar={appearance?.avatar}
                    size={18}
                  />
                )}
                {run.loading ? (
                  <span
                    className="active-session-chip-activity"
                    aria-label={`${agentLabel} 正在处理`}
                  >
                    <Spinner className="active-session-chip-spinner" size={8} />
                  </span>
                ) : null}
              </span>
              <span className="active-session-chip-title">{label}</span>
              <button
                type="button"
                className="active-session-chip-close"
                title={t("sessions.closeTab")}
                aria-label={t("sessions.closeTab")}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(run.runId);
                }}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      {showChips && (
        <button
          type="button"
          className="active-session-new"
          title={t("sessions.newConversation")}
          aria-label={t("sessions.newConversation")}
          onClick={onNew}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
});
