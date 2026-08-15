import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  AgentRuntimeDefinition,
  AgentRuntimeDraft,
  AgentRuntimeKind,
  AgentRuntimeLocation,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";
import { AGENT_RUNTIME_KINDS } from "../../../../shared/agent-runtimes";
import { PROFILE_COLORS } from "../../../../shared/profileColors";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import ConnectionPane from "./ConnectionPane";
import { SettingsDataContext } from "./SettingsDataContext";
import { useSettingsData } from "./useSettingsData";

const DEFAULT_TIMEOUT_MS = 10000;

const KIND_LABELS: Record<AgentRuntimeKind, string> = {
  hermes: "Hermes",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
};

function HermesConnectionManager(): React.JSX.Element {
  const data = useSettingsData();
  return (
    <SettingsDataContext.Provider value={data}>
      <ConnectionPane />
    </SettingsDataContext.Provider>
  );
}

function runtimeTemplate(kind: AgentRuntimeKind): AgentRuntimeDraft {
  if (kind === "pi") {
    return {
      id: "pi-agent",
      name: "Pi Agent",
      kind,
      location: "local",
      enabled: true,
      config: {
        executablePath: "pi",
        transport: "cli",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }
  if (kind === "codex") {
    return {
      id: "codex-local",
      name: "Codex",
      kind,
      location: "local",
      enabled: true,
      config: {
        executablePath: "codex",
        transport: "cli",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }
  if (kind === "claude-code") {
    return {
      id: "claude-code-local",
      name: "Claude Code",
      kind,
      location: "local",
      enabled: true,
      config: {
        executablePath: "claude",
        transport: "cli",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }
  // Hermes (and any remote agent kind) connects via Gateway v1 — the legacy
  // Hermes/OpenClaw remote transports were removed (plan D5).
  return {
    id: `${kind}-gateway`,
    name: kind === "hermes" ? "Hermes" : "Gateway Agent",
    kind,
    location: "remote",
    enabled: true,
    config: {
      endpoint: "",
      transport: "http",
      remoteGateway: { protocol: "agents-one-v1" as const },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  };
}

function emptyDraft(): AgentRuntimeDraft {
  return runtimeTemplate("hermes");
}

function draftFromRuntime(runtime: AgentRuntimeDefinition): AgentRuntimeDraft {
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    location: runtime.location,
    enabled: runtime.enabled,
    needsReauthorization: runtime.needsReauthorization,
    color: runtime.color,
    avatar: runtime.avatar,
    config: { ...runtime.config },
  };
}

function healthLabel(probe?: AgentRuntimeProbe): string {
  if (!probe) return "未检测";
  return {
    healthy: "健康",
    degraded: "异常",
    unreachable: "不可达",
    unsupported: "不支持",
    unknown: "未知",
  }[probe.state];
}

function trueCapabilities(probe?: AgentRuntimeProbe): string[] {
  if (!probe) return [];
  const labels: Record<string, string> = {
    chat: "对话",
    taskDispatch: "任务派发",
    streaming: "流式反馈",
    cancellation: "取消任务",
    tools: "工具调用",
    artifacts: "产物",
    orchestration: "协作规划",
    readOnlyPlanning: "只读规划",
  };
  return Object.entries(probe.capabilities)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => labels[key] || key);
}

interface AgentRuntimesPaneProps {
  /** Used by the Agents page modal to open one Runtime directly. */
  initialRuntimeId?: string;
  /** Start directly in the new-agent draft instead of showing a selected item. */
  startNew?: boolean;
  /** Hides the duplicate Runtime list when the pane is embedded in an agent card. */
  embedded?: boolean;
  onChanged?: () => void;
}

export default function AgentRuntimesPane({
  initialRuntimeId,
  startNew = false,
  embedded = false,
  onChanged,
}: AgentRuntimesPaneProps = {}): React.JSX.Element {
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentRuntimeDraft>(() => emptyDraft());
  const [probes, setProbes] = useState<Record<string, AgentRuntimeProbe>>({});
  const [probingRuntimeIds, setProbingRuntimeIds] = useState<string[]>([]);
  const [probeFailures, setProbeFailures] = useState<string[]>([]);
  const [busy, setBusy] = useState<
    "load" | "save" | "probe" | "remove" | "appearance" | null
  >(null);
  const [bearerToken, setBearerToken] = useState("");
  const [workspaceGatewayToken, setWorkspaceGatewayToken] = useState("");
  const [credentialRevision, setCredentialRevision] = useState(0);
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [draftProbe, setDraftProbe] = useState<AgentRuntimeProbe | null>(null);
  const [draftProbeKey, setDraftProbeKey] = useState<string | null>(null);
  const [savingCredential, setSavingCredential] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === selectedId) || null,
    [runtimes, selectedId],
  );
  const selectedProbe = selectedId ? probes[selectedId] : undefined;
  const isNew = selectedId === null;
  const isBuiltin = selectedRuntime?.managed === "builtin";
  const isRemoteConnection = draft.location === "remote";
  const usesUnifiedGateway =
    isRemoteConnection &&
    draft.config.remoteGateway?.protocol === "agents-one-v1";
  const requiresRemoteCredential = !isBuiltin && usesUnifiedGateway;
  const supportsRemoteWorkspaceGateway =
    !isBuiltin && isRemoteConnection && usesUnifiedGateway;
  const credentialLabel = usesUnifiedGateway ? "Gateway Token" : "";
  const credentialActionLabel = usesUnifiedGateway ? "保存 Gateway Token" : "";
  const draftConnectionKey = JSON.stringify({
    kind: draft.kind,
    location: draft.location,
    endpoint: draft.config.endpoint?.trim() || "",
    remoteGateway: draft.config.remoteGateway?.protocol || null,
    executablePath: draft.config.executablePath?.trim() || "",
    workspace: draft.config.workspace?.trim() || "",
    timeoutMs: draft.config.timeoutMs || DEFAULT_TIMEOUT_MS,
    credentialRevision,
  });
  const canSave =
    !isBuiltin &&
    draft.id.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    (draft.location === "local" || !!draft.config.endpoint?.trim()) &&
    (!draft.needsReauthorization || bearerToken.trim().length >= 8) &&
    (!isNew || (draftProbe?.state === "healthy" && draftProbeKey === draftConnectionKey));

  async function loadCredentialStatus(runtimeId: string | null): Promise<void> {
    if (!runtimeId || !window.hermesAPI.getAgentRuntimeCredentialStatus) {
      setCredentialConfigured(false);
      return;
    }
    try {
      const status =
        await window.hermesAPI.getAgentRuntimeCredentialStatus(runtimeId);
      setCredentialConfigured(status.configured);
    } catch {
      setCredentialConfigured(false);
    }
  }

  async function load(preferredId?: string): Promise<void> {
    setBusy("load");
    try {
      const next = await window.hermesAPI.listAgentRuntimes();
      setRuntimes(next);
      const nextSelected =
        preferredId && next.some((runtime) => runtime.id === preferredId)
          ? preferredId
          : next[0]?.id || null;
      setSelectedId(nextSelected);
      setBearerToken("");
      setWorkspaceGatewayToken("");
      setCredentialRevision(0);
      setDraftProbe(null);
      setDraftProbeKey(null);
      void loadCredentialStatus(nextSelected);
      setDraft(
        nextSelected
          ? draftFromRuntime(
              next.find((runtime) => runtime.id === nextSelected)!,
            )
          : emptyDraft(),
      );
      void probeEnabledRuntimes(next);
    } catch (err) {
      setFlash((err as Error).message || "无法加载智能体接入配置。");
    } finally {
      setBusy(null);
    }
  }

  async function probeEnabledRuntimes(
    items: AgentRuntimeDefinition[],
  ): Promise<void> {
    const enabled = items.filter((runtime) => runtime.enabled);
    const ids = enabled.map((runtime) => runtime.id);
    setProbingRuntimeIds(ids);
    setProbeFailures([]);
    if (enabled.length === 0) return;
    const results = await Promise.all(
      enabled.map(async (runtime) => {
        try {
          return {
            id: runtime.id,
            probe: await window.hermesAPI.probeAgentRuntime(runtime.id),
          };
        } catch {
          return { id: runtime.id, probe: null };
        }
      }),
    );
    setProbes((current) => ({
      ...current,
      ...Object.fromEntries(
        results
          .filter(
            (result): result is { id: string; probe: AgentRuntimeProbe } =>
              result.probe !== null,
          )
          .map((result) => [result.id, result.probe]),
      ),
    }));
    setProbeFailures(
      results
        .filter((result) => result.probe === null)
        .map((result) => result.id),
    );
    setProbingRuntimeIds([]);
  }

  useEffect(() => {
    void load(startNew ? undefined : initialRuntimeId).then(() => {
      if (startNew) startNewRuntime();
    });
  }, []);

  function selectRuntime(runtime: AgentRuntimeDefinition): void {
    setSelectedId(runtime.id);
    setDraft(draftFromRuntime(runtime));
    setFlash(null);
    setBearerToken("");
    setWorkspaceGatewayToken("");
    setCredentialRevision(0);
    setDraftProbe(null);
    setDraftProbeKey(null);
    void loadCredentialStatus(runtime.id);
  }

  function startNewRuntime(): void {
    setSelectedId(null);
    setDraft(emptyDraft());
    setFlash(null);
    setBearerToken("");
    setWorkspaceGatewayToken("");
    setCredentialRevision(0);
    setDraftProbe(null);
    setDraftProbeKey(null);
    setCredentialConfigured(false);
  }

  async function saveRuntime(): Promise<void> {
    if (!canSave) return;
    setBusy("save");
    try {
      const saved = await window.hermesAPI.saveAgentRuntime({
        ...draft,
        id: draft.id.trim(),
        name: draft.name.trim(),
        location: draft.location,
        config: {
          ...draft.config,
          endpoint: draft.config.endpoint?.trim() || undefined,
          executablePath: draft.config.executablePath?.trim() || undefined,
          model: draft.config.model?.trim() || undefined,
          workspace: draft.config.workspace?.trim() || undefined,
          workspaceGatewayEndpoint:
            draft.config.workspaceGatewayEndpoint?.trim() || undefined,
        },
      });
      if (draft.color || draft.avatar) {
        await window.hermesAPI.saveAgentRuntimeAppearance(saved.id, {
          name: saved.name,
          color: draft.color,
          avatar: draft.avatar,
        });
      }
      if (
        saved.config.remoteGateway?.protocol === "agents-one-v1" &&
        bearerToken.trim()
      ) {
        await window.hermesAPI.setAgentRuntimeBearerToken(
          saved.id,
          bearerToken.trim(),
        );
        setBearerToken("");
        setCredentialRevision(0);
        setCredentialConfigured(true);
      }
      if (
        saved.config.remoteGateway?.protocol === "agents-one-v1" &&
        workspaceGatewayToken.trim()
      ) {
        await window.hermesAPI.setAgentRuntimeWorkspaceGatewayToken(
          saved.id,
          workspaceGatewayToken.trim(),
        );
        setWorkspaceGatewayToken("");
      }
      setFlash("智能体接入配置已保存。");
      await load(saved.id);
      onChanged?.();
    } catch (err) {
      setFlash((err as Error).message || "无法保存智能体接入配置。");
    } finally {
      setBusy(null);
    }
  }

  async function saveAppearance(): Promise<void> {
    if (!selectedRuntime) return;
    setBusy("appearance");
    try {
      const saved = await window.hermesAPI.saveAgentRuntimeAppearance(
        selectedRuntime.id,
        {
          name: draft.name.trim() || undefined,
          color: draft.color,
          avatar: draft.avatar,
        },
      );
      setRuntimes((current) =>
        current.map((runtime) => (runtime.id === saved.id ? saved : runtime)),
      );
      setDraft(draftFromRuntime(saved));
      window.dispatchEvent(new CustomEvent("hermes-agent-runtime-changed"));
      setFlash("智能体显示信息已保存。");
    } catch (err) {
      setFlash((err as Error).message || "无法保存智能体显示信息。");
    } finally {
      setBusy(null);
    }
  }

  async function chooseAvatar(file?: File): Promise<void> {
    if (!file) return;
    try {
      const avatar = await fileToAvatarDataUrl(file);
      setDraft((current) => ({ ...current, avatar }));
      setFlash(null);
    } catch (err) {
      setFlash((err as Error).message || "无法读取智能体图标。");
    }
  }

  async function probeRuntime(runtimeId = selectedId): Promise<void> {
    if (!runtimeId) return;
    setBusy("probe");
    try {
      const probe = await window.hermesAPI.probeAgentRuntime(runtimeId);
      setProbes((current) => ({ ...current, [runtimeId]: probe }));
      setProbeFailures((current) => current.filter((id) => id !== runtimeId));
      setFlash(probe.message || `检测结果：${healthLabel(probe)}`);
    } catch (err) {
      setFlash((err as Error).message || "连接检测失败。");
    } finally {
      setBusy(null);
    }
  }

  async function probeDraft(): Promise<void> {
    if (!window.hermesAPI.probeAgentRuntimeDraft) return;
    setBusy("probe");
    try {
      const probe = await window.hermesAPI.probeAgentRuntimeDraft(
        {
          ...draft,
          id: draft.id.trim(),
          name: draft.name.trim(),
          location: draft.location,
          config: {
            ...draft.config,
            endpoint: draft.config.endpoint?.trim() || undefined,
            executablePath: draft.config.executablePath?.trim() || undefined,
            workspace: draft.config.workspace?.trim() || undefined,
          },
        },
        requiresRemoteCredential ? bearerToken.trim() || undefined : undefined,
      );
      setDraftProbe(probe);
      setDraftProbeKey(draftConnectionKey);
      setFlash(probe.message || `连接测试：${healthLabel(probe)}`);
    } catch (err) {
      setDraftProbe(null);
      setDraftProbeKey(null);
      setFlash((err as Error).message || "连接测试失败。");
    } finally {
      setBusy(null);
    }
  }

  async function removeRuntime(): Promise<void> {
    if (!selectedRuntime || selectedRuntime.managed === "builtin") return;
    setBusy("remove");
    try {
      await window.hermesAPI.removeAgentRuntime(selectedRuntime.id);
      setFlash("智能体接入配置已移除。");
      await load();
      onChanged?.();
    } catch (err) {
      setFlash((err as Error).message || "无法移除智能体接入配置。");
    } finally {
      setBusy(null);
    }
  }

  async function saveBearerToken(): Promise<void> {
    if (!selectedRuntime || !bearerToken.trim()) return;
    setSavingCredential(true);
    try {
      await window.hermesAPI.setAgentRuntimeBearerToken(
        selectedRuntime.id,
        bearerToken,
      );
      setBearerToken("");
      setCredentialRevision(0);
      setCredentialConfigured(true);
      setFlash(`${credentialLabel}已保存。`);
    } catch (err) {
      setFlash((err as Error).message || "无法保存 Bridge 凭据。");
    } finally {
      setSavingCredential(false);
    }
  }

  function updateConfig(
    key: keyof AgentRuntimeDraft["config"],
    value: string | number | undefined,
  ): void {
    setDraft((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }));
  }

  async function saveWorkspaceGatewayToken(): Promise<void> {
    if (!selectedRuntime || !workspaceGatewayToken.trim()) return;
    setSavingCredential(true);
    try {
      await window.hermesAPI.setAgentRuntimeWorkspaceGatewayToken(
        selectedRuntime.id,
        workspaceGatewayToken,
      );
      setWorkspaceGatewayToken("");
      setFlash("受控工作区网关 Token 已保存。");
    } catch (err) {
      setFlash((err as Error).message || "无法保存受控工作区网关 Token。");
    } finally {
      setSavingCredential(false);
    }
  }

  return (
    <div className="settings-modal-pane">
      {flash && <div className="settings-pane-flash">{flash}</div>}

      {!embedded && <section className="settings-card agent-runtimes-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <Bot size={19} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">智能体接入</div>
            <div className="settings-card-sub">
              已接入、可用于对话和任务派发的智能体。
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void load(selectedId || undefined)}
            disabled={busy === "load"}
            title="刷新智能体"
          >
            <RefreshCw
              size={13}
              className={busy === "load" ? "settings-spin" : undefined}
            />
            刷新
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={startNewRuntime}
            title="接入智能体"
          >
            <Plus size={13} />
            接入
          </button>
        </header>

        <div className="settings-card-body">
          <div className="agent-runtime-list">
            {runtimes.map((runtime) => {
              const probe = probes[runtime.id];
              const probing = probingRuntimeIds.includes(runtime.id);
              const probeFailed = probeFailures.includes(runtime.id);
              return (
                <button
                  key={runtime.id}
                  type="button"
                  className={`agent-runtime-row ${
                    selectedId === runtime.id ? "is-active" : ""
                  }`}
                  onClick={() => selectRuntime(runtime)}
                >
                  <span className="agent-runtime-row-main">
                    <span className="agent-runtime-row-name">
                      {runtime.name}
                    </span>
                    <span className="agent-runtime-row-meta">
                      {KIND_LABELS[runtime.kind]} /{" "}
                      {runtime.location === "remote" ? "远程" : "本地"}
                    </span>
                  </span>
                  <span
                    className={`agent-runtime-status agent-runtime-status--${
                      probeFailed
                        ? "unreachable"
                        : probe?.state ||
                          (runtime.enabled ? "unknown" : "disabled")
                    }`}
                  >
                    {runtime.enabled
                      ? probing
                        ? "检测中"
                        : probeFailed
                          ? "检测失败"
                          : healthLabel(probe)
                      : "已停用"}
                  </span>
                </button>
              );
            })}
            {runtimes.length === 0 && busy === "load" && (
              <div className="agent-runtime-empty">正在加载智能体...</div>
            )}
            {runtimes.length === 0 && busy !== "load" && (
              <div className="agent-runtime-empty">尚未接入智能体。</div>
            )}
          </div>
        </div>
      </section>}

      <section
        className="settings-card agent-runtimes-card"
        data-builtin={isBuiltin || undefined}
      >
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <CheckCircle2 size={19} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {isNew ? "接入智能体" : draft.name || "智能体接入配置"}
            </div>
            <div className="settings-card-sub">
              {isBuiltin ? "内置智能体" : "自定义智能体"}
            </div>
          </div>
          {selectedRuntime && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => void probeRuntime()}
              disabled={busy === "probe" || !selectedRuntime.enabled}
              title="检测连接"
            >
              {busy === "probe" ? (
                <Loader2 size={13} className="settings-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              检测
            </button>
          )}
        </header>

        <div className="settings-card-body">
          <section
            className="agent-runtime-appearance"
            aria-label="智能体显示信息"
          >
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => void chooseAvatar(event.target.files?.[0])}
            />
            <button
              type="button"
              className="agent-runtime-avatar"
              onClick={() => avatarInputRef.current?.click()}
              title="更换智能体图标"
              aria-label="更换智能体图标"
            >
              {draft.avatar ? (
                <img src={draft.avatar} alt="" />
              ) : (
                <Bot size={18} />
              )}
            </button>
            <div
              className="agent-runtime-appearance-colors"
              aria-label="智能体颜色"
            >
              {PROFILE_COLORS.slice(0, 10).map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`agent-runtime-color ${draft.color === color ? "active" : ""}`}
                  style={{ background: color }}
                  title={color}
                  aria-label={color}
                  onClick={() => setDraft((current) => ({ ...current, color }))}
                />
              ))}
            </div>
            {selectedRuntime && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void saveAppearance()}
                disabled={busy === "appearance"}
              >
                <Save size={14} />
                保存显示信息
              </button>
            )}
          </section>
          <div className="agent-runtime-form-grid">
            <label className="settings-field">
              <span className="settings-field-label">名称</span>
              <input
                className="input"
                aria-label="名称"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">智能体 ID</span>
              <input
                className="input"
                aria-label="智能体 ID"
                value={draft.id}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    id: event.target.value,
                  }))
                }
                disabled={!!selectedRuntime}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">类型</span>
              <select
                className="input"
                aria-label="类型"
                value={draft.kind}
                onChange={(event) => {
                  const kind = event.target.value as AgentRuntimeKind;
                  if (isNew) {
                    setDraft(runtimeTemplate(kind));
                    return;
                  }
                  setDraft((current) => ({ ...current, kind }));
                }}
                disabled={isBuiltin}
              >
                {AGENT_RUNTIME_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
              {isNew && (
                <span className="settings-field-hint">
                  选择模板后仍可自定义名称、图标、可执行文件、工作目录和超时。
                </span>
              )}
            </label>

            <label className="settings-field">
              <span className="settings-field-label">连接方式</span>
              <select
                className="input"
                aria-label="连接方式"
                value={draft.config.transport || "http"}
                onChange={(event) =>
                  updateConfig(
                    "transport",
                    event.target.value as "http" | "cli",
                  )
                }
                disabled={isBuiltin}
              >
                <option value="http">HTTP</option>
                <option value="cli">CLI</option>
              </select>
            </label>
          </div>

          <div className="settings-field">
            <label className="settings-field-label">位置</label>
            <div className="settings-theme-options">
              {(["remote", "local"] as AgentRuntimeLocation[]).map(
                (location) => (
                  <button
                    key={location}
                    type="button"
                    className={`settings-theme-option ${
                      draft.location === location ? "active" : ""
                    }`}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        location,
                        config: {
                          ...current.config,
                          transport: location === "remote" ? "http" : "cli",
                        },
                      }))
                    }
                    disabled={isBuiltin}
                  >
                    {location === "remote" ? "远程" : "本地"}
                  </button>
                ),
              )}
            </div>
          </div>

          {isRemoteConnection ? (
            <>
              <label className="settings-field">
                <span className="settings-field-label">Gateway 地址</span>
                <input
                  className="input"
                  type="url"
                  aria-label="Gateway 地址"
                  value={draft.config.endpoint || ""}
                  onChange={(event) => updateConfig("endpoint", event.target.value)}
                  placeholder="https://gateway.example.com/agents-one/v1"
                  disabled={isBuiltin}
                />
                <span className="settings-field-hint">
                  填写 Relay 或 Gateway 的 v1 基础地址；远程 Hermes/OpenClaw 统一经 Gateway v1 接入（plan D5）。
                </span>
              </label>
              {requiresRemoteCredential && (
                <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                  <label className="settings-field">
                    <span className="settings-field-label">{credentialLabel}</span>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={bearerToken}
                      onChange={(event) => {
                        setBearerToken(event.target.value);
                        setCredentialRevision((current) => current + 1);
                      }}
                      placeholder={credentialConfigured ? "已配置" : credentialLabel}
                    />
                  </label>
                  {selectedRuntime && (
                    <div className="settings-card-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void saveBearerToken()}
                        disabled={savingCredential || !bearerToken.trim()}
                      >
                        {savingCredential ? (
                          <Loader2 size={14} className="settings-spin" />
                        ) : (
                          <Save size={14} />
                        )}
                        {credentialActionLabel}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {supportsRemoteWorkspaceGateway && (
                <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                  <label className="settings-field">
                    <span className="settings-field-label">受控工作区网关地址</span>
                    <input
                      className="input"
                      type="url"
                      aria-label="受控工作区网关地址"
                      value={draft.config.workspaceGatewayEndpoint || ""}
                      onChange={(event) =>
                        updateConfig("workspaceGatewayEndpoint", event.target.value)
                      }
                      placeholder="留空则使用服务地址下的 /workspace-gateway"
                    />
                    <span className="settings-field-hint">
                      远程部署独立时填写完整的 https://host/workspace-gateway；通常可留空。
                    </span>
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label">受控工作区网关 Token</span>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={workspaceGatewayToken}
                      onChange={(event) => setWorkspaceGatewayToken(event.target.value)}
                      placeholder="保存后仅存于受保护连接配置"
                    />
                    {selectedRuntime && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void saveWorkspaceGatewayToken()}
                        disabled={savingCredential || !workspaceGatewayToken.trim()}
                      >
                        <Save size={14} />
                        保存网关 Token
                      </button>
                    )}
                  </label>
                </div>
              )}
            </>
          ) : (
            <div className="agent-runtime-form-grid">
              <label className="settings-field">
                <span className="settings-field-label">可执行文件</span>
                <input
                  className="input"
                  aria-label="可执行文件"
                  value={draft.config.executablePath || ""}
                  onChange={(event) =>
                    updateConfig("executablePath", event.target.value)
                  }
                  placeholder={
                    draft.kind === "claude-code"
                      ? "claude"
                      : draft.kind === "pi"
                        ? "pi"
                        : "codex"
                  }
                  disabled={isBuiltin}
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">检测工作区（可选）</span>
                <input
                  className="input"
                  aria-label="检测工作区（可选）"
                  value={draft.config.workspace || ""}
                  onChange={(event) =>
                    updateConfig("workspace", event.target.value)
                  }
                  placeholder="留空；项目目录在任务中按需选择"
                  disabled={isBuiltin}
                />
                <span className="settings-field-hint">
                  仅用于连接检测，不会自动带入新对话或定时任务。
                </span>
              </label>
              <label className="settings-field">
                <span className="settings-field-label">模型覆盖</span>
                <input
                  className="input"
                  aria-label="模型覆盖"
                  value={draft.config.model || ""}
                  onChange={(event) =>
                    updateConfig("model", event.target.value)
                  }
                  placeholder="留空使用 CLI 默认模型"
                  disabled={isBuiltin}
                />
              </label>
            </div>
          )}

          <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
            <label className="settings-field">
              <span className="settings-field-label">超时（毫秒）</span>
              <input
                className="input"
                type="number"
                aria-label="超时（毫秒）"
                min={1000}
                max={600000}
                step={1000}
                value={draft.config.timeoutMs || DEFAULT_TIMEOUT_MS}
                onChange={(event) =>
                  updateConfig("timeoutMs", Number(event.target.value))
                }
                disabled={isBuiltin}
              />
            </label>

            <label className="agent-runtime-enabled">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                disabled={isBuiltin}
              />
              启用
            </label>
            {draft.needsReauthorization && (
              <div className="settings-field-hint">
                此远程智能体来自恢复且端点身份已变化。请先填写新的主凭据；在此之前无法启用或运行。
              </div>
            )}
          </div>

          {draft.kind === "pi" && (
            <div className="settings-field-hint agent-runtime-pi-note">
              Pi 按每个任务实际选择的项目目录和文件访问级别启动；未选择目录时不继承智能体配置中的工作区。
            </div>
          )}

          {selectedProbe && (
            <div className="agent-runtime-probe">
              <div className="agent-runtime-probe-head">
                <span
                  className={`agent-runtime-status agent-runtime-status--${selectedProbe.state}`}
                >
                  {healthLabel(selectedProbe)}
                </span>
                <span className="agent-runtime-probe-time">
                  {new Date(selectedProbe.checkedAt).toLocaleString()}
                </span>
              </div>
              {selectedProbe.message && (
                <div className="settings-field-hint">
                  {selectedProbe.message}
                </div>
              )}
              {selectedProbe.capabilities.plugin && (
                <div className="settings-field-hint">
                  已识别 Agents One 插件
                  {selectedProbe.capabilities.plugin.version
                    ? ` v${selectedProbe.capabilities.plugin.version}`
                    : ""}
                  {selectedProbe.capabilities.eventStream
                    ? "，已声明细粒度事件流。"
                    : "。"}
                </div>
              )}
              <div className="agent-runtime-capabilities">
                {trueCapabilities(selectedProbe).map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            </div>
          )}

          {!isBuiltin && (
            <div className="settings-card-actions">
              {isNew && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void probeDraft()}
                  disabled={
                    busy === "probe" ||
                    !draft.id.trim() ||
                    !draft.name.trim() ||
                    (draft.location === "remote" && !draft.config.endpoint?.trim())
                  }
                >
                  {busy === "probe" ? (
                    <Loader2 size={14} className="settings-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  连接测试
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveRuntime()}
                disabled={!canSave || busy === "save"}
              >
                {busy === "save" ? (
                  <Loader2 size={14} className="settings-spin" />
                ) : (
                  <Save size={14} />
                )}
                {isNew ? "保存" : "保存更改"}
              </button>
              {selectedRuntime && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void removeRuntime()}
                  disabled={busy === "remove"}
                >
                  <Trash2 size={14} />
                  移除
                </button>
              )}
            </div>
          )}
          {isBuiltin && embedded && (
            <div className="agent-runtime-hermes-connection">
              <div className="agent-runtime-hermes-connection-heading">
                Hermes 连接
              </div>
              <HermesConnectionManager />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
