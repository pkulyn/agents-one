/** Model wire protocols that One explicitly exposes and validates. */
export const ONE_MODEL_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type OneModelApiType = (typeof ONE_MODEL_API_TYPES)[number];

export function isOneModelApiType(value: unknown): value is OneModelApiType {
  return (
    typeof value === "string" &&
    (ONE_MODEL_API_TYPES as readonly string[]).includes(value)
  );
}
