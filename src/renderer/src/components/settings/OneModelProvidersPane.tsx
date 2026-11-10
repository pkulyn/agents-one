import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type {
  AgentRuntimeConfig,
  AgentRuntimeDefinition,
  OneProviderConfig,
} from "../../../../shared/agent-runtimes";
import {
  oneModelProviderKey,
  type OneModelApiType,
  type OneModelInputFormat,
  type OneModelMetadata,
} from "../../../../shared/one-model-api";
import {
  ONE_MODEL_PROVIDER_PRESETS,
  getOneModelProviderPresetId,
} from "./one-model-provider-presets";
import {
  ONE_PROVIDER_MODEL_SUGGESTIONS,
  inferOneModelMetadata,
} from "./one-model-catalog";
import { useI18n } from "../useI18n";

const API_TYPES: readonly { value: OneModelApiType; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

const DEFAULT_METADATA: OneModelMetadata = {
  contextWindow: 128_000,
  input: { text: true, image: false, video: false, pdf: false, audio: false },
  supportsToolCall: true,
  supportsStructuredOutput: false,
  source: "manual",
};

interface OneModelProvidersPaneProps {
  runtime: AgentRuntimeDefinition;
  onChanged: () => void;
}

interface ModelSheetState {
  providerId: string;
  previousId: string | null;
  modelId: string;
  metadata: OneModelMetadata;
  smart: boolean;
  error: string | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerHash(key: string): string {
  let hash = 2166136261;
  for (const char of key) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function providerLabel(
  endpoint: string,
  apiType: OneModelApiType,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const presetId = getOneModelProviderPresetId(endpoint, apiType);
  if (presetId === "ark-agent-plan") return t("agents.configProviderArk");
  if (presetId === "deepseek") return t("agents.configProviderDeepSeek");
  if (presetId === "openai") return t("agents.configProviderOpenAI");
  if (
    endpoint.trim().replace(/\/$/, "") === "https://api.anthropic.com" &&
    apiType === "anthropic-messages"
  )
    return t("agents.configProviderAnthropic");
  const preset = ONE_MODEL_PROVIDER_PRESETS.find(
    (item) => item.id === presetId,
  );
  if (preset) return preset.label;
  if (!endpoint.trim()) return t("agents.configProviderCustom");
  try {
    return new URL(endpoint).hostname;
  } catch {
    return endpoint;
  }
}

/** Rebuild the provider catalog from legacy single-provider fields once. */
function providersFromConfig(
  config: AgentRuntimeConfig,
  t: (key: string, options?: Record<string, unknown>) => string,
): OneProviderConfig[] {
  if (config.oneProviders?.length)
    return config.oneProviders.map((provider) => ({
      ...provider,
      models: [...provider.models],
    }));
  const keys = new Set<string>();
  if (config.endpoint?.trim())
    keys.add(oneModelProviderKey(config.endpoint, config.oneApiType));
  for (const key of Object.keys(config.oneModelsByProvider || {}))
    keys.add(key);
  const result: OneProviderConfig[] = [];
  Array.from(keys).forEach((key, index) => {
    const separator = key.indexOf("::");
    if (separator < 0) return;
    const apiType = key.slice(0, separator) as OneModelApiType;
    const endpoint = key.slice(separator + 2);
    if (!endpoint) return;
    const models =
      config.oneModelsByProvider?.[key] ??
      (endpoint === config.endpoint ? config.oneModels || [] : []);
    result.push({
      id: `p-${providerHash(key)}-${index}`,
      name: providerLabel(endpoint, apiType, t),
      endpoint,
      apiType,
      enabled: true,
      models: [...models],
    });
  });
  if (!result.length) {
    result.push({
      id: `p-${providerHash("empty")}`,
      name: t("agents.configProviderCustom"),
      endpoint: config.endpoint?.trim() || "",
      apiType: config.oneApiType || "openai-completions",
      enabled: true,
      models: [...(config.oneModels || [])],
    });
  }
  return result;
}

function activeProviderFrom(
  config: AgentRuntimeConfig,
  providers: OneProviderConfig[],
): string {
  if (
    config.oneActiveProviderId &&
    providers.some((provider) => provider.id === config.oneActiveProviderId)
  )
    return config.oneActiveProviderId;
  const byEndpoint = providers.find(
    (provider) =>
      provider.endpoint === config.endpoint &&
      provider.apiType === (config.oneApiType || "openai-completions"),
  );
  return (byEndpoint || providers[0])?.id || "";
}

function enabledModelsFor(
  config: AgentRuntimeConfig,
  provider: OneProviderConfig,
): string[] {
  const key = oneModelProviderKey(provider.endpoint, provider.apiType);
  return config.oneModelsByProvider?.[key] ?? provider.models;
}

function modelBadges(
  metadata: OneModelMetadata,
  t: (key: string) => string,
): string[] {
  const context = metadata.contextWindow;
  const windowLabel =
    context >= 1_000_000
      ? `${Math.round(context / 1_000_000)}M`
      : `${Math.round(context / 1000)}K`;
  return [
    windowLabel,
    metadata.input.image ? t("agents.configModelImage") : "",
    metadata.input.video ? t("agents.configModelVideo") : "",
    metadata.input.pdf ? t("agents.configModelPdf") : "",
  ].filter(Boolean);
}

export default function OneModelProvidersPane({
  runtime,
  onChanged,
}: OneModelProvidersPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentRuntimeConfig>(runtime.config);
  const [providers, setProviders] = useState<OneProviderConfig[]>(() =>
    providersFromConfig(runtime.config, t),
  );
  const [activeId, setActiveId] = useState<string>(() =>
    activeProviderFrom(runtime.config, providersFromConfig(runtime.config, t)),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentialStates, setCredentialStates] = useState<
    Record<string, boolean>
  >({});
  const [credentialWarning, setCredentialWarning] = useState("");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [keyVisible, setKeyVisible] = useState<Record<string, boolean>>({});
  const [providerMenu, setProviderMenu] = useState<string | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<{
    name: string;
    endpoint: string;
    apiType: OneModelApiType;
    presetId: string;
  }>({
    name: "",
    endpoint: "",
    apiType: "openai-completions",
    presetId: "custom",
  });
  const [modelSheet, setModelSheet] = useState<ModelSheetState | null>(null);
  const [statusVersion, setStatusVersion] = useState(0);
  const [probeFeedback, setProbeFeedback] = useState<{
    kind: "ok" | "error";
    message: string;
  } | null>(null);

  const activeProvider =
    providers.find((provider) => provider.id === activeId) || providers[0];
  const activeKey = oneModelProviderKey(
    activeProvider?.endpoint,
    activeProvider?.apiType,
  );
  const activeModels = activeProvider?.models || [];
  const enabledModels = activeProvider
    ? enabledModelsFor(config, activeProvider)
    : [];
  const providerIds = providers.map((provider) => provider.id).join(",");
  const providersRef = useRef(providers);
  providersRef.current = providers;

  useEffect(() => {
    let alive = true;
    const currentProviders = config.oneProviders || [];
    const legacyEndpoint = runtime.config.endpoint?.trim();
    const legacyApiType = runtime.config.oneApiType || "openai-completions";
    void Promise.all(
      providersRef.current.map(async (provider) => {
        try {
          if (currentProviders.some((item) => item.id === provider.id)) {
            const status =
              await window.agentsOneAPI.getOneProviderCredentialStatus(
                runtime.id,
                provider.id,
              );
            return [provider.id, status.configured] as const;
          }
          if (
            provider.endpoint === legacyEndpoint &&
            provider.apiType === legacyApiType
          ) {
            const status =
              await window.agentsOneAPI.getAgentRuntimeCredentialStatus(
                runtime.id,
              );
            return [provider.id, status.configured] as const;
          }
          return [provider.id, false] as const;
        } catch {
          return [provider.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (alive) setCredentialStates(Object.fromEntries(entries));
    });
    return () => {
      alive = false;
    };
  }, [
    runtime.id,
    runtime.config.endpoint,
    runtime.config.oneApiType,
    config.oneProviders,
    providerIds,
    statusVersion,
  ]);

  function updateConfig(patch: Partial<AgentRuntimeConfig>): void {
    setNotice(null);
    setConfig((current) => ({ ...current, ...patch }));
  }

  function updateProvider(id: string, patch: Partial<OneProviderConfig>): void {
    setProviders((current) =>
      current.map((provider) =>
        provider.id === id ? { ...provider, ...patch } : provider,
      ),
    );
  }

  function updateActiveProvider(patch: Partial<OneProviderConfig>): void {
    if (!activeProvider) return;
    setProbeFeedback(null);
    const oldKey = oneModelProviderKey(
      activeProvider.endpoint,
      activeProvider.apiType,
    );
    const endpoint = patch.endpoint ?? activeProvider.endpoint;
    const apiType = patch.apiType ?? activeProvider.apiType;
    const newKey = oneModelProviderKey(endpoint, apiType);
    const models = patch.models ?? activeProvider.models;
    const enabled = enabledModelsFor(config, activeProvider);
    const metadata = { ...(config.oneModelMetadata || {}) };
    if (oldKey !== newKey) {
      for (const model of models) {
        const oldMetadata = metadata[`${oldKey}::${model}`];
        if (oldMetadata && !metadata[`${newKey}::${model}`])
          metadata[`${newKey}::${model}`] = oldMetadata;
        delete metadata[`${oldKey}::${model}`];
      }
    }
    updateProvider(activeId, { ...patch, endpoint, apiType, models });
    setConfig((current) => {
      const nextByProvider = { ...(current.oneModelsByProvider || {}) };
      nextByProvider[newKey] = enabled;
      if (oldKey !== newKey) nextByProvider[oldKey] = [];
      return {
        ...current,
        endpoint,
        oneApiType: apiType,
        oneModels: enabled,
        oneModelsByProvider: nextByProvider,
        oneModelMetadata: metadata,
      };
    });
  }

  function switchProvider(id: string): void {
    const target = providers.find((provider) => provider.id === id);
    if (!target) return;
    setProbeFeedback(null);
    const currentKey = activeProvider
      ? oneModelProviderKey(activeProvider.endpoint, activeProvider.apiType)
      : "";
    const targetKey = oneModelProviderKey(target.endpoint, target.apiType);
    const targetModels = enabledModelsFor(config, target);
    const targetModel =
      config.model && targetModels.includes(config.model)
        ? config.model
        : targetModels[0] || "";
    const metadata = targetModel
      ? config.oneModelMetadata?.[`${targetKey}::${targetModel}`] ||
        inferOneModelMetadata(targetModel)
      : undefined;
    setConfig((current) => {
      const nextByProvider = { ...(current.oneModelsByProvider || {}) };
      if (currentKey) nextByProvider[currentKey] = enabledModels;
      nextByProvider[targetKey] = targetModels;
      return {
        ...current,
        endpoint: target.endpoint,
        oneApiType: target.apiType,
        model: targetModel,
        oneModels: targetModels,
        oneModelsByProvider: nextByProvider,
        oneActiveProviderId: target.id,
        ...(metadata
          ? {
              oneModelMetadata: {
                ...current.oneModelMetadata,
                [`${targetKey}::${targetModel}`]: metadata,
              },
            }
          : {}),
      };
    });
    setActiveId(id);
    setNotice(null);
  }

  function selectProviderChip(id: string): void {
    const target = providers.find((provider) => provider.id === id);
    if (!target || id === activeId) return;
    if (!target.enabled) {
      setProviders((current) =>
        current.map((provider) =>
          provider.id === id ? { ...provider, enabled: true } : provider,
        ),
      );
      setNotice(t("agents.configProviderEnabling", { name: target.name }));
    }
    switchProvider(id);
  }

  function toggleProviderEnabled(id: string, enabled: boolean): void {
    if (!enabled && id === activeId) {
      const other = providers.find(
        (provider) => provider.id !== id && provider.enabled,
      );
      if (!other) {
        setNotice(t("agents.configProviderKeepOne"));
        return;
      }
      switchProvider(other.id);
    }
    updateProvider(id, { enabled });
  }

  function enabledForProvider(provider: OneProviderConfig): string[] {
    return enabledModelsFor(config, provider);
  }

  function setEnabledForProvider(
    provider: OneProviderConfig,
    models: string[],
  ): void {
    const key = oneModelProviderKey(provider.endpoint, provider.apiType);
    setConfig((current) => ({
      ...current,
      oneModelsByProvider: {
        ...(current.oneModelsByProvider || {}),
        [key]: models,
      },
      ...(provider.id === activeId ? { oneModels: models } : {}),
    }));
  }

  function toggleModelEnabled(model: string, enabled: boolean): void {
    if (!activeProvider) return;
    const currentEnabled = enabledModels;
    const nextEnabled = enabled
      ? Array.from(new Set([...currentEnabled, model]))
      : currentEnabled.filter((item) => item !== model);
    setEnabledForProvider(activeProvider, nextEnabled);
    if (!enabled && config.model === model) {
      updateConfig({ model: nextEnabled[0] || "" });
    }
  }

  function openAddModel(): void {
    if (!activeProvider) return;
    setModelSheet({
      providerId: activeProvider.id,
      previousId: null,
      modelId: "",
      metadata: { ...DEFAULT_METADATA, input: { ...DEFAULT_METADATA.input } },
      smart: true,
      error: null,
    });
  }

  function openEditModel(model: string): void {
    if (!activeProvider) return;
    const metadata =
      config.oneModelMetadata?.[`${activeKey}::${model}`] ||
      inferOneModelMetadata(model);
    setModelSheet({
      providerId: activeProvider.id,
      previousId: model,
      modelId: model,
      metadata: { ...metadata, input: { ...metadata.input } },
      smart: false,
      error: null,
    });
  }

  function updateModelDraft(patch: Partial<ModelSheetState>): void {
    setModelSheet((current) => (current ? { ...current, ...patch } : current));
  }

  function updateModelMetadata(patch: Partial<OneModelMetadata>): void {
    setModelSheet((current) =>
      current
        ? {
            ...current,
            metadata: { ...current.metadata, ...patch, source: "manual" },
          }
        : current,
    );
  }

  function updateModelInput(
    key: keyof OneModelInputFormat,
    value: boolean,
  ): void {
    setModelSheet((current) =>
      current
        ? {
            ...current,
            metadata: {
              ...current.metadata,
              input: { ...current.metadata.input, [key]: value },
              source: "manual",
            },
          }
        : current,
    );
  }

  function saveModelSheet(): void {
    if (!modelSheet) return;
    const modelId = modelSheet.modelId.trim();
    if (!modelId) {
      updateModelDraft({ error: t("agents.configModelIdRequired") });
      return;
    }
    if (
      !Number.isSafeInteger(modelSheet.metadata.contextWindow) ||
      modelSheet.metadata.contextWindow < 4096 ||
      modelSheet.metadata.contextWindow > 2_000_000
    ) {
      updateModelDraft({ error: t("agents.configContextWindowRange") });
      return;
    }
    const outputLimit = modelSheet.metadata.maxOutputTokens;
    if (
      outputLimit !== undefined &&
      (!Number.isSafeInteger(outputLimit) ||
        outputLimit < 1 ||
        outputLimit >= modelSheet.metadata.contextWindow ||
        outputLimit > 1_000_000)
    ) {
      updateModelDraft({ error: t("agents.configOutputLimitInvalid") });
      return;
    }
    const provider = providers.find(
      (item) => item.id === modelSheet.providerId,
    );
    if (!provider) return;
    if (
      provider.models.includes(modelId) &&
      modelSheet.previousId !== modelId
    ) {
      updateModelDraft({ error: t("agents.configModelExists") });
      return;
    }
    if (!modelSheet.previousId && provider.models.length >= 32) {
      updateModelDraft({ error: t("agents.configModelLimit") });
      return;
    }
    const key = oneModelProviderKey(provider.endpoint, provider.apiType);
    const previousId = modelSheet.previousId;
    const nextModels = Array.from(
      new Set([
        ...provider.models.filter((model) => model !== previousId),
        modelId,
      ]),
    );
    const wasEnabled = enabledForProvider(provider).includes(
      previousId || modelId,
    );
    const enabled = enabledForProvider(provider).filter(
      (model) => model !== previousId,
    );
    if (!previousId || wasEnabled) enabled.push(modelId);
    const metadata = { ...(config.oneModelMetadata || {}) };
    if (previousId) delete metadata[`${key}::${previousId}`];
    metadata[`${key}::${modelId}`] = {
      ...modelSheet.metadata,
      input: { ...modelSheet.metadata.input, text: true },
    };
    updateProvider(provider.id, { models: nextModels });
    setConfig((current) => {
      const nextByProvider = { ...(current.oneModelsByProvider || {}) };
      nextByProvider[key] = Array.from(new Set(enabled));
      return {
        ...current,
        oneModelMetadata: metadata,
        oneModelsByProvider: nextByProvider,
        ...(provider.id === activeId
          ? {
              oneModels: nextByProvider[key],
              model:
                current.model === previousId
                  ? modelId
                  : current.model || modelId,
            }
          : {}),
      };
    });
    setModelSheet(null);
    setNotice(t("agents.configModelSaved"));
  }

  function removeModel(model: string): void {
    if (!activeProvider) return;
    const key = oneModelProviderKey(
      activeProvider.endpoint,
      activeProvider.apiType,
    );
    const nextModels = activeProvider.models.filter((item) => item !== model);
    const nextEnabled = enabledModels.filter((item) => item !== model);
    const metadata = { ...(config.oneModelMetadata || {}) };
    delete metadata[`${key}::${model}`];
    updateProvider(activeProvider.id, { models: nextModels });
    setConfig((current) => ({
      ...current,
      oneModels: nextEnabled,
      oneModelsByProvider: {
        ...(current.oneModelsByProvider || {}),
        [key]: nextEnabled,
      },
      oneModelMetadata: metadata,
      ...(current.model === model ? { model: nextEnabled[0] || "" } : {}),
    }));
  }

  async function saveModelSettings(): Promise<void> {
    if (!activeProvider) return;
    setBusy("save");
    setNotice(null);
    const nextByProvider = { ...(config.oneModelsByProvider || {}) };
    for (const provider of providers) {
      const key = oneModelProviderKey(provider.endpoint, provider.apiType);
      nextByProvider[key] =
        provider.id === activeId
          ? enabledModels
          : enabledModelsFor(config, provider);
    }
    const activeModel =
      config.model && enabledModels.includes(config.model)
        ? config.model
        : enabledModels[0] || "";
    const activeMetadata = activeModel
      ? config.oneModelMetadata?.[`${activeKey}::${activeModel}`] ||
        inferOneModelMetadata(activeModel)
      : undefined;
    const nextConfig: AgentRuntimeConfig = {
      ...config,
      endpoint: activeProvider.endpoint,
      oneApiType: activeProvider.apiType,
      oneProviders: providers,
      oneActiveProviderId: activeId,
      oneModels: enabledModels,
      oneModelsByProvider: nextByProvider,
      model: activeModel,
      ...(activeModel && activeMetadata
        ? {
            oneContextWindow: activeMetadata.contextWindow,
            oneImageInput: activeMetadata.input.image,
            oneModelMetadata: {
              ...(config.oneModelMetadata || {}),
              [`${activeKey}::${activeModel}`]: activeMetadata,
            },
          }
        : {}),
    };
    try {
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: nextConfig,
      });
      setConfig(saved.config);
      setProviders(providersFromConfig(saved.config, t));
      const savedActive = activeProviderFrom(
        saved.config,
        providersFromConfig(saved.config, t),
      );
      setActiveId(savedActive);
      setStatusVersion((current) => current + 1);
      setNotice(t("agents.configProviderSaved"));
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveProviderKey(id: string): Promise<void> {
    const token = (keyInputs[id] || "").trim();
    if (!token) return;
    const provider = providers.find((item) => item.id === id);
    if (!provider) return;
    const persisted = Boolean(
      config.oneProviders?.some((item) => item.id === id),
    );
    const legacyOrigin =
      !config.oneProviders?.length &&
      id === activeId &&
      provider.endpoint === runtime.config.endpoint?.trim() &&
      provider.apiType === (runtime.config.oneApiType || "openai-completions");
    if (!persisted && !legacyOrigin) {
      setNotice(t("agents.configProviderSaveFirst"));
      return;
    }
    setBusy(`key:${id}`);
    setNotice(null);
    try {
      const result = persisted
        ? await window.agentsOneAPI.setAgentRuntimeBearerToken(
            runtime.id,
            token,
            id,
          )
        : await window.agentsOneAPI.setAgentRuntimeBearerToken(
            runtime.id,
            token,
          );
      setKeyInputs((current) => ({ ...current, [id]: "" }));
      setCredentialStates((current) => ({ ...current, [id]: true }));
      setCredentialWarning(result.storage?.warning || "");
      setNotice(t("agents.configApiKeySaved"));
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function probeActiveProvider(): Promise<void> {
    if (!activeProvider) return;
    setBusy("probe");
    setNotice(null);
    setProbeFeedback(null);
    try {
      const nextByProvider = { ...(config.oneModelsByProvider || {}) };
      for (const provider of providers) {
        const key = oneModelProviderKey(provider.endpoint, provider.apiType);
        nextByProvider[key] =
          provider.id === activeId
            ? enabledModels
            : enabledModelsFor(config, provider);
      }
      const draft = {
        ...runtime,
        config: {
          ...config,
          endpoint: activeProvider.endpoint,
          oneApiType: activeProvider.apiType,
          oneProviders: providers,
          oneActiveProviderId: activeId,
          oneModels: enabledModels,
          oneModelsByProvider: nextByProvider,
        },
      };
      const transientToken = (keyInputs[activeId] || "").trim();
      const result = await window.agentsOneAPI.probeAgentRuntimeDraft(
        draft,
        transientToken || undefined,
      );
      setProbeFeedback({
        kind: result.state === "healthy" ? "ok" : "error",
        message:
          result.state === "healthy"
            ? t("agents.configConnectionPassed")
            : result.message || t("agents.configConnectionFailed"),
      });
    } catch (error) {
      setProbeFeedback({ kind: "error", message: errorText(error) });
    } finally {
      setBusy(null);
    }
  }

  function openProviderModal(): void {
    setProviderError(null);
    setProviderDraft({
      name: "",
      endpoint: "",
      apiType: "openai-completions",
      presetId: "custom",
    });
    setProviderModalOpen(true);
  }

  function applyProviderPreset(presetId: string): void {
    if (presetId === "custom") {
      setProviderDraft({
        name: "",
        endpoint: "",
        apiType: "openai-completions",
        presetId,
      });
      return;
    }
    const preset = ONE_MODEL_PROVIDER_PRESETS.find(
      (item) => item.id === presetId,
    );
    if (!preset) return;
    setProviderDraft({
      name: providerLabel(preset.endpoint, preset.apiType, t),
      endpoint: preset.endpoint,
      apiType: preset.apiType,
      presetId,
    });
  }

  function addProvider(): void {
    const name = providerDraft.name.trim();
    const endpoint = providerDraft.endpoint.trim();
    if (providers.length >= 16) {
      setProviderError(t("agents.configProviderLimit"));
      return;
    }
    if (!name) {
      setProviderError(t("agents.configProviderNameRequired"));
      return;
    }
    if (!/^https?:\/\/[^\s]+$/i.test(endpoint)) {
      setProviderError(t("agents.configProviderEndpointInvalid"));
      return;
    }
    if (
      providers.some(
        (provider) =>
          provider.endpoint.trim().replace(/\/$/, "") ===
            endpoint.replace(/\/$/, "") &&
          provider.apiType === providerDraft.apiType,
      )
    ) {
      setProviderError(t("agents.configProviderExists"));
      return;
    }
    const presetId = getOneModelProviderPresetId(
      endpoint,
      providerDraft.apiType,
    );
    const models = [...(ONE_PROVIDER_MODEL_SUGGESTIONS[presetId] || [])];
    const id = `p-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const provider: OneProviderConfig = {
      id,
      name,
      endpoint,
      apiType: providerDraft.apiType,
      enabled: true,
      models,
    };
    setProviders((current) => [...current, provider]);
    setConfig((current) => ({
      ...current,
      oneModelsByProvider: {
        ...(current.oneModelsByProvider || {}),
        [oneModelProviderKey(endpoint, providerDraft.apiType)]: models,
      },
    }));
    setProviderModalOpen(false);
    setNotice(t("agents.configProviderAdded"));
  }

  function removeProvider(id: string): void {
    if (providers.length === 1) {
      setNotice(t("agents.configProviderKeepOne"));
      return;
    }
    if (!window.confirm(t("agents.configRemoveProviderConfirm"))) return;
    if (id === activeId) {
      const other = providers.find(
        (provider) => provider.id !== id && provider.enabled,
      );
      if (!other) {
        setNotice(t("agents.configProviderKeepOne"));
        return;
      }
      switchProvider(other.id);
    }
    const provider = providers.find((item) => item.id === id);
    if (provider) {
      const key = oneModelProviderKey(provider.endpoint, provider.apiType);
      setConfig((current) => {
        const nextByProvider = { ...(current.oneModelsByProvider || {}) };
        delete nextByProvider[key];
        return {
          ...current,
          oneModelsByProvider: nextByProvider,
          ...(current.oneLegacyProviderId === id
            ? { oneLegacyProviderId: undefined }
            : {}),
        };
      });
    }
    setProviders((current) => current.filter((provider) => provider.id !== id));
    setProviderMenu(null);
  }

  if (!activeProvider) {
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configModelSettings")}</h3>
            <p>
              {t("agents.configProviderDescription", { name: runtime.name })}
            </p>
          </div>
        </header>
        <div className="agent-one-config-panel-body">
          <div className="agent-one-config-state">
            {t("agents.configProviderEmpty")}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="agent-one-config-panel agent-one-config-panel--simple">
      <header className="agent-one-config-panel-head">
        <div>
          <h3>{t("agents.configModelSettings")}</h3>
          <p>{t("agents.configProviderDescription", { name: runtime.name })}</p>
        </div>
      </header>

      <div className="agent-one-provider-strip">
        {providers.map((provider) => {
          const isActive = provider.id === activeId;
          return (
            <button
              type="button"
              key={provider.id}
              className={`agent-one-provider-chip${isActive ? " is-active" : ""}${!provider.enabled ? " is-off" : ""}`}
              aria-pressed={isActive}
              onClick={() => selectProviderChip(provider.id)}
            >
              <span className="agent-one-provider-chip-logo" aria-hidden="true">
                {provider.name.slice(0, 1)}
              </span>
              <span className="agent-one-provider-chip-copy">
                <strong>{provider.name}</strong>
                <small>
                  {t("agents.configProviderModelCount", {
                    count: provider.models.length,
                  })}
                </small>
              </span>
              {isActive && (
                <span className="agent-one-provider-chip-current">
                  {t("agents.configProviderCurrent")}
                </span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          className="agent-one-provider-chip is-add"
          onClick={openProviderModal}
        >
          <Plus size={14} />
          {t("agents.configAddProvider")}
        </button>
      </div>

      <div className="agent-one-providers">
        {providers
          .filter((provider) => provider.id === activeId)
          .map((provider) => {
            const isActive = provider.id === activeId;
            const isOpen = true;
            const providerKey = oneModelProviderKey(
              provider.endpoint,
              provider.apiType,
            );
            const enabled = enabledModelsFor(config, provider);
            const status = credentialStates[provider.id] === true;
            return (
              <section
                className={`agent-one-provider-card${isOpen ? " is-open" : ""}${!provider.enabled ? " is-off" : ""}`}
                key={provider.id}
              >
                <div className="agent-one-provider-head">
                  <div className="agent-one-provider-toggle">
                    <span
                      className="agent-one-provider-logo"
                      aria-hidden="true"
                    >
                      {provider.name.slice(0, 1)}
                    </span>
                    <span className="agent-one-provider-copy">
                      <strong>{provider.name}</strong>
                      <small>
                        {[
                          t("agents.configProviderModelCount", {
                            count: provider.models.length,
                          }),
                          isActive && config.model
                            ? t("agents.configProviderCurrentModel", {
                                model: config.model,
                              })
                            : provider.enabled
                              ? t("agents.configProviderEnabled")
                              : t("agents.configProviderDisabled"),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </div>
                  {isActive && (
                    <span className="agent-one-provider-current">
                      {t("agents.configProviderCurrent")}
                    </span>
                  )}
                  <input
                    className="agent-one-switch"
                    type="checkbox"
                    checked={provider.enabled}
                    aria-label={t("agents.configToggleProvider", {
                      name: provider.name,
                    })}
                    onChange={(event) =>
                      toggleProviderEnabled(provider.id, event.target.checked)
                    }
                  />
                  <div className="agent-one-provider-menu-wrap">
                    <button
                      type="button"
                      className="agent-one-provider-menu"
                      aria-label={t("agents.configProviderMenu", {
                        name: provider.name,
                      })}
                      aria-expanded={providerMenu === provider.id}
                      onClick={() =>
                        setProviderMenu((current) =>
                          current === provider.id ? null : provider.id,
                        )
                      }
                    >
                      <MoreHorizontal size={15} />
                    </button>
                    {providerMenu === provider.id && (
                      <div className="agent-one-provider-menu-pop" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => removeProvider(provider.id)}
                        >
                          <Trash2 size={13} />
                          {t("agents.configRemoveProvider")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="agent-one-provider-body">
                    <div className="agent-one-provider-fields">
                      <label className="settings-field agent-one-config-field--wide">
                        <span className="settings-field-label">
                          {t("agents.configProviderName")}
                        </span>
                        <input
                          className="input"
                          value={provider.name}
                          maxLength={80}
                          onChange={(event) =>
                            updateProvider(provider.id, {
                              name: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="settings-field agent-one-config-field--wide">
                        <span className="settings-field-label">
                          {t("agents.configBaseUrl")}
                        </span>
                        <input
                          className="input"
                          type="url"
                          value={provider.endpoint}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) =>
                            updateActiveProvider({
                              endpoint: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t("agents.configApiProtocol")}
                        </span>
                        <select
                          className="input"
                          value={provider.apiType}
                          onChange={(event) =>
                            updateActiveProvider({
                              apiType: event.target.value as OneModelApiType,
                            })
                          }
                        >
                          {API_TYPES.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="settings-field agent-one-config-field--wide">
                        <div className="agent-one-config-label-row">
                          <label
                            className="settings-field-label"
                            htmlFor={`agent-one-provider-key-${provider.id}`}
                          >
                            {t("agents.configApiKey")}
                          </label>
                          {status && (
                            <span className="agent-one-credential-state is-ready">
                              <ShieldCheck size={13} />{" "}
                              {t("agents.configApiKeyConfigured")}
                            </span>
                          )}
                        </div>
                        <div className="agent-one-api-key-row">
                          <input
                            id={`agent-one-provider-key-${provider.id}`}
                            className="input"
                            type={keyVisible[provider.id] ? "text" : "password"}
                            autoComplete="new-password"
                            value={keyInputs[provider.id] || ""}
                            placeholder={
                              status
                                ? t("agents.configApiKeyReplace")
                                : "API Key"
                            }
                            onChange={(event) =>
                              setKeyInputs((current) => ({
                                ...current,
                                [provider.id]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm agent-one-key-visibility"
                            aria-label={t(
                              "agents.configToggleApiKeyVisibility",
                            )}
                            onClick={() =>
                              setKeyVisible((current) => ({
                                ...current,
                                [provider.id]: !current[provider.id],
                              }))
                            }
                          >
                            {keyVisible[provider.id] ? (
                              <EyeOff size={14} />
                            ) : (
                              <Eye size={14} />
                            )}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            disabled={
                              busy !== null ||
                              !(keyInputs[provider.id] || "").trim()
                            }
                            onClick={() => void saveProviderKey(provider.id)}
                          >
                            {busy === `key:${provider.id}` ? (
                              <Loader2 size={14} className="settings-spin" />
                            ) : (
                              <Save size={14} />
                            )}
                            {t("agents.configSaveApiKey")}
                          </button>
                        </div>
                        <span className="settings-field-hint">
                          {t("agents.configApiKeyHint")}
                        </span>
                        {credentialWarning && (
                          <span className="settings-field-hint" role="status">
                            {credentialWarning}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="agent-one-models-head">
                      <span>
                        <strong>{t("agents.configModelsTitle")}</strong>
                        <small>
                          {t("agents.configModelsEnabledCount", {
                            count: enabled.length,
                            total: activeModels.length,
                          })}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={openAddModel}
                      >
                        <Plus size={14} />
                        {t("agents.configAddModel")}
                      </button>
                    </div>

                    {activeModels.length ? (
                      <div className="agent-one-model-list">
                        {activeModels.map((model) => {
                          const metadata =
                            config.oneModelMetadata?.[
                              `${providerKey}::${model}`
                            ] || inferOneModelMetadata(model);
                          const modelEnabled = enabled.includes(model);
                          return (
                            <div className="agent-one-model-row" key={model}>
                              <label className="agent-one-model-current">
                                <input
                                  type="radio"
                                  name={`agent-one-current-model-${provider.id}`}
                                  checked={config.model === model}
                                  disabled={!modelEnabled}
                                  aria-label={t(
                                    "agents.configSetCurrentModel",
                                    {
                                      model,
                                    },
                                  )}
                                  onChange={() => updateConfig({ model })}
                                />
                              </label>
                              <span className="agent-one-model-id">
                                <code>{model}</code>
                                {modelBadges(metadata, t).map((badge) => (
                                  <span
                                    className="agent-one-model-badge"
                                    key={badge}
                                  >
                                    {badge}
                                  </span>
                                ))}
                              </span>
                              <span className="agent-one-model-actions">
                                <button
                                  type="button"
                                  className="agent-one-model-icon"
                                  aria-label={t("agents.configEditModel", {
                                    model,
                                  })}
                                  onClick={() => openEditModel(model)}
                                >
                                  <Pencil size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="agent-one-model-icon"
                                  aria-label={t("agents.configRemoveModel", {
                                    model,
                                  })}
                                  onClick={() => removeModel(model)}
                                >
                                  <Trash2 size={14} />
                                </button>
                                <input
                                  className="agent-one-switch"
                                  type="checkbox"
                                  checked={modelEnabled}
                                  aria-label={t("agents.configEnableModel", {
                                    model,
                                  })}
                                  onChange={(event) =>
                                    toggleModelEnabled(
                                      model,
                                      event.target.checked,
                                    )
                                  }
                                />
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="agent-one-model-empty">
                        {t("agents.configModelsEmpty")}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
      </div>

      <div className="agent-one-provider-actions">
        {probeFeedback && (
          <span
            className={`agent-one-probe-status is-${probeFeedback.kind}`}
            role="status"
          >
            {probeFeedback.kind === "ok" ? (
              <Check size={13} aria-hidden="true" />
            ) : (
              <AlertTriangle size={13} aria-hidden="true" />
            )}
            {probeFeedback.message}
          </span>
        )}
        {notice && (
          <span className="agent-one-provider-notice" role="status">
            {notice}
          </span>
        )}
        <span className="agent-one-config-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null || !activeProvider.endpoint}
            onClick={() => void probeActiveProvider()}
          >
            {busy === "probe" ? (
              <Loader2 size={14} className="settings-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {t("agents.configTestConnection")}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy !== null || !activeProvider.endpoint}
            onClick={() => void saveModelSettings()}
          >
            {busy === "save" ? (
              <Loader2 size={14} className="settings-spin" />
            ) : (
              <Save size={14} />
            )}
            {t("agents.configSaveProvider")}
          </button>
        </span>
      </div>

      {providerModalOpen && (
        <div
          className="agent-one-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget)
              setProviderModalOpen(false);
          }}
        >
          <aside
            className="agent-one-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("agents.configAddProvider")}
          >
            <div className="agent-one-sheet-head">
              <h2>{t("agents.configAddProvider")}</h2>
              <button
                type="button"
                className="agent-one-sheet-close"
                aria-label={t("agents.close")}
                onClick={() => setProviderModalOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="agent-one-sheet-body">
              <span className="settings-field-label">
                {t("agents.configChooseProvider")}
              </span>
              <div className="agent-one-provider-presets">
                {ONE_MODEL_PROVIDER_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={`agent-one-provider-preset${providerDraft.presetId === preset.id ? " is-active" : ""}`}
                    aria-pressed={providerDraft.presetId === preset.id}
                    onClick={() => applyProviderPreset(preset.id)}
                  >
                    <strong>
                      {providerLabel(preset.endpoint, preset.apiType, t)}
                    </strong>
                    <small>{preset.endpoint}</small>
                  </button>
                ))}
                <button
                  type="button"
                  className={`agent-one-provider-preset${providerDraft.presetId === "custom" ? " is-active" : ""}`}
                  aria-pressed={providerDraft.presetId === "custom"}
                  onClick={() => applyProviderPreset("custom")}
                >
                  <strong>{t("agents.configProviderCustom")}</strong>
                  <small>{t("agents.configProviderCustomHint")}</small>
                </button>
              </div>

              <label className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configProviderName")}
                </span>
                <input
                  className="input"
                  maxLength={80}
                  value={providerDraft.name}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configBaseUrl")}
                </span>
                <input
                  className="input"
                  type="url"
                  value={providerDraft.endpoint}
                  placeholder="https://api.example.com/v1"
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      endpoint: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configApiProtocol")}
                </span>
                <select
                  className="input"
                  value={providerDraft.apiType}
                  onChange={(event) =>
                    setProviderDraft((current) => ({
                      ...current,
                      apiType: event.target.value as OneModelApiType,
                    }))
                  }
                >
                  {API_TYPES.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <span className="settings-field-hint">
                {t("agents.configProviderAddHint")}
              </span>
              {providerError && (
                <span className="settings-field-hint" role="alert">
                  {providerError}
                </span>
              )}
            </div>
            <div className="agent-one-sheet-foot">
              <span />
              <span className="agent-one-config-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setProviderModalOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={addProvider}
                >
                  <Plus size={14} />
                  {t("agents.configAddProviderAction")}
                </button>
              </span>
            </div>
          </aside>
        </div>
      )}

      {modelSheet && (
        <div
          className="agent-one-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModelSheet(null);
          }}
        >
          <aside
            className="agent-one-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={
              modelSheet.previousId
                ? t("agents.configEditModelTitle")
                : t("agents.configAddModelTitle")
            }
          >
            <div className="agent-one-sheet-head">
              <h2>
                {modelSheet.previousId
                  ? t("agents.configEditModelTitle")
                  : t("agents.configAddModelTitle")}
              </h2>
              <button
                type="button"
                className="agent-one-sheet-close"
                aria-label={t("agents.close")}
                onClick={() => setModelSheet(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="agent-one-sheet-body">
              <div className="agent-one-model-smart">
                <div>
                  <strong>{t("agents.configSmartModel")}</strong>
                  <p>{t("agents.configSmartModelHint")}</p>
                </div>
                <input
                  className="agent-one-switch"
                  type="checkbox"
                  checked={modelSheet.smart}
                  aria-label={t("agents.configSmartModel")}
                  onChange={(event) => {
                    const smart = event.target.checked;
                    setModelSheet((current) =>
                      current
                        ? {
                            ...current,
                            smart,
                            metadata: smart
                              ? inferOneModelMetadata(current.modelId)
                              : current.metadata,
                            error: null,
                          }
                        : current,
                    );
                  }}
                />
              </div>
              <label className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configModelId")}
                </span>
                <input
                  className="input"
                  maxLength={256}
                  value={modelSheet.modelId}
                  placeholder={t("agents.configModelIdPlaceholder")}
                  onChange={(event) => {
                    const value = event.target.value;
                    setModelSheet((current) =>
                      current
                        ? {
                            ...current,
                            modelId: value,
                            metadata: current.smart
                              ? inferOneModelMetadata(value)
                              : current.metadata,
                            error: null,
                          }
                        : current,
                    );
                  }}
                />
              </label>
              <div className="agent-one-model-metadata-grid">
                <label className="settings-field">
                  <span className="settings-field-label">
                    {t("agents.configContextWindow")}
                  </span>
                  <input
                    className="input"
                    type="number"
                    min={4096}
                    max={2_000_000}
                    step={1024}
                    value={modelSheet.metadata.contextWindow}
                    onChange={(event) =>
                      updateModelMetadata({
                        contextWindow: Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span className="settings-field-label">
                    {t("agents.configMaxOutputTokens")}
                  </span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={1_000_000}
                    step={1024}
                    value={modelSheet.metadata.maxOutputTokens || ""}
                    onChange={(event) =>
                      updateModelMetadata({
                        maxOutputTokens: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
              </div>
              <div className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configInputTypes")}
                </span>
                <div className="agent-one-input-types">
                  {(
                    [
                      ["text", t("agents.configModelText")],
                      ["image", t("agents.configModelImage")],
                      ["video", t("agents.configModelVideo")],
                      ["pdf", t("agents.configModelPdf")],
                      ["audio", t("agents.configModelAudio")],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="agent-one-input-type" key={key}>
                      <input
                        type="checkbox"
                        checked={
                          key === "text" || modelSheet.metadata.input[key]
                        }
                        disabled={key !== "image"}
                        title={
                          key !== "text" && key !== "image"
                            ? t("agents.configNativeInputsUnavailable")
                            : undefined
                        }
                        onChange={(event) =>
                          updateModelInput(key, event.target.checked)
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <small className="settings-field-hint">
                  {t("agents.configNativeInputsUnavailable")}
                </small>
              </div>
              <div className="settings-field">
                <span className="settings-field-label">
                  {t("agents.configModelCapabilities")}
                </span>
                <div className="agent-one-model-capabilities">
                  <label className="agent-one-input-type">
                    <input
                      type="checkbox"
                      checked={modelSheet.metadata.supportsToolCall}
                      onChange={(event) =>
                        updateModelMetadata({
                          supportsToolCall: event.target.checked,
                        })
                      }
                    />
                    {t("agents.configModelToolCall")}
                  </label>
                  <label className="agent-one-input-type">
                    <input
                      type="checkbox"
                      checked={modelSheet.metadata.supportsStructuredOutput}
                      disabled
                      title={t("agents.configStructuredOutputInfo")}
                      onChange={(event) =>
                        updateModelMetadata({
                          supportsStructuredOutput: event.target.checked,
                        })
                      }
                    />
                    {t("agents.configModelStructuredOutput")}
                  </label>
                </div>
              </div>
              {modelSheet.error && (
                <span className="settings-field-hint" role="alert">
                  {modelSheet.error}
                </span>
              )}
            </div>
            <div className="agent-one-sheet-foot">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  setModelSheet((current) =>
                    current
                      ? {
                          ...current,
                          modelId: current.previousId || "",
                          metadata: {
                            ...DEFAULT_METADATA,
                            input: { ...DEFAULT_METADATA.input },
                          },
                          error: null,
                          smart: !current.previousId,
                        }
                      : current,
                  );
                }}
              >
                {t("agents.configResetModelForm")}
              </button>
              <span className="agent-one-config-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setModelSheet(null)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={saveModelSheet}
                >
                  <Check size={14} />
                  {t("common.save")}
                </button>
              </span>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
