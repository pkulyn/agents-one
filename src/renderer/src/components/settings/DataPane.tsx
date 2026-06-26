import { Download, Upload } from "lucide-react";
import { useI18n } from "../useI18n";
import { useSettings } from "./SettingsDataContext";

/** Export / import a full Hermes backup archive. */
export default function DataPane(): React.JSX.Element {
  const { t } = useI18n();
  const {
    backingUp,
    backupResult,
    importing,
    importResult,
    handleBackup,
    handleImport,
  } = useSettings();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <div className="settings-field-hint" style={{ marginBottom: 10 }}>
          {t("settings.dataHint")}
        </div>
        <div className="settings-hermes-actions">
          <button
            className="btn btn-secondary"
            onClick={handleBackup}
            disabled={backingUp}
          >
            <Download size={14} style={{ marginRight: 6 }} />
            {backingUp ? t("settings.backingUp") : t("settings.exportBackup")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleImport}
            disabled={importing}
          >
            <Upload size={14} style={{ marginRight: 6 }} />
            {importing ? t("settings.importing") : t("settings.importBackup")}
          </button>
        </div>
        {backupResult && (
          <div
            className={`settings-hermes-result ${backupResult.includes("created") || backupResult.includes("success") ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {backupResult}
          </div>
        )}
        {importResult && (
          <div
            className={`settings-hermes-result ${importResult.includes("complete") ? "success" : "error"}`}
            style={{ marginTop: 8 }}
          >
            {importResult}
          </div>
        )}
      </div>
    </div>
  );
}
