import { useEffect, useMemo, useState } from "react";
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

const DEFAULT_TIMEOUT_MS = 10000;

const KIND_LABELS: Record<AgentRuntimeKind, string> = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
  codex: "Codex",
  "claude-code": "Claude Code",
};

function emptyDraft(): AgentRuntimeDraft {
  return {
    id: "openclaw-remote",
    name: "OpenClaw Remote",
    kind: "openclaw",
    location: "remote",
    enabled: true,
    config: {
      endpoint: "",
      transport: "http",
      timeoutMs: DEFAULT_TIMEOUT_MS,
    },
  };
}

function draftFromRuntime(runtime: AgentRuntimeDefinition): AgentRuntimeDraft {
  return {
    id: runtime.id,
    name: runtime.name,
    kind: runtime.kind,
    location: runtime.location,
    enabled: runtime.enabled,
    config: { ...runtime.config },
  };
}

function healthLabel(probe?: AgentRuntimeProbe): string {
  if (!probe) return "Not checked";
  return probe.state.charAt(0).toUpperCase() + probe.state.slice(1);
}

function trueCapabilities(probe?: AgentRuntimeProbe): string[] {
  if (!probe) return [];
  return Object.entries(probe.capabilities)
    .filter(([, enabled]) => enabled)
    .map(([key]) => key);
}

