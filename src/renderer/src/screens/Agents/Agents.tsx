import { useState, useEffect, useCallback } from "react";
import { Plus, ChatBubble } from "../../assets/icons";
import {
  AlertTriangle,
  Cloud,
  Globe2,
  RefreshCw,
  Terminal,
  X,
} from "lucide-react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import { useI18n } from "../../components/useI18n";
import AgentRuntimesPane from "../../components/settings/AgentRuntimesPane";
import {
  deriveAgentTransport,
  NO_AGENT_RUNTIME_CAPABILITIES,
  type AgentRuntimeDefinition,
  type AgentRuntimeProbe,
  type AgentRuntimeTransport,
} from "../../../../shared/agent-runtimes";

interface AgentsProps {
  onChatWithRuntime?: (runtime: AgentRuntimeDefinition) => void;
}

const RUNTIME_LABELS: Record<string, string> = {
  hermes: "Hermes Agent Runtime",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
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
  "local-web": "agents.transportLocalWeb",
};

type AgentSectionKey = "local" | "remote" | "web";

const AGENT_SECTION_META: Record<
  AgentSectionKey,
  {
    titleKey: string;
    descriptionKey: string;
    className: string;
    icon: typeof Terminal;
  }
> = {
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

const AGENT_SECTION_ORDER: readonly AgentSectionKey[] = [
  "local",
  "remote",
  "web",
];

function sectionForRuntime(runtime: AgentRuntimeDefinition): AgentSectionKey {
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

function Agents({ onChatWithRuntime }: AgentsProps): React.JSX.Element {
  const { t } = useI18n();
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [runtimeProbes, setRuntimeProbes] = useState<
    Record<string, AgentRuntimeProbe>
  >({});
  const [runtimeProbeLoading, setRuntimeProbeLoading] = useState(false);
  const [managerTarget, setManagerTarget] = useState<{
    mode: "new" | "manage";
    runtimeId?: string;
  } | null>(null);
  const loadRuntimes = useCallback(async (): Promise<void> => {
    if (!window.agentsOneAPI.listAgentRuntimes) return;
    setRuntimeProbeLoading(true);
    try {
      setRuntimes(await window.agentsOneAPI.listAgentRuntimes());
    } catch {
      setRuntimes([]);
      setRuntimeProbeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuntimes();
  }, [loadRuntimes]);

  useEffect(() => {
    let cancelled = false;
    const enabledRuntimes = runtimes.filter((runtime) => runtime.enabled);
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
  }, [runtimes, t]);

  const groupedRuntimes: Record<AgentSectionKey, AgentRuntimeDefinition[]> = {
    local: [],
    remote: [],
    web: [],
  };
  runtimes.forEach((runtime) => {
    groupedRuntimes[sectionForRuntime(runtime)].push(runtime);
  });

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
        key={runtime.id}
      >
        <div className="agents-domain-card-top">
          <div className="agents-runtime-main">
            <span className={`agents-runtime-icon ${runtime.kind}`}>
              {runtime.avatar ? (
                <img src={runtime.avatar} alt="" />
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
                ·{" "}
                {deriveAgentTransport(runtime) === "gateway-v1"
                  ? TRANSPORT_LABEL_KEY[deriveAgentTransport(runtime)]
                  : t(TRANSPORT_LABEL_KEY[deriveAgentTransport(runtime)])}
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
            {section === "web"
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
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">{t("agents.dashboardTitle")}</h2>
          <div className="agents-domain-summary">
            <strong>
              {t("agents.runtimeCount", { count: runtimes.length })}
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
              className={runtimeProbeLoading ? "settings-spin" : undefined}
            />
            {runtimeProbeLoading ? t("agents.checking") : t("agents.refresh")}
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
                    <SectionIcon size={16} aria-hidden="true" />
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
                  group.map((runtime) => renderRuntimeCard(runtime, section))
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
                void loadRuntimes();
                window.dispatchEvent(
                  new CustomEvent("agents-one:runtime-appearance-changed"),
                );
              }}
            />
          </div>
        )}
      </AppModal>
    </div>
  );
}

export default Agents;
