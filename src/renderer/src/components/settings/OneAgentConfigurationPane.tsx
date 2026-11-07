import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeDiagnostics,
  AgentRuntimeProbe,
  AgentRuntimeConfig,
} from "../../../../shared/agent-runtimes";
import type { OneModelApiType } from "../../../../shared/one-model-api";
import type { RuntimeSkillDescriptor } from "../../../../shared/runtime-skills";
import { ONE_MODEL_PROVIDER_PRESETS } from "./one-model-provider-presets";
import { getOneModelProviderPresetId } from "./one-model-provider-presets";
import OneProjectMemoryEditor from "./OneProjectMemoryEditor";
import { useI18n } from "../useI18n";

export type OneAgentConfigSection =
  | "model"
  | "personality"
  | "memory"
  | "subagents"
  | "tools"
  | "skills";

interface OneAgentConfigurationPaneProps {
  runtime: AgentRuntimeDefinition;
  section: OneAgentConfigSection;
  onChanged: () => void;
}

type ProviderChoice = {
  id: string;
  labelKey: string;
  endpoint: string;
  model?: string;
  apiType: OneModelApiType;
};

const QUICK_PROVIDERS: readonly ProviderChoice[] = [
  {
    id: "ark-agent-plan",
    labelKey: "agents.configProviderArk",
    endpoint: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seed-2.0-mini",
    apiType: "openai-completions",
  },
  {
    id: "openai",
    labelKey: "agents.configProviderOpenAI",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiType: "openai-completions",
  },
  {
    id: "deepseek",
    labelKey: "agents.configProviderDeepSeek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-flash",
    apiType: "openai-completions",
  },
  {
    id: "anthropic",
    labelKey: "agents.configProviderAnthropic",
    endpoint: "https://api.anthropic.com",
    apiType: "anthropic-messages",
  },
  {
    id: "custom",
    labelKey: "agents.configProviderCustom",
    endpoint: "",
    apiType: "openai-completions",
  },
];

