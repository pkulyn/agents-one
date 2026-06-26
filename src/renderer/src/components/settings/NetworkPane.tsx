import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/** Force IPv4 + HTTP/SOCKS proxy. */
export default function NetworkPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    profile,
    forceIpv4,
    setForceIpv4,
    httpProxy,
    setHttpProxy,
    httpProxyRef,
    saveHttpProxy,
    networkSaved,
    setNetworkSaved,
  } = useSettings();

  return (
    <div className="settings-modal-pane">
      {networkSaved && (
        <div className="settings-pane-flash">{t("settings.saved")}</div>
      )}
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
        <div className="settings-field-hint">{t("settings.forceIpv4Hint")}</div>
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
        <div className="settings-field-hint">{t("settings.httpProxyHint")}</div>
      </div>
    </div>
  );
}
