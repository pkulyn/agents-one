import { useRuntimeOrder } from "../../components/RuntimeMenu";
import { useState, useEffect, useCallback } from "react";
import { Plus, ChatBubble } from "../../assets/icons";
import {
  AlertTriangle,
  Cloud,
  Globe2,
  RefreshCw,
  Bot,
  ChevronRight,
  Link2,
  Settings2,
  UserRound,
  Brain,
  Sparkles,
  Terminal,
  X,
  Pencil,
  Save,
} from "lucide-react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import AgentRuntimesPane from "../../components/settings/AgentRuntimesPane";
import OneAgentConfigurationPane, {
  type OneAgentConfigSection,
} from "../../components/settings/OneAgentConfigurationPane";
import {
  LocalAgentGlyph,
  OneAgentGlyph,
} from "../../components/AgentTypeGlyphs";
import {
  deriveAgentTransport,
  NO_AGENT_RUNTIME_CAPABILITIES,
  type AgentRuntimeDefinition,
  type AgentRuntimeAppearance,
  type AgentRuntimeProbe,
  type AgentRuntimeTransport,
} from "../../../../shared/agent-runtimes";
import { PROFILE_COLORS } from "../../../../shared/profileColors";

interface AgentsProps {
  onChatWithRuntime?: (runtime: AgentRuntimeDefinition) => void;
}

const RUNTIME_LABELS: Record<string, string> = {
  hermes: "Hermes Agent",
  one: "One",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  "web-agent": "agents.kindWebAgent",
};

// Unified access labels (plan 1.1 / 1.5): remote → Gateway v1, local CLI,
// local API.
const TRANSPORT_LABEL_KEY: Record<AgentRuntimeTransport, string> = {
  "gateway-v1": "Gateway v1",
  "local-cli": "agents.transportLocalCli",
  "local-api": "agents.transportLocalApi",
  "local-sdk": "agents.transportLocalSdk",
  "local-web": "agents.transportLocalWeb",
};

type AgentSectionKey = "one" | "local" | "remote" | "web";

const AGENT_SECTION_META: Record<
  AgentSectionKey,
  {
    titleKey: string;
    descriptionKey: string;
    className: string;
    icon: typeof Terminal;
  }
> = {
  one: {
    titleKey: "agents.sectionOne",
    descriptionKey: "agents.sectionOneDescription",
    className: "one",
    icon: Terminal,
  },
  local: {
    titleKey: "agents.sectionLocal",
    descriptionKey: "agents.sectionLocalDescription",
    className: "local",
    icon: Terminal,
  },
  remote: {
    titleKey: "agents.sectionRemote",
    descriptionKey: "agents.sectionRemoteDescription",
    className: "remote",
    icon: Cloud,
  },
  web: {
    titleKey: "agents.sectionWeb",
    descriptionKey: "agents.sectionWebDescription",
    className: "web",
    icon: Globe2,
  },
};

const AGENT_SECTION_ORDER: readonly Exclude<AgentSectionKey, "one">[] = [
  "local",
  "remote",
  "web",
];

function sectionForRuntime(runtime: AgentRuntimeDefinition): AgentSectionKey {
  if (runtime.kind === "one") return "one";
  if (runtime.kind === "web-agent") return "web";
  return runtime.location === "remote" ? "remote" : "local";
}

const HEALTH_LABEL_KEY: Record<AgentRuntimeProbe["state"], string> = {
  healthy: "agents.healthHealthy",
  degraded: "agents.healthDegraded",
  unreachable: "agents.healthUnreachable",
  unsupported: "agents.healthUnsupported",
  unknown: "agents.healthUnknown",
};