export default function AgentRuntimesPane(): React.JSX.Element {
  const [runtimes, setRuntimes] = useState<AgentRuntimeDefinition[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentRuntimeDraft>(() => emptyDraft());
  const [probes, setProbes] = useState<Record<string, AgentRuntimeProbe>>({});
  const [busy, setBusy] = useState<"load" | "save" | "probe" | "remove" | null>(
    null,
  );
  const [bearerToken, setBearerToken] = useState("");
  const [credentialConfigured, setCredentialConfigured] = useState(false);
  const [savingCredential, setSavingCredential] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const selectedRuntime = useMemo(
    () => runtimes.find((runtime) => runtime.id === selectedId) || null,
    [runtimes, selectedId],
  );
  const selectedProbe = selectedId ? probes[selectedId] : undefined;
  const isNew = selectedId === null;
  const isBuiltin = selectedRuntime?.managed === "builtin";
  const canSave =
    !isBuiltin &&
    draft.id.trim().length > 0 &&
    draft.name.trim().length > 0 &&
    (draft.location === "local" || !!draft.config.endpoint?.trim());

  async function loadCredentialStatus(runtimeId: string | null): Promise<void> {
    if (!runtimeId || !window.hermesAPI.getAgentRuntimeCredentialStatus) {
      setCredentialConfigured(false);
      return;
    }
    try {
      const status = await window.hermesAPI.getAgentRuntimeCredentialStatus(runtimeId);
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
      void loadCredentialStatus(nextSelected);
      setDraft(
        nextSelected
          ? draftFromRuntime(next.find((runtime) => runtime.id === nextSelected)!)
          : emptyDraft(),
      );
    } catch (err) {
      setFlash((err as Error).message || "Could not load runtimes");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function selectRuntime(runtime: AgentRuntimeDefinition): void {
    setSelectedId(runtime.id);
    setDraft(draftFromRuntime(runtime));
    setFlash(null);
    setBearerToken("");
    void loadCredentialStatus(runtime.id);
  }

  function startNewRuntime(): void {
    setSelectedId(null);
    setDraft(emptyDraft());
    setFlash(null);
    setBearerToken("");
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
        config: {
          ...draft.config,
          endpoint: draft.config.endpoint?.trim() || undefined,
          executablePath: draft.config.executablePath?.trim() || undefined,
          workspace: draft.config.workspace?.trim() || undefined,
        },
      });
      setFlash("Runtime saved");
      await load(saved.id);
    } catch (err) {
      setFlash((err as Error).message || "Could not save runtime");
    } finally {
      setBusy(null);
    }
  }

  async function probeRuntime(runtimeId = selectedId): Promise<void> {
    if (!runtimeId) return;
    setBusy("probe");
    try {
      const probe = await window.hermesAPI.probeAgentRuntime(runtimeId);
      setProbes((current) => ({ ...current, [runtimeId]: probe }));
      setFlash(probe.message || `Probe: ${probe.state}`);
    } catch (err) {
      setFlash((err as Error).message || "Probe failed");
    } finally {
      setBusy(null);
    }
  }

  async function removeRuntime(): Promise<void> {
    if (!selectedRuntime || selectedRuntime.managed === "builtin") return;
    setBusy("remove");
    try {
      await window.hermesAPI.removeAgentRuntime(selectedRuntime.id);
      setFlash("Runtime removed");
      await load();
    } catch (err) {
      setFlash((err as Error).message || "Could not remove runtime");
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
      setCredentialConfigured(true);
      setFlash("Bridge credential saved");
    } catch (err) {
      setFlash((err as Error).message || "Could not save Bridge credential");
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

  return (
    <div className="settings-modal-pane">
      {flash && <div className="settings-pane-flash">{flash}</div>}

      <section className="settings-card agent-runtimes-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <Bot size={19} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">Agent Runtimes</div>
            <div className="settings-card-sub">
              Registered runtimes available to orchestration.
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={() => void load(selectedId || undefined)}
            disabled={busy === "load"}
            title="Refresh runtimes"
          >
            <RefreshCw
              size={13}
              className={busy === "load" ? "settings-spin" : undefined}
            />
            Refresh
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={startNewRuntime}
            title="Add runtime"
          >
            <Plus size={13} />
            Add
          </button>
        </header>

        <div className="settings-card-body">
          <div className="agent-runtime-list">
            {runtimes.map((runtime) => {
              const probe = probes[runtime.id];
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
                      {KIND_LABELS[runtime.kind]} / {runtime.location}
                    </span>
                  </span>
                  <span
                    className={`agent-runtime-status agent-runtime-status--${
                      probe?.state || (runtime.enabled ? "unknown" : "disabled")
                    }`}
                  >
                    {runtime.enabled ? healthLabel(probe) : "Disabled"}
                  </span>
                </button>
              );
            })}
            {runtimes.length === 0 && (
              <div className="agent-runtime-empty">No runtimes registered.</div>
            )}
          </div>
        </div>
      </section>

      <section className="settings-card agent-runtimes-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <CheckCircle2 size={19} />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {isNew ? "New Runtime" : draft.name || "Runtime"}
            </div>
            <div className="settings-card-sub">
              {isBuiltin ? "Built-in runtime" : "User runtime"}
            </div>
          </div>
          {selectedRuntime && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => void probeRuntime()}
              disabled={busy === "probe" || !selectedRuntime.enabled}
              title="Probe runtime"
            >
              {busy === "probe" ? (
                <Loader2 size={13} className="settings-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Probe
            </button>
          )}
        </header>

        <div className="settings-card-body">
          <div className="agent-runtime-form-grid">
            <label className="settings-field">
              <span className="settings-field-label">Name</span>
              <input
                className="input"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                disabled={isBuiltin}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Runtime ID</span>
              <input
                className="input"
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
              <span className="settings-field-label">Kind</span>
              <select
                className="input"
                value={draft.kind}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    kind: event.target.value as AgentRuntimeKind,
                  }))
                }
                disabled={isBuiltin}
              >
                {AGENT_RUNTIME_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Transport</span>
              <select
                className="input"
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
            <label className="settings-field-label">Location</label>
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
                    {location[0].toUpperCase() + location.slice(1)}
                  </button>
                ),
              )}
            </div>
          </div>

          {draft.location === "remote" ? (
            <>
              <label className="settings-field">
                <span className="settings-field-label">Endpoint</span>
                <input
                  className="input"
                  type="url"
                  value={draft.config.endpoint || ""}
                  onChange={(event) => updateConfig("endpoint", event.target.value)}
                  placeholder="https://host.example/bridge"
                  disabled={isBuiltin}
                />
                <span className="settings-field-hint">
                  Credentials stay with the bridge or protected Hermes connection.
                </span>
              </label>
              {selectedRuntime?.kind === "openclaw" && !isBuiltin && (
                <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
                  <label className="settings-field">
                    <span className="settings-field-label">Bridge token</span>
                    <input
                      className="input"
                      type="password"
                      autoComplete="new-password"
                      value={bearerToken}
                      onChange={(event) => setBearerToken(event.target.value)}
                      placeholder={credentialConfigured ? "Configured" : "Bearer token"}
                    />
                  </label>
                  <div className="settings-card-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void saveBearerToken()}
                      disabled={savingCredential || !bearerToken.trim()}
                    >
                      {savingCredential ? <Loader2 size={14} className="settings-spin" /> : <Save size={14} />}
                      Save token
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="agent-runtime-form-grid">
              <label className="settings-field">
                <span className="settings-field-label">Executable</span>
                <input
                  className="input"
                  value={draft.config.executablePath || ""}
                  onChange={(event) =>
                    updateConfig("executablePath", event.target.value)
                  }
                  placeholder={draft.kind === "claude-code" ? "claude" : "codex"}
                  disabled={isBuiltin}
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Workspace</span>
                <input
                  className="input"
                  value={draft.config.workspace || ""}
                  onChange={(event) => updateConfig("workspace", event.target.value)}
                  placeholder="D:\\Agent Console"
                  disabled={isBuiltin}
                />
              </label>
            </div>
          )}

          <div className="agent-runtime-form-grid agent-runtime-form-grid--compact">
            <label className="settings-field">
              <span className="settings-field-label">Timeout</span>
              <input
                className="input"
                type="number"
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
              Enabled
            </label>
          </div>

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
              <div className="agent-runtime-capabilities">
                {trueCapabilities(selectedProbe).map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            </div>
          )}

          {!isBuiltin && (
            <div className="settings-card-actions">
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
                Save
              </button>
              {selectedRuntime && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void removeRuntime()}
                  disabled={busy === "remove"}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
