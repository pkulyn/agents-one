import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Cloud,
  Globe2,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Signal,
  Terminal,
  Trash2,
  UserRound,
} from "lucide-react";
import type {
  AgentRuntimeDiagnostics,
  AgentRuntimeDefinition,
  AgentRuntimeDraft,
  AgentRuntimeKind,
  AgentRuntimeLocation,
  AgentRuntimeProbe,
} from "../../../../shared/agent-runtimes";
import { deriveAgentRuntimeConnectionProfile } from "../../../../shared/agent-runtimes";
import type {
  ConnectPairingPreview,
  ConnectRuntimeDescriptor,
} from "../../../../shared/agents-one-connect";
import {
  BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS,
  manifestForRuntimeKind,
  type AgentRuntimeAdapterManifest,
} from "../../../../shared/runtime-adapters";
import { PROFILE_COLORS } from "../../../../shared/profileColors";
import { dispatchAgentsOneEvent } from "../../utils/brandMigration";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import ConnectionPane from "./ConnectionPane";
import { SettingsDataContext } from "./SettingsDataContext";
import { useSettingsData } from "./useSettingsData";

const DEFAULT_TIMEOUT_MS = 300_000;
type NewAgentType = "local" | "remote" | "web";

const KIND_LABELS: Record<string, string> = {
  hermes: "Hermes Agent Runtime",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "Pi Agent CLI",
  opencode: "OpenCode",
  openclaw: "OpenClaw",
  "web-agent": "网页智能体（实验性）",
};

const STANDARD_ADAPTER_FIELD_KEYS = new Set([
  "endpoint",
  "bearerToken",
  "executablePath",
  "model",
  "workspace",
  "timeoutMs",
  "webAgent",
]);

function HermesConnectionManager(): React.JSX.Element {
  const data = useSettingsData();
  return (
    <SettingsDataContext.Provider value={data}>
      <ConnectionPane />
    </SettingsDataContext.Provider>
  );
}

function runtimeConnectionLabel(runtime: AgentRuntimeDefinition): string {
  if (runtime.managed === "builtin") return "内置";
  const profile = deriveAgentRuntimeConnectionProfile(runtime);
  if (profile === "local") return "本地";
  if (profile === "managed-connect") {
    return runtime.config.connect?.runtimeId ? "已配对" : "待配对";
  }
  return "手动直连";
}

