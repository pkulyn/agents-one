import http from "http";
import https from "https";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { CachedSession } from "./session-cache";
import {
  extractLeadingVisionImageFallback,
  stripTrailingImagePlaceholders,
} from "./session-attachment-store";
import {
  expandRowsToHistory,
  type HistoryItem,
  type RawMessageRow,
  type SearchResult,
  type SessionSummary,
} from "./sessions";
import type { Attachment } from "../shared/attachments";
import { isImageMime, MAX_IMAGE_BYTES } from "../shared/attachments";
import {
  isAutomationSessionSource,
  isPlaceholderSessionTitle,
  sessionTitleFromText,
} from "../shared/session-list";
import { configuredRemoteTlsOptions } from "./remote-tls";
import { remoteDashboardRpc } from "./remote-dashboard-rpc";
import {
  listLocalSessionContinuationEntries,
  loadSessionContinuationItemsForSession,
  mergeSessionContinuationWithCanonical,
} from "./session-continuation-store";
import { getSessionContextFolders } from "./session-context-folder-store";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "./utils";

export interface RemoteSessionConfig {
  remoteUrl: string;
  apiKey: string;
  /** Same-origin fallback used only after the primary dashboard credential is
   * rejected. This supports NAS proxies that protect management APIs with the
   * gateway API key while leaving a stale dashboard token configured. */
  fallbackApiKey?: string;
  /** When set (and not "default"), every dashboard request is scoped to this
   *  profile via `?profile=`. The SSH transport uses ONE unified machine
   *  dashboard for all profiles (see ensureDashboardInner), so per-profile data
   *  correctness comes from this query param rather than a per-profile server. */
  profile?: string;
}

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RemoteRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  timeoutMs?: number;
}

type RemoteRecord = Record<string, unknown>;

interface RemoteSessionCacheData {
  histories: Record<string, HistoryItem[]>;
  sessions: CachedSession[];
  updatedAt: number;
}

function remoteSessionCachePath(config: RemoteSessionConfig): string {
  const profile = config.profile?.trim() || getActiveProfileNameSync();
  return join(profileHome(profile), "desktop", "remote-session-cache.json");
}

