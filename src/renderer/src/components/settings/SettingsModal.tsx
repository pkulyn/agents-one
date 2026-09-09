import { useEffect, useState } from "react";
import {
  Archive,
  Database,
  FileText,
  Info,
  Languages,
  Mic,
  Palette,
  X,
} from "lucide-react";
import { useI18n } from "../useI18n";
import { AppModal, AppModalTitle } from "../modal/AppModal";
import { useSettingsData } from "./useSettingsData";
import { SettingsDataContext } from "./SettingsDataContext";
import AppearancePane from "./AppearancePane";
import LanguagePane from "./LanguagePane";
import DataPane from "./DataPane";
import AboutPane from "./AboutPane";
import LogsPane from "./LogsPane";
import ArchivePane from "./ArchivePane";
import VoiceInputPane from "./VoiceInputPane";

export type SettingsSection =
  | "appearance"
  | "language"
  | "data"
  | "about"
  | "logs"
  | "archives"
  | "voice";

type NavGroup = "general";

/** Left-nav sections, grouped. Each renders into the right-hand content pane. */
const SETTINGS_NAV: ReadonlyArray<{
  group: NavGroup;
  id: SettingsSection;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  {
    group: "general",
    id: "appearance",
    labelKey: "settings.nav.appearance",
    Icon: Palette,
  },
  {
    group: "general",
    id: "language",
    labelKey: "settings.nav.language",
    Icon: Languages,
  },
  {
    group: "general",
    id: "voice",
    labelKey: "settings.nav.voice",
    Icon: Mic,
  },
  {
    group: "general",
    id: "data",
    labelKey: "settings.nav.data",
    Icon: Database,
  },
  {
    group: "general",
    id: "archives",
    labelKey: "settings.nav.archives",
    Icon: Archive,
  },
  { group: "general", id: "about", labelKey: "settings.nav.about", Icon: Info },
  {
    group: "general",
    id: "logs",
    labelKey: "settings.nav.logs",
    Icon: FileText,
  },
];

const NAV_GROUP_ORDER: { id: NavGroup; labelKey: string }[] = [
  { id: "general", labelKey: "settings.nav.groups.general" },
];

/** Map a `/settings <name>` argument (and legacy anchor names) to a nav id. */
function resolveSection(name?: string): SettingsSection {
  const key = (name || "").trim().toLowerCase();
  if (key === "hermesagent") return "about";
  const match = SETTINGS_NAV.find((s) => s.id === key);
  return match ? match.id : "appearance";
}

interface SettingsModalProps {
  open: boolean;
  profile?: string;
  initialSection?: string;
  onClose: () => void;
  onExited?: () => void;
}

/**
 * Global settings modal (mirrors the profile detail modal): a grouped left
 * nav + a single active pane on the right, on the shared AppModal shell.
 * Opened from anywhere via `SettingsModalProvider`'s `openSettings`.
 */
export default function SettingsModal({
  open,
  profile,
  initialSection,
  onClose,
  onExited,
}: SettingsModalProps): React.JSX.Element {
  const { t } = useI18n();
  const data = useSettingsData(profile);
  const [section, setSection] = useState<SettingsSection>(() =>
    resolveSection(initialSection),
  );

  // Re-seed the active pane each time the modal is (re)opened or targeted at a
  // different section via the slash command.
  useEffect(() => {
    if (open) setSection(resolveSection(initialSection));
  }, [open, initialSection]);

  return (
    <AppModal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onExitComplete={onExited}
      className="settings-modal"
      overlayClassName="settings-modal-overlay"
      labelledBy="settings-modal-title"
    >
      <div className="settings-modal-header">
        <AppModalTitle
          id="settings-modal-title"
          className="settings-modal-title"
        >
          {t("settings.title")}
        </AppModalTitle>
        <button
          type="button"
          className="settings-modal-close"
          onClick={onClose}
          aria-label={t("common.cancel")}
        >
          <X size={18} />
        </button>
      </div>

      <div className="settings-modal-layout">
        <nav className="settings-modal-nav" aria-label={t("settings.title")}>
          {NAV_GROUP_ORDER.map((g) => (
            <div key={g.id} className="settings-modal-nav-group">
              <div className="settings-modal-nav-group-label">
                {t(g.labelKey)}
              </div>
              {SETTINGS_NAV.filter((s) => s.group === g.id).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`settings-modal-nav-item ${
                    section === s.id ? "active" : ""
                  }`}
                  onClick={() => setSection(s.id)}
                >
                  <s.Icon size={16} />
                  {t(s.labelKey)}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="settings-modal-content">
          <SettingsDataContext.Provider value={data}>
            {section === "appearance" && <AppearancePane />}
            {section === "language" && <LanguagePane />}
            {section === "data" && <DataPane />}
            {section === "archives" && <ArchivePane profile={profile} />}
            {section === "voice" && <VoiceInputPane profile={profile} />}
            {section === "about" && <AboutPane />}
            {section === "logs" && <LogsPane />}
          </SettingsDataContext.Provider>
        </div>
      </div>
    </AppModal>
  );
}
