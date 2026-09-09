import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  WebAgentConversationRef,
  WebAgentProvider,
} from "../../shared/web-agent";
import {
  WEB_AGENT_PROVIDERS,
  isAllowedWebAgentUrl,
  normalizeWebAgentProfileId,
} from "../../shared/web-agent";
import { getActiveProfileNameSync, profileHome, safeWriteFile } from "../utils";

interface WebAgentConversationMapping {
  runtimeId: string;
  profileId?: string;
  localSessionId: string;
  provider: WebAgentProvider;
  ref: WebAgentConversationRef;
  lastVerifiedAt: number;
}

interface WebAgentConversationData {
  mappings: WebAgentConversationMapping[];
}

const MAX_MAPPINGS = 500;

function filePath(profile?: string): string {
  return join(
    profileHome(profile || getActiveProfileNameSync()),
    "desktop",
    "web-agent-conversations.json",
  );
}

function safeText(value: unknown, max = 512): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned && cleaned.length <= max ? cleaned : undefined;
}

/**
 * `/chat` is Doubao's generic landing/new-chat route, not a conversation
 * identity. Persisting it makes every failed first turn look like the same
 * remote conversation and blocks the next local conversation. Only a route
 * with a concrete segment (for example `/chat/123456`) is stable enough to
 * resume later; opaque provider ids remain valid when supplied separately.
 */
function isStableConversationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return /^\/chat\/[^/?#]+$/i.test(path) || /^\/c\/[^/?#]+$/i.test(path);
  } catch {
    return false;
  }
}

function isGenericConversationRef(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (isAllowedWebAgentUrl("doubao", parsed.toString()) ||
        isAllowedWebAgentUrl("chatgpt", parsed.toString()) ||
        isAllowedWebAgentUrl("grok", parsed.toString())) &&
      (/^\/chat\/?$/i.test(parsed.pathname) || /^\/$/.test(parsed.pathname))
    );
  } catch {
    return false;
  }
}

function normalizeMapping(value: unknown): WebAgentConversationMapping | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<WebAgentConversationMapping>;
  if (!WEB_AGENT_PROVIDERS.includes(input.provider as WebAgentProvider)) {
    return null;
  }
  const provider = input.provider as WebAgentProvider;
  const runtimeId = safeText(input.runtimeId, 64);
  const profileId = normalizeWebAgentProfileId(input.profileId || "default");
  const localSessionId = safeText(input.localSessionId, 256);
  if (
    !runtimeId ||
    !localSessionId ||
    !input.ref ||
    typeof input.ref !== "object"
  ) {
    return null;
  }
  const rawRef = input.ref as WebAgentConversationRef;
  const url = rawRef.url?.trim();
  if (
    url &&
    (!isAllowedWebAgentUrl(provider, url) || !isStableConversationUrl(url))
  ) {
    return null;
  }
  const rawOpaqueId = safeText(rawRef.opaqueId, 512);
  const opaqueId =
    rawOpaqueId && !isGenericConversationRef(rawOpaqueId)
      ? rawOpaqueId
      : undefined;
  if (!url && !opaqueId) return null;
  return {
    runtimeId,
    profileId,
    localSessionId,
    provider,
    ref: {
      ...(url ? { url } : {}),
      ...(opaqueId ? { opaqueId } : {}),
    },
    lastVerifiedAt:
      typeof input.lastVerifiedAt === "number" &&
      Number.isFinite(input.lastVerifiedAt)
        ? input.lastVerifiedAt
        : 0,
  };
}

function readStore(profile?: string): WebAgentConversationData {
  try {
    const parsed = JSON.parse(readFileSync(filePath(profile), "utf8")) as {
      mappings?: unknown;
    };
    return {
      mappings: Array.isArray(parsed.mappings)
        ? parsed.mappings
            .map(normalizeMapping)
            .filter((item): item is WebAgentConversationMapping =>
              Boolean(item),
            )
            .slice(-MAX_MAPPINGS)
        : [],
    };
  } catch {
    return { mappings: [] };
  }
}

function writeStore(
  profile: string | undefined,
  data: WebAgentConversationData,
): void {
  safeWriteFile(filePath(profile), JSON.stringify(data));
}

export function getWebAgentConversation(
  profile: string | undefined,
  runtimeId: string,
  localSessionId: string,
  webProfileId?: string,
): WebAgentConversationMapping | null {
  const normalizedProfileId = normalizeWebAgentProfileId(webProfileId);
  return (
    readStore(profile).mappings.find(
      (item) =>
        item.runtimeId === runtimeId &&
        item.localSessionId === localSessionId &&
        item.profileId === normalizedProfileId,
    ) || null
  );
}

export function saveWebAgentConversation(
  profile: string | undefined,
  mapping: WebAgentConversationMapping,
): void {
  const normalized = normalizeMapping(mapping);
  if (!normalized)
    throw new Error("Web Agent conversation mapping is invalid.");
  const current = readStore(profile).mappings.filter(
    (item) =>
      !(
        item.runtimeId === normalized.runtimeId &&
        item.profileId === normalized.profileId &&
        item.localSessionId === normalized.localSessionId
      ),
  );
  const duplicateRemote = current.find(
    (item) =>
      item.runtimeId === normalized.runtimeId &&
      item.provider === normalized.provider &&
      item.profileId === normalized.profileId &&
      item.localSessionId !== normalized.localSessionId &&
      ((item.ref.url &&
        normalized.ref.url &&
        item.ref.url === normalized.ref.url) ||
        (item.ref.opaqueId &&
          normalized.ref.opaqueId &&
          item.ref.opaqueId === normalized.ref.opaqueId)),
  );
  if (duplicateRemote) {
    throw new Error(
      "Web Agent conversation mapping would bind one remote conversation to multiple local conversations.",
    );
  }
  current.push({ ...normalized, lastVerifiedAt: Date.now() });
  writeStore(profile, { mappings: current.slice(-MAX_MAPPINGS) });
}

export function removeWebAgentConversationsForRuntime(
  profile: string | undefined,
  runtimeId: string,
): void {
  const current = readStore(profile);
  const next = current.mappings.filter((item) => item.runtimeId !== runtimeId);
  if (next.length !== current.mappings.length)
    writeStore(profile, { mappings: next });
}

export function hasWebAgentConversationStore(profile?: string): boolean {
  return existsSync(filePath(profile));
}
