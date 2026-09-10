import type { AppLocale } from "../../../../shared/i18n";
import { readMigratedStorageValue } from "../../utils/brandMigration";

export type RemoteChatTransport = "auto" | "dashboard" | "legacy";
export const CHAT_TRANSPORT_OPTIONS: RemoteChatTransport[] = [
  "auto",
  "dashboard",
  "legacy",
];

export type TransportProbe = {
  detail: string;
  kind: "muted" | "ok" | "warn";
  label: string;
  loading: boolean;
};

export const LANGUAGE_NATIVE_NAMES: Record<AppLocale, string> = {
  en: "English",
  "zh-CN": "简体中文",
};

// Build a mask string the same width as the stored API key so the
// "saved" state of the input looks like a key, not a constant blob.
// Length is exposed by the main process via PublicConnectionConfig.
// 0 falls back to 8 dots so the user gets a visible "set" indicator
// even if main didn't report a length yet. Capped to keep absurdly
// long keys from blowing up the field.
export function makeApiKeyMask(length: number): string {
  const n = Math.min(Math.max(length, 8), 128);
  return "*".repeat(n);
}

export type PublicConnectionSnapshot = {
  mode: "local";
};

export function versionCacheKey(
  conn: PublicConnectionSnapshot,
  profile?: string,
): string {
  const profileKey = profile || "default";
  void conn;
  return `local:${profileKey}`;
}

function versionCacheStorageKey(cacheKey: string): string {
  return `agents-one.version-cache.v1:${cacheKey}`;
}

function legacyVersionCacheStorageKey(cacheKey: string): string {
  return `hermes-version-cache:${cacheKey}`;
}

export function getCachedVersion(cacheKey: string): string | null {
  try {
    return readMigratedStorageValue(
      versionCacheStorageKey(cacheKey),
      legacyVersionCacheStorageKey(cacheKey),
    );
  } catch {
    return null;
  }
}

export function setCachedVersion(cacheKey: string, version: string): void {
  try {
    localStorage.setItem(versionCacheStorageKey(cacheKey), version);
  } catch {
    /* ignore */
  }
}
