const CONTENT_JSON_PREFIX = "\x00json:";

const AUTOMATION_SOURCE_PATTERN =
  /(^|[^a-z0-9])(cron|cronjob|schedule|scheduled|scheduler|automation)([^a-z0-9]|$)/i;

export function isAutomationSessionSource(
  source: string | null | undefined,
): boolean {
  return AUTOMATION_SOURCE_PATTERN.test(String(source || "").trim());
}

export function isPlaceholderSessionTitle(
  title: string | null | undefined,
): boolean {
  const text = String(title || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return true;
  if (/^sessions\.newconversation$/i.test(text)) return true;
  if (/^new conversation$/i.test(text)) return true;
  return /^sessions?\s+[a-z0-9_-]{4,}$/i.test(text);
}

function visibleTextFromContent(raw: string): string {
  if (!raw.startsWith(CONTENT_JSON_PREFIX)) return raw;

  try {
    const parsed = JSON.parse(raw.slice(CONTENT_JSON_PREFIX.length));
    if (typeof parsed === "string") return parsed;
    if (!Array.isArray(parsed)) return raw;

    const parts: string[] = [];
    for (const part of parsed) {
      if (typeof part === "string") {
        if (part) parts.push(part);
        continue;
      }
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      const type = String(record.type || "").toLowerCase();
      if (type === "text" || type === "input_text" || type === "output_text") {
        const text = record.text;
        if (typeof text === "string" && text) parts.push(text);
      }
    }
    return parts.join("\n\n") || raw;
  } catch {
    return raw;
  }
}

export function sessionTitleFromText(raw: string, fallback: string): string {
  let text = visibleTextFromContent(raw || "").trim();
  if (!text) return fallback;

  text = text
    .replace(/\[The user attached an image[^\]]*\]\s*/gi, "")
    .replace(/\[You can examine it with vision_analyze[^\]]*\]\s*/gi, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_`~[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return fallback;
  if (text.length <= 50) return text;

  const words = text.split(" ");
  let title = "";
  for (const word of words) {
    if ((title + " " + word).trim().length > 45) break;
    title = (title + " " + word).trim();
  }

  return title || `${text.slice(0, 45)}...`;
}
