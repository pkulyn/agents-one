import { useState, useEffect, useCallback } from "react";
import { useI18n } from "../../components/useI18n";

interface ToolsetInfo {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

interface ToolsProps {
  profile?: string;
  showPlatformToolsets?: boolean;
}

// SVG icons per toolset key
const TOOL_ICONS: Record<string, React.JSX.Element> = {
  web: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  browser: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 3v6" />
    </svg>
  ),
  terminal: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m7 10 3 3-3 3M13 16h4" />
    </svg>
  ),
  file: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
    </svg>
  ),
  code_execution: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
      <line x1="14" y1="4" x2="10" y2="20" />
    </svg>
  ),
  vision: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  image_gen: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  ),
  tts: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  ),
  skills: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.315 8.685a.98.98 0 0 1 .837-.276c.47.07.802.48.968.925a2.501 2.501 0 1 0 3.214-3.214c-.446-.166-.855-.497-.925-.968a.979.979 0 0 1 .276-.837l1.61-1.61a2.404 2.404 0 0 1 1.705-.707c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02z" />
    </svg>
  ),
  memory: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    </svg>
  ),
  session_search: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6M8 11h6" />
    </svg>
  ),
  clarify: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  delegation: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  cronjob: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  moa: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  todo: (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
};

function ToolIcon({ toolKey }: { toolKey: string }): React.JSX.Element {
  return (
    <div className="tools-card-icon">
      {TOOL_ICONS[toolKey] || (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )}
    </div>
  );
}

interface McpServer {
  name: string;
  type: "http" | "stdio" | "unknown";
  transport: "http" | "stdio" | "unknown";
  enabled: boolean;
  detail: string;
  url?: string;
  command?: string;
  args: string[];
  env: Record<string, string>;
  auth?: string;
}

interface McpCatalogEntry {
  name: string;
  description: string;
  source: string;
  transport: "http" | "stdio" | "unknown";
  authType: string;
  requiredEnv: Array<{ name: string; prompt: string; required: boolean }>;
  needsInstall: boolean;
  installed: boolean;
  enabled: boolean;
}

interface AddMcpForm {
  name: string;
  type: "http" | "stdio";
  url: string;
  command: string;
  argsText: string;
  envText: string;
  auth: string;
}

const EMPTY_ADD_FORM: AddMcpForm = {
  name: "",
  type: "http",
  url: "",
  command: "",
  argsText: "",
  envText: "",
  auth: "",
};

function parseArgsText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
  }
  return env;
}

function IconButton({
  title,
  children,
  onClick,
  disabled,
  danger,
}: {
  title: string;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`tools-icon-btn ${danger ? "tools-icon-btn-danger" : ""}`}
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

function TinyIcon({ kind }: { kind: "plus" | "refresh" | "trash" | "test" | "server" | "x" | "install" }): React.JSX.Element {
  if (kind === "plus") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    );
  }
  if (kind === "refresh") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
      </svg>
    );
  }
  if (kind === "trash") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M3 6h18M8 6V4h8v2M6 6l1 18h10l1-18M10 11v6M14 11v6" />
      </svg>
    );
  }
  if (kind === "test") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M10 2v6L4 19a2 2 0 0 0 1.8 3h12.4a2 2 0 0 0 1.8-3L14 8V2M8 14h8" />
      </svg>
    );
  }
  if (kind === "x") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  if (kind === "install") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <circle cx="6" cy="18" r="1" />
    </svg>
  );
}

