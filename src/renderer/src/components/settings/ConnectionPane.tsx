import { Laptop, Server, Wifi } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import { CHAT_TRANSPORT_OPTIONS } from "./settingsHelpers";

/**
 * Local / Remote connection mode, chat transport, server config, and the
 * outgoing Network settings (Force IPv4 + proxy) — proxy/IPv4 shape every
 * connection, so they live here as a subsection rather than a separate tab.
 * SSH mode was removed: remote Hermes now always goes through Gateway v1.
 */
export default function ConnectionPane(): React.JSX.Element {
  const { t } = useI18n();
  const s = useSettings();
  const {
    profile,
    connMode,
    setConnMode,
    connStatus,
    setConnStatus,
    connLoaded,
    connRemoteUrl,
    setConnRemoteUrl,
    connApiKey,
    setConnApiKey,
    connApiKeyMask,
    connDashboardUrl,
    setConnDashboardUrl,
    connDashboardToken,
    setConnDashboardToken,
    connDashboardTokenMask,
    connTesting,
    migratedFromSsh,
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    remoteChatTransport,
    transportProbe,
    handleSaveConnection,
    handleTestConnection,
    handleChatTransportChange,
    handleSwitchToLocal,
    handleSwitchToRemote,
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
          <button
            className={`settings-theme-option ${connMode === "local" ? "active" : ""}`}
            onClick={() => {
              setConnMode("local");
              if (connLoaded.current) handleSwitchToLocal();
            }}
          >
            <span className="settings-mode-option">
              <Laptop size={15} />
              {t("settings.modeLocal")}
            </span>
          </button>
          <button
            className={`settings-theme-option ${connMode === "remote" ? "active" : ""}`}
            onClick={() => void handleSwitchToRemote()}
          >
            <span className="settings-mode-option">
              <Server size={15} />
              {t("settings.modeRemote")}
            </span>
          </button>
        </div>
        <div className="settings-field-hint">
          {connMode === "local"
            ? t("settings.modeLocalHint")
            : t("settings.modeRemoteHint")}
        </div>
      </div>

      {connMode === "remote" && migratedFromSsh && (
        <div className="settings-api-key-banner settings-api-key-banner--info">
          <div className="settings-api-key-banner-title">
            {t("settings.sshMigratedTitle")}
          </div>
          <div className="settings-api-key-banner-desc">
            {t("settings.sshMigratedDesc")}
          </div>
        </div>
      )}

      {!apiServerKeyMissing ? null : connMode === "local" ? (
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
      ) : (
        <div className="settings-api-key-banner settings-api-key-banner--info">
          <div className="settings-api-key-banner-title">
            {t("settings.remoteEnvTitle")}
          </div>
          <div className="settings-api-key-banner-desc">
            {t("settings.remoteEnvDesc")}
          </div>
        </div>
      )}

      {connMode === "remote" && (
        <>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.remoteUrl")}
            </label>
            <input
              className="input"
              type="url"
              value={connRemoteUrl}
              onChange={(e) => setConnRemoteUrl(e.target.value)}
              placeholder="http://192.168.1.100:8642"
              onBlur={handleSaveConnection}
            />
            <div className="settings-field-hint">
              {t("settings.remoteUrlHint")}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.remoteApiKey")}
            </label>
            <input
              className="input"
              type="password"
              value={connApiKey}
              onChange={(e) => setConnApiKey(e.target.value)}
              onFocus={(e) => {
                if (connApiKey === connApiKeyMask) {
                  e.currentTarget.select();
                }
              }}
              placeholder={t("settings.remoteApiKey")}
              onBlur={handleSaveConnection}
            />
            <div className="settings-field-hint">
              {t("settings.remoteApiKeyHint")}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.dashboardUrl")}
            </label>
            <input
              className="input"
              type="url"
              value={connDashboardUrl}
              onChange={(e) => setConnDashboardUrl(e.target.value)}
              placeholder="http://192.168.1.100:9119"
              onBlur={handleSaveConnection}
            />
            <div className="settings-field-hint">
              {t("settings.dashboardUrlHint")}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.dashboardToken")}
            </label>
            <input
              className="input"
              type="password"
              value={connDashboardToken}
              onChange={(e) => setConnDashboardToken(e.target.value)}
              onFocus={(e) => {
                if (connDashboardToken === connDashboardTokenMask) {
                  e.currentTarget.select();
                }
              }}
              placeholder="HERMES_DASHBOARD_SESSION_TOKEN"
              onBlur={handleSaveConnection}
            />
            <div className="settings-field-hint">
              {t("settings.dashboardTokenHint")}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.chatTransport.label")}
            </label>
            <div className="settings-theme-options">
              {CHAT_TRANSPORT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-option ${
                    remoteChatTransport === option ? "active" : ""
                  }`}
                  onClick={() => void handleChatTransportChange(option)}
                >
                  {t(`settings.chatTransport.${option}`)}
                </button>
              ))}
            </div>
            <div className="settings-field-hint">
              {t("settings.chatTransport.remoteHint")}
            </div>
            {transportProbe && (
              <div
                className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
              >
                <span>{transportProbe.label}</span>
                {transportProbe.loading && (
                  <span>{t("settings.chatTransport.checking")}</span>
                )}
                {transportProbe.detail && <code>{transportProbe.detail}</code>}
              </div>
            )}
          </div>
          <div className="settings-hermes-actions">
            <button
              className="btn btn-secondary"
              onClick={handleTestConnection}
              disabled={connTesting}
            >
              {connTesting
                ? t("settings.testingConnection")
                : t("settings.testConnection")}
            </button>
            <button className="btn btn-primary" onClick={handleSaveConnection}>
              {t("settings.save")}
            </button>
          </div>
        </>
      )}

      {connMode === "remote" && (
        <div className="settings-field">
          <label className="settings-field-label">
            {t("settings.serverConfigTitle")}
          </label>
          <div
            className="settings-field-hint"
            dangerouslySetInnerHTML={{ __html: t("settings.serverConfigHint") }}
          />
        </div>
      )}

      {/* Network — applies to every outgoing connection above. */}
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
