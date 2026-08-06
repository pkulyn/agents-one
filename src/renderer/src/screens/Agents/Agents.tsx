import { useState, useEffect, useCallback } from "react";
import { Bot, Plus, ChatBubble } from "../../assets/icons";
import { RefreshCw, X } from "lucide-react";
import { AppModal, AppModalTitle } from "../../components/modal/AppModal";
import AgentRuntimesPane from "../../components/settings/AgentRuntimesPane";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeKind,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";

interface AgentsProps {
  onChatWithRuntime?: (runtime: AgentRuntimeDefinition) => void;
}

const RUNTIME_LABELS: Record<AgentRuntimeKind, string> = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
};

const RUNTIME_LOCATION_LABEL: Record<AgentRuntimeDefinition["location"], string> = {
  local: "本地",
  remote: "远程",
};

const HEALTH_LABEL: Record<AgentRuntimeProbe["state"], string> = {
  healthy: "正常",
  degraded: "受限",
  unreachable: "不可达",
  unsupported: "不支持",
  unknown: "未检测",
};

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
    if (!window.hermesAPI.listAgentRuntimes) return;
    setRuntimeProbeLoading(true);
    try {
      setRuntimes(await window.hermesAPI.listAgentRuntimes());
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
      enabledRuntimes
        .map(async (runtime) => {
          try {
            return [runtime.id, await window.hermesAPI.probeAgentRuntime(runtime.id)] as const;
          } catch {
            return null;
          }
        }),
    ).then((results) => {
      if (cancelled) return;
      setRuntimeProbes(
        Object.fromEntries(
          results.filter(
            (result): result is readonly [string, AgentRuntimeProbe] => result !== null,
          ),
        ),
      );
    }).finally(() => {
      if (!cancelled) setRuntimeProbeLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [runtimes]);

  return (
    <div className="agents-container">
      <div className="agents-header">
        <div>
          <h2 className="agents-title">智能体</h2>
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

      {(["local", "remote"] as const).map((location) => {
        const group = runtimes.filter((runtime) => runtime.location === location);
        if (group.length === 0) return null;
        return (
          <section className="agents-section" key={location}>
            <h3 className="agents-group-title">
              {location === "local" ? "本地智能体" : "远程智能体"}
            </h3>
            <div className="agents-runtime-grid">
              {group.map((runtime) => (
                <div className="agents-runtime-card" key={runtime.id}>
                  <div className="agents-runtime-main">
                    <span className={`agents-runtime-icon ${runtime.kind}`}>
                      {runtime.avatar ? <img src={runtime.avatar} alt="" /> : <Bot size={18} />}
                    </span>
                    <span className="agents-runtime-info">
                      <strong>{runtime.name}</strong>
                      <small>
                        {RUNTIME_LABELS[runtime.kind]} / {RUNTIME_LOCATION_LABEL[runtime.location]}
                      </small>
                    </span>
                  </div>
                  <div className="agents-runtime-meta">
                    <span className={`agents-runtime-health ${runtimeProbes[runtime.id]?.state || "unknown"}`}>
                      {runtimeProbeLoading
                        ? "检测中"
                        : HEALTH_LABEL[runtimeProbes[runtime.id]?.state || "unknown"]}
                    </span>
                    <span>{runtime.enabled ? "可用" : "已停用"}</span>
                  </div>
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
                      disabled={!runtime.enabled || !onChatWithRuntime}
                      title={runtime.enabled ? "发起对话" : "该智能体已停用"}
                      onClick={() => onChatWithRuntime?.(runtime)}
                    >
                      <ChatBubble size={13} />对话
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

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
              onChanged={() => {
                void loadRuntimes();
                window.dispatchEvent(new CustomEvent("agents-one:runtime-appearance-changed"));
              }}
            />
          </div>
        )}
      </AppModal>

    </div>
  );
}

export default Agents;
