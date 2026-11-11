import type { AgentRuntimeDefinition } from "../../shared/agent-runtimes";
import type { RuntimeModelOption } from "../../shared/runtime-commands";
import { oneModelProviderKey } from "../../shared/one-model-api";

/** Explicit SDK request levels; off preserves existing non-reasoning requests. */
export const ONE_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
] as const;
export function oneConversationModels(
  runtime: AgentRuntimeDefinition,
): RuntimeModelOption[] {
  const providers = runtime.config.oneProviders;
  if (providers?.length)
    return providers
      .filter((p) => p.enabled)
      .flatMap((p) => {
        const models =
          runtime.config.oneModelsByProvider?.[
            oneModelProviderKey(p.endpoint, p.apiType)
          ] ?? p.models;
        return models.map((model) => ({
          id: "one-provider:" + p.id + ":" + encodeURIComponent(model),
          displayName: model,
          provider: p.name,
          reasoningEfforts: [...ONE_THINKING_LEVELS],
          imageInput:
            runtime.config.oneModelMetadata?.[
              oneModelProviderKey(p.endpoint, p.apiType) + "::" + model
            ]?.input.image,
          isDefault:
            p.id === runtime.config.oneActiveProviderId &&
            model === runtime.config.model,
        }));
      });
  return Array.from(
    new Set([
      ...(runtime.config.oneModels || []),
      ...(runtime.config.model ? [runtime.config.model] : []),
    ]),
  ).map((model) => ({
    id: model,
    displayName: model,
    reasoningEfforts: [...ONE_THINKING_LEVELS],
    isDefault: model === runtime.config.model,
    imageInput:
      runtime.config.oneModelMetadata?.[
        oneModelProviderKey(
          runtime.config.endpoint,
          runtime.config.oneApiType,
        ) +
          "::" +
          model
      ]?.input.image,
  }));
}

/** Project a validated conversation choice in memory; never write the Runtime defaults. */
export function oneRuntimeForModel(
  runtime: AgentRuntimeDefinition,
  selection?: string,
): AgentRuntimeDefinition {
  if (!selection?.startsWith("one-provider:")) return runtime;
  const option = oneConversationModels(runtime).find((m) => m.id === selection);
  if (!option) throw new Error("One 模型已停用或不在当前配置中，请重新选择。");
  const provider = runtime.config.oneProviders!.find((p) =>
    selection.startsWith("one-provider:" + p.id + ":"),
  )!;
  if (!provider) throw new Error("One 模型供应商不可用。");
  return {
    ...runtime,
    config: {
      ...runtime.config,
      endpoint: provider.endpoint,
      oneApiType: provider.apiType,
      oneActiveProviderId: provider.id,
      model: option.displayName,
    },
  };
}
