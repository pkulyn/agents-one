/** Model wire protocols that One explicitly exposes and validates. */
export const ONE_MODEL_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

export type OneModelApiType = (typeof ONE_MODEL_API_TYPES)[number];

export type OneModelInputFormat = {
  text: boolean;
  image: boolean;
  video: boolean;
  pdf: boolean;
  audio: boolean;
};

export interface OneModelMetadata {
  contextWindow: number;
  maxOutputTokens?: number;
  input: OneModelInputFormat;
  supportsToolCall: boolean;
  supportsStructuredOutput: boolean;
  source: "catalog" | "manual";
}

/** Stable identity for a model list; credentials and query strings are excluded. */
export function oneModelProviderKey(
  endpoint: string | undefined,
  apiType: OneModelApiType | undefined,
): string {
  const normalized = (endpoint || "").trim().replace(/\/+$/, "").toLowerCase();
  return `${apiType || "openai-completions"}::${normalized}`;
}

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

export function normalizeOneModelLists(
  value: unknown,
): Record<string, string[]> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("One provider model lists are invalid.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 32)
    throw new Error("One provider model lists are invalid.");
  const result: Record<string, string[]> = {};
  for (const [provider, models] of entries) {
    if (!provider.trim() || provider.length > 2300)
      throw new Error("One provider model lists are invalid.");
    result[provider] = normalizeOneModelChoices(models) || [];
  }
  return result;
}

export function normalizeOneModelMetadata(
  value: unknown,
): Record<string, OneModelMetadata> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("One model metadata is invalid.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) throw new Error("One model metadata is invalid.");
  const result: Record<string, OneModelMetadata> = {};
  for (const [key, raw] of entries) {
    if (!key.trim() || key.length > 256 || !raw || typeof raw !== "object")
      throw new Error("One model metadata is invalid.");
    const item = raw as Record<string, unknown>;
    const input = item.input as Record<string, unknown> | undefined;
    const contextWindow = item.contextWindow;
    const maxOutputTokens = item.maxOutputTokens;
    if (
      !Number.isSafeInteger(contextWindow) ||
      (contextWindow as number) < 4096 ||
      (contextWindow as number) > 2_000_000 ||
      (maxOutputTokens !== undefined &&
        (!Number.isSafeInteger(maxOutputTokens) ||
          (maxOutputTokens as number) < 1 ||
          (maxOutputTokens as number) > 1_000_000)) ||
      !input ||
      ["text", "image", "video", "pdf", "audio"].some(
        (field) => typeof input[field] !== "boolean",
      ) ||
      typeof item.supportsToolCall !== "boolean" ||
      typeof item.supportsStructuredOutput !== "boolean" ||
      (item.source !== "catalog" && item.source !== "manual")
    )
      throw new Error("One model metadata is invalid.");
    result[key] = {
      contextWindow: contextWindow as number,
      ...(maxOutputTokens !== undefined
        ? { maxOutputTokens: maxOutputTokens as number }
        : {}),
      input: {
        text: input.text as boolean,
        image: input.image as boolean,
        video: input.video as boolean,
        pdf: input.pdf as boolean,
        audio: input.audio as boolean,
      },
      supportsToolCall: item.supportsToolCall,
      supportsStructuredOutput: item.supportsStructuredOutput,
      source: item.source,
    };
  }
  return result;
}
