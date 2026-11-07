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

/** Normalize the non-secret model IDs users have configured as One choices. */
export function normalizeOneModelChoices(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error("One model choices are invalid.");
  }
  const choices: string[] = [];
  for (const item of value) {
    if (
      typeof item !== "string" ||
      item.trim().length === 0 ||
      item.length > 256 ||
      /[\0\r\n]/.test(item)
    ) {
      throw new Error("One model choices are invalid.");
    }
    const id = item.trim();
    if (!choices.includes(id)) choices.push(id);
  }
  return choices;
}
