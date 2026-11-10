import type { OneModelMetadata } from "../../../../shared/one-model-api";

/**
 * A short provider-scoped starter catalog. Capability defaults follow the
 * provider/model registry pattern used by ZCode's public model catalog; the
 * metadata remains editable because gateways and aliases can differ.
 */
export const ONE_PROVIDER_MODEL_SUGGESTIONS: Readonly<
  Record<string, string[]>
> = {
  "ark-agent-plan": [
    "doubao-seed-2.0-mini",
    "doubao-seed-2.1-pro",
    "doubao-seed-2.1-lite",
  ],
  openai: [
    "gpt-6-astra",
    "gpt-6.1-sol",
    "gpt-6-luna",
    "gpt-5.6",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
  ],
  deepseek: ["deepseek-v4.1-flash", "deepseek-v4-pro", "deepseek-flash"],
  anthropic: [
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "claude-haiku-4-5-20251001",
  ],
  custom: [],
};

function defaults(contextWindow: number): OneModelMetadata {
  return {
    contextWindow,
    input: { text: true, image: false, video: false, pdf: false, audio: false },
    supportsToolCall: true,
    supportsStructuredOutput: false,
    source: "manual",
  };
}

/** Fill known model capabilities before saving; unknown IDs stay conservative. */
export function inferOneModelMetadata(modelId: string): OneModelMetadata {
  const id = modelId.trim().toLowerCase();
  const metadata = defaults(32_768);
  let recognized = false;

  if (/^doubao-seed-2[.-]0[.-]mini(?:-[a-z0-9]+)?$/.test(id)) {
    recognized = true;
    metadata.contextWindow = 262_144;
    metadata.input.image = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/doubao-seed-2[.-]1-(pro|lite)(?:-[0-9]+)?/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_024_000;
    metadata.input.image = true;
    metadata.input.video = true;
    metadata.maxOutputTokens = 65_536;
  } else if (
    /kimi-k3\.1-pro(?:-highspeed)?/.test(id) ||
    /^k3\.1-pro(?:-highspeed)?$/.test(id)
  ) {
    recognized = true;
    metadata.contextWindow = 1_048_576;
    metadata.input.image = true;
    metadata.input.video = true;
    metadata.maxOutputTokens = 131_072;
  } else if (
    /deepseek-(?:v4(?:[.-]1-flash|\.1-flash)|flash)(?:$|[-.])/.test(id)
  ) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.input.image = true;
    metadata.maxOutputTokens = 384_000;
  } else if (id.includes("deepseek-v4-pro")) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.maxOutputTokens = 128_000;
  } else if (/glm-5\.3-flashx/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.input.image = true;
    metadata.input.video = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/glm-5v-turbo/.test(id)) {
    recognized = true;
    metadata.contextWindow = 200_000;
    metadata.input.image = true;
    metadata.input.video = true;
    metadata.maxOutputTokens = 131_072;
  } else if (/glm-5\.3-flash/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.input.image = true;
    metadata.input.video = true;
    metadata.input.pdf = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/glm-5\.3(?:$|[-.])/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.maxOutputTokens = 128_000;
  } else if (/glm-5\.2/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.maxOutputTokens = 128_000;
  } else if (/glm-5\.1/.test(id)) {
    recognized = true;
    metadata.contextWindow = 200_000;
    metadata.maxOutputTokens = 64_000;
  } else if (/gpt-6(?:\.[0-9]+)?-(?:astra|sol|luna)(?:$|[-.])/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_050_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/gpt-5\.6(?:-(?:sol|terra|luna))?(?:$|[-.])/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_050_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/gpt-5\.3-codex(?:$|[-.])/.test(id)) {
    recognized = true;
    metadata.contextWindow = 400_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/gpt-5\.4(?:$|-pro(?:$|[-.]))/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_050_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/gpt-5\.4-(?:mini|nano)(?:$|[-.])/.test(id)) {
    recognized = true;
    metadata.contextWindow = 400_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/claude-(?:fable|sonnet|opus)-5(?:[.-][0-9]+)?/.test(id)) {
    recognized = true;
    metadata.contextWindow = 1_000_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.supportsStructuredOutput = true;
    metadata.maxOutputTokens = 128_000;
  } else if (/claude-(?:haiku|sonnet|opus)-4[.-]5/.test(id)) {
    recognized = true;
    metadata.contextWindow = 200_000;
    metadata.input.image = true;
    metadata.input.pdf = true;
    metadata.maxOutputTokens = 64_000;
  }

  metadata.source = recognized ? "catalog" : "manual";
  return metadata;
}
