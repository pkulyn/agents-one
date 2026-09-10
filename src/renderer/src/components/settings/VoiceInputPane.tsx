import { LoaderCircle, Mic, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../useI18n";

interface VoiceInputConfig {
  enabled: boolean;
  url: string;
  hasApiKey: boolean;
  configured: boolean;
}

interface VoiceInputPaneProps {
  profile?: string;
}

function bridgeUnavailableMessage(t: (key: string) => string): string {
  return t("settings.voice.bridgeUnavailable");
}

/**
 * Configures an independently hosted, OpenAI-compatible transcription service.
 * The API key only crosses the preload bridge while being saved or tested and
 * is never included in the public configuration readback.
 */
export default function VoiceInputPane({
  profile,
}: VoiceInputPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      if (typeof window.agentsOneAPI.getVoiceInputConfig !== "function") {
        throw new Error(bridgeUnavailableMessage(t));
      }
      const config: VoiceInputConfig =
        await window.agentsOneAPI.getVoiceInputConfig(profile);
      setEnabled(config.enabled);
      setUrl(config.url);
      setHasApiKey(config.hasApiKey);
      setApiKey("");
      setClearApiKey(false);
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : t("settings.voice.loadFailed"),
      });
    } finally {
      setLoading(false);
    }
  }, [profile, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      if (typeof window.agentsOneAPI.saveVoiceInputConfig !== "function") {
        throw new Error(bridgeUnavailableMessage(t));
      }
      const config = await window.agentsOneAPI.saveVoiceInputConfig(
        {
          enabled,
          url,
          apiKey: apiKey || undefined,
          clearApiKey,
        },
        profile,
      );
      setEnabled(config.enabled);
      setUrl(config.url);
      setHasApiKey(config.hasApiKey);
      setApiKey("");
      setClearApiKey(false);
      setNotice({ kind: "success", message: t("settings.voice.saved") });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : t("settings.voice.saveFailed"),
      });
    } finally {
      setSaving(false);
    }
  }, [apiKey, clearApiKey, enabled, profile, t, url]);

  const testConnection = useCallback(async (): Promise<void> => {
    setTesting(true);
    setNotice(null);
    try {
      if (typeof window.agentsOneAPI.testVoiceInputService !== "function") {
        throw new Error(bridgeUnavailableMessage(t));
      }
      const result = await window.agentsOneAPI.testVoiceInputService(
        {
          url,
          apiKey: apiKey || undefined,
        },
        profile,
      );
      const details = [result.message, result.version, result.streamBackend]
        .filter((value): value is string => Boolean(value))
        .join(" · ");
      setNotice({ kind: result.ok ? "success" : "error", message: details });
    } catch (error) {
      setNotice({
        kind: "error",
        message:
          error instanceof Error && error.message
            ? error.message
            : t("settings.voice.testFailed"),
      });
    } finally {
      setTesting(false);
    }
  }, [apiKey, profile, t, url]);

  return (
    <div className="settings-modal-pane">
      <p className="settings-section-intro">{t("settings.voice.intro")}</p>

      {notice && (
        <div className={`settings-hermes-result ${notice.kind}`} role="status">
          {notice.message}
        </div>
      )}

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="voice-input-enabled">
          {t("settings.voice.enabled")}
        </label>
        <label className="tools-toggle">
          <input
            id="voice-input-enabled"
            type="checkbox"
            checked={enabled}
            disabled={loading || saving}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span className="tools-toggle-track" />
        </label>
        <div className="settings-field-hint">
          {t("settings.voice.enabledHint")}
        </div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="voice-service-url">
          {t("settings.voice.url")}
        </label>
        <input
          id="voice-service-url"
          className="input"
          type="url"
          value={url}
          disabled={loading || saving}
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t("settings.voice.urlPlaceholder")}
          autoComplete="url"
        />
        <div className="settings-field-hint">{t("settings.voice.urlHint")}</div>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor="voice-service-api-key">
          {t("settings.voice.apiKey")}
        </label>
        <input
          id="voice-service-api-key"
          className="input"
          type="password"
          value={apiKey}
          disabled={loading || saving}
          onChange={(event) => {
            setApiKey(event.target.value);
            setClearApiKey(false);
          }}
          placeholder={
            hasApiKey && !clearApiKey
              ? t("settings.voice.apiKeyConfigured")
              : t("settings.voice.apiKeyPlaceholder")
          }
          autoComplete="new-password"
        />
        <div className="settings-field-hint">
          {t("settings.voice.apiKeyHint")}
        </div>
        {hasApiKey && !clearApiKey && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={loading || saving}
            onClick={() => {
              setClearApiKey(true);
              setApiKey("");
            }}
          >
            {t("settings.voice.clearKey")}
          </button>
        )}
        {clearApiKey && (
          <div className="settings-field-hint">
            {t("settings.voice.keyWillClear")}
          </div>
        )}
      </div>

      <div className="settings-hermes-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={loading || saving}
          onClick={() => void save()}
        >
          {saving ? (
            <LoaderCircle className="settings-spinner" size={14} />
          ) : (
            <Mic size={14} />
          )}
          {saving ? t("settings.voice.saving") : t("settings.save")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || testing || !url.trim()}
          onClick={() => void testConnection()}
        >
          {testing ? (
            <LoaderCircle className="settings-spinner" size={14} />
          ) : (
            <ShieldCheck size={14} />
          )}
          {testing ? t("settings.voice.testing") : t("settings.voice.test")}
        </button>
      </div>
    </div>
  );
}
