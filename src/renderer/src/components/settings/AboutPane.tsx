import { Download, Loader, Monitor, RefreshCw, RotateCw } from "lucide-react";
import { useI18n } from "../useI18n";
import agentsOneMark from "../../assets/agents-one-mark.svg";
import { useSettings } from "./SettingsDataContext";

/**
 * About & Updates for the Agents One desktop application.
 */
export default function AboutPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    appVersion,
    autoUpgradeEnabled,
    autoUpgradeSaved,
    desktopUpdatePolicy,
    handleAutoUpgradeChange,
    desktopUpdateState,
    desktopUpdateVersion,
    desktopUpdatePercent,
    desktopUpdateError,
    checkDesktopUpdate,
    handleDesktopUpdate,
  } = useSettings();

  return (
    <div className="settings-modal-pane">
      <section className="settings-card">
        <header className="settings-card-head">
          <span className="settings-card-icon">
            <img
              src={agentsOneMark}
              width={20}
              height={20}
              className="brand-logo"
              alt={t("settings.desktopTitle")}
            />
          </span>
          <div className="settings-card-headtext">
            <div className="settings-card-title">
              {t("settings.desktopTitle")}
            </div>
            <div className="settings-card-sub">
              {t("settings.desktopSubtitle")}
            </div>
          </div>
          {desktopUpdateState === "ready" ? (
            <span className="settings-card-badge is-update">
              {t("settings.statusUpdateReady")}
            </span>
          ) : desktopUpdateState === "available" ? (
            <span className="settings-card-badge is-update">
              {t("settings.statusUpdateAvailable")}
            </span>
          ) : desktopUpdateState === "uptodate" ? (
            <span className="settings-card-badge is-ok">
              {t("settings.statusUpToDate")}
            </span>
          ) : null}
        </header>

        <div className="settings-card-body">
          <div className="settings-meta-grid">
            <Meta
              label={t("common.desktop")}
              loading={!appVersion}
              icon={<Monitor size={13} />}
            >
              {t("settings.version", { version: appVersion })}
            </Meta>
          </div>

          <div className="settings-card-actions">
            <DesktopUpdateButton
              state={desktopUpdateState}
              version={desktopUpdateVersion}
              percent={desktopUpdatePercent}
              onCheck={checkDesktopUpdate}
              onAct={handleDesktopUpdate}
              disabled={!desktopUpdatePolicy.enabled}
            />
            {desktopUpdateState === "uptodate" && (
              <span className="settings-card-actions-note">
                {t("settings.onLatestVersion")}
              </span>
            )}
          </div>

          {desktopUpdateError && (
            <div className="settings-hermes-result error">
              {desktopUpdateError}
            </div>
          )}

          {!desktopUpdatePolicy.enabled && (
            <div className="settings-hermes-result error">
              {t(
                desktopUpdatePolicy.reason === "unsigned-build"
                  ? "settings.desktopUpdateUnsignedDisabled"
                  : "settings.desktopUpdateUnavailable",
              )}
            </div>
          )}

          <div className="settings-toggle-row">
            <div className="settings-toggle-text">
              <div className="settings-toggle-title">
                {t("settings.autoUpgradeDesktop")}
                {autoUpgradeSaved && (
                  <span className="settings-saved">{t("settings.saved")}</span>
                )}
              </div>
              <div className="settings-field-hint">
                {t("settings.autoUpgradeDesktopHint")}
              </div>
            </div>
            <label className="tools-toggle">
              <input
                type="checkbox"
                checked={autoUpgradeEnabled}
                disabled={!desktopUpdatePolicy.enabled}
                onChange={(e) => void handleAutoUpgradeChange(e.target.checked)}
              />
              <span className="tools-toggle-track" />
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}

/** A labelled version/metadata cell with a leading icon. */
function Meta({
  label,
  loading,
  icon,
  children,
}: {
  label: string;
  loading?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-meta">
      <span className="settings-meta-label">
        {icon}
        {label}
      </span>
      {loading ? (
        <span className="skeleton skeleton-sm" />
      ) : (
        <span className="settings-meta-value">{children}</span>
      )}
    </div>
  );
}

/** The desktop-app update action, driven by the live updater state machine. */
function DesktopUpdateButton({
  state,
  version,
  percent,
  onCheck,
  onAct,
  disabled,
}: {
  state:
    | "available"
    | "downloading"
    | "ready"
    | "error"
    | "checking"
    | "uptodate"
    | null;
  version: string | null;
  percent: number | null;
  onCheck: () => void;
  onAct: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const { t } = useI18n();

  if (state === "downloading") {
    return (
      <button className="btn btn-primary" disabled>
        <Loader size={14} className="settings-spin" />
        {t("common.downloading", { percent: percent ?? 0 })}
      </button>
    );
  }
  if (state === "ready") {
    return (
      <button className="btn btn-primary" onClick={onAct}>
        <RotateCw size={14} />
        {t("common.restartToUpdate")}
      </button>
    );
  }
  if (state === "available") {
    return (
      <button className="btn btn-primary" onClick={onAct}>
        <Download size={14} />
        {version
          ? t("common.updateAvailable", { version })
          : t("settings.downloadUpdate")}
      </button>
    );
  }
  if (state === "checking") {
    return (
      <button className="btn btn-secondary" disabled>
        <Loader size={14} className="settings-spin" />
        {t("settings.checkingUpdates")}
      </button>
    );
  }
  // null, "uptodate", or "error" → offer a (re)check.
  return (
    <button className="btn btn-secondary" onClick={onCheck} disabled={disabled}>
      <RefreshCw size={14} />
      {state === "error" ? t("settings.retry") : t("settings.checkForUpdates")}
    </button>
  );
}
