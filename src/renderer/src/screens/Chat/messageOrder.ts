import type { ChatMessage } from "./types";

function isAgentHistory(message: ChatMessage): boolean {
  const kind = (message as { kind?: string }).kind;
  return (
    message.role === "agent" &&
    (kind === "reasoning" || kind === "tool_call" || kind === "tool_result")
  );
}

/**
 * Some remote history APIs return the first turn's agent trace before its user
 * message. Move only that leading trace behind the first user bubble; all
 * subsequent event ordering remains untouched.
 */
export function placeInitialUserMessageBeforeAgentTrace(
  messages: readonly ChatMessage[],
): ChatMessage[] {
  let leadingHistoryCount = 0;
  while (
    leadingHistoryCount < messages.length &&
    isAgentHistory(messages[leadingHistoryCount])
  ) {
    leadingHistoryCount += 1;
  }

  if (leadingHistoryCount === 0 || leadingHistoryCount >= messages.length) {
    return [...messages];
  }

  const firstBubble = messages[leadingHistoryCount];
  const kind = (firstBubble as { kind?: string }).kind;
  if (firstBubble.role !== "user" || (kind !== undefined && kind !== "user")) {
    return [...messages];
  }

  return [
    firstBubble,
    ...messages.slice(0, leadingHistoryCount),
    ...messages.slice(leadingHistoryCount + 1),
  ];
}
