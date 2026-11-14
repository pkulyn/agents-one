import { readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  agentsOneProfileHome,
  getActiveProfileNameSync,
  safeWriteFile,
} from "./utils";
import { desktopSecretStore } from "./desktop-secret-store";
import { assertAgentsOneWritesAllowed } from "./restore-write-lock";

const ENABLED = "AGENTS_ONE_VOICE_ENABLED";
const URL_KEY = "AGENTS_ONE_VOICE_API_URL";

function location(profile?: string): { file: string; secret: string } {
  const home = agentsOneProfileHome(profile || getActiveProfileNameSync());
  return {
    file: join(home, "desktop", "voice-input.json"),
    secret: `portable-voice-${createHash("sha256").update(home).digest("hex")}`,
  };
}

function read(profile?: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(
      readFileSync(location(profile).file, "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid portable voice settings.");
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(
      "Portable voice settings are unreadable; original data was preserved.",
    );
  }
}

/** Explicit blanks prevent callers from falling back to host environment values. */
export function readPortableVoiceEnvironment(
  profile?: string,
): Record<string, string> {
  const value = read(profile);
  return {
    [ENABLED]: value.enabled === true ? "1" : "0",
    [URL_KEY]: typeof value.url === "string" ? value.url : "",
  };
}

export function portableVoiceApiKey(profile?: string): string {
  return (
    desktopSecretStore()?.get(location(profile).secret, {
      read: () => null,
      remove: () => {},
    }) || ""
  );
}

/** Portable settings never read, migrate or modify a Hermes environment file. */
export function savePortableVoiceSettings(
  input: {
    enabled: boolean;
    url: string;
    replacementKey?: string;
    clearApiKey?: boolean;
  },
  profile?: string,
): void {
  assertAgentsOneWritesAllowed();
  const previous = read(profile);
  const target = location(profile);
  if (input.clearApiKey || input.replacementKey !== undefined) {
    const store = desktopSecretStore();
    if (!store?.protector.available)
      throw new Error(
        "Secure credential storage is unavailable; voice settings were not changed.",
      );
    store.set(target.secret, input.clearApiKey ? "" : input.replacementKey!, {
      read: () => null,
      remove: () => {},
    });
  }
  safeWriteFile(
    target.file,
    JSON.stringify({ ...previous, enabled: input.enabled, url: input.url }),
  );
}
