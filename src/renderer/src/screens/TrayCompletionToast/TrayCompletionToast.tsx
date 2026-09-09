import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Check, Clock3, Play, Square, X } from "lucide-react";
import agentsOneMark from "../../assets/agents-one-mark.svg";
import type {
  TrayCompletionData,
  TrayCompletionStatus,
} from "../../../../shared/tray-completion";

const AUTO_DISMISS_MS = 3_000;

function statusCopy(data: TrayCompletionData): {
  label: string;
  summary: string;
  hint: string;
} {
  switch (data.status) {
    case "scheduled_started":
      return {
        label: "定时任务已启动",
        summary: `“${data.title}”已触发，正在执行。`,
        hint: "点击打开任务 · 3 秒后收起",
      };
    case "failed":
      return {
        label: "执行失败",
        summary: `“${data.title}”失败：${data.detail || "执行时发生错误。"}`,
        hint: "点击查看详情 · 3 秒后收起",
      };
    case "cancelled":
      return {
        label: "任务已取消",
        summary: `“${data.title}”执行已停止。`,
        hint: "点击打开任务 · 3 秒后收起",
      };
    case "timed_out":
      return {
        label: "执行超时",
        summary: data.detail
          ? `“${data.title}”：${data.detail}`
          : `“${data.title}”已超过时间限制。`,
        hint: "点击查看详情 · 3 秒后收起",
      };
    default:
      return {
        label: "完成了任务",
        summary: `“${data.title}”已完成，可以查看结果了。`,
        hint: "点击打开任务 · 3 秒后收起",
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
  const copy = statusCopy(data);

  return (
    <div className="tray-completion-shell">
      <button
        type="button"
        className={`tray-completion-card tray-completion-card--${data.status}`}
        aria-label={`打开${copy.label}：${data.title}`}
        onClick={() => window.agentsOneAPI.openTrayCompletion()}
        onMouseEnter={clearDismissTimer}
        onMouseLeave={startDismissTimer}
      >
        <span className="tray-completion-brand-row">
          <span className="tray-completion-brand">
            <img src={agentsOneMark} alt="Agents One" />
            <strong>Agents One</strong>
          </span>
          <span>刚刚</span>
        </span>
        <span className="tray-completion-content">
          <span className="tray-completion-avatar">
            {data.runtimeAvatar ? (
              <img
                src={data.runtimeAvatar}
                alt={`${data.runtimeName} 智能体图标`}
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
