import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t as translate } from "../../../../shared/i18n";

const i18nTestState = vi.hoisted(() => ({
  locale: "zh-CN" as "en" | "zh-CN",
}));

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, i18nTestState.locale, options),
  }),
}));

import { ChatEmptyState } from "./ChatEmptyState";

describe("ChatEmptyState", () => {
  beforeEach(() => {
    i18nTestState.locale = "zh-CN";
  });

  it("uses the product-wide Agents One mark and forwards a selected suggestion", () => {
    const onSelectSuggestion = vi.fn();
    render(<ChatEmptyState onSelectSuggestion={onSelectSuggestion} />);

    expect(screen.getByAltText("Agents One")).toBeTruthy();
    fireEvent.click(screen.getByText("分析项目"));
    expect(onSelectSuggestion).toHaveBeenCalledWith(
      "请分析当前项目的结构、关键模块和主要风险。",
    );
  });

  it("shows and forwards English suggestions in the English locale", () => {
    i18nTestState.locale = "en";
    const onSelectSuggestion = vi.fn();
    render(<ChatEmptyState onSelectSuggestion={onSelectSuggestion} />);

    fireEvent.click(screen.getByText("Analyze project"));
    expect(onSelectSuggestion).toHaveBeenCalledWith(
      "Analyze the current project's structure, key modules, and main risks.",
    );
  });
});
