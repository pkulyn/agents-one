import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SplashScreen from "./SplashScreen";

describe("SplashScreen", () => {
  it("uses the human-and-robot hand scene and the integrated Agents One wordmark", () => {
    const { container } = render(
      <SplashScreen onFinished={vi.fn()} status="正在准备工作区…" />,
    );

    expect(container.querySelector("video")).not.toBeInTheDocument();
    expect(
      container.querySelector(".splash-hand-base"),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector(".splash-hand-background"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".splash-hand-layer")).toHaveLength(2);
    const wordmark = screen.getByRole("img", { name: "Agents One" });
    expect(wordmark).toHaveClass("splash-logo");
    expect(wordmark.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText("正在准备工作区…")).toBeInTheDocument();
  });
});
