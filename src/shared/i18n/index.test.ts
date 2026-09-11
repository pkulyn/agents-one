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

  it("translates the settings interface in zh-CN", () => {
    expect(t("settings.theme.label", "zh-CN")).toBe("主题");
    expect(t("settings.roundedCorners.hint", "zh-CN")).toBe(
      "关闭后，应用中的圆角将改为直角",
    );
    expect(t("settings.hardwareAcceleration.label", "zh-CN")).toBe("硬件加速");
    expect(t("settings.archives.title", "zh-CN")).toBe("已归档的任务和项目");
    expect(t("settings.checkForUpdates", "zh-CN")).toBe("检查更新");
  });

  it("translates the scheduled-task workflow in both locales", () => {
    expect(t("schedules.sourceTitle", "en")).toBe("Agent Tasks");
    expect(t("schedules.runtimeHint", "en")).toContain("remote Gateway");
    expect(t("schedules.recentResult", "en", { status: "Completed" })).toBe(
      "Latest result: Completed",
    );
    expect(t("schedules.sourceTitle", "zh-CN")).toBe("智能体任务");
    expect(t("schedules.queuedCount", "zh-CN", { count: 2 })).toBe("等待 2 次");
  });
});
