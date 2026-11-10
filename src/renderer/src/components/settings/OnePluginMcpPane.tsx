import { useState } from "react";
import {
  Cable,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import type {
  AgentRuntimeConfig,
  AgentRuntimeDefinition,
  OneMcpServerConfig,
  OnePluginConfig,
} from "../../../../shared/agent-runtimes";
import { useI18n } from "../useI18n";

type Section = "plugins" | "mcp";
type McpTool = { name: string; description: string; readOnly: boolean };

export default function OnePluginMcpPane({
  runtime,
  section,
  onChanged,
  headerless,
  query,
}: {
  runtime: AgentRuntimeDefinition;
  section: Section;
  onChanged: () => void;
  headerless?: boolean;
  query?: string;
}): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentRuntimeConfig>(runtime.config);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [serverName, setServerName] = useState("");
  const [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [envText, setEnvText] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpTool[]>>(
    {},
  );
  const search = (query || "").trim().toLowerCase();
  const visiblePlugins = (config.onePlugins || []).filter(
    (plugin) =>
      !search ||
      plugin.name.toLowerCase().includes(search) ||
      plugin.directory.toLowerCase().includes(search),
  );
  const visibleMcpServers = (config.oneMcpServers || []).filter(
    (server) =>
      !search ||
      server.name.toLowerCase().includes(search) ||
      (server.url || server.command || "").toLowerCase().includes(search),
  );

  async function persist(
    next: AgentRuntimeConfig,
    message: string,
  ): Promise<boolean> {
    setBusy("save");
    setNotice("");
    try {
      const latest = await window.agentsOneAPI.listAgentRuntimes();
      const current =
        latest.find((item) => item.id === runtime.id)?.config || runtime.config;
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: {
          ...current,
          onePlugins: next.onePlugins,
          oneMcpServers: next.oneMcpServers,
        },
      });
      setConfig(saved.config);
      setNotice(message);
      onChanged();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function importPlugin(): Promise<void> {
    setBusy("plugin");
    setNotice("");
    try {
      const directory = await window.agentsOneAPI.selectOnePluginDirectory();
      if (!directory) return;
      const plugin =
        await window.agentsOneAPI.inspectOnePluginDirectory(directory);
      const next: OnePluginConfig = {
        id: plugin.id,
        name: plugin.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        directory: plugin.directory,
        enabled: true,
      };
      const plugins = (config.onePlugins || []).filter(
        (item) => item.id !== next.id,
      );
      if (plugins.length >= 64) throw new Error(t("agents.configPluginsLimit"));
      const saved = await persist(
        { ...config, onePlugins: [...plugins, next] },
        t("agents.configPluginAdded"),
      );
      if (saved)
        setNotice(
          t("agents.configPluginAddedWithSkills", {
            name: plugin.name,
            count: plugin.skillCount,
          }),
        );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function togglePlugin(
    plugin: OnePluginConfig,
    enabled: boolean,
  ): Promise<void> {
    await persist(
      {
        ...config,
        onePlugins: (config.onePlugins || []).map((item) =>
          item.id === plugin.id ? { ...item, enabled } : item,
        ),
      },
      enabled
        ? t("agents.configPluginEnabled")
        : t("agents.configPluginDisabled"),
    );
  }

  async function removePlugin(plugin: OnePluginConfig): Promise<void> {
    await persist(
      {
        ...config,
        onePlugins: (config.onePlugins || []).filter(
          (item) => item.id !== plugin.id,
        ),
      },
      t("agents.configPluginRemoved"),
    );
  }

  function parseEnv(): Record<string, string> {
    const values: Record<string, string> = {};
    for (const line of envText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const split = line.indexOf("=");
      if (split < 1) throw new Error(t("agents.configMcpEnvInvalid"));
      const name = line.slice(0, split).trim();
      const value = line.slice(split + 1);
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        throw new Error(t("agents.configMcpEnvInvalid"));
      values[name] = value;
    }
    return values;
  }

  async function addServer(): Promise<void> {
    setBusy("add");
    setNotice("");
    try {
      const name = serverName.trim();
      if (!name) throw new Error(t("agents.configMcpNameRequired"));
      const idBase =
        name
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "mcp-server";
      let id = idBase;
      let suffix = 2;
      while ((config.oneMcpServers || []).some((server) => server.id === id))
        id = `${idBase}-${suffix++}`;
      const secretValues =
        transport === "stdio"
          ? parseEnv()
          : authToken.trim()
            ? { authorization: authToken.trim() }
            : {};
      const server: OneMcpServerConfig = {
        id,
        name,
        transport,
        enabled: true,
        ...(transport === "stdio"
          ? {
              command: command.trim(),
              args: args.split(/\s+/).filter(Boolean),
              envNames: Object.keys(secretValues),
            }
          : { url: url.trim() }),
        allowedTools: [],
      };
      const next = {
        ...config,
        oneMcpServers: [...(config.oneMcpServers || []), server],
      };
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: next,
      });
      setConfig(saved.config);
      onChanged();
      if (Object.keys(secretValues).length)
        await window.agentsOneAPI.setOneMcpSecrets(
          runtime.id,
          id,
          secretValues,
        );
      setServerName("");
      setCommand("");
      setArgs("");
      setUrl("");
      setEnvText("");
      setAuthToken("");
      setNotice(t("agents.configMcpAdded"));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function testServer(server: OneMcpServerConfig): Promise<void> {
    setBusy(`test:${server.id}`);
    setNotice("");
    try {
      const tools = await window.agentsOneAPI.testOneMcpServer(
        runtime.id,
        server.id,
      );
      setToolsByServer((current) => ({ ...current, [server.id]: tools }));
      setNotice(
        t("agents.configMcpTested", { count: tools.length, name: server.name }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function updateServer(
    server: OneMcpServerConfig,
    patch: Partial<OneMcpServerConfig>,
  ): Promise<void> {
    await persist(
      {
        ...config,
        oneMcpServers: (config.oneMcpServers || []).map((item) =>
          item.id === server.id ? { ...item, ...patch } : item,
        ),
      },
      t("agents.configMcpSaved"),
    );
  }

  async function removeServer(server: OneMcpServerConfig): Promise<void> {
    setBusy(`remove:${server.id}`);
    try {
      await window.agentsOneAPI.setOneMcpSecrets(runtime.id, server.id, {});
      await persist(
        {
          ...config,
          oneMcpServers: (config.oneMcpServers || []).filter(
            (item) => item.id !== server.id,
          ),
        },
        t("agents.configMcpRemoved"),
      );
      setToolsByServer((current) => {
        const next = { ...current };
        delete next[server.id];
        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  if (section === "plugins") {
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        {!headerless && (
          <header className="agent-one-config-panel-head">
            <div>
              <h3>{t("agents.configPlugins")}</h3>
              <p>{t("agents.configPluginsHint")}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void importPlugin()}
            >
              {busy === "plugin" ? (
                <Loader2 size={14} className="settings-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t("agents.configAddPlugin")}
            </button>
          </header>
        )}
        <div className="agent-one-config-panel-body">
          {visiblePlugins.length ? (
            <div className="agent-one-extension-list">
              {visiblePlugins.map((plugin) => (
                <article className="agent-one-extension-card" key={plugin.id}>
                  <div className="agent-one-extension-icon">
                    <Puzzle size={18} />
                  </div>
                  <div className="agent-one-extension-main">
                    <strong>{plugin.name}</strong>
                    <small>
                      {plugin.version ? `v${plugin.version} · ` : ""}
                      {plugin.id}
                    </small>
                    <small>{plugin.directory}</small>
                  </div>
                  <label className="agent-one-extension-switch">
                    <span>
                      {plugin.enabled
                        ? t("agents.enabled")
                        : t("agents.disabled")}
                    </span>
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={t("agents.configTogglePlugin", {
                        name: plugin.name,
                      })}
                      checked={plugin.enabled}
                      disabled={busy !== null}
                      onChange={(event) =>
                        void togglePlugin(plugin, event.target.checked)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="agent-one-model-remove"
                    aria-label={t("agents.configRemovePlugin", {
                      name: plugin.name,
                    })}
                    disabled={busy !== null}
                    onClick={() => void removePlugin(plugin)}
                  >
                    <Trash2 size={15} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="agent-one-config-state">
              {t("agents.configPluginsEmpty")}
            </div>
          )}
          <div className="agent-one-config-note">
            {t("agents.configPluginSafety")}
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

  return (
    <section className="agent-one-config-panel agent-one-config-panel--simple">
      {!headerless && (
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configMcpTitle")}</h3>
            <p>{t("agents.configMcpHint")}</p>
          </div>
        </header>
      )}
      <div className="agent-one-config-panel-body agent-one-mcp-settings">
        <div className="agent-one-mcp-form">
          <label className="settings-field">
            <span className="settings-field-label">
              {t("agents.configMcpName")}
            </span>
            <input
              className="input"
              value={serverName}
              maxLength={128}
              onChange={(event) => setServerName(event.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">
              {t("agents.configMcpTransport")}
            </span>
            <select
              className="input"
              value={transport}
              onChange={(event) =>
                setTransport(event.target.value as "stdio" | "http")
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">Streamable HTTP</option>
            </select>
          </label>
          {transport === "stdio" ? (
            <>
              <label className="settings-field agent-one-config-field--wide">
                <span className="settings-field-label">
                  {t("agents.configMcpCommand")}
                </span>
                <input
                  className="input"
                  value={command}
                  maxLength={2048}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="node"
                />
              </label>
              <label className="settings-field agent-one-config-field--wide">
                <span className="settings-field-label">
                  {t("agents.configMcpArgs")}
                </span>
                <input
                  className="input"
                  value={args}
                  maxLength={8192}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder="server.js --stdio"
                />
              </label>
              <label className="settings-field agent-one-config-field--wide">
                <span className="settings-field-label">
                  {t("agents.configMcpEnvironment")}
                </span>
                <textarea
                  className="input"
                  rows={3}
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  placeholder="API_KEY=…"
                />
              </label>
            </>
          ) : (
            <>
              <label className="settings-field agent-one-config-field--wide">
                <span className="settings-field-label">
                  {t("agents.configMcpUrl")}
                </span>
                <input
                  className="input"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/mcp"
                />
              </label>
              <label className="settings-field agent-one-config-field--wide">
                <span className="settings-field-label">
                  {t("agents.configMcpBearer")}
                </span>
                <input
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={authToken}
                  onChange={(event) => setAuthToken(event.target.value)}
                  placeholder={t("agents.configMcpBearerHint")}
                />
              </label>
            </>
          )}
          <div className="agent-one-config-field--wide agent-one-mcp-form-footer">
            <span className="settings-field-hint">
              {t("agents.configMcpSecretHint")}
            </span>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={
                busy !== null ||
                !serverName.trim() ||
                (transport === "stdio" ? !command.trim() : !url.trim())
              }
              onClick={() => void addServer()}
            >
              {busy === "add" ? (
                <Loader2 size={14} className="settings-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t("agents.configMcpAdd")}
            </button>
          </div>
        </div>
        {visibleMcpServers.length ? (
          <div className="agent-one-extension-list">
            {visibleMcpServers.map((server) => (
              <article
                className="agent-one-extension-card agent-one-mcp-card"
                key={server.id}
              >
                <div className="agent-one-extension-icon">
                  <Cable size={18} />
                </div>
                <div className="agent-one-extension-main">
                  <strong>{server.name}</strong>
                  <small>
                    {server.transport === "stdio"
                      ? `${server.command} ${(server.args || []).join(" ")}`
                      : server.url}
                  </small>
                  <small>
                    {server.allowedTools.length
                      ? t("agents.configMcpAllowedCount", {
                          count: server.allowedTools.length,
                        })
                      : t("agents.configMcpNoAllowedTools")}
                  </small>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void testServer(server)}
                >
                  {busy === `test:${server.id}` ? (
                    <Loader2 size={14} className="settings-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {t("agents.configMcpDiscover")}
                </button>
                <label className="agent-one-extension-switch">
                  <span>
                    {server.enabled
                      ? t("agents.enabled")
                      : t("agents.disabled")}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={t("agents.configToggleMcp", {
                      name: server.name,
                    })}
                    checked={server.enabled}
                    disabled={busy !== null}
                    onChange={(event) =>
                      void updateServer(server, {
                        enabled: event.target.checked,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="agent-one-model-remove"
                  aria-label={t("agents.configRemoveMcp", {
                    name: server.name,
                  })}
                  disabled={busy !== null}
                  onClick={() => void removeServer(server)}
                >
                  <Trash2 size={15} />
                </button>
                {toolsByServer[server.id] && (
                  <div className="agent-one-mcp-tools">
                    <strong>{t("agents.configMcpAllowedTools")}</strong>
                    {toolsByServer[server.id].map((tool) => {
                      const allowed = server.allowedTools.includes(tool.name);
                      return (
                        <label key={tool.name}>
                          <input
                            type="checkbox"
                            aria-label={t("agents.configMcpAllowTool", {
                              name: tool.name,
                            })}
                            checked={allowed}
                            onChange={(event) =>
                              void updateServer(server, {
                                allowedTools: event.target.checked
                                  ? [...server.allowedTools, tool.name]
                                  : server.allowedTools.filter(
                                      (item) => item !== tool.name,
                                    ),
                              })
                            }
                          />
                          <span>
                            <b>{tool.name}</b>
                            <small>
                              {tool.description ||
                                (tool.readOnly
                                  ? t("agents.configMcpReadOnly")
                                  : t("agents.configMcpMayWrite"))}
                            </small>
                          </span>
                        </label>
                      );
                    })}
                    {toolsByServer[server.id].length === 0 && (
                      <span className="settings-field-hint">
                        {t("agents.configMcpNoTools")}
                      </span>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="agent-one-config-state">
            {t("agents.configMcpEmpty")}
          </div>
        )}
        <div className="agent-one-config-note">
          {t("agents.configMcpSafety")}
        </div>
        {notice && (
          <div className="agent-one-config-notice" role="status">
            {notice}
          </div>
        )}
        {busy === "save" && (
          <span className="settings-field-hint">
            <Save size={14} /> {t("agents.configSaving")}
          </span>
        )}
      </div>
    </section>
  );
}
