/**
 * Reads a branded localStorage key without discarding preferences written by
 * Hermes Desktop/Hermes One. The legacy value is copied once and deliberately
 * left in place so rolling back to an older build remains safe.
 */
export function readMigratedStorageValue(
  key: string,
  legacyKey: string,
): string | null {
  try {
    const current = localStorage.getItem(key);
    if (current !== null) return current;

    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

export const AGENTS_ONE_EVENTS = {
  runtimeChanged: "agents-one:agent-runtime-changed",
  sessionContextFolderChanged: "agents-one:session-context-folder-changed",
  sessionTranscriptChanged: "agents-one:session-transcript-changed",
} as const;

export const LEGACY_HERMES_EVENTS = {
  runtimeChanged: "hermes-agent-runtime-changed",
  sessionContextFolderChanged: "hermes-session-context-folder-changed",
  sessionTranscriptChanged: "hermes-session-transcript-changed",
} as const;

export type AgentsOneEventKey = keyof typeof AGENTS_ONE_EVENTS;

/** Listen to the new event and its legacy alias during the migration window. */
export function addMigratedEventListener(
  key: AgentsOneEventKey,
  listener: EventListener,
): () => void {
  window.addEventListener(AGENTS_ONE_EVENTS[key], listener);
  window.addEventListener(LEGACY_HERMES_EVENTS[key], listener);
  return () => {
    window.removeEventListener(AGENTS_ONE_EVENTS[key], listener);
    window.removeEventListener(LEGACY_HERMES_EVENTS[key], listener);
  };
}

/** New builds emit only the Agents One event; listeners still accept old ones. */
export function dispatchAgentsOneEvent(
  key: AgentsOneEventKey,
  detail?: unknown,
): void {
  window.dispatchEvent(
    detail === undefined
      ? new Event(AGENTS_ONE_EVENTS[key])
      : new CustomEvent(AGENTS_ONE_EVENTS[key], { detail }),
  );
}
