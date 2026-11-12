/** One exposes requested effort; the native SDK clamps it to model capabilities. */
export const ONE_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "max",
] as const;
export type OneThinkingLevel = (typeof ONE_THINKING_LEVELS)[number];
export const DEFAULT_ONE_THINKING_LEVEL: OneThinkingLevel = "medium";
export function isOneThinkingLevel(value: unknown): value is OneThinkingLevel {
  return (
    typeof value === "string" &&
    ONE_THINKING_LEVELS.some((level) => level === value)
  );
}