function readRemoteSessionCache(config: RemoteSessionConfig): RemoteSessionCacheData {
  try {
    const file = remoteSessionCachePath(config);
    if (!existsSync(file)) return { histories: {}, sessions: [], updatedAt: 0 };
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<RemoteSessionCacheData>;
    return {
      histories:
        parsed.histories && typeof parsed.histories === "object"
          ? parsed.histories
          : {},
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return { histories: {}, sessions: [], updatedAt: 0 };
  }
}

function writeRemoteSessionCache(
  config: RemoteSessionConfig,
  patch: Partial<Pick<RemoteSessionCacheData, "histories" | "sessions">>,
): void {
  try {
    const previous = readRemoteSessionCache(config);
    const patchedSessions =
      patch.sessions && patch.sessions.length === 0 && previous.sessions.length > 0
        ? previous.sessions
        : patch.sessions;
    const next: RemoteSessionCacheData = {
      histories: patch.histories ?? previous.histories,
      sessions: patchedSessions ?? previous.sessions,
      updatedAt: Date.now(),
    };
    safeWriteFile(remoteSessionCachePath(config), JSON.stringify(next));
  } catch {
    // Cache writes are best-effort and must never block remote chat.
  }
}

function overlaySessions(): CachedSession[] {
  const now = Date.now() / 1000;
  const sessions: CachedSession[] = [];
  listLocalSessionContinuationEntries().forEach(
    ({ sessionId, items }, index) => {
      const title = titleFromHistoryItems(items);
      if (!title) return;
      sessions.push({
        id: sessionId,
        title,
        startedAt: now - index / 1000,
        source: "desktop-overlay",
        messageCount: items.length,
        model: "",
        contextFolder: null,
      });
    },
  );
  return sessions;
}

function mergeCachedSessions(
  cached: CachedSession[],
  overlays: CachedSession[],
): CachedSession[] {
  const merged = new Map<string, CachedSession>();
  for (const session of cached) merged.set(session.id, session);
  for (const session of overlays) {
    const existing = merged.get(session.id);
    merged.set(
      session.id,
      existing
        ? {
            ...existing,
            ...session,
            startedAt: Math.max(existing.startedAt || 0, session.startedAt || 0),
            messageCount: Math.max(
              existing.messageCount || 0,
              session.messageCount || 0,
            ),
            model: existing.model || session.model,
            source:
              session.source === "desktop-overlay" &&
              existing.source !== "desktop-overlay"
                ? existing.source
                : session.source,
            contextFolder: session.contextFolder ?? existing.contextFolder,
          }
        : session,
    );
  }
  return Array.from(merged.values()).sort((a, b) => b.startedAt - a.startedAt);
}

function historyTimestamp(items: HistoryItem[]): number {
  return Math.max(
    0,
    ...items
      .map((item) => (typeof item.timestamp === "number" ? item.timestamp : 0))
      .filter((timestamp) => Number.isFinite(timestamp)),
  );
}

function sessionsFromCachedHistories(
  histories: Record<string, HistoryItem[]>,
): CachedSession[] {
  return Object.entries(histories)
    .map((entry): CachedSession | null => {
      const [id, items] = entry;
      if (!Array.isArray(items) || items.length === 0) return null;
      const title = titleFromHistoryItems(items) || `Session ${id.slice(-6)}`;
      return {
        id,
        title,
        startedAt: historyTimestamp(items),
        source: "remote-cache",
        messageCount: items.length,
        model: "",
        contextFolder: null,
      };
    })
    .filter((session): session is CachedSession => Boolean(session))
    .sort((a, b) => b.startedAt - a.startedAt);
}

// A remote Dashboard does not own desktop-selected Windows folders. Overlay
// that local-only relationship after each fetch so remote sessions stay under
// the right project in the sidebar instead of falling back to the task list.
function attachLocalContextFolders(sessions: CachedSession[]): CachedSession[] {
  const folders = getSessionContextFolders(sessions.map((session) => session.id));
  return sessions.map((session) => ({
    ...session,
    contextFolder: folders.get(session.id) ?? session.contextFolder ?? null,
  }));
}

function normalizeRemoteDashboardBaseUrl(value: string): string {
  const raw = value.trim();
  if (!raw) throw new Error("Remote Hermes dashboard URL is not configured.");
  const url = new URL(raw);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (url.pathname === "/v1" || url.pathname === "/api") {
    url.pathname = "";
  }
  return url.toString().replace(/\/+$/, "");
}

// Exported so every dashboard request — including remote-metadata's /api/status
// probe — shares ONE URL builder and gets the same `?profile=` scoping.
export function dashboardApiUrl(
  config: RemoteSessionConfig,
  path: string,
): string {
  const base = normalizeRemoteDashboardBaseUrl(config.remoteUrl);
  const url = new URL(path.replace(/^\/+/, ""), `${base}/`);
  // Scope to the requested profile on the unified machine dashboard, unless the
  // path already carries an explicit profile (e.g. the sessions list uses
  // `profile=all`). "default"/empty needs no param.
  const profile = config.profile?.trim();
  if (profile && profile !== "default" && !url.searchParams.has("profile")) {
    url.searchParams.set("profile", profile);
  }
  return url.toString();
}

export function remoteRequestJson<T>(
  config: RemoteSessionConfig,
  path: string,
  options: RemoteRequestOptions = {},
): Promise<T> {
  const token = config.apiKey.trim();
  if (!token)
    throw new Error("Remote Hermes dashboard token is not configured.");

  return requestRemoteJson<T>(config, path, options, token).catch((error) => {
    const fallback = config.fallbackApiKey?.trim();
    if (
      fallback &&
      fallback !== token &&
      error instanceof RemoteRequestError &&
      (error.statusCode === 401 || error.statusCode === 403)
    ) {
      return requestRemoteJson<T>(config, path, options, fallback);
    }
    throw error;
  });
}

class RemoteRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "RemoteRequestError";
  }
}

