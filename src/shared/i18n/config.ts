import type { AppLocale } from "./types";

export const SOURCE_LOCALE: AppLocale = "en";
export const FALLBACK_LOCALE: AppLocale = "en";
export const DEFAULT_ACTIVE_LOCALE: AppLocale = "en";
export const APP_LOCALES: AppLocale[] = ["en", "zh-CN"];

export type TextDirection = "ltr";

export function getLocaleDirection(_locale: AppLocale): TextDirection {
  return "ltr";
}
