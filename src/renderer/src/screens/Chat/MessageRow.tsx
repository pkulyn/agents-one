import { memo, useMemo, useState, useCallback } from "react";
import { Grid } from "react-loader-spinner";
import { Copy, Check, GitBranch } from "lucide-react";
import agentsOneMark from "../../assets/agents-one-mark.svg";
import { AgentMarkdown } from "../../components/AgentMarkdown";
import { AttachmentChip } from "../../components/AttachmentChip";
import { MediaSegmentView } from "../../components/MediaImage";
import ProfileAvatar from "../../components/common/ProfileAvatar";
import { useI18n } from "../../components/useI18n";
import { parseMediaTokens, cleanLeakedToolTags } from "./mediaUtils";
import type { ChatBubbleMessage, ChatMessage } from "./types";

export const APPROVAL_RE =
  /⚠️.*dangerous|requires? (your )?approval|\/approve.*\/deny|do you want (me )?to (proceed|continue|run|execute)/i;

/**
 * Coerce any DB, stream, or IPC timestamp value to valid epoch milliseconds.
 * Handles seconds (< 1e12), ms, us (> 1e14), ns (> 1e17), and ISO strings.
 */
const MS_THRESHOLD = 1e12;
const US_THRESHOLD = 1e14;
const NS_THRESHOLD = 1e17;

function coerceToEpochMs(raw: unknown): number {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return 0;
    if (raw < MS_THRESHOLD) return raw * 1000;
    if (raw < US_THRESHOLD) return raw;
    if (raw < NS_THRESHOLD) return Math.floor(raw / 1000);
    return Math.floor(raw / 1_000_000);
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      return coerceToEpochMs(num);
    }
    const parsed = new Date(trimmed).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 0;
}

// Earliest valid chat timestamp: Jan 1 2020 (1577836800000 ms).
// Anything before 2020 (e.g. 0, 1 => Jan 1970 => "57 years ago") is bogus/dummy.
const MIN_VALID_EPOCH_MS = 1_577_836_800_000;

function isValidEpochMs(ms: number): boolean {
  return (
    Number.isFinite(ms) &&
    ms >= MIN_VALID_EPOCH_MS &&
    !isNaN(new Date(ms).getTime())
  );
}

/** A stable, full Chinese timestamp shown in each actual conversation bubble. */
function formatBubbleTime(ms: number): string {
  try {
    const value = new Date(ms);
    const weekday = ["日", "一", "二", "三", "四", "五", "六"][value.getDay()];
    const hour = String(value.getHours()).padStart(2, "0");
    const minute = String(value.getMinutes()).padStart(2, "0");
    return `${value.getFullYear()}年${value.getMonth() + 1}月${value.getDate()}日（星期${weekday}）${hour}:${minute}`;
  } catch {
    return "";
  }
}

function formatRuntimeDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} 小时 ${minutes} 分`;
  if (minutes) return `${minutes} 分 ${remainder} 秒`;
  return `${remainder} 秒`;
}

function isChatBubbleMessage(msg: ChatMessage): msg is ChatBubbleMessage {
  return (
    msg.kind === "user" ||
    msg.kind === "assistant" ||
    (!msg.kind && (msg.role === "user" || msg.role === "agent"))
  );
}

/** Agent identity avatar. Activity is represented by the separate platform mark. */
export const HermesAvatar = memo(function HermesAvatar({
  size = 30,
  active = false,
  name = "Agent",
  color,
  avatar,
  onClick,
}: {
  size?: number;
  /** True only for the avatar of the turn currently being generated. */
  active?: boolean;
  name?: string;
  color?: string | null;
  avatar?: string | null;
  onClick?: () => void;
}): React.JSX.Element {
  const className = `chat-avatar chat-avatar-agent chat-avatar-agent--identity${
    onClick ? " chat-avatar-agent--interactive" : ""
  }`;
  const content = (
    <ProfileAvatar name={name} color={color} avatar={avatar} size={size} />
  );
  return onClick ? (
    <button
      type="button"
      className={className}
      style={{ width: size, height: size }}
      data-active={active || undefined}
      onClick={onClick}
      aria-label={`与 ${name} 沟通`}
    >
      {content}
    </button>
  ) : (
    <div
      className={className}
      style={{ width: size, height: size }}
      data-active={active || undefined}
    >
      {content}
    </div>
  );
});

/** Agents One activity mark used only for the live response indicator. */
export const AgentsOneActivityAvatar = memo(function AgentsOneActivityAvatar({
  size = 30,
  active = false,
}: {
  size?: number;
  active?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`chat-avatar chat-avatar-agents-one${
        active ? " chat-avatar-agents-one--active" : ""
      }`}
      style={{ width: size, height: size }}
      aria-label="Agents One"
    >
      <img src={agentsOneMark} alt="" />
    </div>
  );
});

/**
 * Empty box the size of an avatar. Rendered in place of the avatar on
 * continuation rows of a turn (the thinking/tool rows and answer bubble that
 * follow the first row) so one turn shows a single avatar while every row
 * stays aligned to the same content column.
 */
export const AvatarSpacer = memo(function AvatarSpacer(): React.JSX.Element {
  return <div className="chat-avatar" aria-hidden="true" />;
});

interface MessageRowProps {
  msg: ChatMessage;
  isLast: boolean;
  isLoading: boolean;
  onApprove: () => void;
  onDeny: () => void;
  /** False on continuation rows of a turn — render a spacer instead of the
   *  avatar so the turn reads as one grouped block. Defaults to true. */
  showAvatar?: boolean;
  /** Human-readable agent identity shown with the first reply in a turn. */
  agentName?: string;
  agentAvatar?: string | null;
  agentColor?: string | null;
  onAgentAvatarClick?: () => void;
  /** Runtime conversations can fork a new read-only conversation from a reply. */
  onBranchFromMessage?: (messageId: string) => void;
}

export const MessageRow = memo(function MessageRow({
  msg,
  isLast,
  isLoading,
  onApprove,
  onDeny,
  showAvatar = true,
  agentName = "Agent",
  agentAvatar,
  agentColor,
  onAgentAvatarClick,
  onBranchFromMessage,
}: MessageRowProps): React.JSX.Element {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // MessageRow is wrapped in memo() but still re-renders on any prop change
  // (e.g. isLoading toggling at the end of a stream), and `parseMediaTokens`
  // runs a full regex pipeline. Cache the result against the message content
  // so a long conversation doesn't reparse every row on every render.
  // Only agent bubbles need media parsing — user bubbles render content
  // verbatim — so this is gated on the role to skip the work entirely for
  // user rows. (Follow-up item from PR #303 review.)
  const bubbleContent = isChatBubbleMessage(msg)
    ? (msg as ChatBubbleMessage).content
    : null;
  const displayBubbleContent = useMemo(() => {
    if (
      msg.role !== "user" ||
      !isChatBubbleMessage(msg) ||
      (!msg.attachments?.length && !/<file\b/i.test(bubbleContent || ""))
    ) {
      return bubbleContent;
    }
    return (bubbleContent || "")
      .replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }, [bubbleContent, msg]);
  const segments = useMemo(
    () =>
      msg.role === "agent" && bubbleContent
        ? // Recover any tool/skill call the model leaked as text (e.g. a raw
          // `<skill_view>{"answer": …}</skill_view>` tag) before tokenizing.
          parseMediaTokens(cleanLeakedToolTags(bubbleContent))
        : null,
    [msg.role, bubbleContent],
  );

  const handleCopy = useCallback(async () => {
    if (!displayBubbleContent) return;
    try {
      await window.agentsOneAPI.copyToClipboard(displayBubbleContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: clipboard write may fail in some environments
    }
  }, [displayBubbleContent]);

  // Only chat bubble messages have content/attachments
  if (!isChatBubbleMessage(msg)) {
    return (
      <div className={`chat-message chat-message-${msg.role}`}>
        {showAvatar ? (
          <HermesAvatar
            active={isLoading && isLast}
            name={agentName}
            avatar={agentAvatar}
            color={agentColor}
            onClick={onAgentAvatarClick}
          />
        ) : (
          <AvatarSpacer />
        )}
        <div className={`chat-bubble chat-bubble-${msg.role}`}>
          {/* Reasoning/tool messages handled separately */}
        </div>
      </div>
    );
  }

  const showApprovalBar =
    msg.role === "agent" &&
    !msg.error &&
    !isLoading &&
    isLast &&
    APPROVAL_RE.test(msg.content);
  const hasAttachments = !!msg.attachments && msg.attachments.length > 0;
  const epochMs = coerceToEpochMs(msg.timestamp);
  const isTimeValid = isValidEpochMs(epochMs);
  const bubbleTime = isTimeValid ? formatBubbleTime(epochMs) : "";
  const showMessageChrome =
    !msg.isControlMessage && !isLoading && !msg.isSlashLoader;
  const canBranch =
    showMessageChrome && msg.role === "agent" && Boolean(onBranchFromMessage);

  const bubble = (
    <div
      className={`chat-bubble chat-bubble-${msg.role}${
        msg.error ? " chat-bubble-error" : ""
      }`}
    >
      {hasAttachments && (
        <div className="chat-message-attachments">
          {msg.attachments!.map((att) => (
            <AttachmentChip key={att.id} attachment={att} />
          ))}
        </div>
      )}
      {msg.isSlashLoader ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Grid
            visible={true}
            height={13}
            width={13}
            radius={15}
            color="#8b7cf6"
            ariaLabel="running-command"
          />
          <span>{msg.content}</span>
        </div>
      ) : (
        displayBubbleContent &&
        (msg.role === "agent" && segments
          ? segments.map((segment) =>
              segment.type === "text" ? (
                segment.value.trim() ? (
                  <AgentMarkdown key={`t-${segment.start}`}>
                    {segment.value}
                  </AgentMarkdown>
                ) : null
              ) : (
                <MediaSegmentView
                  key={`m-${segment.start}`}
                  token={segment.token}
                  raw={segment.raw}
                  source={segment.source}
                />
              ),
            )
          : displayBubbleContent)
      )}
      {msg.error && (
        <div className="chat-error-message" role="alert">
          {msg.error}
        </div>
      )}
    </div>
  );

  // The footer is deliberately a sibling of the card, not card content: it
  // stays discoverable on hover while leaving reading and Markdown layout
  // completely uninterrupted.
  const messageFooter =
    showMessageChrome && (bubbleTime || displayBubbleContent) ? (
      <footer className={`chat-bubble-footer chat-bubble-footer--${msg.role}`}>
        {msg.role === "agent" && displayBubbleContent ? (
          <button
            type="button"
            className="chat-bubble-footer-action"
            onClick={handleCopy}
            title={copied ? t("common.copied") : t("chat.copyMessage")}
            aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        ) : null}
        {canBranch ? (
          <button
            type="button"
            className="chat-bubble-footer-action"
            onClick={() => onBranchFromMessage?.(msg.id)}
            title="从这条答复创建新对话分支"
            aria-label="从这条答复创建新对话分支"
          >
            <GitBranch size={15} />
          </button>
        ) : null}
        {bubbleTime ? (
          <time
            className="chat-bubble-footer-time"
            dateTime={new Date(epochMs).toISOString()}
            title={bubbleTime}
          >
            {bubbleTime}
          </time>
        ) : null}
        {msg.role === "agent" && msg.runtimeMeta?.durationMs !== undefined ? (
          <span className="chat-bubble-footer-duration">
            · 用时 {formatRuntimeDuration(msg.runtimeMeta.durationMs)}
          </span>
        ) : null}
        {msg.role === "user" && displayBubbleContent ? (
          <button
            type="button"
            className="chat-bubble-footer-action"
            onClick={handleCopy}
            title={copied ? t("common.copied") : t("chat.copyMessage")}
            aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </button>
        ) : null}
      </footer>
    ) : null;

  return (
    <div
      className={`chat-message chat-message-${msg.role}${
        showAvatar ? "" : " chat-message--grouped"
      }`}
    >
      {/* User messages stand alone (right-aligned bubble, no avatar). Only the
          agent turn carries an avatar; its continuation rows get a spacer. */}
      {msg.role === "user" ? null : !showAvatar ? (
        <AvatarSpacer />
      ) : (
        <HermesAvatar
          active={isLoading && isLast}
          name={agentName}
          avatar={agentAvatar}
          color={agentColor}
          onClick={onAgentAvatarClick}
        />
      )}
      {msg.role === "agent" ? (
        <div className="chat-agent-message-content">
          {showAvatar && <span className="chat-agent-name">{agentName}</span>}
          {bubble}
          {messageFooter}
        </div>
      ) : (
        <div className="chat-user-message-content">
          {bubble}
          {messageFooter}
        </div>
      )}
      {showApprovalBar && (
        <div className="chat-approval-bar">
          <button
            className="chat-approval-btn chat-approve"
            onClick={onApprove}
          >
            {t("chat.approve")}
          </button>
          <button className="chat-approval-btn chat-deny" onClick={onDeny}>
            {t("chat.deny")}
          </button>
        </div>
      )}
    </div>
  );
});
