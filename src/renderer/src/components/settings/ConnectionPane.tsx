import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";
import { CHAT_TRANSPORT_OPTIONS } from "./settingsHelpers";

/** Local / Remote / SSH connection mode, chat transport, and server config. */
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
    connTesting,
    apiServerKeyMissing,
    setApiServerKeyMissing,
    generatingKey,
    setGeneratingKey,
    remoteChatTransport,
    sshChatTransport,
    transportProbe,
    sshHost,
    setSshHost,
    sshPort,
    setSshPort,
    sshUser,
    setSshUser,
    sshKeyPath,
    setSshKeyPath,
    sshRemotePort,
    setSshRemotePort,
    handleSaveConnection,
    handleTestConnection,
    handleChatTransportChange,
    handleSwitchToLocal,
    handleSwitchToRemote,
    handleSwitchToSsh,
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
            {t("settings.modeLocal")}
          </button>
          <button
            className={`settings-theme-option ${connMode === "remote" ? "active" : ""}`}
            onClick={() => void handleSwitchToRemote()}
          >
            {t("settings.modeRemote")}
          </button>
          <button
            className={`settings-theme-option ${connMode === "ssh" ? "active" : ""}`}
            onClick={() => void handleSwitchToSsh()}
          >
            {t("settings.modeSsh")}
          </button>
        </div>
        <div className="settings-field-hint">
          {connMode === "local"
            ? t("settings.modeLocalHint")
            : connMode === "ssh"
              ? t("settings.modeSshHint")
              : t("settings.modeRemoteHint")}
        </div>
      </div>

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
            {connMode === "ssh"
              ? t("settings.remoteEnvSshDesc")
              : t("settings.remoteEnvDesc")}
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
            <label className="settings-field-label">Chat transport</label>
            <div className="settings-theme-options">
              {CHAT_TRANSPORT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-option ${
                    remoteChatTransport === option ? "active" : ""
                  }`}
                  onClick={() =>
                    void handleChatTransportChange("remote", option)
                  }
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
            <div className="settings-field-hint">
              Auto tries the Hermes dashboard WebSocket first, then falls back
              to the legacy remote API. Dashboard requires the remote Hermes
              dashboard URL and a valid dashboard session token.
            </div>
            {transportProbe && (
              <div
                className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
              >
                <span>{transportProbe.label}</span>
                {transportProbe.loading && <span>Checking…</span>}
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

      {connMode === "ssh" && (
        <>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.sshHost")}
            </label>
            <input
              className="input"
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              placeholder={t("settings.sshHostPlaceholder")}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.sshPort")}
            </label>
            <input
              className="input"
              type="number"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              placeholder="22"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.sshUsername")}
            </label>
            <input
              className="input"
              type="text"
              value={sshUser}
              onChange={(e) => setSshUser(e.target.value)}
              placeholder={t("settings.sshUsernamePlaceholder")}
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.sshKeyPath")}{" "}
              <span style={{ fontWeight: 400, opacity: 0.6 }}>
                {t("settings.sshKeyPathOptional")}
              </span>
            </label>
            <input
              className="input"
              type="text"
              value={sshKeyPath}
              onChange={(e) => setSshKeyPath(e.target.value)}
              placeholder="~/.ssh/id_rsa"
            />
          </div>
          <div className="settings-field">
            <label className="settings-field-label">
              {t("settings.sshRemotePort")}{" "}
              <span style={{ fontWeight: 400, opacity: 0.6 }}>
                {t("settings.sshRemotePortDefault")}
              </span>
            </label>
            <input
              className="input"
              type="number"
              value={sshRemotePort}
              onChange={(e) => setSshRemotePort(e.target.value)}
              placeholder="8642"
            />
            <div className="settings-field-hint">
              {t("settings.sshHint", {
                cmd: `${sshUser || "user"}@${sshHost || "host"}`,
              })}
            </div>
          </div>
          <div className="settings-field">
            <label className="settings-field-label">Chat transport</label>
            <div className="settings-theme-options">
              {CHAT_TRANSPORT_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`settings-theme-option ${
                    sshChatTransport === option ? "active" : ""
                  }`}
                  onClick={() => void handleChatTransportChange("ssh", option)}
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
            <div className="settings-field-hint">
              Auto tries the Hermes dashboard WebSocket through the SSH tunnel
              first, then falls back to legacy SSH chat. Dashboard forces the
              upstream dashboard path; Legacy keeps the older SSH transport.
            </div>
            {transportProbe && (
              <div
                className={`settings-transport-status settings-transport-status--${transportProbe.kind}`}
              >
                <span>{transportProbe.label}</span>
                {transportProbe.loading && <span>Checking…</span>}
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
              {connTesting ? t("settings.testingSsh") : t("settings.testSsh")}
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
    </div>
  );
}
