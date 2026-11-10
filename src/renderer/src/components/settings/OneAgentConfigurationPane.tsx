import { useEffect, useState } from "react";
import { FileText, Loader2, Save } from "lucide-react";
import type { AgentRuntimeDefinition } from "../../../../shared/agent-runtimes";
import OneModelProvidersPane from "./OneModelProvidersPane";
import OneMemoryPane from "./OneMemoryPane";
import OneExtensionsPane from "./OneExtensionsPane";
import { useI18n } from "../useI18n";

export type OneAgentConfigSection =
  | "model"
  | "personality"
  | "memory"
  | "plugins"
  | "mcp"
  | "skills";

interface OneAgentConfigurationPaneProps {
  runtime: AgentRuntimeDefinition;
  section: OneAgentConfigSection;
  onChanged: () => void;
  onSectionChange?: (section: OneAgentConfigSection) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EXAMPLE_AGENTS_MD = `# Agents One · One

你是 Agents One 中的 One 智能体，与用户在同一台设备上协作。

## 工作方式
- 先理解目标与约束，再动手；不确定时先问一个关键问题。
- 优先复用项目已有组件与数据契约，做最小改动。
- 修改前先读现有配置，保留未知键与用户数据。

## 输出
- 用中文回复，除非用户使用其他语言。
- 先给结论，再给必要的细节，不堆砌选项。
- 涉及文件时给出可点击的相对路径。

## 边界
- 不执行破坏性命令，除非用户明确要求。
- 不把私有计划、审计记录与凭据写入公开文档。
`;

export default function OneAgentConfigurationPane({
  runtime,
  section,
  onChanged,
  onSectionChange,
}: OneAgentConfigurationPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [agentsMd, setAgentsMd] = useState("");
  const [savedAgentsMd, setSavedAgentsMd] = useState("");
  const [agentsMdState, setAgentsMdState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [busy, setBusy] = useState<"save" | "agents-md" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (section !== "personality") return;
    let active = true;
    setAgentsMdState("loading");
    void window.agentsOneAPI
      .getOneAgentAgentsMd(runtime.id)
      .then((value) => {
        if (!active) return;
        setAgentsMd(value || EXAMPLE_AGENTS_MD);
        setSavedAgentsMd(value);
        setAgentsMdState("ready");
      })
      .catch(() => {
        if (active) setAgentsMdState("error");
      });
    return () => {
      active = false;
    };
  }, [runtime.id, section]);

  async function saveAgentsMd(): Promise<void> {
    setBusy("agents-md");
    setNotice(null);
    try {
      await window.agentsOneAPI.saveOneAgentAgentsMd(runtime.id, agentsMd);
      setSavedAgentsMd(agentsMd);
      setNotice(t("agents.configAgentsMdSaved"));
      onChanged();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  if (section === "model") {
    return (
      <OneModelProvidersPane
        key={`one-model-providers:${runtime.id}`}
        runtime={runtime}
        onChanged={onChanged}
      />
    );
  }

  if (section === "personality") {
    const bytes = new TextEncoder().encode(agentsMd).length;
    const dirty = agentsMd !== savedAgentsMd;
    return (
      <section className="agent-one-config-panel agent-one-config-panel--simple">
        <header className="agent-one-config-panel-head">
          <div>
            <h3>{t("agents.configPersonalization")}</h3>
            <p>{t("agents.configPersonalizationDescription")}</p>
          </div>
        </header>
        <div className="agent-one-config-panel-body">
          {agentsMdState === "loading" ? (
            <div className="agent-one-config-state">
              <Loader2 size={18} className="settings-spin" />
              {t("agents.configAgentsMdLoading")}
            </div>
          ) : agentsMdState === "error" ? (
            <div className="agent-one-config-state" role="alert">
              {t("agents.configAgentsMdLoadError")}
            </div>
          ) : (
            <>
              <div className="agent-one-personality-editor">
                <textarea
                  className="agent-one-personality-input"
                  aria-label={t("agents.configAgentsMd")}
                  maxLength={100000}
                  value={agentsMd}
                  onChange={(event) => {
                    setAgentsMd(event.target.value);
                    setNotice(null);
                  }}
                  placeholder={t("agents.configPersonalityPlaceholder")}
                />
              </div>
              <div className="agent-one-personality-meta">
                <span className="agent-one-personality-size">
                  {(bytes / 1024).toFixed(1)} KB / 100 KB
                </span>
                {dirty ? (
                  <span className="agent-one-personality-dirty">
                    {t("agents.configAgentsMdUnsaved")}
                  </span>
                ) : agentsMd ? (
                  <span className="agent-one-personality-saved">
                    {t("agents.configAgentsMdSavedState")}
                  </span>
                ) : null}
                <span className="agent-one-personality-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!dirty || busy !== null}
                    onClick={() => {
                      setAgentsMd(savedAgentsMd);
                      setNotice(null);
                    }}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={!dirty || busy !== null}
                    onClick={() => void saveAgentsMd()}
                  >
                    {busy === "agents-md" ? (
                      <Loader2 size={14} className="settings-spin" />
                    ) : (
                      <Save size={14} />
                    )}
                    {t("common.save")}
                  </button>
                </span>
              </div>
              <div className="agent-one-personality-source">
                <FileText size={14} aria-hidden="true" />
                <span>{t("agents.configAgentsMdSource")}</span>
                <code>desktop/one/{runtime.id}/AGENTS.md</code>
                <span className="agent-one-personality-path-hint">
                  {t("agents.configAgentsMdHint")}
                </span>
              </div>
              {!agentsMd && (
                <button
                  type="button"
                  className="agent-one-personality-example"
                  onClick={() => {
                    setAgentsMd(EXAMPLE_AGENTS_MD);
                    setNotice(null);
                  }}
                >
                  {t("agents.configAgentsMdExample")}
                </button>
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

  if (section === "memory") {
    return (
      <OneMemoryPane
        key={`one-memory:${runtime.id}`}
        runtime={runtime}
        onChanged={onChanged}
      />
    );
  }

  if (section === "plugins" || section === "mcp" || section === "skills") {
    return (
      <OneExtensionsPane
        key={`one-extensions:${runtime.id}`}
        runtime={runtime}
        section={section}
        onChanged={onChanged}
        onSectionChange={onSectionChange || (() => {})}
      />
    );
  }

  return <></>;
}