function requestRemoteJson<T>(
  config: RemoteSessionConfig,
  path: string,
  options: RemoteRequestOptions,
  token: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(dashboardApiUrl(config, path));
    const client = parsed.protocol === "https:" ? https : http;
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = client.request(
      parsed,
      {
        method: options.method ?? "GET",
        ...configuredRemoteTlsOptions(parsed.toString()),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Hermes-Session-Token": token,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("error", reject);
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode ?? 500) >= 400) {
            reject(
              new RemoteRequestError(
                res.statusCode ?? 500,
                `${res.statusCode}: ${text || res.statusMessage}`,
              ),
            );
            return;
          }
          if (!text) {
            resolve(null as T);
            return;
          }
          try {
            resolve(JSON.parse(text) as T);
          } catch {
            reject(
              new Error(
                `Invalid JSON from ${parsed.toString()} (status ${
                  res.statusCode
                }): ${text.slice(0, 200)}`,
              ),
            );
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(options.timeoutMs ?? 15_000, () => {
      req.destroy(
        new Error(
          `Timed out connecting to remote Hermes dashboard after ${
            options.timeoutMs ?? 15_000
          }ms`,
        ),
      );
    });
    if (body) req.write(body);
    req.end();
  });
}

function asRecord(value: unknown): RemoteRecord {
  return value && typeof value === "object" ? (value as RemoteRecord) : {};
}

function asArray(value: unknown): RemoteRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function contentString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? value : null;
  if (Array.isArray(value)) {
    const parts = value
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const record = part as RemoteRecord;
        const text = record.text ?? record.content;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean);
    return parts.length ? parts.join("\n\n") : null;
  }
  if (value && typeof value === "object") {
    const record = value as RemoteRecord;
    return contentString(record.text ?? record.content ?? record.message);
  }
  return null;
}

function firstStringField(row: RemoteRecord, fields: string[]): string | null {
  for (const field of fields) {
    const value = contentString(row[field]);
    if (value) return value;
  }
  return null;
}

function dataUrlValue(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("data:image/")
    ? value
    : null;
}

function remoteImageName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || "image";
}

function highlightTextMatch(text: string, query: string): string {
  if (!text) return "";
  const terms = [query.trim(), ...query.trim().split(/\s+/)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const term of terms) {
    const index = text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if (index >= 0) {
      return `${text.slice(0, index)}<<${text.slice(
        index,
        index + term.length,
      )}>>${text.slice(index + term.length)}`;
    }
  }
  return text;
}

function historyItemSearchText(item: HistoryItem): string {
  switch (item.kind) {
    case "user":
    case "assistant":
    case "tool_result":
      return item.content || "";
    case "reasoning":
      return item.text || "";
    case "tool_call":
      return [item.name, item.args].filter(Boolean).join(" ");
  }
}

function attachmentFromRemoteDataUrl(
  dataUrl: string | null,
  filePath: string,
  id: string,
): Attachment | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1].toLowerCase();
  if (!isImageMime(mime)) return null;
  const size = Buffer.byteLength(match[2], "base64");
  if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
  return {
    id,
    kind: "image",
    name: remoteImageName(filePath),
    mime,
    size,
    dataUrl: dataUrl || "",
    path: filePath,
  };
}

function sessionTitle(row: RemoteRecord, id: string): string {
  const title = nullableString(row.title);
  if (title && !isPlaceholderSessionTitle(title)) return title;
  const preview = nullableString(row.preview);
  if (preview) return sessionTitleFromText(preview, `Session ${id.slice(-6)}`);
  return `Session ${id.slice(-6)}`;
}

function normalizeSessionSummary(row: RemoteRecord): SessionSummary {
  const id = stringValue(row.id, stringValue(row.session_id));
  const title = nullableString(row.title);
  return {
    id,
    source: stringValue(row.source, "chat"),
    startedAt: numberValue(
      row.started_at,
      numberValue(row.session_started, numberValue(row.last_active)),
    ),
    endedAt: nullableNumber(row.ended_at),
    messageCount: numberValue(row.message_count),
    model: stringValue(row.model),
    title: title && !isPlaceholderSessionTitle(title) ? title : null,
    preview: stringValue(row.preview),
  };
}

function normalizeCachedSession(row: RemoteRecord): CachedSession {
  const summary = normalizeSessionSummary(row);
  return {
    id: summary.id,
    title: sessionTitle(row, summary.id),
    startedAt: summary.startedAt,
    source: summary.source,
    messageCount: summary.messageCount,
    model: summary.model,
    contextFolder: null,
  };
}