function runtimeTemplate(
  kind: AgentRuntimeKind,
  detected: Record<string, string | null> = {},
  selectedManifest?: AgentRuntimeAdapterManifest,
  locationOverride?: AgentRuntimeLocation,
): AgentRuntimeDraft {
  const manifest = selectedManifest || manifestForRuntimeKind(kind);
  const metadata = manifest
    ? {
        adapterId: manifest.adapterId,
        vendorId: manifest.vendorId,
        adapterVersion: manifest.adapterVersion,
      }
    : {};
  if (kind === "web-agent") {
    return {
      id: "doubao-web",
      name: "豆包网页版",
      kind,
      connectionProfile: "local",
      ...metadata,
      location: "local",
      enabled: true,
      config: {
        agentTransport: "local-web",
        timeoutMs: DEFAULT_TIMEOUT_MS,
        webAgent: {
          provider: "doubao",
          profileId: "default",
          adapterVersion: "1.0.0",
          enabled: true,
        },
      },
    };
  }
  if (kind === "hermes" && locationOverride === "local") {
    return {
      id: "hermes-local",
      name: manifest?.displayName || "Hermes Agent Runtime",
      kind,
      connectionProfile: "local",
      ...metadata,
      location: "local",
      enabled: true,
      config: {
        transport: "http",
        agentTransport: "local-api",
        hermes: { mode: "local" },
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }
  if (locationOverride !== "remote" && manifest?.localCliCommand) {
    return {
      id: kind === "pi" ? "pi-agent" : `${kind}-local`,
      name: manifest.displayName,
      kind,
      connectionProfile: "local",
      ...metadata,
      location: "local",
      enabled: true,
      config: {
        // Auto-fill the PATH-detected executable; fall back to the bare
        // command name so the form still works when detection is empty.
        executablePath: detected[kind] || manifest.localCliCommand,
        transport: "cli",
        agentTransport: "local-cli",
        timeoutMs: DEFAULT_TIMEOUT_MS,
      },
    };
  }
  // Hermes (and any remote agent kind) connects via Gateway v1 — the legacy
  // Hermes/OpenClaw remote transports were removed (plan D5).
  return {
    id: `${kind}-gateway`,
    name: manifest?.displayName || "Gateway Agent",
    kind,
    connectionProfile: "managed-connect",
    ...metadata,
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
    connectionProfile: deriveAgentRuntimeConnectionProfile(runtime),
    adapterId: runtime.adapterId,
    vendorId: runtime.vendorId,
    adapterVersion: runtime.adapterVersion,
    authRef: runtime.authRef,
    capabilitySnapshot: runtime.capabilitySnapshot,
    lastProbe: runtime.lastProbe,
    configurationIssue: runtime.configurationIssue,
    location: runtime.location,
    enabled: runtime.enabled,
    needsReauthorization: runtime.needsReauthorization,
    color: runtime.color,
    avatar: runtime.avatar,
    config: {
      ...runtime.config,
      ...(runtime.config.adapterOptions
        ? { adapterOptions: { ...runtime.config.adapterOptions } }
        : {}),
      ...(runtime.config.acpArgs
        ? { acpArgs: [...runtime.config.acpArgs] }
        : {}),
    },
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
  onCancel?: () => void;
}

interface ConnectPairingView {
  sessionId: string;
  pairingCode: string;
  runtimeId: string;
  displayName: string;
  expiresAt: number;
  connectEndpoint: string;
  tunnelEndpoint: string;
}

export default function AgentRuntimesPane({
  initialRuntimeId,
  startNew = false,
  embedded = false,
  onChanged,
  onCancel,
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
  const [diagnostics, setDiagnostics] =
    useState<AgentRuntimeDiagnostics | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  // PATH-detected local CLI executables (plan 1.5) — auto-fill the executable
  // path when the user starts a local CLI template.
  const [localCliPaths, setLocalCliPaths] = useState<
    Record<string, string | null>
  >({});
  const [adapterManifests, setAdapterManifests] = useState<
    AgentRuntimeAdapterManifest[]
  >(() => [...BUILTIN_AGENT_RUNTIME_ADAPTER_MANIFESTS]);
  const [connectPairing, setConnectPairing] =
    useState<ConnectPairingView | null>(null);
  const [connectPairingState, setConnectPairingState] = useState<
    "pending" | "paired" | "expired" | null
  >(null);
  const [connectorPairingCode, setConnectorPairingCode] = useState("");
  const [connectorPairingPreview, setConnectorPairingPreview] =
    useState<ConnectPairingPreview | null>(null);
  const [newAgentStep, setNewAgentStep] = useState<1 | 2 | 3>(1);
  const [newAgentType, setNewAgentType] = useState<NewAgentType>("remote");
  const [hermesCandidates, setHermesCandidates] = useState<
    Array<{
      home: string;
      repoPath: string;
      pythonPath: string;
      scriptPath: string;
      source: "active-home" | "environment" | "default-home" | "path";
      valid: boolean;
      executableAvailable: boolean;
      configState: "configured" | "missing" | "invalid";
      apiState:
        | "unknown"
        | "healthy"
        | "unreachable"
        | "not-running"
        | "unrelated";
      version?: string;
    }>
  >([]);
  const [hermesDiscoveryBusy, setHermesDiscoveryBusy] = useState(false);

  useEffect(() => {
    if (!window.agentsOneAPI.detectLocalCliPaths) return;
    window.agentsOneAPI
      .detectLocalCliPaths()
      .then(setLocalCliPaths)
      .catch(() => {
        /* best-effort — detection is a convenience, not a requirement */
      });
  }, []);

  useEffect(() => {
    if (!window.agentsOneAPI.listAgentRuntimeAdapters) return;
    window.agentsOneAPI
      .listAgentRuntimeAdapters()
      .then((manifests) => setAdapterManifests(manifests))
      .catch(() => {
        /* built-in manifests remain available as a safe renderer fallback */
      });
  }, []);

  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === selectedId) || null,
    [runtimes, selectedId],
  );
  const selectedProbe = selectedId ? probes[selectedId] : undefined;
  const isNew = selectedId === null;
  const isBuiltin = selectedRuntime?.managed === "builtin";
  const isRemoteConnection = draft.location === "remote";
  const isLocalHermesAdoption =
    isNew && newAgentType === "local" && draft.kind === "hermes";
  const remoteConnectionProfile = isRemoteConnection
    ? deriveAgentRuntimeConnectionProfile(draft)
    : undefined;
  const isWebAgent =
    draft.kind === "web-agent" && Boolean(draft.config.webAgent);

  useEffect(() => {
    if (
      !isLocalHermesAdoption ||
      !window.agentsOneAPI.discoverHermesInstallations
    ) {
      return;
    }
    setHermesDiscoveryBusy(true);
    window.agentsOneAPI
      .discoverHermesInstallations()
      .then(setHermesCandidates)
      .catch(() => setHermesCandidates([]))
      .finally(() => setHermesDiscoveryBusy(false));
  }, [isLocalHermesAdoption]);
  const manifestForDraft = adapterManifests.find(
    (manifest) =>
      manifest.adapterId === draft.adapterId ||
      manifest.kinds.includes(draft.kind),
  );
  const dynamicAdapterFields = useMemo(
    () =>
      (manifestForDraft?.fields || []).filter(
        (field) =>
          !STANDARD_ADAPTER_FIELD_KEYS.has(field.key) &&
          !field.secret &&
          // 默认 Agent / ACP 参数属于旧版 CLI 高级选项。新建本地智能体
          // 只需配置可执行文件和超时，保留读取能力以兼容既有运行时。
          !(
            isNew &&
            draft.location === "local" &&
            (field.key === "agent" || field.key === "acpArgs")
          ),
      ),
    [draft.location, isNew, manifestForDraft],
  );
  const newRuntimeKinds = useMemo<AgentRuntimeKind[]>(() => {
    const manifests = adapterManifests.filter((manifest) => {
      if (newAgentType === "local") {
        return (
          (manifest.locations.includes("local") &&
            Boolean(manifest.localCliCommand)) ||
          manifest.adapterId === "hermes"
        );
      }
      if (newAgentType === "remote") {
        return manifest.locations.includes("remote");
      }
      return manifest.kinds.includes("web-agent");
    });
    return manifests.flatMap((manifest) =>
      manifest.kinds.map((kind) => kind as AgentRuntimeKind),
    );
  }, [adapterManifests, newAgentType]);
  const usesUnifiedGateway =
    isRemoteConnection &&
    draft.config.remoteGateway?.protocol === "agents-one-v1";
  const requiresRemoteCredential =
    !isBuiltin &&
    usesUnifiedGateway &&
    remoteConnectionProfile === "self-hosted-gateway";
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
    model: draft.config.model?.trim() || "",
    agent: draft.config.agent?.trim() || "",
    acpArgs: draft.config.acpArgs || [],
    adapterOptions: draft.config.adapterOptions || {},
    connectionProfile:
      remoteConnectionProfile || draft.connectionProfile || null,
    timeoutMs: draft.config.timeoutMs || DEFAULT_TIMEOUT_MS,
    credentialRevision,
  });
  const requiresPairing =
    isRemoteConnection && remoteConnectionProfile === "managed-connect";
  const pairingNotCompleted =
    requiresPairing && !draft.config.connect?.runtimeId;
  const requiresSelfHostedGatewayProbe =
    isRemoteConnection &&
    usesUnifiedGateway &&
    remoteConnectionProfile === "self-hosted-gateway";
  const selfHostedGatewayProbeReady =
    draftProbe?.state === "healthy" && draftProbeKey === draftConnectionKey;
  const canSave =
    !isBuiltin &&
    !pairingNotCompleted &&
    draft.id.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    (draft.location === "local" || !!draft.config.endpoint?.trim()) &&
    (!draft.needsReauthorization || bearerToken.trim().length >= 8) &&
    (!requiresSelfHostedGatewayProbe || selfHostedGatewayProbeReady) &&
    (!isNew ||
      isWebAgent ||
      (draftProbe?.state === "healthy" &&
        draftProbeKey === draftConnectionKey));

  async function loadCredentialStatus(runtimeId: string | null): Promise<void> {
    if (!runtimeId || !window.agentsOneAPI.getAgentRuntimeCredentialStatus) {
      setCredentialConfigured(false);
      return;
    }
    try {
      const status =
        await window.agentsOneAPI.getAgentRuntimeCredentialStatus(runtimeId);
      setCredentialConfigured(status.configured);
    } catch {
      setCredentialConfigured(false);
    }
  }

  async function load(preferredId?: string): Promise<void> {
    setBusy("load");
    try {
      const next = await window.agentsOneAPI.listAgentRuntimes();
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
      setDiagnostics(null);
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
            probe: await window.agentsOneAPI.probeAgentRuntime(runtime.id),
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
    // This is an intentional one-time pane initialization; these functions
    // are render-local and including them would restart the load on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setDiagnostics(null);
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
    setDiagnostics(null);
    setCredentialConfigured(false);
    setConnectPairing(null);
    setConnectPairingState(null);
    setConnectorPairingCode("");
    setConnectorPairingPreview(null);
    setNewAgentStep(1);
    setNewAgentType("remote");
  }

  function selectNewAgentType(type: NewAgentType): void {
    const kind =
      type === "local" ? "codex" : type === "web" ? "web-agent" : "hermes";
    setNewAgentType(type);
    setDraft(
      runtimeTemplate(
        kind,
        localCliPaths,
        undefined,
        type === "local" ? "local" : type === "remote" ? "remote" : undefined,
      ),
    );
    setDraftProbe(null);
    setDraftProbeKey(null);
    setFlash(null);
  }

  function selectNewAgentKind(kind: AgentRuntimeKind): void {
    const manifest = adapterManifests.find((item) => item.kinds.includes(kind));
    const next = runtimeTemplate(
      kind,
      localCliPaths,
      manifest,
      newAgentType === "local"
        ? "local"
        : newAgentType === "remote"
          ? "remote"
          : undefined,
    );
    setDraft((current) => ({
      ...next,
      color: current.color,
      avatar: current.avatar,
    }));
    setDraftProbe(null);
    setDraftProbeKey(null);
  }

  function selectRemoteConnectionProfile(
    profile: "managed-connect" | "self-hosted-gateway",
  ): void {
    if (!isRemoteConnection) return;
    const previous = deriveAgentRuntimeConnectionProfile(draft);
    if (
      selectedRuntime &&
      previous !== profile &&
      !window.confirm(
        `确定将“${draft.name || selectedRuntime.name}”的远程接入方式切换为“${profile === "managed-connect" ? "校验码配对" : "自托管 Gateway"}”吗？现有接入凭据不会自动转换。`,
      )
    ) {
      return;
    }
    setDraft((current) => ({
      ...current,
      connectionProfile: profile,
      config: {
        ...current.config,
        ...(profile === "self-hosted-gateway" ? { connect: undefined } : {}),
        remoteGateway: { protocol: "agents-one-v1" },
        transport: "http",
        agentTransport: "gateway-v1",
      },
    }));
    setDraftProbe(null);
    setDraftProbeKey(null);
    setConnectPairing(null);
    setConnectPairingState(null);
    setConnectorPairingCode("");
  }

  function hermesDiscoverySourceLabel(
    source: "active-home" | "environment" | "default-home" | "path",
  ): string {
    return {
      "active-home": "当前采用目录",
      environment: "HERMES_HOME",
      "default-home": "默认目录",
      path: "PATH 可执行文件",
    }[source];
  }

  function hermesConfigStateLabel(
    state: "configured" | "missing" | "invalid",
  ): string {
    return {
      configured: "配置已发现",
      missing: "未发现配置",
      invalid: "配置文件异常",
    }[state];
  }

  function hermesApiStateLabel(
    state: "unknown" | "healthy" | "unreachable" | "not-running" | "unrelated",
  ): string {
    return {
      unknown: "API 未检查",
      healthy: "本地 API 正常",
      unreachable: "本地 API 不可达",
      "not-running": "本地 API 未运行",
      unrelated: "端口由其他进程占用",
    }[state];
  }

  async function chooseHermesHome(): Promise<void> {
    if (!window.agentsOneAPI.selectHermesHome) return;
    const home = await window.agentsOneAPI.selectHermesHome();
    if (!home) return;
    const valid = await window.agentsOneAPI.validateHermesHome(home);
    if (!valid) {
      setFlash(
        "该目录不是可直接采用的 Hermes Agent Runtime 安装，未写入任何配置。",
      );
      return;
    }
    setHermesCandidates((current) => [
      {
        home,
        repoPath: `${home}\\hermes-agent`,
        pythonPath: `${home}\\hermes-agent\\venv\\Scripts\\python.exe`,
        scriptPath: `${home}\\hermes-agent\\venv\\Scripts\\hermes.exe`,
        source: "path",
        valid: true,
        executableAvailable: true,
        configState: "missing",
        apiState: "unknown",
      },
      ...current.filter((candidate) => candidate.home !== home),
    ]);
    setFlash("已校验 Hermes Agent Runtime 安装，请点击“使用此安装”。");
  }

  async function adoptHermesHome(home: string): Promise<void> {
    setHermesDiscoveryBusy(true);
    try {
      const valid = await window.agentsOneAPI.validateHermesHome(home);
      if (!valid) {
        setFlash("Hermes Agent Runtime 安装校验失败，当前配置未改变。");
        return;
      }
      const adopted = await window.agentsOneAPI.adoptHermesHome(home);
      if (!adopted) {
        setFlash("无法采用该 Hermes Agent Runtime 安装，当前配置未改变。");
        return;
      }
      const reloadNow = window.confirm(
        "Hermes Agent Runtime 安装已采用。现在重载 Agents One 以立即生效吗？选择“否”将在下次启动时生效。",
      );
      if (reloadNow) {
        setFlash("Hermes Agent Runtime 安装已采用，正在重载 Agents One…");
        await window.agentsOneAPI.relaunchApp();
      } else {
        setFlash(
          "Hermes Agent Runtime 安装已采用，将在下次启动 Agents One 时生效。",
        );
      }
    } catch (err) {
      setFlash(
        (err as Error).message || "无法采用 Hermes Agent Runtime 安装。",
      );
    } finally {
      setHermesDiscoveryBusy(false);
    }
  }

  function runtimeKindLabel(kind: AgentRuntimeKind): string {
    return (
      adapterManifests.find((manifest) => manifest.kinds.includes(kind))
        ?.displayName ||
      KIND_LABELS[kind] ||
      kind
    );
  }

  async function claimConnectorPairingCode(): Promise<void> {
    const code = connectorPairingCode.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z2-9]{10}$/.test(code)) {
      setFlash("接入校验码应为 10 位字母或数字。");
      return;
    }
    try {
      const preview = await window.agentsOneAPI.previewAgentsOneConnectPairingCode(
        code,
        draft.id.trim() || undefined,
      );
      setConnectorPairingPreview(preview);
      setFlash("已找到远端设备，请核对设备指纹和 Runtime 清单后确认接入。");
    } catch (err) {
      setFlash((err as Error).message || "接入校验码无效或已过期。");
    }
  }

  async function confirmConnectorPairing(): Promise<void> {
    if (!connectorPairingPreview) return;
    try {
      const saved =
        await window.agentsOneAPI.completeAgentsOneConnectPairingPreview(
          connectorPairingPreview.sessionId,
          {
            ...draft,
            id: draft.id.trim(),
            name: draft.name.trim(),
          },
        );
      setConnectorPairingCode("");
      setConnectorPairingPreview(null);
      setFlash("已确认接入，远程智能体已保存。");
      await load(saved.id);
      onChanged?.();
    } catch (err) {
      setFlash((err as Error).message || "配对确认失败，请重新输入校验码。");
    }
  }

  async function startConnectPairing(): Promise<void> {
    if (!draft.id.trim() || !draft.name.trim()) {
      setFlash("请先填写智能体 ID 和名称，再生成 Connect 配对码。");
      return;
    }
    try {
      const session = await window.agentsOneAPI.createAgentsOneConnectPairing(
        draft.id.trim(),
        draft.name.trim(),
      );
      setConnectPairing(session);
      setConnectPairingState("pending");
      setFlash(
        "配对码已生成。请在远端智能体安装 Agents One Connector CLI 后输入该码。",
      );
    } catch (err) {
      setFlash((err as Error).message || "无法生成 Connect 配对码。");
    }
  }

  async function refreshConnectPairing(): Promise<void> {
    if (!connectPairing) return;
    try {
      const status = await window.agentsOneAPI.getAgentsOneConnectPairingStatus(
        connectPairing.sessionId,
      );
      setConnectPairingState(status.state);
      if (status.state === "paired") {
        const saved = await window.agentsOneAPI.completeAgentsOneConnectPairing(
          connectPairing.sessionId,
          {
            ...draft,
            id: draft.id.trim(),
            name: draft.name.trim(),
          },
        );
        setConnectPairing(null);
        setFlash("Connect 配对完成，远程智能体已保存。");
        await load(saved.id);
        onChanged?.();
      }
    } catch (err) {
      setFlash((err as Error).message || "无法读取 Connect 配对状态。");
    }
  }

  async function saveRuntime(): Promise<void> {
    if (!canSave) return;
    setBusy("save");
    try {
      const saved = await window.agentsOneAPI.saveAgentRuntime({
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
        await window.agentsOneAPI.saveAgentRuntimeAppearance(saved.id, {
          name: saved.name,
          color: draft.color,
          avatar: draft.avatar,
        });
      }
      if (
        saved.config.remoteGateway?.protocol === "agents-one-v1" &&
        bearerToken.trim()
      ) {
        await window.agentsOneAPI.setAgentRuntimeBearerToken(
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
        await window.agentsOneAPI.setAgentRuntimeWorkspaceGatewayToken(
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
      const saved = await window.agentsOneAPI.saveAgentRuntimeAppearance(
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
      dispatchAgentsOneEvent("runtimeChanged");
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
      const probe = await window.agentsOneAPI.probeAgentRuntime(runtimeId);
      setProbes((current) => ({ ...current, [runtimeId]: probe }));
      if (runtimeId === selectedId) {
        setDraftProbe(probe);
        setDraftProbeKey(draftConnectionKey);
      }
      setProbeFailures((current) => current.filter((id) => id !== runtimeId));
      setFlash(probe.message || `检测结果：${healthLabel(probe)}`);
    } catch (err) {
      if (runtimeId === selectedId) {
        setDraftProbe(null);
        setDraftProbeKey(null);
      }
      setFlash((err as Error).message || "连接检测失败。");
    } finally {
      setBusy(null);
    }
  }

  async function loadDiagnostics(runtimeId = selectedId): Promise<void> {
    if (!runtimeId || !window.agentsOneAPI.getAgentRuntimeDiagnostics) return;
    setDiagnosticsBusy(true);
    try {
      setDiagnostics(
        await window.agentsOneAPI.getAgentRuntimeDiagnostics(runtimeId),
      );
    } catch (err) {
      setFlash((err as Error).message || "无法读取智能体诊断信息。");
      setDiagnostics(null);
    } finally {
      setDiagnosticsBusy(false);
    }
  }

  async function openWebAgentWindow(): Promise<void> {
    if (!selectedRuntime || !window.agentsOneAPI.openWebAgentRuntime) return;
    setBusy("probe");
    try {
      await window.agentsOneAPI.openWebAgentRuntime(selectedRuntime.id);
      setFlash(
        "豆包窗口已在 Agents One 内打开。登录或验证完成后可返回此处重新检测。",
      );
    } catch (err) {
      setFlash((err as Error).message || "无法打开豆包窗口。");
    } finally {
      setBusy(null);
    }
  }

  async function clearWebAgentLogin(): Promise<void> {
    if (!selectedRuntime || !window.agentsOneAPI.clearWebAgentRuntimeLogin) return;
    setBusy("remove");
    try {
      await window.agentsOneAPI.clearWebAgentRuntimeLogin(selectedRuntime.id);
      setFlash("已清除豆包本地登录数据；Runtime 配置仍保留。");
      await probeRuntime(selectedRuntime.id);
    } catch (err) {
      setFlash((err as Error).message || "无法清除豆包登录数据。");
    } finally {
      setBusy(null);
    }
  }

  async function probeDraft(): Promise<void> {
    if (!window.agentsOneAPI.probeAgentRuntimeDraft) return;
    setBusy("probe");
    try {
      const probe = await window.agentsOneAPI.probeAgentRuntimeDraft(
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
      const clearWebLogin =
        selectedRuntime.kind === "web-agent" &&
        Boolean(window.agentsOneAPI.clearWebAgentRuntimeLogin) &&
        window.confirm(
          "是否同时清除豆包网页登录数据？点击“取消”将只移除 Runtime 配置，保留登录态。",
        );
      if (clearWebLogin) {
        await window.agentsOneAPI.clearWebAgentRuntimeLogin(selectedRuntime.id);
      }
      await window.agentsOneAPI.removeAgentRuntime(selectedRuntime.id);
      setFlash(
        clearWebLogin
          ? "智能体接入配置和豆包网页登录数据已移除。"
          : "智能体接入配置已移除。",
      );
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
      await window.agentsOneAPI.setAgentRuntimeBearerToken(
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
    value: string | number | boolean | undefined,
  ): void {
    setDraft((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
    }));
  }

  function updateAdapterField(
    field: AgentRuntimeAdapterManifest["fields"][number],
    value: string | number | boolean | undefined,
  ): void {
    if (field.key === "acpArgs") {
      const acpArgs =
        typeof value === "string"
          ? value
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean)
          : [];
      setDraft((current) => ({
        ...current,
        config: {
          ...current.config,
          ...(acpArgs.length ? { acpArgs } : { acpArgs: undefined }),
        },
      }));
      return;
    }
    if (
      field.key === "endpoint" ||
      field.key === "executablePath" ||
      field.key === "model" ||
      field.key === "workspace" ||
      field.key === "timeoutMs" ||
      field.key === "agent"
    ) {
      updateConfig(field.key as keyof AgentRuntimeDraft["config"], value);
      return;
    }
    setDraft((current) => {
      const adapterOptions = { ...(current.config.adapterOptions || {}) };
      if (value === undefined || value === "") delete adapterOptions[field.key];
      else adapterOptions[field.key] = value;
      return {
        ...current,
        config: {
          ...current.config,
          ...(Object.keys(adapterOptions).length ? { adapterOptions } : {}),
        },
      };
    });
  }

  function adapterFieldValue(
    field: AgentRuntimeAdapterManifest["fields"][number],
  ): string | number | boolean {
    if (field.key === "acpArgs") return (draft.config.acpArgs || []).join("\n");
    const direct = draft.config[field.key as keyof typeof draft.config];
    if (
      typeof direct === "string" ||
      typeof direct === "number" ||
      typeof direct === "boolean"
    ) {
      return direct;
    }
    return (
      draft.config.adapterOptions?.[field.key] ??
      (field.type === "boolean" ? false : "")
    );
  }

  async function saveWorkspaceGatewayToken(): Promise<void> {
    if (!selectedRuntime || !workspaceGatewayToken.trim()) return;
    setSavingCredential(true);
    try {
      await window.agentsOneAPI.setAgentRuntimeWorkspaceGatewayToken(
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

      {!embedded && (
        <section className="settings-card agent-runtimes-card">
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
                        {runtimeKindLabel(runtime.kind)} /{" "}
                        {runtime.location === "remote" ? "远程" : "本地"} ·{" "}
                        {runtimeConnectionLabel(runtime)}
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
        </section>
      )}

      <section
        className={`settings-card agent-runtimes-card ${isNew && embedded ? "agent-runtimes-card--onboarding" : ""}`}
        data-builtin={isBuiltin || undefined}
      >
        {!(isNew && embedded) && (
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
              <>
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
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void loadDiagnostics()}
                  disabled={diagnosticsBusy}
                  title="查看分层诊断"
                >
                  {diagnosticsBusy ? (
                    <Loader2 size={13} className="settings-spin" />
                  ) : (
                    <Signal size={13} />
                  )}
                  诊断
                </button>
              </>
            )}
          </header>
        )}

        <div className="settings-card-body">
          {selectedRuntime &&
            draft.location === "remote" &&
            usesUnifiedGateway && (
              <div
                className="settings-field-hint agent-runtime-connection-summary"
                data-testid="agent-runtime-connection-summary"
              >
                接入来源：
                {remoteConnectionProfile === "managed-connect"
                  ? draft.config.connect?.runtimeId
                    ? "校验码配对（已配对）"
                    : "校验码配对（未完成）"
                  : "自托管 Gateway（手动直连）"}
              </div>
            )}
          {draft.configurationIssue && (
            <div
              className="settings-pane-flash"
              role="alert"
              data-testid="agent-runtime-configuration-issue"
            >
              {draft.configurationIssue.message}
            </div>
          )}
          {isNew && (
            <>
              <ol
                className="agent-onboarding-steps"
                aria-label="新增智能体步骤"
              >
                {(
                  [
                    [1, "选择类型"],
                    [2, "基础信息"],
                    [3, "连接设置"],
                  ] as const
                ).map(([step, label]) => (
                  <li
                    className={
                      newAgentStep === step
                        ? "is-active"
                        : newAgentStep > step
                          ? "is-complete"
                          : ""
                    }
                    key={step}
                  >
                    <span>{step}</span>
                    <strong>{label}</strong>
                  </li>
                ))}
              </ol>

              {newAgentStep === 1 && (
                <section
                  className="agent-onboarding-type-picker"
                  aria-labelledby="agent-onboarding-type-title"
                >
                  <div>
                    <h3 id="agent-onboarding-type-title">选择要接入的智能体</h3>
                    <p>根据运行位置选择，后续仅展示必要配置。</p>
                  </div>
                  <div className="agent-onboarding-type-options">
                    <button
                      type="button"
                      className={newAgentType === "local" ? "is-selected" : ""}
                      aria-pressed={newAgentType === "local"}
                      onClick={() => selectNewAgentType("local")}
                    >
                      <span className="agent-onboarding-type-icon agent-onboarding-type-icon--local">
                        <Terminal size={22} />
                      </span>
                      <strong>本地智能体</strong>
                      <small>在当前电脑运行的智能体CLI或服务</small>
                      {newAgentType === "local" && <i aria-hidden="true">✓</i>}
                    </button>
                    <button
                      type="button"
                      className={newAgentType === "remote" ? "is-selected" : ""}
                      aria-pressed={newAgentType === "remote"}
                      onClick={() => selectNewAgentType("remote")}
                    >
                      <span className="agent-onboarding-type-icon agent-onboarding-type-icon--remote">
                        <Cloud size={22} />
                      </span>
                      <strong>远程智能体</strong>
                      <small>连接远端服务器或电脑上的智能体</small>
                      {newAgentType === "remote" && <i aria-hidden="true">✓</i>}
                    </button>
                    <button
                      type="button"
                      className={newAgentType === "web" ? "is-selected" : ""}
                      aria-pressed={newAgentType === "web"}
                      onClick={() => selectNewAgentType("web")}
                    >
                      <span className="agent-onboarding-type-icon agent-onboarding-type-icon--web">
                        <Globe2 size={22} />
                      </span>
                      <strong>网页智能体</strong>
                      <small>在隔离浏览器中连接网页端智能体服务</small>
                      {newAgentType === "web" && <i aria-hidden="true">✓</i>}
                    </button>
                  </div>
                  <div className="agent-onboarding-preview">
                    <strong>下一步将需要</strong>
                    <span className="agent-onboarding-preview-item">
                      <span className="agent-onboarding-preview-icon">
                        <UserRound size={16} aria-hidden="true" />
                      </span>
                      基础信息：头像、名称、智能体 ID
                    </span>
                    <span className="agent-onboarding-preview-item">
                      <span className="agent-onboarding-preview-icon">
                        <Link2 size={16} aria-hidden="true" />
                      </span>
                      {newAgentType === "local"
                        ? "本地连接：可执行文件"
                        : newAgentType === "web"
                          ? "网页连接：Provider"
                          : "远程连接：校验码配对或自托管 Gateway"}
                    </span>
                  </div>
                </section>
              )}
            </>
          )}

          {(!isNew || newAgentStep === 2) && (
            <>
              <section
                className="agent-runtime-appearance"
                aria-label="智能体显示信息"
              >
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  hidden
                  onChange={(event) =>
                    void chooseAvatar(event.target.files?.[0])
                  }
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
                      onClick={() =>
                        setDraft((current) => ({ ...current, color }))
                      }
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
                      const manifest = adapterManifests.find((item) =>
                        item.kinds.includes(kind),
                      );
                      if (isNew) {
                        selectNewAgentKind(kind);
                        return;
                      }
                      setDraft((current) => {
                        if (kind === "web-agent") {
                          return {
                            ...current,
                            kind,
                            adapterId: manifest?.adapterId,
                            vendorId: manifest?.vendorId,
                            adapterVersion: manifest?.adapterVersion,
                            location: "local",
                            config: {
                              ...current.config,
                              agentTransport: "local-web",
                              webAgent: {
                                provider: "doubao",
                                profileId:
                                  current.config.webAgent?.profileId ||
                                  "default",
                                adapterVersion:
                                  current.config.webAgent?.adapterVersion ||
                                  "1.0.0",
                                enabled:
                                  current.config.webAgent?.enabled !== false,
                              },
                            },
                          };
                        }
                        const { webAgent: _webAgent, ...config } =
                          current.config;
                        return {
                          ...current,
                          kind,
                          adapterId: manifest?.adapterId,
                          vendorId: manifest?.vendorId,
                          adapterVersion: manifest?.adapterVersion,
                          config: {
                            ...config,
                            agentTransport:
                              kind === "hermes" || current.location === "remote"
                                ? "gateway-v1"
                                : "local-cli",
                          },
                        };
                      });
                    }}
                    disabled={isBuiltin}
                  >
                    {(isNew
                      ? newRuntimeKinds
                      : Array.from(
                          new Set([
                            ...adapterManifests.flatMap(
                              (manifest) => manifest.kinds,
                            ),
                            draft.kind,
                          ]),
                        )
                    ).map((kind) => (
                      <option key={kind} value={kind}>
                        {runtimeKindLabel(kind as AgentRuntimeKind)}
                      </option>
                    ))}
                  </select>
                  {isNew && (
                    <span className="settings-field-hint">
                      {manifestForDraft?.description ||
                        "选择模板后仍可自定义名称、图标、连接参数和超时。"}
                    </span>
                  )}
                </label>

                {!isWebAgent && !isNew && (
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
                      // For a new agent the transport is derived from the template:
                      // remote (Gateway v1) → http, local CLI → cli (plan 1.5).
                      disabled={isBuiltin || isNew}
                    >
                      <option value="http">HTTP</option>
                      <option value="cli">CLI</option>
                    </select>
                  </label>
                )}
              </div>

              {!isWebAgent && !isNew && (
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
                                transport:
                                  location === "remote" ? "http" : "cli",
                              },
                            }))
                          }
                          // For a new agent the location is derived from the chosen
                          // template (Hermes → remote Gateway, others → local CLI).
                          disabled={isBuiltin || isNew}
                        >
                          {location === "remote" ? "远程" : "本地"}
                        </button>
                      ),
                    )}
                  </div>
                  {isNew && (
                    <span className="settings-field-hint">
                      由模板决定：Hermes 可采用本机已有安装，其余为本地 CLI
                      （可执行文件路径）。
                    </span>
                  )}
                </div>
              )}
            </>
          )}

          {(!isNew || newAgentStep === 3) &&
            (isWebAgent ? (
              <div className="settings-field">
                <span className="settings-field-label">
                  网页智能体（实验性）
                </span>
                <span className="settings-field-hint">
                  Agents One
                  将在隔离浏览器会话中使用你的网页登录态。正常任务不打开外部浏览器；登录、验证码或页面确认时会在应用内接管。网页没有工作区或
                  Shell 权限，仅能读取本轮明确添加的附件。
                </span>
                <label className="settings-field">
                  <span className="settings-field-label">Provider</span>
                  <select
                    className="input"
                    aria-label="网页 Provider"
                    value={draft.config.webAgent?.provider || "doubao"}
                    onChange={(event) => {
                      const provider = event.target.value as
                        | "doubao"
                        | "chatgpt"
                        | "grok";
                      setDraft((current) => ({
                        ...current,
                        id: ["doubao-web", "chatgpt-web", "grok-web"].includes(
                          current.id,
                        )
                          ? `${provider}-web`
                          : current.id,
                        name:
                          provider === "chatgpt"
                            ? "ChatGPT 网页版"
                            : provider === "grok"
                              ? "Grok 网页版"
                              : "豆包网页版",
                        config: {
                          ...current.config,
                          webAgent: {
                            provider,
                            profileId:
                              current.config.webAgent?.profileId || "default",
                            adapterVersion:
                              current.config.webAgent?.adapterVersion ||
                              "1.0.0",
                            enabled: current.config.webAgent?.enabled !== false,
                          },
                        },
                      }));
                    }}
                    disabled={Boolean(selectedRuntime)}
                  >
                    <option value="doubao">豆包</option>
                    <option value="chatgpt">ChatGPT</option>
                    <option value="grok">Grok</option>
                  </select>
                </label>
                <span className="settings-field-hint">
                  当前 Provider：
                  {draft.config.webAgent?.provider === "chatgpt"
                    ? "ChatGPT"
                    : draft.config.webAgent?.provider === "grok"
                      ? "Grok"
                      : "豆包"}
                  ；适配器版本：
                  {draft.config.webAgent?.adapterVersion || "未知"}
                  。网页兼容能力为实验性功能。
                </span>
                <label className="settings-field">
                  <span className="settings-field-label">本地网页登录档案</span>
                  <input
                    className="input"
                    aria-label="本地网页登录档案"
                    value={draft.config.webAgent?.profileId || "default"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        config: {
                          ...current.config,
                          webAgent: {
                            provider:
                              current.config.webAgent?.provider || "doubao",
                            profileId: event.target.value,
                            adapterVersion:
                              current.config.webAgent?.adapterVersion ||
                              "1.0.0",
                            enabled: true,
                          },
                        },
                      }))
                    }
                    disabled={Boolean(selectedRuntime)}
                  />
                  <span className="settings-field-hint">
                    用于隔离多个网页登录账号；不要填写手机号、邮箱或真实姓名。
                  </span>
                </label>
                {selectedRuntime && (
                  <div className="settings-card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void openWebAgentWindow()}
                      disabled={busy === "probe"}
                    >
                      打开网页窗口 / 登录
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void clearWebAgentLogin()}
                      disabled={busy === "remove"}
                    >
                      清除登录数据
                    </button>
                  </div>
                )}
              </div>
            ) : isRemoteConnection ? (
              <>
                {isNew && (
                  <div className="agent-onboarding-connection-note">
                    <strong>选择远程接入方式</strong>
                    <span>
                      校验码配对和自托管 Gateway
                      是两种独立的连接方式，请先选择其一。
                    </span>
                  </div>
                )}
                <div
                  className="settings-theme-options"
                  aria-label="远程接入方式"
                >
                  <button
                    type="button"
                    className={`settings-theme-option ${remoteConnectionProfile === "managed-connect" ? "active" : ""}`}
                    aria-pressed={remoteConnectionProfile === "managed-connect"}
                    onClick={() =>
                      selectRemoteConnectionProfile("managed-connect")
                    }
                  >
                    校验码配对（推荐）
                  </button>
                  <button
                    type="button"
                    className={`settings-theme-option ${remoteConnectionProfile === "self-hosted-gateway" ? "active" : ""}`}
                    aria-pressed={
                      remoteConnectionProfile === "self-hosted-gateway"
                    }
                    onClick={() =>
                      selectRemoteConnectionProfile("self-hosted-gateway")
                    }
                  >
                    自托管 Gateway（高级）
                  </button>
                </div>

                {remoteConnectionProfile === "managed-connect" ? (
                  <div className="settings-field settings-field--connect-pairing">
                    <span className="settings-field-label">校验码配对</span>
                    <span className="settings-field-hint">
                      远端运行 Agents One Connector 后生成 10
                      位校验码。配对建立设备信任，不需要手动填写 Gateway 地址或
                      Token。
                    </span>
                    <div className="settings-card-actions">
                      <input
                        className="input"
                        aria-label="输入接入校验码"
                        value={connectorPairingCode}
                        onChange={(event) =>
                          setConnectorPairingCode(event.target.value)
                        }
                        placeholder="输入 10 位校验码"
                        maxLength={12}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void claimConnectorPairingCode()}
                        disabled={
                          !connectorPairingCode.trim() ||
                          Boolean(connectorPairingPreview)
                        }
                      >
                        {connectorPairingPreview ? "已查看设备" : "确认配对"}
                      </button>
                    </div>
                    {connectorPairingPreview && (
                      <div
                        className="settings-field agent-runtime-pairing-preview"
                        data-testid="agent-runtime-pairing-preview"
                      >
                        <strong>待确认远端设备</strong>
                        <span className="settings-field-hint">
                          设备名称：{connectorPairingPreview.displayName} ·
                          Runtime：
                          {connectorPairingPreview.runtimeId}
                        </span>
                        <span className="settings-field-hint">
                          设备指纹摘要：
                          {connectorPairingPreview.deviceFingerprint ||
                            "未提供"}
                        </span>
                        <span className="settings-field-hint">
                          校验码有效期至：
                          {new Date(
                            connectorPairingPreview.expiresAt,
                          ).toLocaleString()}
                        </span>
                        <span className="settings-field-hint">
                          远端 Runtime 与能力摘要：
                        </span>
                        <ul>
                          {(
                            connectorPairingPreview.runtimes || [
                              {
                                runtimeId: connectorPairingPreview.runtimeId,
                                displayName:
                                  connectorPairingPreview.displayName,
                              },
                            ]
                          ).map((runtime: ConnectRuntimeDescriptor) => (
                            <li key={runtime.runtimeId}>
                              {runtime.displayName}（{runtime.runtimeId}）
                              {runtime.kind ? ` · ${runtime.kind}` : ""}
                              {runtime.adapterId
                                ? ` · ${runtime.adapterId}`
                                : ""}
                              {runtime.capabilityDigest
                                ? " · 已声明能力指纹"
                                : " · 未声明能力指纹"}
                              {runtime.enabled === false ? " · 已停用" : ""}
                            </li>
                          ))}
                        </ul>
                        <div className="settings-card-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void confirmConnectorPairing()}
                          >
                            确认接入
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setConnectorPairingPreview(null);
                              setFlash(
                                "已取消本次配对确认，校验码仍可重新查看。",
                              );
                            }}
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    )}
                    <details className="agent-runtime-advanced">
                      <summary>本机发起配对</summary>
                      <p>仅当远程 Connector 需要由本机发起配对时使用。</p>
                      <div className="settings-card-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void startConnectPairing()}
                          disabled={!draft.id.trim() || !draft.name.trim()}
                        >
                          生成配对码
                        </button>
                        {connectPairing && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void refreshConnectPairing()}
                          >
                            <RefreshCw size={14} />
                            检查配对
                          </button>
                        )}
                      </div>
                      {connectPairing && (
                        <div className="settings-field-hint">
                          配对码：<strong>{connectPairing.pairingCode}</strong>{" "}
                          · 状态：
                          {connectPairingState === "pending"
                            ? "等待 Connector"
                            : connectPairingState === "paired"
                              ? "已配对"
                              : "已过期"}
                        </div>
                      )}
                    </details>
                  </div>
                ) : (
                  <>
                    <label className="settings-field">
                      <span className="settings-field-label">Gateway 地址</span>
                      <input
                        className="input"
                        type="url"
                        aria-label="Gateway 地址"
                        value={draft.config.endpoint || ""}
                        onChange={(event) =>
                          updateConfig("endpoint", event.target.value)
                        }
                        placeholder="https://gateway.example.com/agents-one/v1"
                        disabled={isBuiltin}
                      />
                      <span className="settings-field-hint">
                        自托管 Gateway v1 的 HTTPS 基础地址。此路径不会创建
                        Connect 配对记录。
                      </span>
                    </label>
                    {requiresRemoteCredential && (
                      <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                        <label className="settings-field">
                          <span className="settings-field-label">
                            {credentialLabel}
                          </span>
                          <input
                            className="input"
                            type="password"
                            aria-label={credentialLabel}
                            autoComplete="new-password"
                            value={bearerToken}
                            onChange={(event) => {
                              setBearerToken(event.target.value);
                              setCredentialRevision((current) => current + 1);
                            }}
                            placeholder={
                              credentialConfigured ? "已配置" : credentialLabel
                            }
                          />
                          <span className="settings-field-hint">
                            手动接入时填写；使用配对码成功后会自动安全保存。
                          </span>
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
                  </>
                )}
                {supportsRemoteWorkspaceGateway && !isNew && (
                  <details className="agent-runtime-advanced">
                    <summary>高级设置（可选）</summary>
                    <p>通常无需填写。仅在远程工作区网关独立部署时配置。</p>
                    <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field-label">
                          受控工作区网关地址
                        </span>
                        <input
                          className="input"
                          type="url"
                          aria-label="受控工作区网关地址"
                          value={draft.config.workspaceGatewayEndpoint || ""}
                          onChange={(event) =>
                            updateConfig(
                              "workspaceGatewayEndpoint",
                              event.target.value,
                            )
                          }
                          placeholder="留空则使用服务地址下的 /workspace-gateway"
                        />
                        <span className="settings-field-hint">
                          远程部署独立时填写完整的
                          https://host/workspace-gateway；通常可留空。
                        </span>
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">
                          受控工作区网关 Token
                        </span>
                        <input
                          className="input"
                          type="password"
                          autoComplete="new-password"
                          value={workspaceGatewayToken}
                          onChange={(event) =>
                            setWorkspaceGatewayToken(event.target.value)
                          }
                          placeholder="保存后仅存于受保护连接配置"
                        />
                        {selectedRuntime && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void saveWorkspaceGatewayToken()}
                            disabled={
                              savingCredential || !workspaceGatewayToken.trim()
                            }
                          >
                            <Save size={14} />
                            保存网关 Token
                          </button>
                        )}
                      </label>
                    </div>
                  </details>
                )}
              </>
            ) : (
              <>
                {isLocalHermesAdoption && (
                  <div className="settings-field agent-runtime-hermes-adoption">
                    <span className="settings-field-label">
                      采用已有 Hermes Agent Runtime 安装
                    </span>
                    <span className="settings-field-hint">
                      Agents One 会只读发现本机安装；采用只保存 Hermes Home
                      覆盖，不会重复下载或创建第二个 Hermes Runtime。
                    </span>
                    <div className="settings-card-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setHermesDiscoveryBusy(true);
                          void window.agentsOneAPI
                            .discoverHermesInstallations()
                            .then(setHermesCandidates)
                            .catch(() => setHermesCandidates([]))
                            .finally(() => setHermesDiscoveryBusy(false));
                        }}
                        disabled={hermesDiscoveryBusy}
                      >
                        {hermesDiscoveryBusy ? (
                          <Loader2 size={14} className="settings-spin" />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                        重新扫描
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void chooseHermesHome()}
                        disabled={hermesDiscoveryBusy}
                      >
                        选择 Hermes Home
                      </button>
                    </div>
                    {hermesCandidates.length === 0 && !hermesDiscoveryBusy && (
                      <span className="settings-field-hint">
                        未发现可直接采用的安装，请选择 Hermes
                        Home；无效目录不会写入配置。
                      </span>
                    )}
                    {hermesCandidates.map((candidate) => (
                      <div
                        className="settings-field agent-runtime-hermes-candidate"
                        key={candidate.home}
                      >
                        <strong>{candidate.home}</strong>
                        <span className="settings-field-hint">
                          {hermesDiscoverySourceLabel(candidate.source)} ·{" "}
                          {candidate.valid ? "校验通过" : "校验失败"}
                        </span>
                        <span className="settings-field-hint">
                          版本：{candidate.version || "无法读取"} · 可执行文件：
                          {candidate.executableAvailable ? "可用" : "缺失"}
                        </span>
                        <span className="settings-field-hint">
                          配置：{hermesConfigStateLabel(candidate.configState)}{" "}
                          · API：{hermesApiStateLabel(candidate.apiState)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void adoptHermesHome(candidate.home)}
                          disabled={!candidate.valid || hermesDiscoveryBusy}
                        >
                          使用此安装
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!isLocalHermesAdoption && (
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
                          manifestForDraft?.localCliCommand ||
                          (draft.kind === "claude-code"
                            ? "claude"
                            : draft.kind === "pi"
                              ? "pi"
                              : "codex")
                        }
                        disabled={isBuiltin}
                      />
                      <span className="settings-field-hint">
                        {isNew && localCliPaths[draft.kind]
                          ? `已在 PATH 检测到：${localCliPaths[draft.kind]}`
                          : isNew && draft.kind !== "hermes"
                            ? "未在 PATH 检测到，请填写可执行文件完整路径。"
                            : manifestForDraft?.fields.find(
                                (field) => field.key === "executablePath",
                              )?.help ||
                              "可执行文件路径或命令名（自动检测优先）。"}
                      </span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">
                        检测工作区（可选）
                      </span>
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
                    {!isNew && (
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
                    )}
                  </div>
                )}
              </>
            ))}

          {!isWebAgent && dynamicAdapterFields.length > 0 && (
            <div className="agent-runtime-form-grid">
              {dynamicAdapterFields.map((field) => {
                const value = adapterFieldValue(field);
                if (field.type === "boolean") {
                  return (
                    <label className="agent-runtime-enabled" key={field.key}>
                      <input
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) =>
                          updateAdapterField(field, event.target.checked)
                        }
                        disabled={isBuiltin}
                      />
                      {field.label}
                    </label>
                  );
                }
                if (field.type === "select") {
                  return (
                    <label className="settings-field" key={field.key}>
                      <span className="settings-field-label">
                        {field.label}
                      </span>
                      <select
                        className="input"
                        value={String(value)}
                        onChange={(event) =>
                          updateAdapterField(field, event.target.value)
                        }
                        disabled={isBuiltin}
                      >
                        <option value="">请选择</option>
                        {(field.options || []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {field.help && (
                        <span className="settings-field-hint">
                          {field.help}
                        </span>
                      )}
                    </label>
                  );
                }
                const inputType =
                  field.type === "number"
                    ? "number"
                    : field.type === "password"
                      ? "password"
                      : "text";
                return (
                  <label className="settings-field" key={field.key}>
                    <span className="settings-field-label">{field.label}</span>
                    {field.key === "acpArgs" ? (
                      <textarea
                        className="input"
                        rows={3}
                        value={String(value)}
                        onChange={(event) =>
                          updateAdapterField(field, event.target.value)
                        }
                        disabled={isBuiltin}
                      />
                    ) : (
                      <input
                        className="input"
                        type={inputType}
                        value={String(value)}
                        placeholder={field.placeholder}
                        onChange={(event) =>
                          updateAdapterField(
                            field,
                            field.type === "number"
                              ? Number(event.target.value) || undefined
                              : event.target.value,
                          )
                        }
                        disabled={isBuiltin}
                      />
                    )}
                    {field.help && (
                      <span className="settings-field-hint">{field.help}</span>
                    )}
                  </label>
                );
              })}
            </div>
          )}

          {(!isNew || newAgentStep === 3) && (
            <>
              <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                <label className="settings-field">
                  <span className="settings-field-label">连接超时（秒）</span>
                  <input
                    className="input"
                    type="number"
                    aria-label="连接超时（秒）"
                    min={1}
                    max={600}
                    step={1}
                    value={Math.max(
                      1,
                      Math.round(
                        (draft.config.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000,
                      ),
                    )}
                    onChange={(event) =>
                      updateConfig(
                        "timeoutMs",
                        Math.max(1, Number(event.target.value) || 1) * 1000,
                      )
                    }
                    disabled={isBuiltin}
                  />
                  <span className="settings-field-hint">
                    连接检测或发起对话时，超过此时长未响应将提示连接异常。
                  </span>
                </label>

                {!isNew && (
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
                )}
                {draft.needsReauthorization && (
                  <div className="settings-field-hint">
                    此远程智能体来自恢复且端点身份已变化。请先填写新的主凭据；在此之前无法启用或运行。
                  </div>
                )}
              </div>

              {draft.kind === "pi" && (
                <div className="settings-field-hint agent-runtime-pi-note">
                  Pi
                  按每个任务实际选择的项目目录和文件访问级别启动；未选择目录时不继承智能体配置中的工作区。
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

              {diagnostics &&
                diagnostics.runtime.id === selectedRuntime?.id && (
                  <div
                    className="agent-runtime-probe"
                    data-testid="agent-runtime-diagnostics"
                  >
                    <div className="agent-runtime-probe-head">
                      <strong>分层诊断</strong>
                      <span className="agent-runtime-probe-time">
                        {new Date(diagnostics.generatedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="settings-field-hint">
                      Desktop：v{diagnostics.desktopVersion || "未知"} · Gateway
                      v1：{diagnostics.gatewayProtocolVersion || "未知"}
                    </div>
                    <div className="settings-field-hint">
                      连接：{diagnostics.connection.profile} ·{" "}
                      {diagnostics.connection.state} · TLS{" "}
                      {diagnostics.connection.tls}
                      {diagnostics.connection.endpointHost && (
                        <>
                          {" · "}
                          {diagnostics.connection.endpointHost}
                        </>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      设备：
                      {diagnostics.connection.deviceId || "无（自托管/本地）"}
                      {diagnostics.connection.connectorVersion && (
                        <>
                          {" "}
                          · Connector v{diagnostics.connection.connectorVersion}
                        </>
                      )}
                      {diagnostics.connection.lastSeenAt && (
                        <>
                          {" · 最近在线 "}
                          {new Date(
                            diagnostics.connection.lastSeenAt,
                          ).toLocaleString()}
                        </>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      Host / Adapter：{diagnostics.host.state} ·{" "}
                      {diagnostics.host.adapterId || "未声明"}
                      {diagnostics.host.adapterVersion && (
                        <> v{diagnostics.host.adapterVersion}</>
                      )}
                      {diagnostics.host.plugin?.version && (
                        <> · 插件 v{diagnostics.host.plugin.version}</>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      Provider：
                      {diagnostics.provider.authConfigured
                        ? "凭据已配置"
                        : "未配置桌面侧凭据"}
                      {diagnostics.provider.requestedModel && (
                        <>
                          {" · 请求 "}
                          {diagnostics.provider.requestedModel}
                        </>
                      )}
                      {diagnostics.provider.actualModel && (
                        <>
                          {" · 实际 "}
                          {diagnostics.provider.actualModel.provider && (
                            <>{diagnostics.provider.actualModel.provider}/</>
                          )}
                          {diagnostics.provider.actualModel.id || "未知"}
                        </>
                      )}
                    </div>
                    {diagnostics.connection.message && (
                      <div className="settings-field-hint">
                        连接说明：{diagnostics.connection.message}
                      </div>
                    )}
                    {diagnostics.lastRun && (
                      <div className="settings-field-hint">
                        最近运行：{diagnostics.lastRun.status} · 事件{" "}
                        {diagnostics.lastRun.eventCount}
                        {diagnostics.lastRun.lastSequence !== undefined && (
                          <>
                            {" · 序号 "}
                            {diagnostics.lastRun.lastSequence}
                          </>
                        )}
                        {diagnostics.lastRun.reconnectFailures > 0 && (
                          <>
                            {" · 重连失败 "}
                            {diagnostics.lastRun.reconnectFailures}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
            </>
          )}

          {!isBuiltin && (
            <div className="settings-card-actions">
              {isNew && newAgentStep < 3 ? (
                <>
                  {newAgentStep > 1 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setNewAgentStep(1)}
                    >
                      上一步
                    </button>
                  )}
                  {isNew && newAgentStep === 1 && onCancel && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onCancel}
                    >
                      取消
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setNewAgentStep(newAgentStep === 1 ? 2 : 3)}
                  >
                    下一步
                  </button>
                </>
              ) : (
                <>
                  {isNew && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setNewAgentStep(2)}
                    >
                      上一步
                    </button>
                  )}
                  {isNew && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void probeDraft()}
                      disabled={
                        busy === "probe" ||
                        isLocalHermesAdoption ||
                        !draft.id.trim() ||
                        !draft.name.trim() ||
                        (draft.location === "remote" &&
                          remoteConnectionProfile !== "self-hosted-gateway") ||
                        (draft.location === "remote" &&
                          !draft.config.endpoint?.trim())
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
                    disabled={
                      !canSave || isLocalHermesAdoption || busy === "save"
                    }
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
                </>
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