const RUNTIME_META_LABEL_KEY: Record<AgentRuntimeProbe["state"], string> = {
  healthy: "agents.metaHealthy",
  degraded: "agents.metaDegraded",
  unreachable: "agents.metaUnreachable",
  unsupported: "agents.metaUnsupported",
  unknown: "agents.metaUnknown",
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

function webRuntimeHealthNotice(
  state: AgentRuntimeProbe["state"],
  message?: string,
  t?: Translate,
): string | undefined {
  if (state === "healthy") return undefined;
  if (message?.trim()) return message;
  switch (state) {
    case "degraded":
      return t?.("agents.webLoginRequired");
    case "unsupported":
      return t?.("agents.webUnsupported");
    case "unreachable":
      return t?.("agents.webUnreachable");
    case "unknown":
      return t?.("agents.webUnknown");
  }
}

function runtimeConnectionHint(
  runtime: AgentRuntimeDefinition,
  t: Translate,
): string {
  const transport = deriveAgentTransport(runtime);
  if (transport === "gateway-v1") {
    return runtime.config.endpoint?.trim() || t("agents.addressNotConfigured");
  }
  if (transport === "local-sdk") {
    return runtime.config.endpoint?.trim() || t("agents.addressNotConfigured");
  }
  if (transport === "local-cli") {
    return (
      runtime.config.executablePath?.trim() ||
      t("agents.executableNotConfigured")
    );
  }
  if (transport === "local-web") {
    return runtime.config.webAgent?.provider === "doubao"
      ? t("agents.doubaoWebSession")
      : runtime.config.webAgent?.provider === "chatgpt"
        ? t("agents.chatgptWebSession")
        : runtime.config.webAgent?.provider === "grok"
          ? t("agents.grokWebSession")
          : t("agents.webProviderNotConfigured");
  }
  return t("agents.localApiLoopback");
}

function AgentProfileEditorDialog({
  runtime,
  onClose,
  onSaved,
}: {
  runtime: AgentRuntimeDefinition;
  onClose: () => void;
  onSaved: (runtime: AgentRuntimeDefinition) => void;
}): React.JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(runtime.name);
  const [color, setColor] = useState(runtime.color || PROFILE_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    const displayName = name.trim();
    if (!displayName) {
      setError(t("agents.configProfileNameRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    const appearance: AgentRuntimeAppearance = {
      name: displayName,
      color,
      avatar: runtime.avatar ?? null,
    };
    try {
      onSaved(
        await window.agentsOneAPI.saveAgentRuntimeAppearance(
          runtime.id,
          appearance,
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="agents-profile-edit-modal"
      labelledBy="agent-profile-edit-title"
    >
      <div className="agents-create-modal-header">
        <AppModalTitle
          id="agent-profile-edit-title"
          className="agents-create-modal-title"
        >
          {t("agents.configEditProfile", { name: runtime.name })}
        </AppModalTitle>
        <button
          className="profile-modal-close"
          type="button"
          onClick={onClose}
          aria-label={t("agents.close")}
        >
          <X size={18} />
        </button>
      </div>
      <div className="agents-profile-edit-body">
        <label className="settings-field">
          <span className="settings-field-label">
            {t("agents.configProfileName")}
          </span>
          <input
            className="input"
            autoFocus
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="settings-field">
          <span className="settings-field-label">
            {t("agents.configProfileColor")}
          </span>
          <div className="agents-profile-edit-colors">
            {PROFILE_COLORS.slice(0, 10).map((profileColor) => (
              <button
                type="button"
                key={profileColor}
                aria-label={t("agents.configSelectProfileColor", {
                  color: profileColor,
                })}
                aria-pressed={color === profileColor}
                className={`agents-profile-edit-color${color === profileColor ? " is-active" : ""}`}
                style={{ background: profileColor }}
                onClick={() => setColor(profileColor)}
              />
            ))}
          </div>
        </div>
        {error && (
          <div className="agents-profile-edit-error" role="alert">
            {error}
          </div>
        )}
        <div className="agents-profile-edit-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || !name.trim()}
          >
            {busy ? (
              <span className="agents-loading-spinner" />
            ) : (
              <Save size={15} />
            )}
            {t("agents.configSaveProfile")}
          </button>
        </div>
      </div>
    </AppModal>
  );
}

function Agents({ onChatWithRuntime }: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [managerView, setManagerView] = useState<"configuration" | "access">(
    "configuration",
  );
  const [selectedConfigRuntimeId, setSelectedConfigRuntimeId] = useState<
    string | null
  >(null);
  const [activeConfigSection, setActiveConfigSection] =
    useState<OneAgentConfigSection>("model");
  const [profileTarget, setProfileTarget] =
    useState<AgentRuntimeDefinition | null>(null);
  const [credentialStates, setCredentialStates] = useState<
    Record<string, boolean>
  >({});
  const [credentialStatesLoaded, setCredentialStatesLoaded] = useState(false);
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [runtimesLoaded, setRuntimesLoaded] = useState(false);
  const [runtimeProbes, setRuntimeProbes] = useState<
    Record<string, AgentRuntimeProbe>
  >({});
  const [runtimeProbeLoading, setRuntimeProbeLoading] = useState(false);
  const [managerTarget, setManagerTarget] = useState<{
    mode: "new" | "manage";
    runtimeId?: string;
  } | null>(null);
  const loadRuntimes = useCallback(async (): Promise<void> => {
    if (!window.agentsOneAPI.listAgentRuntimes) {
      setRuntimesLoaded(true);
      return;
    }
    setRuntimeProbeLoading(true);
    try {
      setRuntimes(await window.agentsOneAPI.listAgentRuntimes());
      setRuntimesLoaded(true);
    } catch {
      setRuntimes([]);
      setRuntimeProbeLoading(false);
      setRuntimesLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadRuntimes();
  }, [loadRuntimes]);

  useEffect(() => {
    let cancelled = false;
    const enabledRuntimes = runtimes.filter(
      (runtime) => runtime.enabled && runtime.kind !== "one",
    );
    if (managerView !== "access") {
      setRuntimeProbeLoading(false);
      return;
    }
    if (enabledRuntimes.length === 0) {
      setRuntimeProbeLoading(false);
      return;
    }
    setRuntimeProbeLoading(true);
    void Promise.all(
      enabledRuntimes.map(async (runtime) => {
        try {
          return [
            runtime.id,
            await window.agentsOneAPI.probeAgentRuntime(runtime.id),
          ] as const;
        } catch (error) {
          return [
            runtime.id,
            {
              runtimeId: runtime.id,
              state: "unknown",
              capabilities: NO_AGENT_RUNTIME_CAPABILITIES,
              checkedAt: Date.now(),
              message:
                error instanceof Error && error.message.trim()
                  ? error.message
                  : t("agents.healthCheckFailed"),
            },
          ] as const;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setRuntimeProbes(
          Object.fromEntries(
            results.filter(
              (result): result is readonly [string, AgentRuntimeProbe] =>
                result !== null,
            ),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setRuntimeProbeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [managerView, runtimes, t]);

  const { sorted, dragProps } = useRuntimeOrder(runtimes);
  const connectedRuntimes = sorted.filter((runtime) => runtime.kind !== "one");
  const groupedRuntimes: Record<AgentSectionKey, AgentRuntimeDefinition[]> = {
    one: [],
    local: [],
    remote: [],
    web: [],
  };
  connectedRuntimes.forEach((runtime) => {
    groupedRuntimes[sectionForRuntime(runtime)].push(runtime);
  });
  const configurableRuntimes = runtimes.filter(
    (runtime) => runtime.kind === "one",
  );
  const selectedConfigRuntime =
    configurableRuntimes.find(
      (runtime) => runtime.id === selectedConfigRuntimeId,
    ) || configurableRuntimes[0];

  useEffect(() => {
    let cancelled = false;
    const oneRuntimes = runtimes.filter((runtime) => runtime.kind === "one");
    setCredentialStatesLoaded(false);
    if (!window.agentsOneAPI.getAgentRuntimeCredentialStatus) {
      setCredentialStates({});
      setCredentialStatesLoaded(true);
      return;
    }
    void Promise.all(
      oneRuntimes.map(async (runtime) => {
        try {
          const status =
            await window.agentsOneAPI.getAgentRuntimeCredentialStatus(
              runtime.id,
            );
          return [runtime.id, status.configured] as const;
        } catch {
          return [runtime.id, false] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setCredentialStates(Object.fromEntries(entries));
      setCredentialStatesLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [runtimes]);

  function notifyRuntimeChanged(): void {
    void loadRuntimes();
    window.dispatchEvent(
      new CustomEvent("agents-one:runtime-appearance-changed"),
    );
  }

  function renderRuntimeCard(
    runtime: AgentRuntimeDefinition,
    section: AgentSectionKey,
  ): React.JSX.Element {
    const probe = runtimeProbes[runtime.id];
    const healthState = probe?.state || "unknown";
    const SectionIcon = AGENT_SECTION_META[section].icon;
    const isProbePending = runtime.enabled && runtimeProbeLoading;
    const isHealthy = runtime.enabled && healthState === "healthy";
    const isUnreachable = healthState === "unreachable";
    const webNotice =
      section === "web" && runtime.enabled && !isProbePending
        ? webRuntimeHealthNotice(healthState, probe?.message, t)
        : undefined;
    const statusLabel = !runtime.enabled
      ? t("agents.disabled")
      : isProbePending
        ? t("agents.checking")
        : t(RUNTIME_META_LABEL_KEY[healthState]);
    const statusTone =
      !runtime.enabled || isProbePending || healthState === "healthy"
        ? ""
        : healthState === "degraded"
          ? " agents-runtime-meta--warning"
          : " agents-runtime-meta--error";

    return (
      <article
        className={`agents-domain-card agents-domain-card--${section}${
          section === "remote" ? " agents-domain-card--remote-featured" : ""
        }`}
        {...dragProps(runtime.id)}
        key={runtime.id}
      >
        <div className="agents-domain-card-top">
          <div className="agents-runtime-main">
            <span className={`agents-runtime-icon ${runtime.kind}`}>
              {runtime.avatar ? (
                <img src={runtime.avatar} alt="" />
              ) : section === "one" ? (
                <OneAgentGlyph size={22} />
              ) : section === "local" ? (
                <LocalAgentGlyph size={22} />
              ) : (
                <SectionIcon size={18} aria-hidden="true" />
              )}
            </span>
            <span className="agents-runtime-info">
              <strong>{runtime.name}</strong>
              <small>
                {runtime.kind === "web-agent"
                  ? t(RUNTIME_LABELS[runtime.kind])
                  : RUNTIME_LABELS[runtime.kind]}{" "}
                {runtime.kind !== "hermes" && (
                  <>
                    {" "}
                    ·{" "}
                    {deriveAgentTransport(runtime) === "gateway-v1"
                      ? TRANSPORT_LABEL_KEY[deriveAgentTransport(runtime)]
                      : t(TRANSPORT_LABEL_KEY[deriveAgentTransport(runtime)])}
                  </>
                )}
              </small>
            </span>
          </div>
          <span
            className={`agents-runtime-health ${healthState}`}
            title={probe?.message}
          >
            {!runtime.enabled
              ? t("agents.disabled")
              : isProbePending
                ? t("agents.checking")
                : t(HEALTH_LABEL_KEY[healthState])}
          </span>
        </div>

        <div className="agents-domain-card-connection">
          <span>
            {runtime.kind === "one"
              ? t("agents.connectionModelApi")
              : section === "web"
                ? t("agents.connectionSession")
                : section === "remote"
                  ? t("agents.connectionGateway")
                  : t("agents.connectionPath")}
          </span>
          <strong title={runtimeConnectionHint(runtime, t)}>
            {runtimeConnectionHint(runtime, t)}
          </strong>
        </div>

        {((isUnreachable && section === "remote") || webNotice) && (
          <div
            className={`agents-domain-card-notice${
              webNotice ? ` agents-domain-card-notice--${healthState}` : ""
            }`}
          >
            <AlertTriangle size={14} aria-hidden="true" />
            <span>
              {webNotice ||
                probe?.message ||
                t("agents.remoteConnectionFailed")}
            </span>
          </div>
        )}

        <div className="agents-domain-card-foot">
          <span className={`agents-runtime-meta${statusTone}`}>
            {statusLabel}
            {probe?.checkedAt
              ? ` · ${t("agents.lastChecked", {
                  time: new Date(probe.checkedAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}`
              : ""}
          </span>
          <div className="agents-runtime-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                setManagerTarget({ mode: "manage", runtimeId: runtime.id })
              }
            >
              {t("agents.manage")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!isHealthy || !onChatWithRuntime || isProbePending}
              title={
                !runtime.enabled
                  ? t("agents.disabledChatHint")
                  : isProbePending
                    ? t("agents.checkingChatHint")
                    : !isHealthy
                      ? probe?.message || t("agents.unhealthyChatHint")
                      : t("agents.startChatHint")
              }
              onClick={() => onChatWithRuntime?.(runtime)}
            >
              <ChatBubble size={13} />
              {t("agents.dashboardChat")}
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="agents-container agents-manager-container">
      <header className="agents-manager-heading">
        <div>
          <h2 className="agents-title">{t("agents.managerTitle")}</h2>
          <p>{t("agents.managerDescription")}</p>
        </div>
      </header>

      <div
        className="agents-manager-modes"
        role="tablist"
        aria-label={t("agents.managerModes")}
      >
        <button
          type="button"
          id="agents-configuration-tab"
          role="tab"
          aria-selected={managerView === "configuration"}
          aria-controls="agents-configuration-panel"
          className={`agents-manager-mode${managerView === "configuration" ? " is-active" : ""}`}
          onClick={() => setManagerView("configuration")}
        >
          <span className="agents-manager-mode-icon agents-manager-mode-icon--config">
            <Settings2 size={19} aria-hidden="true" />
          </span>
          <span className="agents-manager-mode-copy">
            <strong>{t("agents.configurationMode")}</strong>
            <small>{t("agents.configurationModeDescription")}</small>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
        <button
          type="button"
          id="agents-access-tab"
          role="tab"
          aria-selected={managerView === "access"}
          aria-controls="agents-access-panel"
          className={`agents-manager-mode${managerView === "access" ? " is-active" : ""}`}
          onClick={() => setManagerView("access")}
        >
          <span className="agents-manager-mode-icon agents-manager-mode-icon--access">
            <Link2 size={19} aria-hidden="true" />
          </span>
          <span className="agents-manager-mode-copy">
            <strong>{t("agents.accessManagementMode")}</strong>
            <small>{t("agents.accessManagementModeDescription")}</small>
          </span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>

      {managerView === "configuration" ? (
        <>
          <section
            id="agents-configuration-panel"
            className="agents-config-view"
            role="tabpanel"
            aria-labelledby="agents-configuration-tab"
          >
            <header className="agents-config-heading">
              <div>
                <h3>{t("agents.configuredAgentsTitle")}</h3>
                <span>
                  {t("agents.configuredAgentsCount", {
                    count: configurableRuntimes.length,
                  })}
                </span>
              </div>
              <small>{t("agents.configuredAgentsHint")}</small>
            </header>
            <div className="agents-config-layout">
              <aside className="agents-config-sidebar">
                <div className="agents-config-sidebar-title">
                  <span>{t("agents.oneConfigListTitle")}</span>
                  <span>{configurableRuntimes.length}</span>
                </div>
                <div className="agents-config-runtime-list">
                  {configurableRuntimes.length ? (
                    configurableRuntimes.map((runtime) => {
                      const isSelected =
                        (selectedConfigRuntime?.id || null) === runtime.id;
                      const configured = Boolean(
                        runtime.config.endpoint?.trim() &&
                        runtime.config.model?.trim() &&
                        credentialStates[runtime.id],
                      );
                      return (
                        <div
                          className="agents-config-runtime-row"
                          key={runtime.id}
                        >
                          <button
                            type="button"
                            className={`agents-config-runtime${isSelected ? " is-active" : ""}`}
                            aria-pressed={isSelected}
                            onClick={() =>
                              setSelectedConfigRuntimeId(runtime.id)
                            }
                          >
                            <span className="agents-config-runtime-icon">
                              {runtime.avatar ? (
                                <img src={runtime.avatar} alt="" />
                              ) : (
                                <OneAgentGlyph size={19} />
                              )}
                            </span>
                            <span className="agents-config-runtime-copy">
                              <strong>{runtime.name}</strong>
                              <small>{runtime.id}</small>
                            </span>
                            <span
                              className={`agents-config-runtime-state${configured ? " is-ready" : " is-pending"}`}
                            >
                              {!credentialStatesLoaded &&
                              runtime.config.endpoint?.trim() &&
                              runtime.config.model?.trim()
                                ? t("agents.configCheckingCredential")
                                : configured
                                  ? t("agents.configAgentReady")
                                  : t("agents.configAgentNeedsSetup")}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="agents-config-profile-edit"
                            aria-label={t("agents.configEditProfile", {
                              name: runtime.name,
                            })}
                            onClick={() => setProfileTarget(runtime)}
                          >
                            <Pencil size={13} aria-hidden="true" />
                            <span>{t("agents.configEditProfileShort")}</span>
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="agents-config-empty-list">
                      {!runtimesLoaded
                        ? t("agents.configLoading")
                        : t("agents.configEmptyList")}
                    </p>
                  )}
                </div>
                <div className="agents-config-nav-heading">
                  {t("agents.configSectionsTitle")}
                </div>
                <nav
                  className="agents-config-sections"
                  aria-label={t("agents.configSectionsTitle")}
                >
                  <button
                    type="button"
                    className={
                      activeConfigSection === "model" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("model")}
                  >
                    <Settings2 size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configModelSettings")}</span>
                      <small>{t("agents.configModelSummary")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      activeConfigSection === "personality" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("personality")}
                  >
                    <UserRound size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configPersonalization")}</span>
                      <small>{t("agents.configPersonalitySummary")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      activeConfigSection === "memory" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("memory")}
                  >
                    <Brain size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configMemory")}</span>
                      <small>{t("agents.configMemorySummary")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      activeConfigSection === "subagents" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("subagents")}
                  >
                    <Bot size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configSubagents")}</span>
                      <small>{t("agents.configSubagentsHint")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      activeConfigSection === "tools" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("tools")}
                  >
                    <Link2 size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configPluginsMcp")}</span>
                      <small>{t("agents.configAppManagedTools")}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={
                      activeConfigSection === "skills" ? "is-active" : ""
                    }
                    onClick={() => setActiveConfigSection("skills")}
                  >
                    <Sparkles size={15} aria-hidden="true" />
                    <span className="agents-config-section-copy">
                      <span>{t("agents.configSkillsCommands")}</span>
                      <small>{t("agents.configSkillsSummary")}</small>
                    </span>
                  </button>
                </nav>
                <div className="agents-config-sidebar-note">
                  {t("agents.configIndependenceHint")}
                </div>
              </aside>
              <div className="agents-config-editor">
                {selectedConfigRuntime ? (
                  <OneAgentConfigurationPane
                    key={`one-config:${selectedConfigRuntime.id}`}
                    runtime={selectedConfigRuntime}
                    section={activeConfigSection}
                    onChanged={notifyRuntimeChanged}
                  />
                ) : !runtimesLoaded ? (
                  <div className="agents-config-state">
                    <span className="agents-loading-spinner" />
                    {t("agents.configLoading")}
                  </div>
                ) : (
                  <div className="agents-config-state agents-config-state--empty">
                    <span className="agents-manager-mode-icon agents-manager-mode-icon--config">
                      <Settings2 size={21} aria-hidden="true" />
                    </span>
                    <strong>{t("agents.configEmptyTitle")}</strong>
                    <p>{t("agents.configEmptyDescription")}</p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => setManagerTarget({ mode: "new" })}
                    >
                      <Plus size={14} />
                      {t("agents.configEmptyAction")}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
          <div
            id="agents-access-panel"
            role="tabpanel"
            aria-labelledby="agents-access-tab"
            hidden
          />
        </>
      ) : (
        <>
          <div
            id="agents-configuration-panel"
            role="tabpanel"
            aria-labelledby="agents-configuration-tab"
            hidden
          />
          <section
            id="agents-access-panel"
            className="agents-access-view"
            role="tabpanel"
            aria-labelledby="agents-access-tab"
          >
            <div className="agents-header">
              <div>
                <h2 className="agents-title">{t("agents.dashboardTitle")}</h2>
                <div className="agents-domain-summary">
                  <strong>
                    {t("agents.runtimeCount", {
                      count: connectedRuntimes.length,
                    })}
                  </strong>
                  <span>{t("agents.accessTypeCount")}</span>
                </div>
              </div>
              <div className="agents-header-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => void loadRuntimes()}
                  disabled={runtimeProbeLoading}
                >
                  <RefreshCw
                    size={14}
                    className={
                      runtimeProbeLoading ? "settings-spin" : undefined
                    }
                  />
                  {runtimeProbeLoading
                    ? t("agents.checking")
                    : t("agents.refresh")}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  type="button"
                  onClick={() => setManagerTarget({ mode: "new" })}
                >
                  <Plus size={14} />
                  {t("agents.addAgent")}
                </button>
              </div>
            </div>

            <div className="agents-domain-board">
              {AGENT_SECTION_ORDER.map((section) => {
                const group = groupedRuntimes[section];
                const meta = AGENT_SECTION_META[section];
                const SectionIcon = meta.icon;
                const emptyLabel =
                  section === "web"
                    ? t("agents.emptyWeb")
                    : t("agents.emptySection", { section: t(meta.titleKey) });

                return (
                  <section
                    className={`agents-domain agents-domain--${meta.className}`}
                    key={section}
                  >
                    <div className="agents-domain-heading">
                      <div className="agents-domain-heading-label">
                        <span className="agents-domain-icon">
                          {section === "local" ? (
                            <LocalAgentGlyph size={20} />
                          ) : (
                            <SectionIcon size={16} aria-hidden="true" />
                          )}
                        </span>
                        <div>
                          <h3>{t(meta.titleKey)}</h3>
                          <small>{t(meta.descriptionKey)}</small>
                        </div>
                      </div>
                      <span className="agents-domain-count">
                        {t("agents.itemCount", { count: group.length })}
                      </span>
                    </div>
                    <div className="agents-domain-list">
                      {group.length > 0 ? (
                        group.map((runtime) =>
                          renderRuntimeCard(runtime, section),
                        )
                      ) : (
                        <div className="agents-domain-empty">
                          <span>{emptyLabel}</span>
                          <small>{t("agents.emptyHint")}</small>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>
        </>
      )}

      <AppModal
        open={Boolean(managerTarget)}
        onOpenChange={(open) => {
          if (!open) setManagerTarget(null);
        }}
        className="agents-runtime-manager-modal"
        labelledBy="runtime-manager-title"
      >
        <div className="agents-create-modal-header">
          <AppModalTitle
            id="runtime-manager-title"
            className="agents-create-modal-title"
          >
            {managerTarget?.mode === "new"
              ? t("agents.addAgent")
              : t("agents.manageAgent")}
          </AppModalTitle>
          <button
            className="profile-modal-close"
            type="button"
            onClick={() => setManagerTarget(null)}
            aria-label={t("agents.close")}
          >
            <X size={18} />
          </button>
        </div>
        {managerTarget && (
          <div className="agents-runtime-manager-body">
            <AgentRuntimesPane
              key={`${managerTarget.mode}:${managerTarget.runtimeId || "new"}`}
              embedded
              startNew={managerTarget.mode === "new"}
              initialRuntimeId={managerTarget.runtimeId}
              onCancel={() => setManagerTarget(null)}
              onChanged={() => {
                notifyRuntimeChanged();
              }}
            />
          </div>
        )}
      </AppModal>

      {profileTarget && (
        <AgentProfileEditorDialog
          runtime={profileTarget}
          onClose={() => setProfileTarget(null)}
          onSaved={(saved) => {
            setProfileTarget(null);
            void loadRuntimes();
            window.dispatchEvent(
              new CustomEvent("agents-one:runtime-appearance-changed"),
            );
            if (selectedConfigRuntimeId === saved.id) {
              setSelectedConfigRuntimeId(saved.id);
            }
          }}
        />
      )}
    </div>
  );
}

export default Agents;
