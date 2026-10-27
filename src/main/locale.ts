import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  getLocale as getSharedLocale,
  setLocale as setSharedLocale,
  type AppLocale,
} from "../shared/i18n";
import { readDesktopConfig, writeDesktopConfig } from "./config";

const DESKTOP_LOCALE_KEY = "locale";

function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && APP_LOCALES.includes(value as AppLocale);
}

function readSavedLocale(): AppLocale | undefined {
  try {
    const value = readDesktopConfig()[DESKTOP_LOCALE_KEY];
    return isAppLocale(value) ? value : undefined;
  } catch {
    // Language bootstrap must reach the native startup recovery prompt even
    // when desktop.json is damaged. This fallback never authorizes a write.
    return undefined;
  }
}

function writeSavedLocale(locale: AppLocale): void {
  const data = readDesktopConfig();
  data[DESKTOP_LOCALE_KEY] = locale;
  writeDesktopConfig(data);
}

const savedLocale = readSavedLocale();
if (savedLocale) {
  setSharedLocale(savedLocale);
}

export function getAppLocale(): AppLocale {
  return readSavedLocale() || getSharedLocale() || DEFAULT_ACTIVE_LOCALE;
}

export function setAppLocale(locale: AppLocale): AppLocale {
  writeSavedLocale(locale);
  return setSharedLocale(locale);
}
