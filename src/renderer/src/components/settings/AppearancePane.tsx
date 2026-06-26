import { Check } from "lucide-react";
import { useTheme } from "../ThemeProvider";
import { useFont } from "../FontProvider";
import { THEMES, FONT_OPTIONS } from "../../constants";
import { useI18n } from "../useI18n";

/** Theme, rounded corners, and interface font. */
export default function AppearancePane(): React.JSX.Element {
  const { t } = useI18n();
  const { theme, setTheme, rounded, setRounded } = useTheme();
  const { font, setFont } = useFont();

  return (
    <div className="settings-modal-pane">
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.theme.label")}
        </label>
        <div className="settings-theme-grid">
          {THEMES.map((th) => {
            const active = theme === th.id;
            return (
              <button
                key={th.id}
                type="button"
                className={`settings-theme-card ${active ? "active" : ""}`}
                onClick={() => setTheme(th.id)}
              >
                <div className="settings-theme-preview" data-theme={th.id}>
                  <div className="settings-theme-preview-sidebar" />
                  <div className="settings-theme-preview-main">
                    <div className="settings-theme-preview-bar accent" />
                    <div className="settings-theme-preview-bar text" />
                    <div className="settings-theme-preview-bar" />
                  </div>
                </div>
                <div className="settings-theme-card-row">
                  <span className="settings-theme-card-name">{th.name}</span>
                  {active && (
                    <span className="settings-theme-card-check">
                      <Check size={14} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        <div className="settings-field-hint">
          {t("settings.appearanceHint")}
        </div>
      </div>
      <div className="settings-field">
        <div className="settings-theme-system">
          <div>
            <div className="settings-theme-system-label">
              {t("settings.roundedCorners.label")}
            </div>
            <div className="settings-theme-system-hint">
              {t("settings.roundedCorners.hint")}
            </div>
          </div>
          <label className="tools-toggle" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={rounded}
              onChange={() => setRounded(!rounded)}
            />
            <span className="tools-toggle-track" />
          </label>
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label">
          {t("settings.font.label")}
        </label>
        <div className="settings-theme-options">
          {FONT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`settings-theme-option ${font === opt.value ? "active" : ""}`}
              style={{ fontFamily: opt.stack }}
              onClick={() => setFont(opt.value)}
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
        <div className="settings-field-hint">{t("settings.font.hint")}</div>
      </div>
    </div>
  );
}
