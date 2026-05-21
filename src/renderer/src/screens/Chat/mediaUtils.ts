/**
 * Parsing for agent-delivered media (issue #299).
 *
 * Two signals are recognised in agent responses:
 *
 *  1. Explicit `MEDIA:<path-or-url>` tokens — hermes-agent's delivery
 *     protocol. Trusted: rendered eagerly.
 *  2. A line whose *entire* trimmed content is an absolute file path with a
 *     known extension — the agent often just states the path it created
 *     instead of emitting a MEDIA: tag. Treated as a *candidate*: the
 *     renderer verifies the file exists before showing it, and lines inside
 *     ``` fences are skipped, so paths in code examples are left alone.
 *
 * hermes-agent's own MEDIA: regexes are POSIX-only (paths must start with
 * `/` or `~/`); this parser also accepts Windows drive / UNC paths.
 */

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

// Extensions recognised in a bare (untagged) path line.
const BARE_PATH_EXT =
  "png|jpe?g|gif|webp|svg|bmp|avif|pdf|txt|md|csv|json|docx?|xlsx?|pptx?|" +
  "odt|rtf|zip|tar|gz|mp4|mov|webm|mkv|avi|mp3|wav|ogg|opus|m4a|flac";

// MEDIA: + optional whitespace + (quoted) | (bare non-whitespace run).
const MEDIA_RE =
  /MEDIA:[ \t]*(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))/g;

// A whole line that is exactly an absolute path ending in a known extension.
// Applied to the trimmed line, so spaces inside the path are tolerated. The
// `^` anchor keeps it from matching URLs (which start with a scheme).
const ABS_PATH_LINE_RE = new RegExp(
  `^(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/|~[\\\\/]).*\\.(?:${BARE_PATH_EXT})$`,
  "i",
);

export interface MediaToken {
  /** The resolved path or URL. */
  src: string;
  /** True when `src` is an http(s) URL rather than a local path. */
  isUrl: boolean;
  /** True when the extension looks like a displayable image. */
  isImage: boolean;
  /** Last path/URL segment, for download filenames and alt text. */
  name: string;
}

export type MediaSegment =
  | { type: "text"; value: string }
  | {
      type: "media";
      token: MediaToken;
      /** Exact original text this segment replaced. Rendered verbatim when
       *  a bare-path candidate turns out not to be a real file. */
      raw: string;
      /** `media-token` — explicit MEDIA: tag, rendered eagerly.
       *  `bare-path` — inferred path, rendered only once verified to exist. */
      source: "media-token" | "bare-path";
    };

function toToken(raw: string, wasQuoted: boolean): MediaToken | null {
  let src = raw.trim();
  // Bare MEDIA: tokens may swallow trailing sentence punctuation.
  if (!wasQuoted) src = src.replace(/[).,;:!?\]}]+$/, "");
  if (!src) return null;
  const isUrl = /^https?:\/\//i.test(src);
  const name = src.split(/[\\/]/).filter(Boolean).pop() || src;
  return { src, isUrl, isImage: IMAGE_EXT.test(src), name };
}

interface Hit {
  start: number;
  end: number;
  token: MediaToken;
  raw: string;
  source: "media-token" | "bare-path";
}

/**
 * Split agent content into ordered text / media segments. Text segments are
 * rendered as markdown; media segments as inline images or download chips.
 */
export function parseMediaTokens(content: string): MediaSegment[] {
  const hits: Hit[] = [];

  // 1) Explicit MEDIA: tokens.
  MEDIA_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MEDIA_RE.exec(content)) !== null) {
    const quoted = m[1] ?? m[2] ?? m[3];
    const token = toToken(quoted ?? m[4] ?? "", quoted !== undefined);
    if (!token) continue;
    hits.push({
      start: m.index,
      end: m.index + m[0].length,
      token,
      raw: m[0],
      source: "media-token",
    });
  }

  // 2) Whole-line bare absolute paths, skipping ``` fenced code.
  let offset = 0;
  let inFence = false;
  for (const line of content.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1; // include the consumed "\n"
    const trimmed = line.trim();
    if (/^```/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed || !ABS_PATH_LINE_RE.test(trimmed)) continue;
    const start = lineStart + line.indexOf(trimmed);
    const end = start + trimmed.length;
    // Don't double-count a path already inside a MEDIA: token.
    if (hits.some((h) => start < h.end && end > h.start)) continue;
    const token = toToken(trimmed, true);
    if (!token) continue;
    hits.push({ start, end, token, raw: trimmed, source: "bare-path" });
  }

  hits.sort((a, b) => a.start - b.start);

  const segments: MediaSegment[] = [];
  let last = 0;
  for (const h of hits) {
    if (h.start > last) {
      segments.push({ type: "text", value: content.slice(last, h.start) });
    }
    segments.push({
      type: "media",
      token: h.token,
      raw: h.raw,
      source: h.source,
    });
    last = h.end;
  }
  if (last < content.length) {
    segments.push({ type: "text", value: content.slice(last) });
  }
  return segments;
}

/** True when `content` contains at least one explicit MEDIA: token. */
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
