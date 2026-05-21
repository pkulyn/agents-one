/**
 * Parsing for hermes-agent's `MEDIA:` delivery protocol (issue #299).
 *
 * The agent emits `MEDIA:<path-or-url>` tokens inline in its responses to
 * deliver generated files (images, audio, …). Messaging-platform adapters
 * turn those into native attachments; the desktop must do the same.
 *
 * hermes-agent's own regexes are POSIX-leaning (paths must start with `/`
 * or `~/`), so a generated Windows path like `MEDIA:C:\Users\me\cat.png`
 * is not matched upstream. This parser is deliberately more permissive: a
 * token is `MEDIA:` followed by either a quoted string or an unquoted run
 * of non-whitespace, covering Windows paths, POSIX paths and URLs.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// MEDIA: + optional whitespace + (backtick/double/single quoted) | (bare run)
const MEDIA_RE =
  /MEDIA:[ \t]*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g;

export interface MediaToken {
  /** The resolved path or URL. */
  src: string;
  /** True when `src` is an http(s) URL rather than a local path. */
  isUrl: boolean;
  /** True when the file extension looks like a displayable image. */
  isImage: boolean;
  /** Last path/URL segment, for download filenames and alt text. */
  name: string;
}

export type MediaSegment =
  | { type: "text"; value: string }
  | { type: "media"; token: MediaToken };

function toToken(raw: string, wasQuoted: boolean): MediaToken | null {
  let src = raw.trim();
  // Bare tokens may swallow trailing sentence punctuation — strip it.
  if (!wasQuoted) src = src.replace(/[).,;:!?\]}]+$/, "");
  if (!src) return null;
  const isUrl = /^https?:\/\//i.test(src);
  const name = src.split(/[\\/]/).filter(Boolean).pop() || src;
  return { src, isUrl, isImage: IMAGE_EXT.test(src), name };
}

/**
 * Split agent content into ordered text / media segments. Text segments
 * are rendered as markdown; media segments as inline images (or chips).
 */
export function parseMediaTokens(content: string): MediaSegment[] {
  const segments: MediaSegment[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  MEDIA_RE.lastIndex = 0;
  while ((m = MEDIA_RE.exec(content)) !== null) {
    const quoted = m[1] ?? m[2] ?? m[3];
    const token = toToken(quoted ?? m[4] ?? "", quoted !== undefined);
    if (!token) continue;
    if (m.index > lastIndex) {
      segments.push({
        type: "text",
        value: content.slice(lastIndex, m.index),
      });
    }
    segments.push({ type: "media", token });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    segments.push({ type: "text", value: content.slice(lastIndex) });
  }
  return segments;
}

/** True when `content` contains at least one MEDIA: token. */
export function hasMediaTokens(content: string): boolean {
  MEDIA_RE.lastIndex = 0;
  return MEDIA_RE.test(content);
}

/** Classify a plain image src (used by the markdown `img` override). */
export function describeImageSrc(src: string): MediaToken {
  const trimmed = src.trim();
  const isUrl = /^https?:\/\//i.test(trimmed);
  const name = trimmed.split(/[\\/]/).filter(Boolean).pop() || trimmed;
  return { src: trimmed, isUrl, isImage: true, name };
}
