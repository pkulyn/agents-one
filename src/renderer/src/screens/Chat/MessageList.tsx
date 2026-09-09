import { memo, useMemo } from "react";
import { MessageRow } from "./MessageRow";
import { ReasoningRow, ToolActivityGroup } from "./HistoryRow";
import { ClarifyCard } from "./ClarifyCard";
import { collapseHistoricalEchoes } from "./messageDedup";
import { placeInitialUserMessageBeforeAgentTrace } from "./messageOrder";
import type {
  ChatMessage,
  ClarifyMessage,
  ToolCallMessage,
  ToolResultMessage,
  SystemMessage,
  ChatMessageAgentIdentity,
} from "./types";

function isToolRow(m: ChatMessage): m is ToolCallMessage | ToolResultMessage {
  const k = (m as { kind?: string }).kind;
  return k === "tool_call" || k === "tool_result";
}

function SystemEventRow({
  message,
}: {
  message: SystemMessage;
}): React.JSX.Element {
  return (
    <details className="chat-system-event">
      <summary>{message.title}</summary>
      <pre>{message.detail}</pre>
    </details>
  );
}

interface MessageListProps {
  messages: ChatMessage[];
  isLoading: boolean;
  toolProgress: string | null;
  /** Visible identity for the Hermes endpoint behind this conversation. */
  agentName?: string;
  agentAvatar?: string | null;
  agentColor?: string | null;
  onApprove: () => void;
  onDeny: () => void;
  /** Mark an inline clarify card resolved once the user answers/skips. */
  onClarifyResolved: (requestId: string, answer: string) => void;
  /** Collaboration chats can focus a role by clicking its visible avatar. */
  onAgentAvatarClick?: (identity: ChatMessageAgentIdentity) => void;
  /** Create a new Runtime conversation from one completed assistant reply. */
  onBranchFromMessage?: (messageId: string) => void;
}

