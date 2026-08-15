import { Laptop, Wifi } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/**
 * Built-in Hermes connection settings. The connection is local-only (plan
 * D5): SSH and old remote Hermes transports were removed, and remote agents
 * now go through Gateway v1 in the Agent Runtimes pane. This pane keeps the
 * local API_SERVER_KEY management and the outgoing Network settings
 * (Force IPv4 + proxy), which shape every local gateway connection.
 */
export default function ConnectionPane(): React.JSX.Element {
  const { t } = useI18n();
  const s = useSettings();
  const {
    profile,
    connMode,
    connStatus,
    setConnStatus,
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    forceIpv4,
    setForceIpv4,
    httpProxy,
    setHttpProxy,
    httpProxyRef,
    saveHttpProxy,
    networkSaved,
    setNetworkSaved,
  } = s;

  return (
    <div className="settings-modal-pane">
      {connStatus && <div className="settings-pane-flash">{connStatus}</div>}

      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.connectionMode")}
        </label>
        <div className="settings-theme-options">
          <span className={`settings-theme-option active`}>
            <span className="settings-mode-option">
              <Laptop size={15} />
              {t("settings.modeLocal")}
            </span>
          </span>
        </div>
        <div className="settings-field-hint">
          {connMode === "local"
            ? t("settings.modeLocalHint")
            : t("settings.modeRemoteHint")}
        </div>
      </div>

      {!apiServerKeyMissing ? null : (
        <div className="settings-api-key-banner">
          <div className="settings-api-key-banner-title">
            {t("settings.sessionDisabledTitle")}
          </div>
          <div className="settings-api-key-banner-desc">
            {t("settings.sessionDisabledDesc")}
          </div>
          <button
            className="btn btn-primary"
            disabled={generatingKey}
            onClick={async () => {
              setGeneratingKey(true);
              await window.hermesAPI.generateApiServerKey(profile);
              setApiServerKeyMissing(false);
              setGeneratingKey(false);
              setConnStatus(t("settings.apiGenerated"));
              setTimeout(() => setConnStatus(null), 4000);
            }}
          >
            {generatingKey
              ? t("settings.generating")
              : t("settings.generateKey")}
          </button>
        </div>
      )}

      {/* Network — applies to the local gateway connection. */}
      <div className="settings-subsection">
        <div className="settings-subsection-head">
          <Wifi size={14} />
          <span>{t("settings.networkSection")}</span>
          {networkSaved && (
            <span className="settings-saved">{t("settings.saved")}</span>
          )}
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.forceIpv4")}
            <label
              className="tools-toggle"
              style={{ marginLeft: 12, verticalAlign: "middle" }}
            >
              <input
                type="checkbox"
                checked={forceIpv4}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setForceIpv4(val);
                  await window.hermesAPI.setConfig(
                    "network.force_ipv4",
                    val ? "true" : "false",
                    profile,
                  );
                  setNetworkSaved(true);
                  setTimeout(() => setNetworkSaved(false), 2000);
                }}
              />
              <span className="tools-toggle-track" />
            </label>
          </label>
          <div className="settings-field-hint">
            {t("settings.forceIpv4Hint")}
          </div>
        </div>
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.httpProxy")}
          </label>
          <input
            className="input"
            type="text"
            value={httpProxy}
            onChange={(e) => {
              httpProxyRef.current = e.target.value;
              setHttpProxy(e.target.value);
            }}
            onBlur={() => {
              void saveHttpProxy();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void saveHttpProxy();
                e.currentTarget.blur();
              }
            }}
            placeholder={t("settings.proxyPlaceholder")}
          />
          <div className="settings-field-hint">
            {t("settings.httpProxyHint")}
          </div>
        </div>
      </div>
    </div>
  );
}
