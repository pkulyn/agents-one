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
import type { WebAgentPolicyStatus } from "../../../../shared/web-agent";
import { dispatchAgentsOneEvent } from "../../utils/brandMigration";
import { fileToAvatarDataUrl } from "../../utils/imageResize";
import { useI18n } from "../useI18n";
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
  "web-agent": "settings.runtimeManager.kindWebAgent",
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

type Translate = (key: string, options?: Record<string, unknown>) => string;

function runtimeConnectionLabel(
  runtime: AgentRuntimeDefinition,
  t: Translate,
): string {
  if (runtime.managed === "builtin") {
    return t("settings.runtimeManager.connectionBuiltin");
  }
  const profile = deriveAgentRuntimeConnectionProfile(runtime);
  if (profile === "local") return t("settings.runtimeManager.connectionLocal");
  if (profile === "managed-connect") {
    return runtime.config.connect?.runtimeId
      ? t("settings.runtimeManager.connectionPaired")
      : t("settings.runtimeManager.connectionPairing");
  }
  return t("settings.runtimeManager.connectionDirect");
}

function runtimeTemplate(
  kind: AgentRuntimeKind,
  detected: Record<string, string | null> = {},
  selectedManifest?: AgentRuntimeAdapterManifest,
  locationOverride?: AgentRuntimeLocation,
  t?: Translate,
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
      name: t?.("settings.runtimeManager.defaultDoubaoName") || "Doubao Web",
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

function emptyDraft(t?: Translate): AgentRuntimeDraft {
  return runtimeTemplate("hermes", {}, undefined, undefined, t);
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

function healthLabel(
  probe: AgentRuntimeProbe | undefined,
  t: Translate,
): string {
  if (!probe) return t("settings.runtimeManager.healthUnchecked");
  const keys = {
    healthy: "settings.runtimeManager.healthHealthy",
    degraded: "settings.runtimeManager.healthDegraded",
    unreachable: "settings.runtimeManager.healthUnreachable",
    unsupported: "settings.runtimeManager.healthUnsupported",
    unknown: "settings.runtimeManager.healthUnknown",
  }[probe.state];
  return t(keys);
}

function trueCapabilities(
  probe: AgentRuntimeProbe | undefined,
  t: Translate,
): string[] {
  if (!probe) return [];
  const labels: Record<string, string> = {
    chat: "settings.runtimeManager.capabilityChat",
    taskDispatch: "settings.runtimeManager.capabilityTaskDispatch",
    streaming: "settings.runtimeManager.capabilityStreaming",
    cancellation: "settings.runtimeManager.capabilityCancellation",
    tools: "settings.runtimeManager.capabilityTools",
    artifacts: "settings.runtimeManager.capabilityArtifacts",
    orchestration: "settings.runtimeManager.capabilityOrchestration",
    readOnlyPlanning: "settings.runtimeManager.capabilityReadOnlyPlanning",
  };
  return Object.entries(probe.capabilities)
    .filter(([, enabled]) => enabled === true)
    .map(([key]) => (labels[key] ? t(labels[key]) : key));
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
  const { t } = useI18n();
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentRuntimeDraft>(() => emptyDraft(t));
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
  const [credentialStorageWarning, setCredentialStorageWarning] = useState<
    string | null
  >(null);
  const [draftProbe, setDraftProbe] = useState<AgentRuntimeProbe | null>(null);
  const [draftProbeKey, setDraftProbeKey] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<AgentRuntimeDiagnostics | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [webAgentPolicy, setWebAgentPolicy] =
    useState<WebAgentPolicyStatus | null>(null);
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
    if (!window.agentsOneAPI.getWebAgentPolicyStatus) {
      setWebAgentPolicy({
        available: false,
        enabled: false,
        killSwitchActive: false,
        reason: t("settings.runtimeManager.webPolicyUnavailable"),
      });
      return;
    }
    window.agentsOneAPI
      .getWebAgentPolicyStatus()
      .then(setWebAgentPolicy)
      .catch(() =>
        setWebAgentPolicy({
          available: false,
          enabled: false,
          killSwitchActive: false,
          reason: t("settings.runtimeManager.webPolicyLoadFailed"),
        }),
      );
  }, [t]);

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
  const credentialActionLabel = usesUnifiedGateway
    ? t("settings.runtimeManager.gatewayTokenSave")
    : "";
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
      setCredentialStorageWarning(status.storage?.warning || null);
    } catch {
      setCredentialConfigured(false);
      setCredentialStorageWarning(null);
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
          : emptyDraft(t),
      );
      void probeEnabledRuntimes(next);
    } catch (err) {
      setFlash(
        (err as Error).message || t("settings.runtimeManager.loadFailed"),
      );
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
    setDraft(emptyDraft(t));
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
        t,
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
      t,
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
        t("settings.runtimeManager.switchRemoteMethodConfirm", {
          name: draft.name || selectedRuntime.name,
          method:
            profile === "managed-connect"
              ? t("settings.runtimeManager.pairingMethod")
              : t("settings.runtimeManager.selfHostedMethod"),
        }),
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
      "active-home": t("settings.runtimeManager.discoveryActiveHome"),
      environment: t("settings.runtimeManager.discoveryEnvironmentHome"),
      "default-home": t("settings.runtimeManager.discoveryDefaultHome"),
      path: t("settings.runtimeManager.discoveryPath"),
    }[source];
  }

  function hermesConfigStateLabel(
    state: "configured" | "missing" | "invalid",
  ): string {
    return {
      configured: t("settings.runtimeManager.configFound"),
      missing: t("settings.runtimeManager.configMissing"),
      invalid: t("settings.runtimeManager.configInvalid"),
    }[state];
  }

  function hermesApiStateLabel(
    state: "unknown" | "healthy" | "unreachable" | "not-running" | "unrelated",
  ): string {
    return {
      unknown: t("settings.runtimeManager.apiUnchecked"),
      healthy: t("settings.runtimeManager.apiHealthy"),
      unreachable: t("settings.runtimeManager.apiUnreachable"),
      "not-running": t("settings.runtimeManager.apiNotRunning"),
      unrelated: t("settings.runtimeManager.apiUnrelated"),
    }[state];
  }

  async function chooseHermesHome(): Promise<void> {
    if (!window.agentsOneAPI.selectHermesHome) return;
    const home = await window.agentsOneAPI.selectHermesHome();
    if (!home) return;
    const valid = await window.agentsOneAPI.validateHermesHome(home);
    if (!valid) {
      setFlash(t("settings.runtimeManager.invalidHermesHome"));
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
    setFlash(t("settings.runtimeManager.hermesValidated"));
  }

  async function adoptHermesHome(home: string): Promise<void> {
    setHermesDiscoveryBusy(true);
    try {
      const valid = await window.agentsOneAPI.validateHermesHome(home);
      if (!valid) {
        setFlash(t("settings.runtimeManager.hermesValidationFailed"));
        return;
      }
      const adopted = await window.agentsOneAPI.adoptHermesHome(home);
      if (!adopted) {
        setFlash(t("settings.runtimeManager.hermesAdoptionFailedUnchanged"));
        return;
      }
      const reloadNow = window.confirm(
        t("settings.runtimeManager.hermesReloadConfirm"),
      );
      if (reloadNow) {
        setFlash(t("settings.runtimeManager.hermesReloading"));
        await window.agentsOneAPI.relaunchApp();
      } else {
        setFlash(t("settings.runtimeManager.hermesApplyNextLaunch"));
      }
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.hermesAdoptionFailed"),
      );
    } finally {
      setHermesDiscoveryBusy(false);
    }
  }

  function runtimeKindLabel(kind: AgentRuntimeKind): string {
    const label =
      adapterManifests.find((manifest) => manifest.kinds.includes(kind))
        ?.displayName || KIND_LABELS[kind];
    return label?.startsWith("settings.") ? t(label) : label || kind;
  }

  async function claimConnectorPairingCode(): Promise<void> {
    const code = connectorPairingCode.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-Z2-9]{10}$/.test(code)) {
      setFlash(t("settings.runtimeManager.invalidVerificationCode"));
      return;
    }
    try {
      const preview =
        await window.agentsOneAPI.previewAgentsOneConnectPairingCode(
          code,
          draft.id.trim() || undefined,
        );
      setConnectorPairingPreview(preview);
      setFlash(t("settings.runtimeManager.pairingPreviewReady"));
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.pairingCodeInvalid"),
      );
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
      setFlash(t("settings.runtimeManager.pairingConfirmed"));
      await load(saved.id);
      onChanged?.();
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.pairingConfirmFailed"),
      );
    }
  }

  async function startConnectPairing(): Promise<void> {
    if (!draft.id.trim() || !draft.name.trim()) {
      setFlash(t("settings.runtimeManager.pairingIdentityRequired"));
      return;
    }
    try {
      const session = await window.agentsOneAPI.createAgentsOneConnectPairing(
        draft.id.trim(),
        draft.name.trim(),
      );
      setConnectPairing(session);
      setConnectPairingState("pending");
      setFlash(t("settings.runtimeManager.pairingGenerated"));
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.pairingGenerateFailed"),
      );
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
        setFlash(t("settings.runtimeManager.connectPaired"));
        await load(saved.id);
        onChanged?.();
      }
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.pairingStatusFailed"),
      );
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
      setFlash(t("settings.runtimeManager.configurationSaved"));
      await load(saved.id);
      onChanged?.();
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.configurationSaveFailed"),
      );
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
      setFlash(t("settings.runtimeManager.appearanceSaved"));
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.appearanceSaveFailed"),
      );
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
      setFlash(
        (err as Error).message || t("settings.runtimeManager.iconReadFailed"),
      );
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
      setFlash(
        probe.message ||
          t("settings.runtimeManager.probeResult", {
            result: healthLabel(probe, t),
          }),
      );
    } catch (err) {
      if (runtimeId === selectedId) {
        setDraftProbe(null);
        setDraftProbeKey(null);
      }
      setFlash(
        (err as Error).message || t("settings.runtimeManager.probeFailed"),
      );
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
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.diagnosticsLoadFailed"),
      );
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
      setFlash(t("settings.runtimeManager.webWindowOpened"));
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.webWindowOpenFailed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function clearWebAgentLogin(): Promise<void> {
    if (!selectedRuntime || !window.agentsOneAPI.clearWebAgentRuntimeLogin)
      return;
    setBusy("remove");
    try {
      await window.agentsOneAPI.clearWebAgentRuntimeLogin(selectedRuntime.id);
      setFlash(t("settings.runtimeManager.webLoginCleared"));
      await probeRuntime(selectedRuntime.id);
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.webLoginClearFailed"),
      );
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
      setFlash(
        probe.message ||
          t("settings.runtimeManager.connectionTestResult", {
            result: healthLabel(probe, t),
          }),
      );
    } catch (err) {
      setDraftProbe(null);
      setDraftProbeKey(null);
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.connectionTestFailed"),
      );
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
        window.confirm(t("settings.runtimeManager.removeWebLoginConfirm"));
      if (clearWebLogin) {
        await window.agentsOneAPI.clearWebAgentRuntimeLogin(selectedRuntime.id);
      }
      await window.agentsOneAPI.removeAgentRuntime(selectedRuntime.id);
      setFlash(
        clearWebLogin
          ? t("settings.runtimeManager.removedWithWebLogin")
          : t("settings.runtimeManager.removed"),
      );
      await load();
      onChanged?.();
    } catch (err) {
      setFlash(
        (err as Error).message || t("settings.runtimeManager.removeFailed"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveBearerToken(): Promise<void> {
    if (!selectedRuntime || !bearerToken.trim()) return;
    setSavingCredential(true);
    try {
      const result = await window.agentsOneAPI.setAgentRuntimeBearerToken(
        selectedRuntime.id,
        bearerToken,
      );
      setBearerToken("");
      setCredentialRevision(0);
      setCredentialConfigured(true);
      setCredentialStorageWarning(result.storage?.warning || null);
      setFlash(
        t("settings.runtimeManager.credentialSaved", {
          label: credentialLabel,
        }),
      );
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.credentialSaveFailed"),
      );
    } finally {
      setSavingCredential(false);
    }
  }

  async function toggleWebAgentPolicy(): Promise<void> {
    if (!webAgentPolicy?.available) return;
    const enable = !webAgentPolicy.enabled;
    if (
      enable &&
      !window.confirm(t("settings.runtimeManager.webRiskConfirm"))
    ) {
      return;
    }
    try {
      const next = await window.agentsOneAPI.setWebAgentPolicyEnabled(
        enable,
        enable,
      );
      setWebAgentPolicy(next);
      if (!next.enabled && newAgentType === "web") {
        selectNewAgentType("remote");
      }
      setFlash(
        next.enabled
          ? t("settings.runtimeManager.webPolicyEnabled")
          : t("settings.runtimeManager.webPolicyDisabled"),
      );
    } catch (error) {
      setFlash(
        (error as Error).message ||
          t("settings.runtimeManager.webPolicyUpdateFailed"),
      );
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
      setFlash(t("settings.runtimeManager.workspaceGatewayTokenSaved"));
    } catch (err) {
      setFlash(
        (err as Error).message ||
          t("settings.runtimeManager.workspaceGatewayTokenSaveFailed"),
      );
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
              <div className="settings-card-title">
                {t("settings.runtimeManager.cardTitle")}
              </div>
              <div className="settings-card-sub">
                {t("settings.runtimeManager.cardHint")}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => void load(selectedId || undefined)}
              disabled={busy === "load"}
              title={t("settings.runtimeManager.refreshAgents")}
            >
              <RefreshCw
                size={13}
                className={busy === "load" ? "settings-spin" : undefined}
              />
              {t("settings.runtimeManager.refresh")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={startNewRuntime}
              title={t("settings.runtimeManager.connectAgent")}
            >
              <Plus size={13} />
              {t("settings.runtimeManager.connect")}
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
                        {runtime.location === "remote"
                          ? t("settings.runtimeManager.remote")
                          : t("settings.runtimeManager.local")}{" "}
                        · {runtimeConnectionLabel(runtime, t)}
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
                          ? t("settings.runtimeManager.checking")
                          : probeFailed
                            ? t("settings.runtimeManager.checkFailed")
                            : healthLabel(probe, t)
                        : t("settings.runtimeManager.disabled")}
                    </span>
                  </button>
                );
              })}
              {runtimes.length === 0 && busy === "load" && (
                <div className="agent-runtime-empty">
                  {t("settings.runtimeManager.loading")}
                </div>
              )}
              {runtimes.length === 0 && busy !== "load" && (
                <div className="agent-runtime-empty">
                  {t("settings.runtimeManager.empty")}
                </div>
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
                {isNew
                  ? t("settings.runtimeManager.connectAgent")
                  : draft.name || t("settings.runtimeManager.configuration")}
              </div>
              <div className="settings-card-sub">
                {isBuiltin
                  ? t("settings.runtimeManager.builtinAgent")
                  : t("settings.runtimeManager.customAgent")}
              </div>
            </div>
            {selectedRuntime && (
              <>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void probeRuntime()}
                  disabled={busy === "probe" || !selectedRuntime.enabled}
                  title={t("settings.runtimeManager.checkConnection")}
                >
                  {busy === "probe" ? (
                    <Loader2 size={13} className="settings-spin" />
                  ) : (
                    <RefreshCw size={13} />
                  )}
                  {t("settings.runtimeManager.check")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={() => void loadDiagnostics()}
                  disabled={diagnosticsBusy}
                  title={t("settings.runtimeManager.viewDiagnostics")}
                >
                  {diagnosticsBusy ? (
                    <Loader2 size={13} className="settings-spin" />
                  ) : (
                    <Signal size={13} />
                  )}
                  {t("settings.runtimeManager.diagnostics")}
                </button>
              </>
            )}
          </header>
        )}

        <div className="settings-card-body">
          <section
            className="settings-field-hint"
            data-testid="web-agent-policy"
          >
            <strong>{t("settings.runtimeManager.experimentalTitle")}</strong>
            <div>{t("settings.runtimeManager.experimentalDescription")}</div>
            {webAgentPolicy?.available ? (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                aria-pressed={webAgentPolicy.enabled}
                onClick={() => void toggleWebAgentPolicy()}
              >
                {webAgentPolicy.enabled
                  ? t("settings.runtimeManager.disableWebProviders")
                  : t("settings.runtimeManager.understandAndEnable")}
              </button>
            ) : (
              <div>
                {webAgentPolicy?.reasonCode === "public-build-disabled"
                  ? t("settings.runtimeManager.publicBuildWebDisabled")
                  : webAgentPolicy?.reasonCode === "emergency-disabled"
                    ? t("settings.runtimeManager.emergencyWebDisabled")
                    : webAgentPolicy?.reason ||
                      t("settings.runtimeManager.policyLoading")}
              </div>
            )}
          </section>
          {selectedRuntime &&
            draft.location === "remote" &&
            usesUnifiedGateway && (
              <div
                className="settings-field-hint agent-runtime-connection-summary"
                data-testid="agent-runtime-connection-summary"
              >
                {t("settings.runtimeManager.connectionSource")}
                {remoteConnectionProfile === "managed-connect"
                  ? draft.config.connect?.runtimeId
                    ? t("settings.runtimeManager.pairedSource")
                    : t("settings.runtimeManager.unpairedSource")
                  : t("settings.runtimeManager.directSource")}
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
                aria-label={t("settings.runtimeManager.onboardingSteps")}
              >
                {(
                  [
                    [1, t("settings.runtimeManager.stepType")],
                    [2, t("settings.runtimeManager.stepBasics")],
                    [3, t("settings.runtimeManager.stepConnection")],
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
                    <h3 id="agent-onboarding-type-title">
                      {t("settings.runtimeManager.chooseTypeTitle")}
                    </h3>
                    <p>{t("settings.runtimeManager.chooseTypeHint")}</p>
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
                      <strong>{t("settings.runtimeManager.localAgent")}</strong>
                      <small>
                        {t("settings.runtimeManager.localAgentDescription")}
                      </small>
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
                      <strong>
                        {t("settings.runtimeManager.remoteAgent")}
                      </strong>
                      <small>
                        {t("settings.runtimeManager.remoteAgentDescription")}
                      </small>
                      {newAgentType === "remote" && <i aria-hidden="true">✓</i>}
                    </button>
                    <button
                      type="button"
                      className={newAgentType === "web" ? "is-selected" : ""}
                      aria-pressed={newAgentType === "web"}
                      disabled={!webAgentPolicy?.enabled}
                      onClick={() => selectNewAgentType("web")}
                    >
                      <span className="agent-onboarding-type-icon agent-onboarding-type-icon--web">
                        <Globe2 size={22} />
                      </span>
                      <strong>{t("settings.runtimeManager.webAgent")}</strong>
                      <small>
                        {t("settings.runtimeManager.webAgentDescription")}
                      </small>
                      {newAgentType === "web" && <i aria-hidden="true">✓</i>}
                    </button>
                  </div>
                  <div className="agent-onboarding-preview">
                    <strong>{t("settings.runtimeManager.nextRequires")}</strong>
                    <span className="agent-onboarding-preview-item">
                      <span className="agent-onboarding-preview-icon">
                        <UserRound size={16} aria-hidden="true" />
                      </span>
                      {t("settings.runtimeManager.basicsPreview")}
                    </span>
                    <span className="agent-onboarding-preview-item">
                      <span className="agent-onboarding-preview-icon">
                        <Link2 size={16} aria-hidden="true" />
                      </span>
                      {newAgentType === "local"
                        ? t("settings.runtimeManager.localConnectionPreview")
                        : newAgentType === "web"
                          ? t("settings.runtimeManager.webConnectionPreview")
                          : t(
                              "settings.runtimeManager.remoteConnectionPreview",
                            )}
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
                aria-label={t("settings.runtimeManager.displayInformation")}
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
                  title={t("settings.runtimeManager.changeIcon")}
                  aria-label={t("settings.runtimeManager.changeIcon")}
                >
                  {draft.avatar ? (
                    <img src={draft.avatar} alt="" />
                  ) : (
                    <Bot size={18} />
                  )}
                </button>
                <div
                  className="agent-runtime-appearance-colors"
                  aria-label={t("settings.runtimeManager.agentColor")}
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
                    {t("settings.runtimeManager.saveDisplayInformation")}
                  </button>
                )}
              </section>
              <div className="agent-runtime-form-grid">
                <label className="settings-field">
                  <span className="settings-field-label">
                    {t("settings.runtimeManager.name")}
                  </span>
                  <input
                    className="input"
                    aria-label={t("settings.runtimeManager.name")}
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
                  <span className="settings-field-label">
                    {t("settings.runtimeManager.agentId")}
                  </span>
                  <input
                    className="input"
                    aria-label={t("settings.runtimeManager.agentId")}
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
                  <span className="settings-field-label">
                    {t("settings.runtimeManager.type")}
                  </span>
                  <select
                    className="input"
                    aria-label={t("settings.runtimeManager.type")}
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
                        t("settings.runtimeManager.templateHint")}
                    </span>
                  )}
                </label>

                {!isWebAgent && !isNew && (
                  <label className="settings-field">
                    <span className="settings-field-label">
                      {t("settings.runtimeManager.transport")}
                    </span>
                    <select
                      className="input"
                      aria-label={t("settings.runtimeManager.transport")}
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
                  <label className="settings-field-label">
                    {t("settings.runtimeManager.location")}
                  </label>
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
                          {location === "remote"
                            ? t("settings.runtimeManager.remote")
                            : t("settings.runtimeManager.local")}
                        </button>
                      ),
                    )}
                  </div>
                  {isNew && (
                    <span className="settings-field-hint">
                      {t("settings.runtimeManager.templateLocationHint")}
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
                  {t("settings.runtimeManager.experimentalWebAgent")}
                </span>
                <span className="settings-field-hint">
                  {t("settings.runtimeManager.webAgentSecurityHint")}
                </span>
                <label className="settings-field">
                  <span className="settings-field-label">Provider</span>
                  <select
                    className="input"
                    aria-label={t("settings.runtimeManager.webProvider")}
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
                            ? t("settings.runtimeManager.chatgptWebName")
                            : provider === "grok"
                              ? t("settings.runtimeManager.grokWebName")
                              : t("settings.runtimeManager.defaultDoubaoName"),
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
                    <option value="doubao">
                      {t("settings.runtimeManager.doubao")}
                    </option>
                    <option value="chatgpt">ChatGPT</option>
                    <option value="grok">Grok</option>
                  </select>
                </label>
                <span className="settings-field-hint">
                  {t("settings.runtimeManager.currentProvider", {
                    provider:
                      draft.config.webAgent?.provider === "chatgpt"
                        ? "ChatGPT"
                        : draft.config.webAgent?.provider === "grok"
                          ? "Grok"
                          : t("settings.runtimeManager.doubao"),
                    version:
                      draft.config.webAgent?.adapterVersion ||
                      t("settings.runtimeManager.unknown"),
                  })}
                </span>
                <label className="settings-field">
                  <span className="settings-field-label">
                    {t("settings.runtimeManager.webProfile")}
                  </span>
                  <input
                    className="input"
                    aria-label={t("settings.runtimeManager.webProfile")}
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
                    {t("settings.runtimeManager.webProfileHint")}
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
                      {t("settings.runtimeManager.openWebLogin")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void clearWebAgentLogin()}
                      disabled={busy === "remove"}
                    >
                      {t("settings.runtimeManager.clearWebLogin")}
                    </button>
                  </div>
                )}
              </div>
            ) : isRemoteConnection ? (
              <>
                {isNew && (
                  <div className="agent-onboarding-connection-note">
                    <strong>
                      {t("settings.runtimeManager.chooseRemoteMethod")}
                    </strong>
                    <span>
                      {t("settings.runtimeManager.chooseRemoteMethodHint")}
                    </span>
                  </div>
                )}
                <div
                  className="settings-theme-options"
                  aria-label={t("settings.runtimeManager.remoteMethod")}
                >
                  <button
                    type="button"
                    className={`settings-theme-option ${remoteConnectionProfile === "managed-connect" ? "active" : ""}`}
                    aria-pressed={remoteConnectionProfile === "managed-connect"}
                    onClick={() =>
                      selectRemoteConnectionProfile("managed-connect")
                    }
                  >
                    {t("settings.runtimeManager.pairingRecommended")}
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
                    {t("settings.runtimeManager.selfHostedAdvanced")}
                  </button>
                </div>

                {remoteConnectionProfile === "managed-connect" ? (
                  <div className="settings-field settings-field--connect-pairing">
                    <span className="settings-field-label">
                      {t("settings.runtimeManager.verificationPairing")}
                    </span>
                    <span className="settings-field-hint">
                      {t("settings.runtimeManager.verificationPairingHint")}
                    </span>
                    <div className="settings-card-actions">
                      <input
                        className="input"
                        aria-label={t(
                          "settings.runtimeManager.enterVerificationCode",
                        )}
                        value={connectorPairingCode}
                        onChange={(event) =>
                          setConnectorPairingCode(event.target.value)
                        }
                        placeholder={t(
                          "settings.runtimeManager.verificationCodePlaceholder",
                        )}
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
                        {connectorPairingPreview
                          ? t("settings.runtimeManager.deviceReviewed")
                          : t("settings.runtimeManager.confirmPairing")}
                      </button>
                    </div>
                    {connectorPairingPreview && (
                      <div
                        className="settings-field agent-runtime-pairing-preview"
                        data-testid="agent-runtime-pairing-preview"
                      >
                        <strong>
                          {t("settings.runtimeManager.pendingDevice")}
                        </strong>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.deviceAndRuntime", {
                            name: connectorPairingPreview.displayName,
                            runtime: connectorPairingPreview.runtimeId,
                          })}
                        </span>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.deviceFingerprint", {
                            fingerprint:
                              connectorPairingPreview.deviceFingerprint ||
                              t("settings.runtimeManager.notProvided"),
                          })}
                        </span>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.verificationExpires", {
                            time: new Date(
                              connectorPairingPreview.expiresAt,
                            ).toLocaleString(),
                          })}
                        </span>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.remoteRuntimeSummary")}
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
                                ? ` · ${t("settings.runtimeManager.capabilityDigestDeclared")}`
                                : ` · ${t("settings.runtimeManager.capabilityDigestMissing")}`}
                              {runtime.enabled === false
                                ? ` · ${t("settings.runtimeManager.disabled")}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                        <div className="settings-card-actions">
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => void confirmConnectorPairing()}
                          >
                            {t("settings.runtimeManager.confirmConnection")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setConnectorPairingPreview(null);
                              setFlash(
                                t("settings.runtimeManager.pairingCancelled"),
                              );
                            }}
                          >
                            {t("settings.runtimeManager.cancel")}
                          </button>
                        </div>
                      </div>
                    )}
                    <details className="agent-runtime-advanced">
                      <summary>
                        {t("settings.runtimeManager.initiatePairingLocally")}
                      </summary>
                      <p>{t("settings.runtimeManager.initiatePairingHint")}</p>
                      <div className="settings-card-actions">
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => void startConnectPairing()}
                          disabled={!draft.id.trim() || !draft.name.trim()}
                        >
                          {t("settings.runtimeManager.generatePairingCode")}
                        </button>
                        {connectPairing && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void refreshConnectPairing()}
                          >
                            <RefreshCw size={14} />
                            {t("settings.runtimeManager.checkPairing")}
                          </button>
                        )}
                      </div>
                      {connectPairing && (
                        <div className="settings-field-hint">
                          {t("settings.runtimeManager.pairingSummary", {
                            code: connectPairing.pairingCode,
                            status:
                              connectPairingState === "pending"
                                ? t("settings.runtimeManager.waitingConnector")
                                : connectPairingState === "paired"
                                  ? t("settings.runtimeManager.paired")
                                  : t("settings.runtimeManager.expired"),
                          })}
                        </div>
                      )}
                    </details>
                  </div>
                ) : (
                  <>
                    <label className="settings-field">
                      <span className="settings-field-label">
                        {t("settings.runtimeManager.gatewayAddress")}
                      </span>
                      <input
                        className="input"
                        type="url"
                        aria-label={t("settings.runtimeManager.gatewayAddress")}
                        value={draft.config.endpoint || ""}
                        onChange={(event) =>
                          updateConfig("endpoint", event.target.value)
                        }
                        placeholder="https://gateway.example.com/agents-one/v1"
                        disabled={isBuiltin}
                      />
                      <span className="settings-field-hint">
                        {t("settings.runtimeManager.gatewayAddressHint")}
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
                              credentialConfigured
                                ? t("settings.runtimeManager.configured")
                                : credentialLabel
                            }
                          />
                          <span className="settings-field-hint">
                            {t("settings.runtimeManager.credentialHint")}
                          </span>
                          {credentialStorageWarning && (
                            <span className="settings-field-hint">
                              {t("settings.runtimeManager.secureStorageHint", {
                                warning: credentialStorageWarning,
                              })}
                            </span>
                          )}
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
                    <summary>
                      {t("settings.runtimeManager.advancedOptional")}
                    </summary>
                    <p>
                      {t(
                        "settings.runtimeManager.workspaceGatewayAdvancedHint",
                      )}
                    </p>
                    <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t("settings.runtimeManager.workspaceGatewayAddress")}
                        </span>
                        <input
                          className="input"
                          type="url"
                          aria-label={t(
                            "settings.runtimeManager.workspaceGatewayAddress",
                          )}
                          value={draft.config.workspaceGatewayEndpoint || ""}
                          onChange={(event) =>
                            updateConfig(
                              "workspaceGatewayEndpoint",
                              event.target.value,
                            )
                          }
                          placeholder={t(
                            "settings.runtimeManager.workspaceGatewayPlaceholder",
                          )}
                        />
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.workspaceGatewayHint")}
                        </span>
                      </label>
                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t("settings.runtimeManager.workspaceGatewayToken")}
                        </span>
                        <input
                          className="input"
                          type="password"
                          autoComplete="new-password"
                          value={workspaceGatewayToken}
                          onChange={(event) =>
                            setWorkspaceGatewayToken(event.target.value)
                          }
                          placeholder={t(
                            "settings.runtimeManager.protectedCredentialPlaceholder",
                          )}
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
                            {t(
                              "settings.runtimeManager.saveWorkspaceGatewayToken",
                            )}
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
                      {t("settings.runtimeManager.adoptHermesInstallation")}
                    </span>
                    <span className="settings-field-hint">
                      {t("settings.runtimeManager.adoptHermesHint")}
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
                        {t("settings.runtimeManager.rescan")}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void chooseHermesHome()}
                        disabled={hermesDiscoveryBusy}
                      >
                        {t("settings.runtimeManager.chooseHermesHome")}
                      </button>
                    </div>
                    {hermesCandidates.length === 0 && !hermesDiscoveryBusy && (
                      <span className="settings-field-hint">
                        {t("settings.runtimeManager.noHermesInstallation")}
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
                          {candidate.valid
                            ? t("settings.runtimeManager.validationPassed")
                            : t("settings.runtimeManager.validationFailed")}
                        </span>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.versionAndExecutable", {
                            version:
                              candidate.version ||
                              t("settings.runtimeManager.unreadable"),
                            executable: candidate.executableAvailable
                              ? t("settings.runtimeManager.available")
                              : t("settings.runtimeManager.missing"),
                          })}
                        </span>
                        <span className="settings-field-hint">
                          {t("settings.runtimeManager.configState", {
                            state: hermesConfigStateLabel(
                              candidate.configState,
                            ),
                          })}{" "}
                          · API: {hermesApiStateLabel(candidate.apiState)}
                        </span>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void adoptHermesHome(candidate.home)}
                          disabled={!candidate.valid || hermesDiscoveryBusy}
                        >
                          {t("settings.runtimeManager.useInstallation")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {!isLocalHermesAdoption && (
                  <div className="agent-runtime-form-grid">
                    <label className="settings-field">
                      <span className="settings-field-label">
                        {t("settings.runtimeManager.executable")}
                      </span>
                      <input
                        className="input"
                        aria-label={t("settings.runtimeManager.executable")}
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
                          ? t("settings.runtimeManager.executableDetected", {
                              path: localCliPaths[draft.kind],
                            })
                          : isNew && draft.kind !== "hermes"
                            ? t("settings.runtimeManager.executableNotDetected")
                            : manifestForDraft?.fields.find(
                                (field) => field.key === "executablePath",
                              )?.help ||
                              t("settings.runtimeManager.executableHint")}
                      </span>
                    </label>
                    <label className="settings-field">
                      <span className="settings-field-label">
                        {t("settings.runtimeManager.probeWorkspace")}
                      </span>
                      <input
                        className="input"
                        aria-label={t("settings.runtimeManager.probeWorkspace")}
                        value={draft.config.workspace || ""}
                        onChange={(event) =>
                          updateConfig("workspace", event.target.value)
                        }
                        placeholder={t(
                          "settings.runtimeManager.probeWorkspacePlaceholder",
                        )}
                        disabled={isBuiltin}
                      />
                      <span className="settings-field-hint">
                        {t("settings.runtimeManager.probeWorkspaceHint")}
                      </span>
                    </label>
                    {!isNew && (
                      <label className="settings-field">
                        <span className="settings-field-label">
                          {t("settings.runtimeManager.modelOverride")}
                        </span>
                        <input
                          className="input"
                          aria-label={t(
                            "settings.runtimeManager.modelOverride",
                          )}
                          value={draft.config.model || ""}
                          onChange={(event) =>
                            updateConfig("model", event.target.value)
                          }
                          placeholder={t(
                            "settings.runtimeManager.modelOverridePlaceholder",
                          )}
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
                        <option value="">
                          {t("settings.runtimeManager.select")}
                        </option>
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
                  <span className="settings-field-label">
                    {t("settings.runtimeManager.timeoutSeconds")}
                  </span>
                  <input
                    className="input"
                    type="number"
                    aria-label={t("settings.runtimeManager.timeoutSeconds")}
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
                    {t("settings.runtimeManager.timeoutHint")}
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
                    {t("settings.runtimeManager.enabled")}
                  </label>
                )}
                {draft.needsReauthorization && (
                  <div className="settings-field-hint">
                    {t("settings.runtimeManager.reauthorizationRequired")}
                  </div>
                )}
              </div>

              {draft.kind === "pi" && (
                <div className="settings-field-hint agent-runtime-pi-note">
                  Pi: {t("settings.runtimeManager.workspaceSelectionHint")}
                </div>
              )}

              {selectedProbe && (
                <div className="agent-runtime-probe">
                  <div className="agent-runtime-probe-head">
                    <span
                      className={`agent-runtime-status agent-runtime-status--${selectedProbe.state}`}
                    >
                      {healthLabel(selectedProbe, t)}
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
                      {t("settings.runtimeManager.pluginRecognized")}
                      {selectedProbe.capabilities.plugin.version
                        ? ` v${selectedProbe.capabilities.plugin.version}`
                        : ""}
                      {selectedProbe.capabilities.eventStream
                        ? t("settings.runtimeManager.granularEvents")
                        : "."}
                    </div>
                  )}
                  <div className="agent-runtime-capabilities">
                    {trueCapabilities(selectedProbe, t).map((capability) => (
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
                      <strong>
                        {t("settings.runtimeManager.diagnosticsTitle")}
                      </strong>
                      <span className="agent-runtime-probe-time">
                        {new Date(diagnostics.generatedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="settings-field-hint">
                      {t("settings.runtimeManager.desktopGatewayVersions", {
                        desktop:
                          diagnostics.desktopVersion ||
                          t("settings.runtimeManager.unknown"),
                        gateway:
                          diagnostics.gatewayProtocolVersion ||
                          t("settings.runtimeManager.unknown"),
                      })}
                    </div>
                    <div className="settings-field-hint">
                      {t("settings.runtimeManager.connectionDiagnostic", {
                        profile: diagnostics.connection.profile,
                        transport: `${diagnostics.connection.state} · TLS ${diagnostics.connection.tls}`,
                      })}
                      {diagnostics.connection.endpointHost && (
                        <>
                          {" · "}
                          {diagnostics.connection.endpointHost}
                        </>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      {t("settings.runtimeManager.device", {
                        device:
                          diagnostics.connection.deviceId ||
                          t("settings.runtimeManager.selfHostedOrLocal"),
                      })}
                      {diagnostics.connection.connectorVersion && (
                        <>
                          {" "}
                          · Connector v{diagnostics.connection.connectorVersion}
                        </>
                      )}
                      {diagnostics.connection.lastSeenAt && (
                        <>
                          {` · ${t("settings.runtimeManager.lastOnline", {
                            time: new Date(
                              diagnostics.connection.lastSeenAt,
                            ).toLocaleString(),
                          })}`}
                        </>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      Host / Adapter：{diagnostics.host.state} ·{" "}
                      {diagnostics.host.adapterId ||
                        t("settings.runtimeManager.undeclared")}
                      {diagnostics.host.adapterVersion && (
                        <> v{diagnostics.host.adapterVersion}</>
                      )}
                      {diagnostics.host.plugin?.version && (
                        <>
                          {` · ${t("settings.runtimeManager.pluginVersion", {
                            version: diagnostics.host.plugin.version,
                          })}`}
                        </>
                      )}
                    </div>
                    <div className="settings-field-hint">
                      Provider：
                      {diagnostics.provider.authConfigured
                        ? t("settings.runtimeManager.credentialConfigured")
                        : t("settings.runtimeManager.credentialNotConfigured")}
                      {diagnostics.provider.requestedModel && (
                        <>
                          {` · ${t("settings.runtimeManager.requestedModel", {
                            model: diagnostics.provider.requestedModel,
                          })}`}
                        </>
                      )}
                      {diagnostics.provider.actualModel && (
                        <>
                          {` · ${t("settings.runtimeManager.actualModel", {
                            model: `${diagnostics.provider.actualModel.provider ? `${diagnostics.provider.actualModel.provider}/` : ""}${diagnostics.provider.actualModel.id || t("settings.runtimeManager.unknown")}`,
                          })}`}
                        </>
                      )}
                    </div>
                    {diagnostics.connection.message && (
                      <div className="settings-field-hint">
                        {t("settings.runtimeManager.connectionMessage", {
                          message: diagnostics.connection.message,
                        })}
                      </div>
                    )}
                    {diagnostics.lastRun && (
                      <div className="settings-field-hint">
                        {t("settings.runtimeManager.lastRun", {
                          status: diagnostics.lastRun.status,
                          events: diagnostics.lastRun.eventCount,
                        })}
                        {diagnostics.lastRun.lastSequence !== undefined && (
                          <>
                            {` · ${t("settings.runtimeManager.sequence", {
                              sequence: diagnostics.lastRun.lastSequence,
                            })}`}
                          </>
                        )}
                        {diagnostics.lastRun.reconnectFailures > 0 && (
                          <>
                            {` · ${t(
                              "settings.runtimeManager.reconnectFailures",
                              {
                                count: diagnostics.lastRun.reconnectFailures,
                              },
                            )}`}
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
                      {t("settings.runtimeManager.previous")}
                    </button>
                  )}
                  {isNew && newAgentStep === 1 && onCancel && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={onCancel}
                    >
                      {t("settings.runtimeManager.cancel")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setNewAgentStep(newAgentStep === 1 ? 2 : 3)}
                  >
                    {t("settings.runtimeManager.next")}
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
                      {t("settings.runtimeManager.previous")}
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
                      {t("settings.runtimeManager.connectionTest")}
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
                    {isNew
                      ? t("settings.runtimeManager.save")
                      : t("settings.runtimeManager.saveChanges")}
                  </button>
                  {selectedRuntime && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void removeRuntime()}
                      disabled={busy === "remove"}
                    >
                      <Trash2 size={14} />
                      {t("settings.runtimeManager.remove")}
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {isBuiltin && embedded && (
            <div className="agent-runtime-hermes-connection">
              <div className="agent-runtime-hermes-connection-heading">
                {t("settings.runtimeManager.hermesConnection")}
              </div>
              <HermesConnectionManager />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
