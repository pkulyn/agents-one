import { Download, Upload } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/**
 * Export / restore Agents One workspace data.
 */
export default function DataPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    backingUp,
    backupResult,
    importing,
    importResult,
    handleBackup,
    handleImport,
    handleRestartAfterRestore,
  } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.dataHint")}
        </div>
        <div className="settings-field-hint" style={{ marginBottom: 12 }}>
          {t("settings.dataExclusions")}
        </div>
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={handleBackup}
            disabled={backingUp || importing}
          >
            <Download size={14} style={{ marginRight: 6 }} />
            {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleImport}
            disabled={importing || backingUp}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            {importing ? t("settings.importing") : t("settings.importBackup")}
          </button>
        </div>
        {backupResult && (
          <div
            className={`settings-hermes-result ${backupResult.success ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {backupResult.message}
          </div>
        )}
        {importResult && (
          <>
            <div
              className={`settings-hermes-result ${importResult.success ? "success" : "error"}`}
              style={{ marginTop: 8 }}
            >
              {importResult.message}
            </div>
            {importResult.success && importResult.requiresRestart && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleRestartAfterRestore()}
                style={{ marginTop: 8 }}
              >
                {t("settings.backupRestartNow")}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
