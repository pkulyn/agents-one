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