function titleFromHistoryItems(items: HistoryItem[]): string | null {
  for (const item of items) {
    if (item.kind === "user" && item.content.trim()) {
      return sessionTitleFromText(item.content, "");
    }
  }
  for (const item of items) {
    if (item.kind === "assistant" && item.content.trim()) {
      return sessionTitleFromText(item.content, "");
    }
  }
  return null;
}

function historyHasUserMessage(items: HistoryItem[]): boolean {
  return items.some(
    (item) => item.kind === "user" && Boolean(item.content.trim()),
  );
}

function localContinuationItems(sessionId: string): HistoryItem[] {
  try {
    return loadSessionContinuationItemsForSession(sessionId);
  } catch {
    return [];
  }
}

function mergeRemoteHistoryWithLocalContinuation(
  sessionId: string,
  canonical: HistoryItem[],
): HistoryItem[] {
  const continuation = localContinuationItems(sessionId);
  return mergeSessionContinuationWithCanonical(continuation, canonical);
}

function isUserlessDashboardOrphan(
  session: CachedSession,
  items: HistoryItem[],
): boolean {
  return (
    session.source.toLowerCase() === "api_server" &&
    !historyHasUserMessage(items)
  );
}

async function fillPlaceholderCachedSessionTitles(
  config: RemoteSessionConfig,
  sessions: CachedSession[],
): Promise<CachedSession[]> {
  const CONCURRENCY = 4;
  const out: Array<CachedSession | null> = [...sessions];

  for (let i = 0; i < out.length; i += CONCURRENCY) {
    const chunk = out.slice(i, i + CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async (session) => {
        if (!session) return null;
        if (!isPlaceholderSessionTitle(session.title)) return session;
        try {
          const remoteItems = await remoteGetSessionMessages(
            config,
            session.id,
          );
          const items = mergeRemoteHistoryWithLocalContinuation(
            session.id,
            remoteItems,
          );
          // Dashboard recovery/model-switch attempts can leave a persisted
          // api_server row containing only assistant/tool output. It is not a
          // user conversation and otherwise appears as a second sidebar chat
          // titled from the first Thought message.
          if (isUserlessDashboardOrphan(session, items)) return null;
          const title = titleFromHistoryItems(items);
          return title && !isPlaceholderSessionTitle(title)
            ? { ...session, title }
            : session;
        } catch {
          return session;
        }
      }),
    );
    for (let j = 0; j < resolved.length; j++) out[i + j] = resolved[j];
  }

  return out.filter((session): session is CachedSession => session !== null);
}

function sessionsFromResponse(response: unknown): RemoteRecord[] {
  const record = asRecord(response);
  return asArray(record.sessions);
}

async function remoteSessionListPage(
  config: RemoteSessionConfig,
  limit: number,
  offset: number,
): Promise<unknown> {
  const profileEndpoint =
    `/api/profiles/sessions?limit=${limit}&offset=${offset}` +
    "&min_messages=0&archived=exclude&order=recent&profile=all";

  try {
    return await remoteRequestJson(config, profileEndpoint);
  } catch {
    try {
      return await remoteRequestJson(
        config,
        `/api/sessions?limit=${limit}&offset=${offset}&archived=exclude&order=recent`,
      );
    } catch {
      const response = await remoteDashboardRpc<unknown>(
        config,
        "session.list",
        config.profile ? { profile: config.profile } : {},
      );
      const sessions = sessionsFromResponse(response).filter(
        (row) => !isAutomationSessionSource(stringValue(row.source, "chat")),
      );
      return { sessions: sessions.slice(offset, offset + limit) };
    }
  }
}

export async function remoteListSessions(
  config: RemoteSessionConfig,
  limit = 30,
  offset = 0,
): Promise<SessionSummary[]> {
  const response = await remoteSessionListPage(config, limit, offset);
  return sessionsFromResponse(response)
    .map(normalizeSessionSummary)
    .filter((session) => !isAutomationSessionSource(session.source));
}

