import {
  DEFAULT_ONE_THINKING_LEVEL,
  isOneThinkingLevel,
  type OneThinkingLevel,
} from "../../../../shared/one-thinking";
function preferenceKey(profile: string, runtimeId: string): string {
  return "agents-one:thinking:" + JSON.stringify([profile, runtimeId]);
}
/** Remember a desktop UI preference without rewriting Runtime/API defaults. */
export function readOneThinkingPreference(
  profile: string,
  runtimeId: string,
): OneThinkingLevel {
  try {
    const value = localStorage.getItem(preferenceKey(profile, runtimeId));
    return isOneThinkingLevel(value) ? value : DEFAULT_ONE_THINKING_LEVEL;
  } catch {
    return DEFAULT_ONE_THINKING_LEVEL;
  }
}
export function saveOneThinkingPreference(
  profile: string,
  runtimeId: string,
  level: string,
): void {
  if (!isOneThinkingLevel(level)) return;
  try {
    localStorage.setItem(preferenceKey(profile, runtimeId), level);
  } catch {
    /* The current session still works when storage is unavailable. */
  }
}
