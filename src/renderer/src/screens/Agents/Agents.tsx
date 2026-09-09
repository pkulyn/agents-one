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
  "web-agent": "网页智能体",
};

// Unified access labels (plan 1.1 / 1.5): remote → Gateway v1, local CLI,
// local API.
const TRANSPORT_LABEL: Record<AgentRuntimeTransport, string> = {
  "gateway-v1": "Gateway v1",
  "local-cli": "本地 CLI",
  "local-api": "本地 API",
  "local-web": "内嵌网页",
};

type AgentSectionKey = "local" | "remote" | "web";

const AGENT_SECTION_META: Record<
  AgentSectionKey,
  {
    title: string;
    description: string;
    className: string;
    icon: typeof Terminal;
  }
> = {
  local: {
    title: "本地智能体",
    description: "在当前电脑运行的智能体CLI或服务",
    className: "local",
    icon: Terminal,
  },
  remote: {
    title: "远程智能体",
    description: "连接远端服务器或电脑上的智能体",
    className: "remote",
    icon: Cloud,
  },
  web: {
    title: "网页智能体",
    description: "在隔离浏览器中连接网页端智能体服务",
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

const HEALTH_LABEL: Record<AgentRuntimeProbe["state"], string> = {
  healthy: "正常",
  degraded: "受限",
  unreachable: "不可达",
  unsupported: "不支持",
  unknown: "检测异常",
};

const RUNTIME_META_LABEL: Record<AgentRuntimeProbe["state"], string> = {
  healthy: "可用",
  degraded: "连接受限",
  unreachable: "连接异常",
  unsupported: "暂不支持",
  unknown: "检测异常",
};

function webRuntimeHealthNotice(
  state: AgentRuntimeProbe["state"],
  message?: string,
): string | undefined {
  if (state === "healthy") return undefined;
  if (message?.trim()) return message;
  switch (state) {
    case "degraded":
      return "网页会话需要登录或完成验证，请进入管理页处理。";
    case "unsupported":
      return "当前网页页面或适配器暂不支持，请进入管理页检查配置。";
    case "unreachable":
      return "网页连接检测失败，请进入管理页检查网页会话。";
    case "unknown":
      return "网页健康检测未完成，请稍后刷新或进入管理页检查。";
  }
}

function runtimeConnectionHint(runtime: AgentRuntimeDefinition): string {
  const transport = deriveAgentTransport(runtime);
  if (transport === "gateway-v1") {
    return runtime.config.endpoint?.trim() || "未配置地址";
  }
  if (transport === "local-cli") {
    return runtime.config.executablePath?.trim() || "未配置可执行文件";
  }
  if (transport === "local-web") {
    return runtime.config.webAgent?.provider === "doubao"
      ? "豆包隔离网页会话"
      : runtime.config.webAgent?.provider === "chatgpt"
        ? "ChatGPT 隔离网页会话"
        : runtime.config.webAgent?.provider === "grok"
          ? "Grok 隔离网页会话"
          : "未配置网页 Provider";
  }
  return "本地 API（127.0.0.1）";
}

function Agents({ onChatWithRuntime }: AgentsProps): React.JSX.Element {
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
                  : "健康检测失败，请稍后重试。",
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
  }, [runtimes]);

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
        ? webRuntimeHealthNotice(healthState, probe?.message)
        : undefined;
    const statusLabel = !runtime.enabled
      ? "已停用"
      : isProbePending
        ? "检测中"
        : RUNTIME_META_LABEL[healthState];
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
                {RUNTIME_LABELS[runtime.kind]} ·{" "}
                {TRANSPORT_LABEL[deriveAgentTransport(runtime)]}
              </small>
            </span>
          </div>
          <span
            className={`agents-runtime-health ${healthState}`}
            title={probe?.message}
          >
            {!runtime.enabled
              ? "已停用"
              : isProbePending
                ? "检测中"
                : HEALTH_LABEL[healthState]}
          </span>
        </div>

        <div className="agents-domain-card-connection">
          <span>
            {section === "web"
              ? "会话"
              : section === "remote"
                ? "网关"
                : "路径"}
          </span>
          <strong title={runtimeConnectionHint(runtime)}>
            {runtimeConnectionHint(runtime)}
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
              {webNotice || "连接检测失败，可进入管理页检查网关地址与凭据。"}
            </span>
          </div>
        )}

        <div className="agents-domain-card-foot">
          <span className={`agents-runtime-meta${statusTone}`}>
            {statusLabel}
            {probe?.checkedAt
              ? ` · 最近检测 ${new Date(probe.checkedAt).toLocaleTimeString(
                  [],
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  },
                )}`
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
              管理
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!isHealthy || !onChatWithRuntime || isProbePending}
              title={
                !runtime.enabled
                  ? "该智能体已停用"
                  : isProbePending
                    ? "正在检测连接，请稍候"
                    : !isHealthy
                      ? probe?.message ||
                        "当前智能体未处于正常状态，暂时无法发起对话"
                      : "发起对话"
              }
              onClick={() => onChatWithRuntime?.(runtime)}
            >
              <ChatBubble size={13} />
              对话
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
          <h2 className="agents-title">智能体</h2>
          <div className="agents-domain-summary">
            <strong>{runtimes.length} 个智能体</strong>
            <span>3 类接入方式</span>
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
            {runtimeProbeLoading ? "检测中" : "刷新"}
          </button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => setManagerTarget({ mode: "new" })}
          >
            <Plus size={14} />
            新增智能体
          </button>
        </div>
      </div>

      <div className="agents-domain-board">
        {AGENT_SECTION_ORDER.map((section) => {
          const group = groupedRuntimes[section];
          const meta = AGENT_SECTION_META[section];
          const SectionIcon = meta.icon;
          const emptyLabel =
            section === "web" ? "暂无网页智能体" : `暂无${meta.title}`;

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
                    <h3>{meta.title}</h3>
                    <small>{meta.description}</small>
                  </div>
                </div>
                <span className="agents-domain-count">{group.length} 个</span>
              </div>
              <div className="agents-domain-list">
                {group.length > 0 ? (
                  group.map((runtime) => renderRuntimeCard(runtime, section))
                ) : (
                  <div className="agents-domain-empty">
                    <span>{emptyLabel}</span>
                    <small>点击右上角“新增智能体”开始接入</small>
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
            {managerTarget?.mode === "new" ? "新增智能体" : "管理智能体"}
          </AppModalTitle>
          <button
            className="profile-modal-close"
            type="button"
            onClick={() => setManagerTarget(null)}
            aria-label="关闭"
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
