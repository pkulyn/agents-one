/** File references are derived presentation, never persisted grants. */
export interface ConversationFileRef {
  conversationId: string;
  messageId: string;
  path?: string;
  artifactId?: string;
}
export interface ConversationFileInfo {
  name: string;
  path: string;
  relativePath?: string;
  size: number;
  image: boolean;
}
export type ConversationFileAction =
  | "open"
  | "open-with"
  | "save"
  | "copy-path"
  | "copy-relative"
  | "reveal"
  | "image"
  | "menu";
export interface FileReferenceMatch {
  start: number;
  end: number;
  path: string;
}
const EXT =
  "md|markdown|txt|pdf|docx?|xlsx?|pptx?|csv|tsv|json|ya?ml|toml|log|rtf|odt|ods|odp|png|jpe?g|gif|webp|svg|bmp|avif|mp3|wav|mp4|webm|zip";
export function documentPath(value: string): string | null {
  let path = value.trim();
  if (/^file:\/\//i.test(path)) {
    if (!/^file:\/\/\//i.test(path)) return null;
    try {
      path = decodeURIComponent(path.replace(/^file:\/\/\//i, "/"));
    } catch {
      return null;
    }
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  }
  if (
    !/^(?:[A-Za-z]:[\\/]|\/(?!\/)|~[\\/])/.test(path) ||
    /[\0\r\n]/.test(path)
  )
    return null;
  if (!new RegExp("\\.(?:" + EXT + ")$", "i").test(path)) return null;
  return path.replace(/\\\\/g, "\\");
}
/** Bounded extraction outside fenced commands, including Chinese names and quoted spaces. */
export function findDocumentReferences(content: string): FileReferenceMatch[] {
  const text = content.slice(0, 200_000);
  const result: FileReferenceMatch[] = [];
  const excluded: Array<[number, number]> = [];
  const fences =
    /(?:^|\n)(?:\x60{3,}|~{3,})[^\n]*\n[\s\S]*?(?:(?:\n)(?:\x60{3,}|~{3,})|$)/g;
  for (const m of text.matchAll(fences))
    excluded.push([m.index!, m.index! + m[0].length]);
  const add = (start: number, end: number, raw: string): void => {
    if (
      excluded.some(([s, e]) => start < e && end > s) ||
      result.some((r) => start < r.end && end > r.start)
    )
      return;
    const path = documentPath(raw);
    if (path) result.push({ start, end, path });
  };
  for (const m of text.matchAll(
    /\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s\n]+?))\s*\)/g,
  ))
    add(m.index!, m.index! + m[0].length, m[1] || m[2]);
  for (const m of text.matchAll(/\x60([^\x60\n]+)\x60/g)) {
    add(m.index!, m.index! + m[0].length, m[1]);
    excluded.push([m.index!, m.index! + m[0].length]);
  }
  const bare = new RegExp(
    String.raw`(?<![\w/\\.:])(?:[A-Za-z]:[\\/]|/(?!/)|~[\\/])[^\s\x60<>"'，。；！？]+?\.(?:` +
      EXT +
      String.raw`)(?=[\s\x60<>"'，。；！？,;:!?\])}]|$)`,
    "gi",
  );
  for (const m of text.matchAll(bare))
    add(m.index!, m.index! + m[0].length, m[0]);
  return result.sort((a, b) => a.start - b.start);
}
