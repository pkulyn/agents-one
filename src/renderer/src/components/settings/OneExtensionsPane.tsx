import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Loader2,
  Monitor,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  AgentRuntimeConfig,
  AgentRuntimeDefinition,
  OnePluginConfig,
} from "../../../../shared/agent-runtimes";
import type { RuntimeSkillDescriptor } from "../../../../shared/runtime-skills";
import OnePluginMcpPane from "./OnePluginMcpPane";
import { useI18n } from "../useI18n";
import type { OneAgentConfigSection } from "./OneAgentConfigurationPane";

interface OneExtensionsPaneProps {
  runtime: AgentRuntimeDefinition;
  section: "plugins" | "mcp" | "skills";
  onChanged: () => void;
  onSectionChange: (section: OneAgentConfigSection) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function OneExtensionsPane({
  runtime,
  section,
  onChanged,
  onSectionChange,
}: OneExtensionsPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [config, setConfig] = useState<AgentRuntimeConfig>(runtime.config);
  const [skills, setSkills] = useState<RuntimeSkillDescriptor[]>([]);
  const [skillsState, setSkillsState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [mcpFormOpen, setMcpFormOpen] = useState(false);

  useEffect(() => {
    setConfig(runtime.config);
  }, [runtime.id, runtime.config]);

  useEffect(() => {
    let alive = true;
    setSkillsState("loading");
    void window.agentsOneAPI
      .listRuntimeSkills(runtime.id)
      .then((items) => {
        if (!alive) return;
        setSkills(items.filter((item) => item.source === "user"));
        setSkillsState("ready");
      })
      .catch(() => {
        if (alive) {
          setSkills([]);
          setSkillsState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [runtime.id, refresh]);

  const plugins = config.onePlugins || [];
  const mcpServers = config.oneMcpServers || [];
  const selectedSkills = new Set(config.oneSkills || []);
  const availableSkillIds = new Set(skills.map((skill) => skill.id));
  const unavailableSkills = (config.oneSkills || []).filter(
    (id) => !availableSkillIds.has(id),
  );
  const skillDirName = (skill: RuntimeSkillDescriptor): string =>
    skill.id.slice(skill.id.indexOf(":") + 1);
  const oneSkillId = (skill: RuntimeSkillDescriptor): string =>
    `one:${skillDirName(skill)}`;
  const isSkillSelected = (skill: RuntimeSkillDescriptor): boolean =>
    selectedSkills.has(skill.id) ||
    selectedSkills.has(oneSkillId(skill)) ||
    (skill.id.startsWith("one:") &&
      (selectedSkills.has(`user:${skillDirName(skill)}`) ||
        selectedSkills.has(`agents-user:${skillDirName(skill)}`)));
  const search = query.trim().toLowerCase();

  const visiblePlugins = plugins.filter(
    (plugin) =>
      !search ||
      plugin.name.toLowerCase().includes(search) ||
      plugin.directory.toLowerCase().includes(search),
  );
  const ownedNames = new Set(
    skills
      .filter((skill) => skill.id.startsWith("one:"))
      .map((skill) => skillDirName(skill)),
  );
  const displayedSkills = skills.filter(
    (skill) =>
      skill.id.startsWith("one:") || !ownedNames.has(skillDirName(skill)),
  );
  const visibleSkills = displayedSkills.filter(
    (skill) =>
      !search ||
      skill.name.toLowerCase().includes(search) ||
      (skill.description || "").toLowerCase().includes(search),
  );
  const isInstalled = (skill: RuntimeSkillDescriptor): boolean =>
    skill.id.startsWith("one:") || isSkillSelected(skill);
  const installedSkills = displayedSkills.filter(isInstalled);
  const visibleInstalled = visibleSkills.filter(isInstalled);
  const visibleAvailable = visibleSkills.filter((skill) => !isInstalled(skill));

  async function persist(
    patch: Partial<AgentRuntimeConfig>,
    message: string,
  ): Promise<boolean> {
    setBusy("save");
    setNotice(null);
    try {
      const latest = await window.agentsOneAPI.listAgentRuntimes();
      const current =
        latest.find((item) => item.id === runtime.id)?.config || runtime.config;
      const saved = await window.agentsOneAPI.saveAgentRuntime({
        ...runtime,
        config: { ...current, ...patch },
      });
      setConfig(saved.config);
      setNotice(message);
      onChanged();
      return true;
    } catch (error) {
      setNotice(errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function importPlugin(): Promise<void> {
    setBusy("import");
    setNotice(null);
    try {
      const directory = await window.agentsOneAPI.selectOnePluginDirectory();
      if (!directory) return;
      const inspected =
        await window.agentsOneAPI.inspectOnePluginDirectory(directory);
      const next: OnePluginConfig = {
        id: inspected.id,
        name: inspected.name,
        ...(inspected.version ? { version: inspected.version } : {}),
        directory: inspected.directory,
        enabled: true,
      };
      const remaining = plugins.filter((plugin) => plugin.id !== next.id);
      if (remaining.length >= 64)
        throw new Error(t("agents.configPluginsLimit"));
      await persist(
        { onePlugins: [...remaining, next] },
        t("agents.configPluginAdded", { name: next.name }),
      );
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function togglePlugin(
    plugin: OnePluginConfig,
    enabled: boolean,
  ): Promise<void> {
    const next = plugins.map((item) =>
      item.id === plugin.id ? { ...item, enabled } : item,
    );
    await persist(
      { onePlugins: next },
      enabled
        ? t("agents.configPluginEnabled")
        : t("agents.configPluginDisabled"),
    );
  }

  async function removePlugin(plugin: OnePluginConfig): Promise<void> {
    await persist(
      { onePlugins: plugins.filter((item) => item.id !== plugin.id) },
      t("agents.configPluginRemoved"),
    );
  }

  async function toggleSkill(
    skill: RuntimeSkillDescriptor,
    enabled: boolean,
  ): Promise<void> {
    if (enabled) {
      if (isSkillSelected(skill)) return;
      if (skill.id.startsWith("one:")) {
        await persist(
          { oneSkills: [...(config.oneSkills || []), skill.id] },
          t("agents.configSkillsSaved"),
        );
        return;
      }
      setBusy("skill-copy");
      setNotice(null);
      try {
        const copied = await window.agentsOneAPI.importOneSkill(
          runtime.id,
          skill.id,
        );
        const next = [
          ...(config.oneSkills || []).filter(
            (id) => id !== skill.id && id !== oneSkillId(skill),
          ),
          copied.id,
        ];
        await persist({ oneSkills: next }, t("agents.configSkillAdded"));
        setRefresh((current) => current + 1);
      } catch (error) {
        setNotice(errorText(error));
      } finally {
        setBusy(null);
      }
      return;
    }
    const remove = new Set([
      skill.id,
      oneSkillId(skill),
      ...(skill.id.startsWith("one:")
        ? [`user:${skillDirName(skill)}`, `agents-user:${skillDirName(skill)}`]
        : []),
    ]);
    const next = (config.oneSkills || []).filter((id) => !remove.has(id));
    await persist({ oneSkills: next }, t("agents.configSkillsSaved"));
  }

  async function removeSkillCopy(skill: RuntimeSkillDescriptor): Promise<void> {
    if (
      !window.confirm(
        t("agents.configRemoveSkillConfirm", { name: skill.name }),
      )
    )
      return;
    setBusy("skill-remove");
    setNotice(null);
    try {
      await window.agentsOneAPI.removeOneSkill(runtime.id, skillDirName(skill));
      const remove = new Set([skill.id, oneSkillId(skill)]);
      const next = (config.oneSkills || []).filter((id) => !remove.has(id));
      await persist({ oneSkills: next }, t("agents.configSkillRemoved"));
      setRefresh((current) => current + 1);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  async function removeUnavailableSkills(): Promise<void> {
    const available = (config.oneSkills || []).filter((id) =>
      availableSkillIds.has(id),
    );
    await persist({ oneSkills: available }, t("agents.configSkillsSaved"));
  }

  const title =
    section === "plugins"
      ? t("agents.configPlugins")
      : section === "mcp"
        ? t("agents.configMcpTitle")
        : t("agents.configSkills");
  const description =
    section === "plugins"
      ? t("agents.configPluginsHint")
      : section === "mcp"
        ? t("agents.configMcpHint")
        : t("agents.configSkillsHint", { name: runtime.name });
  const searchPlaceholder =
    section === "plugins"
      ? t("agents.configSearchPlugins")
      : section === "mcp"
        ? t("agents.configSearchMcp")
        : t("agents.configSearchSkills");

  function switchSection(next: "plugins" | "mcp" | "skills"): void {
    setQuery("");
    setNotice(null);
    onSectionChange(next);
  }

  return (
    <section className="agent-one-config-panel agent-one-config-panel--simple">
      <header className="agent-one-config-panel-head">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="agent-one-config-head-actions">
          {section === "plugins" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy !== null}
              onClick={() => void importPlugin()}
            >
              {busy === "import" ? (
                <Loader2 size={14} className="settings-spin" />
              ) : (
                <Plus size={14} />
              )}
              {t("agents.configAddPlugin")}
            </button>
          )}
          {section === "mcp" && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setMcpFormOpen(true)}
            >
              <Plus size={14} />
              {t("agents.configAddMcp")}
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm agent-one-model-icon"
            aria-label={t("agents.configExtRefresh")}
            onClick={() => setRefresh((current) => current + 1)}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="agent-one-ext-toolbar">
        <span className="agent-one-ext-scope">
          <Monitor size={14} aria-hidden="true" />
          {t("agents.configExtScope")}
        </span>
        <div
          className="agent-one-ext-tabs"
          role="tablist"
          aria-label={t("agents.configExtensions")}
        >
          <button
            type="button"
            role="tab"
            aria-selected={section === "plugins"}
            onClick={() => switchSection("plugins")}
          >
            {t("agents.configPlugins")}
            <span className="agent-one-ext-count">{plugins.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "mcp"}
            onClick={() => switchSection("mcp")}
          >
            {t("agents.configMcpTab")}
            <span className="agent-one-ext-count">{mcpServers.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={section === "skills"}
            onClick={() => switchSection("skills")}
          >
            {t("agents.configSkills")}
            <span className="agent-one-ext-count">
              {installedSkills.length}
            </span>
          </button>
        </div>
        <label className="agent-one-ext-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="agent-one-config-panel-body">
        {section === "plugins" && (
          <>
            <div className="agent-one-ext-head">
              <strong>{t("agents.configInstalledCount")}</strong>
              <span>{plugins.length}</span>
            </div>
            {visiblePlugins.length ? (
              <div className="agent-one-ext-rows">
                {visiblePlugins.map((plugin) => (
                  <div className="agent-one-ext-row" key={plugin.id}>
                    <span className="agent-one-ext-icon" aria-hidden="true">
                      <Puzzle size={17} />
                    </span>
                    <div className="agent-one-ext-main">
                      <strong>{plugin.name}</strong>
                      <small>
                        {plugin.version ? `v${plugin.version} · ` : ""}
                        {plugin.directory}
                      </small>
                    </div>
                    <div className="agent-one-ext-actions">
                      <input
                        className="agent-one-switch"
                        type="checkbox"
                        checked={plugin.enabled}
                        aria-label={t("agents.configTogglePlugin", {
                          name: plugin.name,
                        })}
                        disabled={busy !== null}
                        onChange={(event) =>
                          void togglePlugin(plugin, event.target.checked)
                        }
                      />
                      <button
                        type="button"
                        className="agent-one-model-icon"
                        aria-label={t("agents.configRemovePlugin", {
                          name: plugin.name,
                        })}
                        disabled={busy !== null}
                        onClick={() => void removePlugin(plugin)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : plugins.length ? (
              <div className="agent-one-config-state">
                {t("agents.configSearchEmpty")}
              </div>
            ) : (
              <div className="agent-one-ext-empty">
                <strong>{t("agents.configPluginsEmptyTitle")}</strong>
                <p>{t("agents.configPluginsEmptyHint")}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busy !== null}
                  onClick={() => void importPlugin()}
                >
                  <Plus size={14} />
                  {t("agents.configAddPlugin")}
                </button>
              </div>
            )}
          </>
        )}

        {section === "mcp" && (
          <>
            <div className="agent-one-ext-head">
              <strong>{t("agents.configInstalledCount")}</strong>
              <span>{mcpServers.length}</span>
            </div>
            {mcpServers.length || mcpFormOpen ? (
              <OnePluginMcpPane
                key={`one-mcp:${runtime.id}`}
                runtime={runtime}
                section="mcp"
                onChanged={() => {
                  onChanged();
                  setRefresh((current) => current + 1);
                }}
                headerless
                query={query}
              />
            ) : (
              <div className="agent-one-ext-empty">
                <strong>{t("agents.configMcpEmptyTitle")}</strong>
                <p>{t("agents.configMcpEmptyHint")}</p>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setMcpFormOpen(true)}
                >
                  <Plus size={14} />
                  {t("agents.configAddMcp")}
                </button>
              </div>
            )}
          </>
        )}

        {section === "skills" && (
          <>
            {skillsState === "error" && (
              <div className="agent-one-ext-diag" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                {t("agents.configSkillsLoadError")}
              </div>
            )}
            {skillsState === "ready" && unavailableSkills.length > 0 && (
              <div className="agent-one-ext-diag" role="alert">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>
                  {t("agents.configUnavailableSkills", {
                    count: unavailableSkills.length,
                    names: unavailableSkills.join("、"),
                  })}
                </span>
                <button
                  type="button"
                  className="agent-one-memory-edit"
                  disabled={busy !== null}
                  onClick={() => void removeUnavailableSkills()}
                >
                  {t("agents.configRemoveUnavailableSkills")}
                </button>
              </div>
            )}
            <div className="agent-one-ext-head">
              <strong>{t("agents.configInstalledCount")}</strong>
              <span>{installedSkills.length}</span>
            </div>
            {skillsState === "loading" ? (
              <div className="agent-one-config-state">
                <Loader2 size={18} className="settings-spin" />
                {t("agents.configSkillsLoading")}
              </div>
            ) : skills.length === 0 ? (
              <div className="agent-one-ext-empty">
                <strong>{t("agents.configSkillsEmptyTitle")}</strong>
                <p>{t("agents.configSkillsEmpty")}</p>
              </div>
            ) : (
              <>
                {visibleInstalled.length ? (
                  <div className="agent-one-ext-rows">
                    {visibleInstalled.map((skill) => (
                      <div className="agent-one-ext-row" key={skill.id}>
                        <span className="agent-one-ext-icon" aria-hidden="true">
                          <Sparkles size={17} />
                        </span>
                        <div className="agent-one-ext-main">
                          <strong>{skill.name}</strong>
                          <small>{skill.description || skill.location}</small>
                        </div>
                        <div className="agent-one-ext-actions">
                          <input
                            className="agent-one-switch"
                            type="checkbox"
                            role="switch"
                            checked={isSkillSelected(skill)}
                            aria-label={t("agents.configEnableSkill", {
                              name: skill.name,
                            })}
                            disabled={busy !== null}
                            onChange={(event) =>
                              void toggleSkill(skill, event.target.checked)
                            }
                          />
                          <button
                            type="button"
                            className="agent-one-model-icon"
                            aria-label={t("agents.configRemoveSkill", {
                              name: skill.name,
                            })}
                            disabled={busy !== null}
                            onClick={() => void removeSkillCopy(skill)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="agent-one-config-state">
                    {t("agents.configSkillsNoneInstalled")}
                  </div>
                )}
                {visibleAvailable.length > 0 && (
                  <>
                    <div className="agent-one-ext-head agent-one-ext-head--available">
                      <strong>{t("agents.configAvailableSkills")}</strong>
                      <span>{visibleAvailable.length}</span>
                    </div>
                    <div className="agent-one-ext-rows">
                      {visibleAvailable.map((skill) => (
                        <div className="agent-one-ext-row" key={skill.id}>
                          <span
                            className="agent-one-ext-icon"
                            aria-hidden="true"
                          >
                            <Sparkles size={17} />
                          </span>
                          <div className="agent-one-ext-main">
                            <strong>
                              {skill.name}
                              {skill.oneIssue && (
                                <span className="agent-one-ext-warn">
                                  {t("agents.configSkillUnavailable")}
                                </span>
                              )}
                            </strong>
                            <small>{skill.description || skill.location}</small>
                          </div>
                          <div className="agent-one-ext-actions">
                            <input
                              className="agent-one-switch"
                              type="checkbox"
                              role="switch"
                              checked={false}
                              aria-label={t("agents.configAddSkill", {
                                name: skill.name,
                              })}
                              disabled={
                                busy !== null || Boolean(skill.oneIssue)
                              }
                              onChange={(event) =>
                                void toggleSkill(skill, event.target.checked)
                              }
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {!visibleSkills.length && search && (
                  <div className="agent-one-config-state">
                    {t("agents.configSearchEmpty")}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {notice && (
          <div className="agent-one-config-notice" role="status">
            {notice}
          </div>
        )}
      </div>
    </section>
  );
}
