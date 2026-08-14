import { describe, expect, it } from "vitest";
import { t, getLocaleDirection } from "./index";

describe("shared i18n", () => {
  it("returns English text by default", () => {
    expect(t("welcome.title")).toBe("Welcome to Agents One");
  });

  it("falls back to the key when an English key is missing", () => {
    expect(t("common.missingKey")).toBe("common.missingKey");
  });

  it("returns zh-CN text when available", () => {
    expect(t("welcome.title", "zh-CN")).toBe("欢迎使用 Agents One");
  });

  it("reports both locales as left-to-right", () => {
    expect(getLocaleDirection("en")).toBe("ltr");
    expect(getLocaleDirection("zh-CN")).toBe("ltr");
  });

  it("falls back to en when zh-CN key is missing", () => {
    expect(t("nonExistent.fallbackKey", "zh-CN")).toBe(
      "nonExistent.fallbackKey",
    );
  });

  it("preserves interpolation placeholders in zh-CN", () => {
    expect(t("common.updateAvailable", "zh-CN", { version: "1.2.3" })).toBe(
      "更新 v1.2.3",
    );
  });
});