export async function remoteListCachedSessions(
  config: RemoteSessionConfig,
  limit = 50,
  offset = 0,
): Promise<CachedSession[]> {
  const cachedBeforeFetch = readRemoteSessionCache(config);
  const recoveredFromHistories = sessionsFromCachedHistories(
    cachedBeforeFetch.histories,
  );
  const cachedWithRecovered = mergeCachedSessions(
    cachedBeforeFetch.sessions,
    recoveredFromHistories,
  );
  try {
    const response = await remoteSessionListPage(config, limit, offset);
    const sessions = sessionsFromResponse(response)
      .map(normalizeCachedSession)
      .filter((session) => !isAutomationSessionSource(session.source));
    const resolved = await fillPlaceholderCachedSessionTitles(config, sessions);
    const enriched = attachLocalContextFolders(resolved);
    if (offset <= 0 && enriched.length > 0) {
      writeRemoteSessionCache(config, {
        sessions: mergeCachedSessions(recoveredFromHistories, enriched),
      });
    }
    if (enriched.length > 0) return enriched;
    if (
      offset <= 0 &&
      cachedBeforeFetch.sessions.length === 0 &&
      recoveredFromHistories.length > 0
    ) {
      writeRemoteSessionCache(config, { sessions: recoveredFromHistories });
    }
    return mergeCachedSessions(
      attachLocalContextFolders(cachedWithRecovered),
      overlaySessions(),
    ).slice(offset, offset + limit);
  } catch {
    if (
      offset <= 0 &&
      cachedBeforeFetch.sessions.length === 0 &&
      recoveredFromHistories.length > 0
    ) {
      writeRemoteSessionCache(config, { sessions: recoveredFromHistories });
    }
    const cached = attachLocalContextFolders(
      cachedWithRecovered,
    );
    return mergeCachedSessions(cached, overlaySessions()).slice(
      offset,
      offset + limit,
    );
  }
}

export async function remoteSearchSessions(
  config: RemoteSessionConfig,
  query: string,
  limit = 20,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const response = await remoteRequestJson(
    config,
    `/api/sessions/search?q=${encodeURIComponent(trimmed)}`,
  );
  const records = asArray(asRecord(response).results);
  const results = records
    .map((row) => {
      const sessionId = stringValue(row.session_id, stringValue(row.id));
      return {
        sessionId,
        title: nullableString(row.title),
        startedAt: numberValue(
          row.session_started,
          numberValue(row.started_at, numberValue(row.timestamp)),
        ),
        source: stringValue(row.source, "chat"),
        messageCount: numberValue(row.message_count),
        model: stringValue(row.model),
        snippet: stringValue(row.snippet),
      };
    })
    .filter((result) => !isAutomationSessionSource(result.source))
    .slice(0, limit);

  const enriched = await enrichRemoteSearchResults(config, results);
  if (enriched.length >= limit) return enriched.slice(0, limit);

  const fallback = await remoteSearchRecentSessionMessages(
    config,
    trimmed,
    limit,
    new Set(enriched.map((result) => result.sessionId)),
  );
  return [...enriched, ...fallback].slice(0, limit);
}

async function remoteSearchRecentSessionMessages(
  config: RemoteSessionConfig,
  query: string,
  limit: number,
  excludedSessionIds: Set<string>,
): Promise<SearchResult[]> {
  let sessions: SessionSummary[];
  try {
    sessions = await remoteListSessions(config, 75, 0);
  } catch {
    return [];
  }

  const lower = query.toLocaleLowerCase();
  const results: SearchResult[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < sessions.length; i += CONCURRENCY) {
    const chunk = sessions.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map(async (session) => {
        if (!session.id || excludedSessionIds.has(session.id)) return null;
        try {
          const items = await remoteGetSessionMessages(config, session.id);
          const match = items
            .map(historyItemSearchText)
            .find((text) => text.toLocaleLowerCase().includes(lower));
          if (!match) return null;
          return {
            sessionId: session.id,
            title: session.title,
            startedAt: session.startedAt,
            source: session.source,
            messageCount: session.messageCount,
            model: session.model,
            snippet: highlightTextMatch(match, query).slice(0, 500),
          } satisfies SearchResult;
        } catch {
          return null;
        }
      }),
    );
    for (const result of fetched) {
      if (!result) continue;
      excludedSessionIds.add(result.sessionId);
      results.push(result);
      if (results.length >= limit) return results;
    }
  }
  return results;
}

