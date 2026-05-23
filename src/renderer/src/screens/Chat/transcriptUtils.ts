import type { ChatMessage } from "./types";

export type TranscriptFormat = "text" | "markdown";

/**
 * Serialise a conversation into a clipboard-ready transcript (issue #298).
 *
 * - `text`     → plain `You: …` / `Hermes: …` blocks.
 * - `markdown` → `**You:**` / `**Hermes:**` headed blocks.
 *
 * Blocks are separated by a blank line. Exported for unit testing.
 */
export function buildChatTranscript(
  messages: ChatMessage[],
  format: TranscriptFormat,
): string {
  return messages
    .map((m) => {
      const speaker = m.role === "user" ? "You" : "Hermes";
      const content = (m.content ?? "").trim();
      return format === "markdown"
        ? `**${speaker}:**\n\n${content}`
        : `${speaker}: ${content}`;
    })
    .join("\n\n");
}
