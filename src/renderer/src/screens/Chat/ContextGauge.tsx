import { memo } from "react";
import { useI18n } from "../../components/useI18n";

export interface ContextUsage {
  /** Current context occupancy = latest turn's prompt tokens. */
  used: number;
  /** Model context window in tokens. */
  window: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ContextGaugeProps extends ContextUsage {
  /** Optional control-plane action, e.g. RuntimeChat's native `/compact`. */
  onClick?: () => void;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const val = (n / 1_000_000).toFixed(1);
    return `${val.endsWith(".0") ? val.slice(0, -2) : val}M`;
  }
  if (n >= 1000) {
    const val = (n / 1000).toFixed(1);
    return `${val.endsWith(".0") ? val.slice(0, -2) : val}k`;
  }
  return String(Math.round(n));
}

/**
 * Small circular gauge showing how full the model's context window is, with a
 * hover/focus tooltip breaking down tokens used and prompt-cache hits. Mirrors
 * the webui's context indicator. Auto-compress threshold is intentionally
 * omitted — the gateway doesn't expose it over the chat API.
 */
export const ContextGauge = memo(function ContextGauge({
  used,
  window: ctxWindow,
  cacheReadTokens,
  cacheWriteTokens,
  onClick,
}: ContextGaugeProps): React.JSX.Element {
  const { t } = useI18n();
  const pct =
    ctxWindow > 0 ? Math.min(100, Math.round((used / ctxWindow) * 100)) : 0;
  const left = 100 - pct;

  // Ring geometry.
  const size = 26;
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (pct / 100) * circumference;

  const hasCache =
    cacheReadTokens !== undefined || cacheWriteTokens !== undefined;
  const cacheHitPct =
    used > 0 && cacheReadTokens
      ? Math.min(100, Math.round((cacheReadTokens / used) * 100))
      : 0;
  const interactive = typeof onClick === "function";
  const label = t("chat.contextGauge.label", {
    usage: t("chat.contextUsed", { pct, left }),
    window: fmtTokens(ctxWindow),
  });
  const title = t("chat.contextGauge.title", {
    window: fmtTokens(ctxWindow),
    used: fmtTokens(used),
  });

  return (
    <div
      className={`chat-ctx-gauge${interactive ? " chat-ctx-gauge--interactive" : ""}`}
      tabIndex={0}
      role={interactive ? "button" : "img"}
      aria-label={
        interactive ? t("chat.contextGauge.compactLabel", { label }) : label
      }
      title={
        interactive ? t("chat.contextGauge.compactHint", { title }) : title
      }
      {...(interactive
        ? {
            onClick,
            onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            },
          }
        : {})}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="chat-ctx-gauge-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
        />
        <circle
          className="chat-ctx-gauge-fill"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="chat-ctx-gauge-num">{pct}</span>

      <div className="chat-ctx-tooltip" role="tooltip">
        <div className="chat-ctx-tooltip-title">{t("chat.contextWindow")}</div>
        <div>{t("chat.contextUsed", { pct, left })}</div>
        <div>
          {t("chat.contextTokens", {
            used: fmtTokens(used),
            total: fmtTokens(ctxWindow),
          })}
        </div>
        {hasCache && (
          <div>
            {t("chat.contextCache", {
              pct: cacheHitPct,
              read: fmtTokens(cacheReadTokens || 0),
              write: fmtTokens(cacheWriteTokens || 0),
            })}
          </div>
        )}
      </div>
    </div>
  );
});
