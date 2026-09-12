import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Clock3, Play, Square, X } from "lucide-react";
import agentsOneMark from "../../assets/agents-one-mark.svg";
import type {
  TrayCompletionData,
  TrayCompletionStatus,
} from "../../../../shared/tray-completion";
import { useI18n } from "../../components/useI18n";

const AUTO_DISMISS_MS = 3_000;

type Translate = (key: string, options?: Record<string, unknown>) => string;

function statusCopy(
  data: TrayCompletionData,
  t: Translate,
): {
  label: string;
  summary: string;
  hint: string;
} {
  switch (data.status) {
    case "scheduled_started":
      return {
        label: t("tray.completion.scheduledStarted"),
        summary: t("tray.completion.scheduledSummary", { title: data.title }),
        hint: t("tray.completion.openHint"),
      };
    case "failed":
      return {
        label: t("tray.completion.failed"),
        summary: t("tray.completion.failedSummary", {
          title: data.title,
          detail: data.detail || t("tray.completion.failedFallback"),
        }),
        hint: t("tray.completion.detailsHint"),
      };
    case "cancelled":
      return {
        label: t("tray.completion.cancelled"),
        summary: t("tray.completion.cancelledSummary", { title: data.title }),
        hint: t("tray.completion.openHint"),
      };
    case "timed_out":
      return {
        label: t("tray.completion.timedOut"),
        summary: data.detail
          ? t("tray.completion.timedOutDetail", {
              title: data.title,
              detail: data.detail,
            })
          : t("tray.completion.timedOutSummary", { title: data.title }),
        hint: t("tray.completion.detailsHint"),
      };
    default:
      return {
        label: t("tray.completion.succeeded"),
        summary: t("tray.completion.succeededSummary", { title: data.title }),
        hint: t("tray.completion.openHint"),
      };
  }
}

function StatusGlyph({
  status,
}: {
  status: TrayCompletionStatus;
}): React.JSX.Element {
  switch (status) {
    case "scheduled_started":
      return <Play size={8} fill="currentColor" strokeWidth={0} />;
    case "failed":
      return <X size={10} strokeWidth={3} />;
    case "cancelled":
      return <Square size={7} fill="currentColor" strokeWidth={0} />;
    case "timed_out":
      return <Clock3 size={10} strokeWidth={2.5} />;
    default:
      return <Check size={9} strokeWidth={3} />;
  }
}

// @lat: [[main-process#App Lifecycle#Notification-area tray and quick task composer#Task completion toast]]
export default function TrayCompletionToast(): React.JSX.Element | null {
  const { t } = useI18n();
  const [data, setData] = useState<TrayCompletionData | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDismissTimer = useCallback((): void => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const startDismissTimer = useCallback((): void => {
    clearDismissTimer();
    timerRef.current = setTimeout(() => {
      window.agentsOneAPI.closeTrayCompletion();
    }, AUTO_DISMISS_MS);
  }, [clearDismissTimer]);

  useEffect(() => {
    let disposed = false;
    void window.agentsOneAPI.getTrayCompletionData().then((next) => {
      if (!disposed && next) setData(next);
    });
    const unsubscribe = window.agentsOneAPI.onTrayCompletionData((next) => {
      setData(next);
    });
    return () => {
      disposed = true;
      clearDismissTimer();
      unsubscribe();
    };
  }, [clearDismissTimer]);

  useEffect(() => {
    if (!data) return;
    startDismissTimer();
    return clearDismissTimer;
  }, [clearDismissTimer, data, startDismissTimer]);

  if (!data) return null;
  const copy = statusCopy(data, t);

  return (
    <div className="tray-completion-shell">
      <button
        type="button"
        className={`tray-completion-card tray-completion-card--${data.status}`}
        aria-label={t("tray.completion.openLabel", {
          label: copy.label,
          title: data.title,
        })}
        onClick={() => window.agentsOneAPI.openTrayCompletion()}
        onMouseEnter={clearDismissTimer}
        onMouseLeave={startDismissTimer}
      >
        <span className="tray-completion-brand-row">
          <span className="tray-completion-brand">
            <img src={agentsOneMark} alt="Agents One" />
            <strong>Agents One</strong>
          </span>
          <span>{t("tray.completion.justNow")}</span>
        </span>
        <span className="tray-completion-content">
          <span className="tray-completion-avatar">
            {data.runtimeAvatar ? (
              <img
                src={data.runtimeAvatar}
                alt={t("tray.completion.agentAvatar", {
                  name: data.runtimeName,
                })}
              />
            ) : (
              <Bot size={24} aria-hidden="true" />
            )}
            <span className="tray-completion-status" aria-hidden="true">
              <StatusGlyph status={data.status} />
            </span>
          </span>
          <span className="tray-completion-copy">
            <strong className="tray-completion-title">
              <span>{data.runtimeName}</span> {copy.label}
            </strong>
            <span className="tray-completion-summary">{copy.summary}</span>
            <span className="tray-completion-hint">{copy.hint}</span>
          </span>
        </span>
      </button>
    </div>
  );
}