function Tools({
  profile,
  showPlatformToolsets = true,
}: ToolsProps): React.JSX.Element {
  const { t } = useI18n();
  const [toolsets, setToolsets] = useState<ToolsetInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [mcpError, setMcpError] = useState("");
  const [mcpMessage, setMcpMessage] = useState("");
  const [mcpBusy, setMcpBusy] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [addForm, setAddForm] = useState<AddMcpForm>(EMPTY_ADD_FORM);
  const [catalogEntries, setCatalogEntries] = useState<McpCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");

  const loadToolsets = useCallback(async (): Promise<void> => {
    setLoading(true);
    setMcpError("");
    try {
      const [list, mcp] = await Promise.all([
        showPlatformToolsets
          ? window.hermesAPI.getToolsets(profile)
          : Promise.resolve([]),
        window.hermesAPI.listMcpServers(profile),
      ]);
      setToolsets(list);
      setMcpServers(mcp);
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [profile, showPlatformToolsets]);

  useEffect(() => {
    loadToolsets();
  }, [loadToolsets]);

  async function handleToggle(
    key: string,
    currentEnabled: boolean,
  ): Promise<void> {
    setToolsets((prev) =>
      prev.map((t) => (t.key === key ? { ...t, enabled: !currentEnabled } : t)),
    );
    await window.hermesAPI.setToolsetEnabled(key, !currentEnabled, profile);
  }

  async function reloadMcp(): Promise<void> {
    setMcpError("");
    try {
      setMcpServers(await window.hermesAPI.listMcpServers(profile));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpLoadFailed"));
    }
  }

  async function handleAddMcp(): Promise<void> {
    setMcpError("");
    setMcpMessage("");
    setMcpBusy("add");
    try {
      const result = await window.hermesAPI.addMcpServer(
        {
          name: addForm.name,
          type: addForm.type,
          url: addForm.type === "http" ? addForm.url : undefined,
          command: addForm.type === "stdio" ? addForm.command : undefined,
          args: addForm.type === "stdio" ? parseArgsText(addForm.argsText) : [],
          env: addForm.type === "stdio" ? parseEnvText(addForm.envText) : {},
          auth: addForm.auth || undefined,
        },
        profile,
      );
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpAddFailed"));
        return;
      }
      setShowAddMcp(false);
      setAddForm(EMPTY_ADD_FORM);
      setMcpMessage(t("tools.mcpAdded"));
      await reloadMcp();
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpAddFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  async function handleRemoveMcp(name: string): Promise<void> {
    if (!window.confirm(t("tools.mcpRemoveConfirm", { name }))) return;
    setMcpBusy(`remove:${name}`);
    try {
      const result = await window.hermesAPI.removeMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpRemoveFailed"));
        return;
      }
      setMcpMessage(t("tools.mcpRemoved"));
      await reloadMcp();
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpRemoveFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  async function handleMcpEnabled(
    name: string,
    enabled: boolean,
  ): Promise<void> {
    setMcpBusy(`toggle:${name}`);
    setMcpServers((prev) =>
      prev.map((server) =>
        server.name === name ? { ...server, enabled } : server,
      ),
    );
    try {
      const result = await window.hermesAPI.setMcpServerEnabled(
        name,
        enabled,
        profile,
      );
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpToggleFailed"));
        await reloadMcp();
        return;
      }
      setMcpMessage(enabled ? t("tools.mcpEnabled") : t("tools.mcpDisabled"));
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpToggleFailed"));
      await reloadMcp();
    } finally {
      setMcpBusy("");
    }
  }

  async function handleTestMcp(name: string): Promise<void> {
    setMcpBusy(`test:${name}`);
    setMcpError("");
    setMcpMessage("");
    try {
      const result = await window.hermesAPI.testMcpServer(name, profile);
      if (!result.success) {
        setMcpError(result.error || t("tools.mcpTestFailed"));
        return;
      }
      setMcpMessage(
        t("tools.mcpTestPassed", { count: result.tools?.length || 0 }),
      );
    } catch (err) {
      setMcpError((err as Error).message || t("tools.mcpTestFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  async function openCatalog(): Promise<void> {
    setShowCatalog(true);
    setCatalogLoading(true);
    setCatalogError("");
    try {
      const result = await window.hermesAPI.listMcpCatalog(profile);
      setCatalogEntries(result.entries);
      setCatalogError(result.error || "");
    } catch (err) {
      setCatalogError((err as Error).message || t("tools.mcpCatalogLoadFailed"));
    } finally {
      setCatalogLoading(false);
    }
  }

  async function handleInstallCatalog(entry: McpCatalogEntry): Promise<void> {
    const env: Record<string, string> = {};
    for (const item of entry.requiredEnv) {
      const value = window.prompt(item.prompt || item.name, "");
      if (!value && item.required) return;
      if (value) env[item.name] = value;
    }

    setMcpBusy(`install:${entry.name}`);
    try {
      const result = await window.hermesAPI.installMcpCatalogEntry(
        entry.name,
        env,
        profile,
      );
      if (!result.success) {
        setCatalogError(result.error || t("tools.mcpInstallFailed"));
        return;
      }
      setMcpMessage(
        result.background
          ? t("tools.mcpInstallStarted")
          : t("tools.mcpInstalled"),
      );
      await reloadMcp();
      await openCatalog();
    } catch (err) {
      setCatalogError((err as Error).message || t("tools.mcpInstallFailed"));
    } finally {
      setMcpBusy("");
    }
  }

  if (loading) {
    return (
      <div className="tools-container">
        <div className="tools-loading">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="tools-container">
      {showPlatformToolsets && (
        <>
          <div className="tools-header">
            <h2 className="tools-title">{t("tools.title")}</h2>
            <p className="tools-subtitle">{t("tools.subtitle")}</p>
          </div>

          <div className="tools-grid">
            {toolsets.map((t) => (
              <div
                key={t.key}
                className={`tools-card ${t.enabled ? "tools-card-enabled" : "tools-card-disabled"}`}
                onClick={() => handleToggle(t.key, t.enabled)}
              >
                <div className="tools-card-top">
                  <ToolIcon toolKey={t.key} />
                  <label
                    className="tools-toggle"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={t.enabled}
                      onChange={() => handleToggle(t.key, t.enabled)}
                    />
                    <span className="tools-toggle-track" />
                  </label>
                </div>
                <div className="tools-card-label">{t.label}</div>
                <div className="tools-card-description">{t.description}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="tools-section">
        <div className="tools-header tools-header-row">
          <div>
            <h2 className="tools-title">{t("tools.mcpServers")}</h2>
            <p className="tools-subtitle">{t("tools.mcpDescription")}</p>
          </div>
          <div className="tools-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={openCatalog}
            >
              <TinyIcon kind="install" />
              {t("tools.mcpBrowseCatalog")}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void reloadMcp()}
            >
              <TinyIcon kind="refresh" />
              {t("tools.refresh")}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowAddMcp(true)}
            >
              <TinyIcon kind="plus" />
              {t("tools.mcpAddServer")}
            </button>
          </div>
        </div>

        {mcpError && <div className="tools-error">{mcpError}</div>}
        {mcpMessage && <div className="tools-success">{mcpMessage}</div>}

        {mcpServers.length === 0 ? (
          <div className="tools-empty">
            <div className="tools-card-icon">
              <TinyIcon kind="server" />
            </div>
            <div>
              <div className="tools-card-label">{t("tools.mcpEmptyTitle")}</div>
              <div className="tools-card-description">
                {t("tools.mcpEmptyDescription")}
              </div>
            </div>
          </div>
        ) : (
          <div className="tools-grid">
            {mcpServers.map((s) => (
              <div
                key={s.name}
                className={`tools-card tools-mcp-card ${s.enabled ? "tools-card-enabled" : "tools-card-disabled"}`}
              >
                <div className="tools-card-top">
                  <div className="tools-card-icon">
                    <TinyIcon kind="server" />
                  </div>
                  <div className="tools-mcp-actions">
                    <IconButton
                      title={t("tools.mcpTest")}
                      disabled={mcpBusy === `test:${s.name}`}
                      onClick={() => void handleTestMcp(s.name)}
                    >
                      <TinyIcon kind="test" />
                    </IconButton>
                    <IconButton
                      title={t("tools.mcpRemove")}
                      danger
                      disabled={mcpBusy === `remove:${s.name}`}
                      onClick={() => void handleRemoveMcp(s.name)}
                    >
                      <TinyIcon kind="trash" />
                    </IconButton>
                    <label
                      className="tools-toggle"
                      title={
                        s.enabled
                          ? t("tools.mcpDisable")
                          : t("tools.mcpEnable")
                      }
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        disabled={mcpBusy === `toggle:${s.name}`}
                        onChange={() =>
                          void handleMcpEnabled(s.name, !s.enabled)
                        }
                      />
                      <span className="tools-toggle-track" />
                    </label>
                  </div>
                </div>
                <div className="tools-card-label">{s.name}</div>
                <div className="tools-card-description">
                  <span className="tools-mcp-pill">
                    {s.type === "http"
                      ? t("tools.http")
                      : s.type === "stdio"
                        ? t("tools.stdio")
                        : t("tools.unknown")}
                  </span>
                  {!s.enabled && (
                    <span className="tools-mcp-disabled">
                      {t("tools.disabled")}
                    </span>
                  )}
                </div>
                <div className="tools-card-description tools-mcp-detail">
                  {s.detail || t("tools.mcpNoDetail")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddMcp && (
        <div className="models-modal-overlay" onClick={() => setShowAddMcp(false)}>
          <div className="models-modal" onClick={(e) => e.stopPropagation()}>
            <div className="models-modal-header">
              <h2 className="models-modal-title">{t("tools.mcpAddServer")}</h2>
              <button
                type="button"
                className="tools-icon-btn"
                aria-label={t("tools.close")}
                onClick={() => setShowAddMcp(false)}
              >
                <TinyIcon kind="x" />
              </button>
            </div>
            <div className="models-modal-body">
              <div className="models-modal-field">
                <label className="models-modal-label">{t("tools.mcpName")}</label>
                <input
                  className="input"
                  value={addForm.name}
                  onChange={(e) =>
                    setAddForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder="github"
                />
              </div>
              <div className="models-modal-field">
                <label className="models-modal-label">
                  {t("tools.mcpTransport")}
                </label>
                <select
                  className="input"
                  value={addForm.type}
                  onChange={(e) =>
                    setAddForm((prev) => ({
                      ...prev,
                      type: e.target.value as "http" | "stdio",
                    }))
                  }
                >
                  <option value="http">{t("tools.http")}</option>
                  <option value="stdio">{t("tools.stdio")}</option>
                </select>
              </div>
              {addForm.type === "http" ? (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label">{t("tools.mcpUrl")}</label>
                    <input
                      className="input"
                      value={addForm.url}
                      onChange={(e) =>
                        setAddForm((prev) => ({ ...prev, url: e.target.value }))
                      }
                      placeholder="https://example.com/mcp"
                    />
                  </div>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("tools.mcpAuth")}
                    </label>
                    <select
                      className="input"
                      value={addForm.auth}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          auth: e.target.value,
                        }))
                      }
                    >
                      <option value="">{t("tools.mcpAuthNone")}</option>
                      <option value="oauth">OAuth</option>
                      <option value="header">{t("tools.mcpAuthHeader")}</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("tools.mcpCommand")}
                    </label>
                    <input
                      className="input"
                      value={addForm.command}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          command: e.target.value,
                        }))
                      }
                      placeholder="npx"
                    />
                  </div>
                  <div className="models-modal-field">
                    <label className="models-modal-label">
                      {t("tools.mcpArgs")}
                    </label>
                    <textarea
                      className="input tools-textarea"
                      value={addForm.argsText}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          argsText: e.target.value,
                        }))
                      }
                      placeholder={"-y\n@modelcontextprotocol/server-github"}
                    />
                    <span className="models-modal-hint">
                      {t("tools.mcpArgsHint")}
                    </span>
                  </div>
                  <div className="models-modal-field">
                    <label className="models-modal-label">{t("tools.mcpEnv")}</label>
                    <textarea
                      className="input tools-textarea"
                      value={addForm.envText}
                      onChange={(e) =>
                        setAddForm((prev) => ({
                          ...prev,
                          envText: e.target.value,
                        }))
                      }
                      placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..."
                    />
                    <span className="models-modal-hint">
                      {t("tools.mcpEnvHint")}
                    </span>
                  </div>
                </>
              )}
            </div>
            <div className="models-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowAddMcp(false)}
              >
                {t("tools.cancel")}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={mcpBusy === "add"}
                onClick={() => void handleAddMcp()}
              >
                {t("tools.mcpAddServer")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCatalog && (
        <div className="models-modal-overlay" onClick={() => setShowCatalog(false)}>
          <div
            className="models-modal tools-catalog-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="models-modal-header">
              <h2 className="models-modal-title">
                {t("tools.mcpBrowseCatalog")}
              </h2>
              <button
                type="button"
                className="tools-icon-btn"
                aria-label={t("tools.close")}
                onClick={() => setShowCatalog(false)}
              >
                <TinyIcon kind="x" />
              </button>
            </div>
            <div className="models-modal-body">
              {catalogLoading ? (
                <div className="tools-card-description">
                  {t("tools.mcpCatalogLoading")}
                </div>
              ) : catalogError ? (
                <div className="tools-error">{catalogError}</div>
              ) : catalogEntries.length === 0 ? (
                <div className="tools-card-description">
                  {t("tools.mcpCatalogEmpty")}
                </div>
              ) : (
                <div className="tools-catalog-list">
                  {catalogEntries.map((entry) => (
                    <div key={entry.name} className="tools-catalog-row">
                      <div>
                        <div className="tools-card-label">{entry.name}</div>
                        <div className="tools-card-description">
                          {entry.description}
                        </div>
                        <div className="tools-card-description">
                          {entry.transport} · {entry.authType}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={
                          entry.installed || mcpBusy === `install:${entry.name}`
                        }
                        onClick={() => void handleInstallCatalog(entry)}
                      >
                        <TinyIcon kind="install" />
                        {entry.installed
                          ? t("tools.mcpInstalledStatus")
                          : t("tools.mcpInstall")}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Tools;