const API_TYPES: readonly { value: OneModelApiType; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function OneAgentConfigurationPane({
  runtime,
  section,
  onChanged,
}: OneAgentConfigurationPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentRuntimeConfig>(runtime.config);
  const [bearerToken, setBearerToken] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [credentialWarning, setCredentialWarning] = useState("");
  const [skillOptions, setSkillOptions] = useState<RuntimeSkillDescriptor[]>(
    [],
  );
  const [skillsState, setSkillsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [personalMemory, setPersonalMemory] = useState("");
  const [savedPersonalMemory, setSavedPersonalMemory] = useState("");
  const [personalMemoryState, setPersonalMemoryState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [addModelId, setAddModelId] = useState("");
  const [busy, setBusy] = useState<
    "save" | "key" | "probe" | "diagnostics" | "memory" | null
  >(null);
  const [probe, setProbe] = useState<AgentRuntimeProbe | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<AgentRuntimeDiagnostics | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setConfig(runtime.config);
    setBearerToken("");
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
  }, [runtime.id, runtime.config]);

  useEffect(() => {
    let active = true;
    setCredentialConfigured(false);
    setCredentialWarning("");
    void window.agentsOneAPI
      .getAgentRuntimeCredentialStatus(runtime.id)
      .then((status) => {
        if (!active) return;
        setCredentialConfigured(status.configured);
        setCredentialWarning(status.storage?.warning || "");
      })
      .catch(() => {
        if (active) setCredentialConfigured(false);
      });
    return () => {
      active = false;
    };
  }, [runtime.id]);

  useEffect(() => {
    if (section !== "skills") return;
    let active = true;
    setSkillsState("loading");
    void window.agentsOneAPI
      .listRuntimeSkills()
      .then((items) => {
        if (!active) return;
        setSkillOptions(items.filter((item) => item.source === "user"));
        setSkillsState("ready");
      })
      .catch(() => {
        if (active) {
          setSkillOptions([]);
          setSkillsState("error");
        }
      });
    return () => {
      active = false;
    };
  }, [section]);

  useEffect(() => {
    if (section !== "memory") return;
    let active = true;
    setPersonalMemoryState("loading");
    void window.agentsOneAPI
      .getOneRuntimeMemory(runtime.id)
      .then((value) => {
        if (!active) return;
        setPersonalMemory(value);
        setSavedPersonalMemory(value);
        setPersonalMemoryState("ready");
      })
      .catch(() => {
        if (active) setPersonalMemoryState("error");
      });
    return () => {
      active = false;
    };
  }, [runtime.id, section]);

  const modelChoices = useMemo(() => {
    const ids = [...(config.oneModels || [])];
    const activeModel = config.model?.trim();
    if (activeModel && !ids.includes(activeModel)) ids.push(activeModel);
    return Array.from(new Set(ids));
  }, [config.model, config.oneModels]);

  const selectedProviderId = useMemo(() => {
    const presetId = getOneModelProviderPresetId(
      config.endpoint,
      config.oneApiType,
    );
    if (presetId !== "custom") return presetId;
    if (
      config.endpoint?.replace(/\/$/, "") === "https://api.anthropic.com" &&
      config.oneApiType === "anthropic-messages"
    ) {
      return "anthropic";
    }
    return "custom";
  }, [config.endpoint, config.oneApiType]);

  function updateConfig(patch: Partial<AgentRuntimeConfig>): void {
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
    setConfig((current) => ({ ...current, ...patch }));
  }

  async function saveConfig(
    nextConfig: AgentRuntimeConfig = config,
    successMessage = t("agents.configSaved"),
  ): Promise<void> {
    setBusy("save");
    setNotice(null);
    const normalizedModels = Array.from(
      new Set(
        [
          ...(nextConfig.oneModels || []),
          ...(nextConfig.model?.trim() ? [nextConfig.model.trim()] : []),
        ]
          .map((model) => model.trim())
          .filter(Boolean),
      ),
    );
    try {
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: {
          ...nextConfig,
          oneModels: normalizedModels,
        },
      });
      setConfig(saved.config);
      setNotice(successMessage);
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveCredential(): Promise<void> {
    if (!bearerToken.trim()) return;
    setBusy("key");
    setNotice(null);
    try {
      const result = await window.agentsOneAPI.setAgentRuntimeBearerToken(
        runtime.id,
        bearerToken,
      );
      setBearerToken("");
      setCredentialConfigured(true);
      setCredentialWarning(result.storage?.warning || "");
      setNotice(t("agents.configApiKeySaved"));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function testConnection(): Promise<void> {
    setBusy("probe");
    setNotice(null);
    try {
      const result = await window.agentsOneAPI.probeAgentRuntimeDraft(
        { ...runtime, config },
        bearerToken.trim() || undefined,
      );
      setProbe(result);
      setNotice(
        result.state === "healthy"
          ? t("agents.configConnectionPassed")
          : result.message || t("agents.configConnectionFailed"),
      );
    } catch (error) {
      setProbe(null);
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadDiagnostics(): Promise<void> {
    setBusy("diagnostics");
    setNotice(null);
    try {
      setDiagnostics(
        await window.agentsOneAPI.getAgentRuntimeDiagnostics(runtime.id),
      );
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  function selectProvider(providerId: string): void {
    const provider = QUICK_PROVIDERS.find((item) => item.id === providerId);
    if (!provider) return;
    const preset = ONE_MODEL_PROVIDER_PRESETS.find(
      (item) => item.id === provider.id,
    );
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
    setConfig((current) => {
      const nextModel = provider.model ?? "";
      const nextModels = Array.from(
        new Set([
          ...(current.oneModels || []),
          ...(current.model?.trim() ? [current.model.trim()] : []),
          ...(nextModel ? [nextModel] : []),
        ]),
      );
      return {
        ...current,
        endpoint: provider.endpoint,
        oneApiType: provider.apiType,
        model: nextModel || current.model || "",
        oneModels: nextModels,
        oneContextWindow: preset?.contextWindow,
        oneImageInput: preset?.imageInput,
      };
    });
  }

  function addModelChoice(): void {
    const id = addModelId.trim();
    if (!id || modelChoices.includes(id) || modelChoices.length >= 32) return;
    const nextModels = [...modelChoices, id];
    const nextConfig = {
      ...config,
      oneModels: nextModels,
      ...(!config.model?.trim()
        ? { model: id, oneContextWindow: undefined, oneImageInput: undefined }
        : {}),
    };
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
    setConfig(nextConfig);
    setAddModelId("");
  }

  function chooseDefaultModel(id: string): void {
    if (id === config.model) return;
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
    updateConfig({
      model: id,
      oneContextWindow: undefined,
      oneImageInput: undefined,
    });
  }

  function removeModelChoice(id: string): void {
    const nextModels = modelChoices.filter((candidate) => candidate !== id);
    const nextDefault =
      config.model === id ? nextModels[0] || "" : config.model;
    setProbe(null);
    setDiagnostics(null);
    setNotice(null);
    setConfig({
      ...config,
      oneModels: nextModels,
      model: nextDefault,
      ...(config.model === id
        ? { oneContextWindow: undefined, oneImageInput: undefined }
        : {}),
    });
  }

  async function savePersonalMemory(): Promise<void> {
    setBusy("memory");
    setNotice(null);
    try {
      await window.agentsOneAPI.saveOneRuntimeMemory(
        runtime.id,
        personalMemory,
      );
      setSavedPersonalMemory(personalMemory);
      setNotice(t("agents.configPersonalMemorySaved"));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  function toggleSkill(skillId: string, enabled: boolean): void {
    const nextSkills = new Set(config.oneSkills || []);
    if (enabled) nextSkills.add(skillId);
    else nextSkills.delete(skillId);
    updateConfig({ oneSkills: Array.from(nextSkills) });
  }

  if (section === "model") {
    const canSave = Boolean(config.endpoint?.trim() && config.model?.trim());
    const canTest =
      canSave && (credentialConfigured || Boolean(bearerToken.trim()));

    return (
      <section
        className="agent-one-config-panel"
        aria-label={t("agents.configProviderTitle")}
      >
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configProviderTitle")}</h3>
            <p>
              {t("agents.configProviderDescription", { name: runtime.name })}
            </p>
          </div>
          <div className="agent-one-config-head-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!canTest || busy !== null}
              onClick={() => void testConnection()}
            >
              {busy === "probe" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <Activity size={15} />
              )}
              {t("agents.configTestConnection")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() => void loadDiagnostics()}
            >
              {busy === "diagnostics" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <ShieldCheck size={15} />
              )}
              {t("agents.configDiagnostics")}
            </button>
          </div>
        </header>

        <div className="agent-one-config-panel-body">
          <div className="agent-one-config-subheading">
            <strong>{t("agents.configChooseProvider")}</strong>
            <small>{t("agents.configProviderSwitchHint")}</small>
          </div>
          <div
            className="agent-one-provider-choices"
            role="group"
            aria-label={t("agents.configChooseProvider")}
          >
            {QUICK_PROVIDERS.map((provider) => (
              <button
                type="button"
                key={provider.id}
                className={`agent-one-provider-choice${selectedProviderId === provider.id ? " is-active" : ""}`}
                aria-pressed={selectedProviderId === provider.id}
                onClick={() => selectProvider(provider.id)}
              >
                <span
                  className={`agent-one-provider-mark agent-one-provider-mark--${provider.id}`}
                  aria-hidden="true"
                >
                  {provider.id === "custom"
                    ? "+"
                    : provider.labelKey === "agents.configProviderDeepSeek"
                      ? "◉"
                      : provider.id.slice(0, 1).toUpperCase()}
                </span>
                <span>{t(provider.labelKey)}</span>
                {selectedProviderId === provider.id && (
                  <Check size={15} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>

          <div className="agent-one-config-fields">
            <label className="settings-field agent-one-config-field--wide">
              <span className="settings-field-label">
                {t("agents.configBaseUrl")}
              </span>
              <input
                className="input"
                type="url"
                aria-label={t("agents.configBaseUrl")}
                value={config.endpoint || ""}
                placeholder="https://api.example.com/v1"
                onChange={(event) =>
                  updateConfig({ endpoint: event.target.value })
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">
                {t("agents.configApiProtocol")}
              </span>
              <select
                className="input"
                aria-label={t("agents.configApiProtocol")}
                value={config.oneApiType || "openai-completions"}
                onChange={(event) =>
                  updateConfig({
                    oneApiType: event.target.value as OneModelApiType,
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
                  htmlFor="agent-one-api-key"
                >
                  {t("agents.configApiKey")}
                </label>
                {credentialConfigured && (
                  <span className="agent-one-credential-state is-ready">
                    <ShieldCheck size={13} />{" "}
                    {t("agents.configApiKeyConfigured")}
                  </span>
                )}
              </div>
              <div className="agent-one-api-key-row">
                <input
                  id="agent-one-api-key"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  aria-label={t("agents.configApiKey")}
                  value={bearerToken}
                  placeholder={
                    credentialConfigured
                      ? t("agents.configApiKeyReplace")
                      : "API Key"
                  }
                  onChange={(event) => {
                    setProbe(null);
                    setBearerToken(event.target.value);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={!bearerToken.trim() || busy !== null}
                  onClick={() => void saveCredential()}
                >
                  {busy === "key" ? (
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

          <div className="agent-one-model-list">
            <div className="agent-one-config-subheading">
              <strong>{t("agents.configModelsTitle")}</strong>
              <small>{t("agents.configModelsHint")}</small>
            </div>
            {modelChoices.length ? (
              <div className="agent-one-model-rows">
                {modelChoices.map((model) => (
                  <div className="agent-one-model-row" key={model}>
                    <label className="agent-one-model-choice">
                      <input
                        type="radio"
                        name={`one-default-model-${runtime.id}`}
                        checked={config.model === model}
                        aria-label={t("agents.configSetDefaultModel", {
                          model,
                        })}
                        onChange={() => chooseDefaultModel(model)}
                      />
                      <code>{model}</code>
                    </label>
                    {config.model === model ? (
                      <span className="agent-one-model-default">
                        {t("agents.configDefaultModel")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="agent-one-model-remove"
                        aria-label={t("agents.configRemoveModel", { model })}
                        onClick={() => removeModelChoice(model)}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="agent-one-model-empty">
                {t("agents.configModelsEmpty")}
              </div>
            )}
            <div className="agent-one-model-add-row">
              <input
                className="input"
                aria-label={t("agents.configModelId")}
                value={addModelId}
                maxLength={256}
                placeholder={t("agents.configModelIdPlaceholder")}
                onChange={(event) => setAddModelId(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addModelChoice();
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!addModelId.trim() || modelChoices.length >= 32}
                onClick={addModelChoice}
              >
                <Plus size={15} /> {t("agents.configAddModel")}
              </button>
            </div>
            {modelChoices.length >= 32 && (
              <span className="settings-field-hint">
                {t("agents.configModelLimit")}
              </span>
            )}
          </div>

          <footer className="agent-one-config-footer">
            <div className="agent-one-config-status" role="status">
              {probe?.state === "healthy" ? (
                <>
                  <Check size={15} /> {t("agents.configConnectionPassed")}
                </>
              ) : probe?.message || notice ? (
                <>
                  <AlertCircle size={15} /> {probe?.message || notice}
                </>
              ) : (
                <>
                  <ShieldCheck size={15} />{" "}
                  {credentialConfigured
                    ? t("agents.configReadyForTest")
                    : t("agents.configNeedsApiKey")}
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canSave || busy !== null}
              onClick={() => void saveConfig()}
            >
              {busy === "save" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <Save size={15} />
              )}
              {t("agents.configSaveModel")}
            </button>
          </footer>
          {notice && (
            <div className="agent-one-config-notice" role="status">
              {notice}
            </div>
          )}
          {diagnostics && (
            <div
              className="agent-one-diagnostics"
              role="region"
              aria-label={t("agents.configDiagnostics")}
            >
              <strong>{t("agents.configDiagnosticSummary")}</strong>
              <span>
                {t("agents.configDiagnosticConnection", {
                  state: diagnostics.connection.state,
                })}
              </span>
              <span>
                {t("agents.configDiagnosticProvider", {
                  model:
                    diagnostics.provider.actualModel?.id ||
                    diagnostics.provider.requestedModel ||
                    t("agents.configUnknownModel"),
                })}
              </span>
              {diagnostics.connection.message && (
                <span>{diagnostics.connection.message}</span>
              )}
              {diagnostics.host.message && (
                <span>{diagnostics.host.message}</span>
              )}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (section === "personality") {
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configPersonalization")}</h3>
            <p>{t("agents.configPersonalityHint", { name: runtime.name })}</p>
          </div>
        </header>
        <div className="agent-one-config-panel-body">
          <label className="settings-field">
            <span className="settings-field-label">
              {t("settings.runtimeManager.oneInstructions")}
            </span>
            <textarea
              className="input agent-one-personality-input"
              aria-label={t("settings.runtimeManager.oneInstructions")}
              maxLength={100000}
              value={config.oneInstructions || ""}
              onChange={(event) =>
                updateConfig({ oneInstructions: event.target.value })
              }
              placeholder={t("agents.configPersonalityPlaceholder")}
            />
            <span className="settings-field-hint">
              {t("settings.runtimeManager.oneInstructionsHint")}
            </span>
          </label>
          <div className="agent-one-config-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void saveConfig()}
            >
              {busy === "save" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <Save size={15} />
              )}
              {t("agents.configSavePersonalization")}
            </button>
          </div>
          {notice && (
            <div className="agent-one-config-notice" role="status">
              {notice}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (section === "memory") {
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configMemory")}</h3>
            <p>{t("agents.configMemoryHint", { name: runtime.name })}</p>
          </div>
        </header>
        <div className="agent-one-config-panel-body agent-one-memory-settings">
          <div className="agent-one-memory-toggle">
            <div>
              <strong>{t("agents.configMemoryEnabled")}</strong>
              <p>{t("agents.configMemoryEnabledHint")}</p>
            </div>
            <input
              type="checkbox"
              aria-label={t("agents.configMemoryEnabled")}
              checked={config.oneMemoryEnabled === true}
              onChange={(event) =>
                updateConfig({ oneMemoryEnabled: event.target.checked })
              }
            />
          </div>
          <div className="agent-one-config-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void saveConfig()}
            >
              {busy === "save" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <Save size={15} />
              )}
              {t("agents.configSaveMemory")}
            </button>
          </div>

          <div className="agent-one-memory-editor">
            <h4>{t("agents.configPersonalMemory")}</h4>
            <p>{t("agents.configPersonalMemoryHint")}</p>
            {personalMemoryState === "loading" ? (
              <span className="settings-field-hint">
                {t("agents.configMemoryLoading")}
              </span>
            ) : personalMemoryState === "error" ? (
              <span role="alert">{t("agents.configMemoryLoadError")}</span>
            ) : (
              <>
                <textarea
                  className="input agent-one-personality-input"
                  aria-label={t("agents.configPersonalMemory")}
                  rows={5}
                  maxLength={100000}
                  value={personalMemory}
                  onChange={(event) => setPersonalMemory(event.target.value)}
                />
                <div className="agent-one-config-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={
                      busy !== null || personalMemory === savedPersonalMemory
                    }
                    onClick={() => void savePersonalMemory()}
                  >
                    {busy === "memory" ? (
                      <Loader2 size={15} className="settings-spin" />
                    ) : (
                      <Save size={15} />
                    )}
                    {t("agents.configSavePersonalMemory")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy !== null || !savedPersonalMemory}
                    onClick={() => {
                      if (
                        !window.confirm(
                          t("agents.configClearPersonalMemoryConfirm"),
                        )
                      )
                        return;
                      setPersonalMemory("");
                      void window.agentsOneAPI
                        .saveOneRuntimeMemory(runtime.id, "")
                        .then(() => {
                          setSavedPersonalMemory("");
                          setNotice(t("agents.configPersonalMemorySaved"));
                        })
                        .catch((error) => setNotice(errorText(error)));
                    }}
                  >
                    <Trash2 size={14} /> {t("agents.configClearMemory")}
                  </button>
                </div>
              </>
            )}
          </div>
          <div className="agent-one-memory-editor">
            <h4>{t("agents.configProjectMemory")}</h4>
            <OneProjectMemoryEditor key={runtime.id} runtimeId={runtime.id} />
          </div>
          {notice && (
            <div className="agent-one-config-notice" role="status">
              {notice}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (section === "skills") {
    const selected = new Set(config.oneSkills || []);
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configSkillsCommands")}</h3>
            <p>{t("agents.configSkillsHint", { name: runtime.name })}</p>
          </div>
        </header>
        <div className="agent-one-config-panel-body">
          {skillsState === "loading" ? (
            <div className="agent-one-config-state">
              <Loader2 size={18} className="settings-spin" />
              {t("agents.configSkillsLoading")}
            </div>
          ) : skillsState === "error" ? (
            <div className="agent-one-config-state" role="alert">
              {t("agents.configSkillsError")}
            </div>
          ) : skillOptions.length === 0 ? (
            <div className="agent-one-config-state">
              {t("agents.configSkillsEmpty")}
            </div>
          ) : (
            <div className="agent-one-skill-list">
              {skillOptions.map((skill) => (
                <label className="agent-one-skill-row" key={skill.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(skill.id)}
                    onChange={(event) =>
                      toggleSkill(skill.id, event.target.checked)
                    }
                  />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{skill.description || skill.location}</small>
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="agent-one-config-note">
            {t("agents.configCommandsAppManaged")}
          </div>
          <div className="agent-one-config-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null || skillsState !== "ready"}
              onClick={() => void saveConfig()}
            >
              {busy === "save" ? (
                <Loader2 size={15} className="settings-spin" />
              ) : (
                <Save size={15} />
              )}
              {t("agents.configSaveSkills")}
            </button>
          </div>
          {notice && (
            <div className="agent-one-config-notice" role="status">
              {notice}
            </div>
          )}
        </div>
      </section>
    );
  }

  const unavailableTitle =
    section === "subagents"
      ? t("agents.configSubagents")
      : t("agents.configPluginsMcp");
  const unavailableDescription =
    section === "subagents"
      ? t("agents.configSubagentsHint")
      : t("agents.configPluginsMcpHint");
  return (
    <section className="agent-one-config-panel agent-one-config-panel--simple">
      <header className="agent-one-config-panel-head">
        <div>
          <h3>{unavailableTitle}</h3>
          <p>{unavailableDescription}</p>
        </div>
      </header>
      <div className="agent-one-config-panel-body">
        <div className="agent-one-config-state agent-one-config-state--info">
          <ShieldCheck size={20} aria-hidden="true" />
          <span>
            {section === "subagents"
              ? t("agents.configSubagentsScope")
              : t("agents.configToolsScope")}
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