async function remoteGetSessionSummary(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<SessionSummary | null> {
  try {
    const response = await remoteRequestJson(
      config,
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      { timeoutMs: 8_000 },
    );
    const record = asRecord(response);
    return record.id || record.session_id
      ? normalizeSessionSummary(record)
      : null;
  } catch {
    return null;
  }
}

async function enrichRemoteSearchResults(
  config: RemoteSessionConfig,
  results: SearchResult[],
): Promise<SearchResult[]> {
  const uniqueIds = Array.from(
    new Set(results.map((result) => result.sessionId).filter(Boolean)),
  );
  if (uniqueIds.length === 0) return results;

  const summaries = new Map<string, SessionSummary>();
  const CONCURRENCY = 5;
  for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
    const chunk = uniqueIds.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map((id) => remoteGetSessionSummary(config, id)),
    );
    for (const summary of fetched) {
      if (summary?.id) summaries.set(summary.id, summary);
    }
  }

  return results.map((result) => {
    const summary = summaries.get(result.sessionId);
    if (!summary) return result;
    return {
      ...result,
      title: result.title ?? summary.title,
      startedAt: result.startedAt || summary.startedAt,
      source: result.source || summary.source,
      messageCount: summary.messageCount || result.messageCount,
      model: result.model || summary.model,
    };
  });
}

function toNumericMessageId(value: unknown, index: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return index + 1;
}

function normalizeRemoteRole(row: RemoteRecord): string {
  const raw = String(
    row.role ?? row.kind ?? row.type ?? row.author_role ?? row.sender ?? "",
  )
    .trim()
    .toLowerCase();
  if (
    [
      "user",
      "human",
      "client",
      "input",
      "prompt",
      "question",
    ].includes(raw)
  ) {
    return "user";
  }
  if (
    [
      "assistant",
      "agent",
      "ai",
      "model",
      "bot",
      "output",
      "completion",
      "response",
    ].includes(raw)
  ) {
    return "assistant";
  }
  if (["tool", "function", "tool_result"].includes(raw)) return "tool";
  return raw;
}

function remoteMessageContent(row: RemoteRecord, role: string): string | null {
  if (role === "user") {
    return firstStringField(row, [
      "content",
      "text",
      "prompt",
      "input",
      "query",
      "question",
      "user",
      "user_message",
      "message",
    ]);
  }
  if (role === "assistant") {
    return firstStringField(row, [
      "content",
      "text",
      "response",
      "answer",
      "assistant",
      "assistant_message",
      "output",
      "completion",
      "rendered",
      "message",
    ]);
  }
  return firstStringField(row, ["content", "text", "result", "output"]);
}

function splitPromptResponseRow(
  row: RemoteRecord,
  index: number,
): RawMessageRow[] | null {
  const prompt = firstStringField(row, [
    "prompt",
    "input",
    "query",
    "question",
    "user",
    "user_message",
  ]);
  const response = firstStringField(row, [
    "response",
    "answer",
    "assistant",
    "assistant_message",
    "output",
    "completion",
  ]);
  if (!prompt || !response) return null;

  const baseId = toNumericMessageId(row.id ?? row.message_id, index) * 10;
  const timestamp = numberValue(row.timestamp, index);
  return [
    {
      id: baseId,
      role: "user",
      content: prompt,
      timestamp,
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      reasoning: null,
      reasoning_content: null,
      reasoning_details: null,
    },
    {
      id: baseId + 1,
      role: "assistant",
      content: response,
      timestamp: timestamp + 0.000001,
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      reasoning: null,
      reasoning_content: null,
      reasoning_details: null,
    },
  ];
}

function normalizeMessageRows(
  row: RemoteRecord,
  index: number,
): RawMessageRow[] {
  if (!row.role && !row.kind && !row.type) {
    const split = splitPromptResponseRow(row, index);
    if (split) return split;
  }

  const role = normalizeRemoteRole(row);
  let content = remoteMessageContent(row, role);
  let reasoning = nullableString(row.reasoning);
  const reasoningContent = nullableString(row.reasoning_content);
  let reasoningDetails =
    typeof row.reasoning_details === "string"
      ? row.reasoning_details
      : row.reasoning_details === undefined || row.reasoning_details === null
        ? null
        : JSON.stringify(row.reasoning_details);

  if (role === "assistant" && !content && reasoning && !reasoningContent) {
    content = reasoning;
    reasoning = null;
    reasoningDetails = null;
  }

  return [
    {
    id: toNumericMessageId(row.id ?? row.message_id, index),
    role,
    content,
    timestamp: numberValue(row.timestamp ?? row.created_at, index),
    tool_call_id: nullableString(row.tool_call_id),
    tool_calls: typeof row.tool_calls === "string" ? row.tool_calls : null,
    tool_name: nullableString(row.tool_name),
    reasoning,
    reasoning_content: reasoningContent,
    reasoning_details: reasoningDetails,
    },
  ];
}

