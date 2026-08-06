import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import { ChatEmptyState } from "./ChatEmptyState";

describe("ChatEmptyState", () => {
  it("uses the product-wide Agents One mark and forwards a selected suggestion", () => {
    const onSelectSuggestion = vi.fn();
    render(<ChatEmptyState onSelectSuggestion={onSelectSuggestion} />);

    expect(screen.getByAltText("Agents One")).toBeTruthy();
    fireEvent.click(screen.getByText("分析项目"));
    expect(onSelectSuggestion).toHaveBeenCalledWith(
      "请分析当前项目的结构、关键模块和主要风险。",
    );
  });
});