function TypingIndicator({
  toolProgress,
}: {
  toolProgress: string | null;
}): React.JSX.Element {
  return (
    <div className="chat-message chat-message-agent chat-message-typing">
      <div className="chat-bubble chat-bubble-agent">
        {toolProgress ? (
          <div className="chat-tool-progress">{toolProgress}</div>
        ) : (
          <div className="chat-typing">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Bubble messages are filtered to "has content". History items (reasoning,
 * tool_call, tool_result) are *always* shown — they're collapsed by default
 * and the user opens them. Filtering them by content would defeat the point.
 */
function isBubble(m: ChatMessage): m is import("./types").ChatBubbleMessage {
  // Bubble messages have no `kind` field (or kind === "user"/"assistant").
  // History items have kind === "reasoning" | "tool_call" | "tool_result".
  const k = (m as { kind?: string }).kind;
  return !k || k === "user" || k === "assistant";
}

function messageIdentity(
  message: ChatMessage,
): ChatMessageAgentIdentity | undefined {
  const identity = message as Partial<ChatMessageAgentIdentity>;
  return identity.agentRuntimeId
    ? {
        agentRuntimeId: identity.agentRuntimeId,
        ...(identity.agentName ? { agentName: identity.agentName } : {}),
        agentAvatar: identity.agentAvatar ?? null,
        ...(identity.agentColor ? { agentColor: identity.agentColor } : {}),
        ...(identity.collaborationRole
          ? { collaborationRole: identity.collaborationRole }
          : {}),
        ...(identity.collaborationAssignmentId
          ? { collaborationAssignmentId: identity.collaborationAssignmentId }
          : {}),
      }
    : undefined;
}

function identityKey(identity?: ChatMessageAgentIdentity): string {
  return identity
    ? [
        identity.agentRuntimeId,
        identity.agentName,
        identity.agentAvatar,
        identity.agentColor,
        identity.collaborationAssignmentId,
      ].join("\u0000")
    : "";
}

export const MessageList = memo(function MessageList({
  messages,
  isLoading,
  toolProgress,
  agentName = "Agent",
  agentAvatar,
  agentColor,
  onApprove,
  onDeny,
  onClarifyResolved,
  onAgentAvatarClick,
  onBranchFromMessage,
}: MessageListProps): React.JSX.Element {
  // Bubbles with empty content are still hidden (live-stream placeholders).
  // History rows pass through unconditionally.
  const visibleMessages = useMemo(() => {
    const contentMessages = messages.filter((m) => {
      if (!isBubble(m)) return true;
      return !!m.error || ((m.content as string) || "").trim().length > 0;
    });
    return placeInitialUserMessageBeforeAgentTrace(
      collapseHistoricalEchoes(contentMessages),
    );
  }, [messages]);

  const lastBubble = [...messages].reverse().find(isBubble);
  const lastMessageIsAgent = !!lastBubble && lastBubble.role === "agent";
  // Render plan: bubble/reasoning rows pass through one-to-one, but a
  // contiguous run of tool_call/tool_result rows folds into a single
  // ToolActivityGroup (collapsed by default) instead of one bubble per call.
  const rows: React.JSX.Element[] = [];
  for (let i = 0; i < visibleMessages.length; i++) {
    const msg = visibleMessages[i];
    // One avatar per turn: show it only on the first row of a contiguous run
    // of same-role rows. The agent turn's thinking/tool rows + answer bubble
    // share one avatar; the continuation rows render a spacer.
    const prev = visibleMessages[i - 1];
    const currentIdentity = messageIdentity(msg);
    const previousIdentity = prev ? messageIdentity(prev) : undefined;
    const previousKind = (prev as { kind?: string } | undefined)?.kind;
    // System/clarify cards do not render an agent avatar. They therefore
    // cannot own the avatar for the assistant answer that follows them, even
    // when both rows carry the same persisted collaboration identity.
    const previousOwnsAvatar =
      previousKind !== "system" && previousKind !== "clarify";
    const showAvatar =
      !prev ||
      !previousOwnsAvatar ||
      prev.role !== msg.role ||
      identityKey(previousIdentity) !== identityKey(currentIdentity);
    const rowAgentName = currentIdentity?.agentName || agentName;
    const rowAgentAvatar = currentIdentity
      ? currentIdentity.agentAvatar
      : agentAvatar;
    const rowAgentColor = currentIdentity?.agentColor || agentColor;
    const handleAvatarClick =
      currentIdentity && onAgentAvatarClick
        ? () => onAgentAvatarClick(currentIdentity)
        : undefined;

    if (isToolRow(msg)) {
      // Collect the whole run of consecutive tool rows.
      const group: (ToolCallMessage | ToolResultMessage)[] = [];
      const start = i;
      while (i < visibleMessages.length && isToolRow(visibleMessages[i])) {
        group.push(visibleMessages[i] as ToolCallMessage | ToolResultMessage);
        i++;
      }
      i--; // step back: the for-loop's i++ advances past the run
      rows.push(
        <ToolActivityGroup
          key={`${group[0].id}-${start}`}
          items={group}
          // Active (spinner) only while streaming and this run is trailing.
          active={isLoading && i === visibleMessages.length - 1}
          // A tool-only trace still needs a visible owner. When reasoning
          // precedes it this remains a grouped continuation row; otherwise
          // the tool group carries the runtime avatar and name itself.
          showAvatar={showAvatar}
          agentName={rowAgentName}
          agentAvatar={rowAgentAvatar}
          agentColor={rowAgentColor}
          onAgentAvatarClick={handleAvatarClick}
        />,
      );
      continue;
    }

    const k = (msg as { kind?: string }).kind;
    if (k === "system") {
      rows.push(<SystemEventRow key={msg.id} message={msg as SystemMessage} />);
      continue;
    }
    if (k === "reasoning") {
      rows.push(
        <ReasoningRow
          key={msg.id}
          msg={msg as Extract<ChatMessage, { kind: "reasoning" }>}
          // Still "Thinking…" only while this is the last row and the turn is
          // streaming; once the answer arrives (or history loads) it becomes
          // a completed "Thought".
          active={isLoading && i === visibleMessages.length - 1}
          showAvatar={showAvatar}
          agentName={rowAgentName}
          agentAvatar={rowAgentAvatar}
          agentColor={rowAgentColor}
          onAgentAvatarClick={handleAvatarClick}
        />,
      );
      continue;
    }

    if (k === "clarify") {
      rows.push(
        <ClarifyCard
          key={msg.id}
          msg={msg as ClarifyMessage}
          onResolved={onClarifyResolved}
        />,
      );
      continue;
    }

    const bubble = msg as Extract<ChatMessage, { role: "user" | "agent" }>;
    rows.push(
      <MessageRow
        key={msg.id}
        msg={bubble}
        isLast={i === visibleMessages.length - 1}
        isLoading={isLoading}
        onApprove={onApprove}
        onDeny={onDeny}
        showAvatar={showAvatar}
        agentName={rowAgentName}
        agentAvatar={rowAgentAvatar}
        agentColor={rowAgentColor}
        onAgentAvatarClick={handleAvatarClick}
        onBranchFromMessage={onBranchFromMessage}
      />,
    );
  }

  return (
    <>
      {rows}

      {isLoading && !lastMessageIsAgent && (
        <TypingIndicator toolProgress={toolProgress} />
      )}

      {isLoading && toolProgress && lastMessageIsAgent && (
        <div className="chat-tool-progress-inline">{toolProgress}</div>
      )}
    </>
  );
});
