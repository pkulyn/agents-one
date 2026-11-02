import { useState } from "react";
import { ChevronRight } from "../../assets/icons";
import { useI18n } from "../../components/useI18n";
import { ReasoningRow, ToolActivityGroup } from "./HistoryRow";
import {
  AvatarSpacer,
  HermesAvatar,
  formatRuntimeDuration,
} from "./MessageRow";
import type {
  ChatMessage,
  ChatMessageAgentIdentity,
  ToolCallMessage,
  ToolResultMessage,
} from "./types";

export type TraceMessage = Extract<
  ChatMessage,
  { kind: "reasoning" | "tool_call" | "tool_result" }
>;
export function isTraceMessage(message: ChatMessage): message is TraceMessage {
  return (
    message.kind === "reasoning" ||
    message.kind === "tool_call" ||
    message.kind === "tool_result"
  );
}

/** One completed execution's optional process, with its answer kept outside. */
export function ExecutionTraceGroup({
  items,
  durationMs,
  showAvatar,
  identity,
  onAvatarClick,
}: {
  items: TraceMessage[];
  durationMs?: number;
  showAvatar: boolean;
  identity: ChatMessageAgentIdentity;
  onAvatarClick?: () => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const thoughtCount = items.filter((item) => item.kind === "reasoning").length;
  const callCount = new Set(
    items
      .filter((item) => item.kind !== "reasoning")
      .map((item) => item.callId),
  ).size;
  const rows: React.JSX.Element[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === "reasoning") {
      rows.push(<ReasoningRow key={item.id} msg={item} showAvatar={false} />);
    } else {
      const tools: (ToolCallMessage | ToolResultMessage)[] = [];
      while (i < items.length && items[i].kind !== "reasoning")
        tools.push(items[i++] as ToolCallMessage | ToolResultMessage);
      i -= 1;
      rows.push(
        <ToolActivityGroup key={item.id} items={tools} showAvatar={false} />,
      );
    }
  }
  return (
    <div
      className={`chat-message chat-message-agent chat-message-history chat-execution-trace${showAvatar ? "" : " chat-message--grouped"}`}
    >
      {showAvatar ? (
        <HermesAvatar
          name={identity.agentName}
          avatar={identity.agentAvatar}
          color={identity.agentColor}
          onClick={onAvatarClick}
        />
      ) : (
        <AvatarSpacer />
      )}
      <div className="chat-agent-message-content">
        {showAvatar && (
          <span className="chat-agent-name">{identity.agentName}</span>
        )}
        <button
          type="button"
          className="chat-execution-trace-summary"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="chat-execution-trace-title">
            {t("chat.executionTrace.title")}
          </span>
          {thoughtCount > 0 && (
            <span>
              {t("chat.executionTrace.thoughts", { count: thoughtCount })}
            </span>
          )}
          {callCount > 0 && (
            <span>{t("chat.executionTrace.calls", { count: callCount })}</span>
          )}
          {durationMs !== undefined && (
            <span className="chat-execution-trace-duration">
              {formatRuntimeDuration(durationMs, t)}
            </span>
          )}
          <ChevronRight
            size={14}
            className={`chat-execution-trace-chevron${open ? " chat-execution-trace-chevron--open" : ""}`}
          />
        </button>
        <div className="chat-execution-trace-items" hidden={!open}>
          {rows}
        </div>
      </div>
    </div>
  );
}
