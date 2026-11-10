import type { OneModelApiType } from "../../../../shared/one-model-api";

export type OneModelProviderPreset = {
  id: string;
  label: string;
  endpoint: string;
  model: string;
  apiType: OneModelApiType;
  contextWindow?: number;
  imageInput?: boolean;
};

/** Curated quick-fill values; a real One tool probe is still required. */
export const ONE_MODEL_PROVIDER_PRESETS: readonly OneModelProviderPreset[] = [
  {
    id: "ark-agent-plan",
    label: "火山方舟 Agent Plan",
    endpoint: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seed-2.0-mini",
    apiType: "openai-completions",
    contextWindow: 262144,
    imageInput: true,
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiType: "openai-completions",
  },
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiType: "openai-completions",
    imageInput: true,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    endpoint: "https://api.anthropic.com",
    model: "claude-sonnet-5-5",
    apiType: "anthropic-messages",
    imageInput: true,
  },
  {
    id: "bigmodel",
    label: "智谱 BigModel API",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5-turbo",
    apiType: "openai-completions",
  },
  {
    id: "zai",
    label: "Z.ai API",
    endpoint: "https://api.z.ai/api/paas/v4",
    model: "glm-5.3",
    apiType: "openai-completions",
  },
  {
    id: "kimi",
    label: "Kimi API",
    endpoint: "https://api.moonshot.cn/v1",
    model: "kimi-k3.1-pro",
    apiType: "openai-completions",
  },
  {
    id: "minimax",
    label: "MiniMax API",
    endpoint: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
    apiType: "openai-completions",
  },
  {
    id: "bailian",
    label: "阿里云百炼 API",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-max",
    apiType: "openai-completions",
  },
];

export function getOneModelProviderPresetId(
  endpoint: string | undefined,
  apiType: OneModelApiType | undefined,
): string {
  const effectiveApiType = apiType || "openai-completions";
  return (
    ONE_MODEL_PROVIDER_PRESETS.find(
      (preset) =>
        preset.endpoint === endpoint && preset.apiType === effectiveApiType,
    )?.id || "custom"
  );
}

/** User-facing provider name for the active One model connection. */
export function oneProviderDisplayLabel(
  endpoint: string | undefined,
  apiType: OneModelApiType | undefined,
  t: (key: string) => string,
): string {
  const presetId = getOneModelProviderPresetId(endpoint, apiType);
  if (presetId === "ark-agent-plan") return t("agents.configProviderArk");
  if (presetId === "deepseek") return t("agents.configProviderDeepSeek");
  if (presetId === "openai") return t("agents.configProviderOpenAI");
  if (presetId === "anthropic") return t("agents.configProviderAnthropic");
  const preset = ONE_MODEL_PROVIDER_PRESETS.find(
    (item) => item.id === presetId,
  );
  if (preset) return preset.label;
  if (!endpoint?.trim()) return t("agents.configProviderCustom");
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

/** Prefer a user-renamed provider; fall back to the preset/host label. */
export function oneActiveProviderLabel(
  config: {
    endpoint?: string;
    oneApiType?: OneModelApiType;
    oneProviders?: readonly {
      id: string;
      name: string;
      endpoint: string;
      apiType: OneModelApiType;
    }[];
    oneActiveProviderId?: string;
  },
  t: (key: string) => string,
): string {
  const provider = config.oneProviders?.find(
    (item) => item.id === config.oneActiveProviderId,
  );
  if (provider?.name?.trim()) return provider.name.trim();
  return oneProviderDisplayLabel(config.endpoint, config.oneApiType, t);
}
