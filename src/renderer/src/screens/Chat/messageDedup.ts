import type { ChatBubbleMessage, ChatMessage } from "./types";

function isBubbleMessage(message: ChatMessage): message is ChatBubbleMessage {
  const kind = (message as { kind?: string }).kind;
  return !kind || kind === "user" || kind === "assistant";
}

function visibleAgentText(message: ChatMessage): string | null {
  if (message.role !== "agent") return null;
  if (message.kind === "reasoning") return message.text;
  if (!message.kind || message.kind === "assistant") return message.content;
  return null;
}

function normalized(text: string): string {
  return text
    .replace(/<file\b[^>]*>[\s\S]*?<\/file>/gi, " ")
    .replace(/<\/?file\b[^>]*>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function isPersisted(message: ChatMessage): boolean {
  // Positive numeric ids are authoritative Hermes rows. Negative db ids are
  // desktop recovery overlays and must still be treated as transient/live.
  return /^db-\d+$/.test(message.id);
}

function isCanonicalPersistedAssistant(message: ChatMessage): boolean {
  return (
    message.role === "agent" && isBubbleMessage(message) && isPersisted(message)
  );
}

function isTransientAssistant(message: ChatMessage): boolean {
  return (
    message.role === "agent" &&
    isBubbleMessage(message) &&
    (!isPersisted(message) || /^db--\d+$/.test(message.id))
  );
}

function isLiveBubble(message: ChatMessage): boolean {
  return (
    isBubbleMessage(message) &&
    (Boolean(message.pending) ||
      Boolean(message.turnId) ||
      !isPersisted(message))
  );
}

function isEcho(
  leftMessage: ChatMessage,
  left: string,
  rightMessage: ChatMessage,
  right: string,
): boolean {
  const a = normalized(left);
  const b = normalized(right);
  if (!a || !b) return false;
  if (a === b) return true;

  let prefix = 0;
  const limit = Math.min(a.length, b.length);
  while (prefix < limit && a[prefix] === b[prefix]) prefix++;
  const crossSourceLiveEcho =
    (isPersisted(leftMessage) && isLiveBubble(rightMessage)) ||
    (isPersisted(rightMessage) && isLiveBubble(leftMessage)) ||
    ("pending" in leftMessage && Boolean(leftMessage.pending)) ||
    ("pending" in rightMessage && Boolean(rightMessage.pending));

  // A persisted final answer can arrive while a one-character live fragment is
  // still on screen. Only allow that aggressive prefix match across live/DB
  // sources; ordinary same-turn prose still needs a meaningful shared prefix.
  if (crossSourceLiveEcho && prefix === limit) return true;
  return prefix >= 12 && prefix / limit >= 0.55;
}

function isRepeatedCopy(longer: string, shorter: string): boolean {
  const longText = normalized(longer);
  const shortText = normalized(shorter);
  if (!shortText || longText.length <= shortText.length) return false;
  if (longText.length % shortText.length !== 0) return false;
  return shortText.repeat(longText.length / shortText.length) === longText;
}

function isDuplicatePersistedUser(
  messages: ReadonlyArray<ChatMessage>,
  index: number,
  hidden: ReadonlySet<string>,
): boolean {
  const current = messages[index];
  if (
    current.role !== "user" ||
    !("content" in current) ||
    !isPersisted(current)
  ) {
    return false;
  }
  const key = normalized(current.content);
  if (!key) return false;

  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex--) {
    const previous = messages[previousIndex];
    if (
      hidden.has(previous.id) ||
      previous.role !== "user" ||
      !("content" in previous) ||
      isPersisted(previous)
    ) {
      continue;
    }
    if (normalized(previous.content) === key) return true;
  }
  return false;
}

/**
 * Older remote Hermes histories can contain the streamed answer, a mirrored
 * reasoning record, and the final answer as three separate stored rows. Keep
 * the most complete answer on screen while leaving the source history intact.
 */
export function collapseHistoricalEchoes(
  messages: ChatMessage[],
): ChatMessage[] {
  const hidden = new Set<string>();
  let userTurnStart = 0;

  for (let index = 0; index < messages.length; index++) {
    const current = messages[index];
    if (current.role === "user") {
      if (isDuplicatePersistedUser(messages, index, hidden)) {
        hidden.add(current.id);
        continue;
      }
      userTurnStart = index + 1;
      continue;
    }

    const currentText = visibleAgentText(current);
    if (!currentText) continue;

    // The canonical positive DB row is authoritative for a completed remote
    // turn. Remove live stream and negative-id recovery fragments from that
    // same turn even if a split multibyte chunk prevents textual prefix
    // matching. Canonical tool/reasoning rows remain visible.
    if (isCanonicalPersistedAssistant(current)) {
      for (
        let previousIndex = index - 1;
        previousIndex >= userTurnStart;
        previousIndex--
      ) {
        const previous = messages[previousIndex];
        if (!hidden.has(previous.id) && isTransientAssistant(previous)) {
          hidden.add(previous.id);
        }
      }
    }

    for (
      let previousIndex = index - 1;
      previousIndex >= userTurnStart;
      previousIndex--
    ) {
      const previous = messages[previousIndex];
      if (hidden.has(previous.id)) continue;
      const previousText = visibleAgentText(previous);
      if (
        !previousText ||
        !isEcho(previous, previousText, current, currentText)
      ) {
        continue;
      }

      // Thought is useful when it differs from the answer, but a mirrored
      // answer adds noise. For two answer bubbles, retain the fuller version.
      if (
        normalized(currentText) === normalized(previousText) &&
        isPersisted(current) &&
        !isPersisted(previous)
      ) {
        hidden.add(current.id);
      } else if (isRepeatedCopy(currentText, previousText)) {
        hidden.add(current.id);
      } else if (isRepeatedCopy(previousText, currentText)) {
        hidden.add(previous.id);
      } else if (current.kind === "reasoning") {
        hidden.add(current.id);
      } else if (previous.kind === "reasoning") {
        hidden.add(previous.id);
      } else if (
        normalized(currentText).length >= normalized(previousText).length
      ) {
        hidden.add(previous.id);
      } else {
        hidden.add(current.id);
      }
      break;
    }
  }

  return hidden.size === 0
    ? messages
    : messages.filter((message) => !hidden.has(message.id));
}
