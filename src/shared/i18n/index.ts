import i18next, { type Resource } from "i18next";
import {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  getLocaleDirection,
  type TextDirection,
} from "./config";
import type { AppLocale } from "./types";
import agents_en from "./locales/en/agents";
import chat_en from "./locales/en/chat";
import collaboration_en from "./locales/en/collaboration";
import common_en from "./locales/en/common";
import constants_en from "./locales/en/constants";
import diagnose_en from "./locales/en/diagnose";
import discover_en from "./locales/en/discover";
import errors_en from "./locales/en/errors";
import gateway_en from "./locales/en/gateway";
import install_en from "./locales/en/install";
import memory_en from "./locales/en/memory";
import models_en from "./locales/en/models";
import navigation_en from "./locales/en/navigation";
import office_en from "./locales/en/office";
import providers_en from "./locales/en/providers";
import runtimeChat_en from "./locales/en/runtimeChat";
import schedules_en from "./locales/en/schedules";
import sessions_en from "./locales/en/sessions";
import settings_en from "./locales/en/settings";
import setup_en from "./locales/en/setup";
import skills_en from "./locales/en/skills";
import soul_en from "./locales/en/soul";
import tools_en from "./locales/en/tools";
import welcome_en from "./locales/en/welcome";
import agents_zh from "./locales/zh-CN/agents";
import chat_zh from "./locales/zh-CN/chat";
import collaboration_zh from "./locales/zh-CN/collaboration";
import common_zh from "./locales/zh-CN/common";
import constants_zh from "./locales/zh-CN/constants";
import errors_zh from "./locales/zh-CN/errors";
import gateway_zh from "./locales/zh-CN/gateway";
import install_zh from "./locales/zh-CN/install";
import memory_zh from "./locales/zh-CN/memory";
import models_zh from "./locales/zh-CN/models";
import navigation_zh from "./locales/zh-CN/navigation";
import office_zh from "./locales/zh-CN/office";
import providers_zh from "./locales/zh-CN/providers";
import runtimeChat_zh from "./locales/zh-CN/runtimeChat";
import schedules_zh from "./locales/zh-CN/schedules";
import sessions_zh from "./locales/zh-CN/sessions";
import settings_zh from "./locales/zh-CN/settings";
import setup_zh from "./locales/zh-CN/setup";
import skills_zh from "./locales/zh-CN/skills";
import soul_zh from "./locales/zh-CN/soul";
import tools_zh from "./locales/zh-CN/tools";
import welcome_zh from "./locales/zh-CN/welcome";

export const resources = {
  en: {
    translation: {
      agents: agents_en,
      chat: chat_en,
      collaboration: collaboration_en,
      common: common_en,
      constants: constants_en,
      diagnose: diagnose_en,
      discover: discover_en,
      errors: errors_en,
      gateway: gateway_en,
      install: install_en,
      memory: memory_en,
      models: models_en,
      navigation: navigation_en,
      office: office_en,
      providers: providers_en,
      runtimeChat: runtimeChat_en,
      schedules: schedules_en,
      sessions: sessions_en,
      settings: settings_en,
      setup: setup_en,
      skills: skills_en,
      soul: soul_en,
      tools: tools_en,
      welcome: welcome_en,
    },
  },
  "zh-CN": {
    translation: {
      agents: agents_zh,
      chat: chat_zh,
      collaboration: collaboration_zh,
      common: common_zh,
      constants: constants_zh,
      errors: errors_zh,
      gateway: gateway_zh,
      install: install_zh,
      memory: memory_zh,
      models: models_zh,
      navigation: navigation_zh,
      office: office_zh,
      providers: providers_zh,
      runtimeChat: runtimeChat_zh,
      schedules: schedules_zh,
      sessions: sessions_zh,
      settings: settings_zh,
      setup: setup_zh,
      skills: skills_zh,
      soul: soul_zh,
      tools: tools_zh,
      welcome: welcome_zh,
    },
  },
} satisfies Resource;

function readKey(node: unknown, path: string): string | undefined {
  const result = path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, node);

  return typeof result === "string" ? result : undefined;
}

let locale: AppLocale = DEFAULT_ACTIVE_LOCALE;

export const sharedI18n = i18next.createInstance();

void sharedI18n.init({
  lng: locale,
  fallbackLng: FALLBACK_LOCALE,
  supportedLngs: APP_LOCALES,
  defaultNS: "translation",
  ns: ["translation"],
  interpolation: {
    escapeValue: false,
  },
  resources,
  initImmediate: false,
});

export function getLocale(): AppLocale {
  return locale;
}

export function setLocale(nextLocale: AppLocale): AppLocale {
  locale = nextLocale;
  void sharedI18n.changeLanguage(nextLocale);
  return locale;
}

export function t(
  key: string,
  lang: AppLocale = locale,
  options?: Record<string, unknown>,
): string {
  const translated = readKey(resources[lang]?.translation, key);
  const fallback = readKey(resources[FALLBACK_LOCALE].translation, key);
  const base = translated ?? fallback ?? key;

  if (!options) return base;

  return Object.entries(options).reduce((message, [name, value]) => {
    return message.replaceAll(`{{${name}}}`, String(value));
  }, base);
}

export {
  APP_LOCALES,
  DEFAULT_ACTIVE_LOCALE,
  FALLBACK_LOCALE,
  SOURCE_LOCALE,
  getLocaleDirection,
};
export type { AppLocale, TextDirection };