export async function remoteGetSessionMessages(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<HistoryItem[]> {
  let response: unknown;
  try {
    response = await remoteRequestJson(
      config,
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    );
  } catch {
    try {
      const resumed = await remoteDashboardRpc<RemoteRecord>(
        config,
        "session.resume",
        {
          session_id: sessionId,
          cols: 96,
          ...(config.profile ? { profile: config.profile } : {}),
        },
        30_000,
      );
      response = resumed;
      const runtimeSessionId = nullableString(resumed.session_id);
      if (runtimeSessionId) {
        void remoteDashboardRpc(
          config,
          "session.close",
          { session_id: runtimeSessionId },
          5_000,
        ).catch(() => undefined);
      }
    } catch {
      const cached = readRemoteSessionCache(config).histories[sessionId];
      if (cached?.length) {
        return mergeRemoteHistoryWithLocalContinuation(sessionId, cached);
      }
      return localContinuationItems(sessionId);
    }
  }
  const rows = asArray(asRecord(response).messages).flatMap(
    normalizeMessageRows,
  );
  const canonical = await hydrateRemotePromptImageAttachments(
    config,
    expandRowsToHistory(rows),
  );
  const items = mergeRemoteHistoryWithLocalContinuation(sessionId, canonical);
  const cache = readRemoteSessionCache(config);
  writeRemoteSessionCache(config, {
    histories: { ...cache.histories, [sessionId]: items },
  });
  return items;
}

async function hydrateRemotePromptImageAttachments(
  config: RemoteSessionConfig,
  items: HistoryItem[],
): Promise<HistoryItem[]> {
  const hydrated: HistoryItem[] = [];
  const cache = new Map<string, Promise<string | null>>();

  for (const item of items) {
    if (item.kind !== "user") {
      hydrated.push(item);
      continue;
    }

    const fallback = extractLeadingVisionImageFallback(item.content);
    if (!fallback.imagePath) {
      hydrated.push(item);
      continue;
    }

    const nextContent = stripTrailingImagePlaceholders(fallback.content);
    if (item.attachments?.length) {
      hydrated.push({ ...item, content: nextContent });
      continue;
    }

    const dataUrlPromise =
      cache.get(fallback.imagePath) ??
      remoteReadMediaAsDataUrl(config, fallback.imagePath);
    cache.set(fallback.imagePath, dataUrlPromise);
    const attachment = attachmentFromRemoteDataUrl(
      await dataUrlPromise,
      fallback.imagePath,
      `remote-fallback-att-${item.id}-0`,
    );

    hydrated.push({
      ...item,
      content: nextContent,
      ...(attachment ? { attachments: [attachment] } : {}),
    });
  }

  return hydrated;
}

export async function remoteReadMediaAsDataUrl(
  config: RemoteSessionConfig,
  filePath: string,
): Promise<string | null> {
  if (!filePath.trim()) return null;
  try {
    const response = await remoteRequestJson<unknown>(
      config,
      `/api/media?path=${encodeURIComponent(filePath)}`,
      { timeoutMs: 30_000 },
    );
    return dataUrlValue(asRecord(response).data_url);
  } catch {
    return null;
  }
}

export async function remoteUpdateSessionTitle(
  config: RemoteSessionConfig,
  sessionId: string,
  title: string,
): Promise<void> {
  await remoteRequestJson(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      body: { title },
    },
  );
}

export async function remoteDeleteSession(
  config: RemoteSessionConfig,
  sessionId: string,
): Promise<void> {
  await remoteRequestJson(
    config,
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
    },
  );
}

export interface RemoteDeleteSessionsResult {
  requested: number;
  deleted: number;
}

export async function remoteDeleteSessions(
  config: RemoteSessionConfig,
  sessionIds: string[],
): Promise<RemoteDeleteSessionsResult> {
  let deleted = 0;
  for (const id of sessionIds) {
    await remoteDeleteSession(config, id);
    deleted += 1;
  }
  return { requested: sessionIds.length, deleted };
}
