import { act, fireEvent, render, screen } from "@testing-library/react";
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
    expect(container.querySelectorAll(".splash-human-motion img")).toHaveLength(
      1,
    );
    expect(container.querySelector(".splash-forearm-continuation")).toBeNull();
    const wordmark = screen.getByRole("img", { name: "Agents One" });
    expect(wordmark).toHaveClass("splash-logo");
    expect(wordmark.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(screen.getByText("正在准备工作区…")).toBeInTheDocument();
  });

  it("keeps readiness, loading status and the delayed local-mode escape outside the decorative scene", () => {
    vi.useFakeTimers();
    try {
      const onFinished = vi.fn();
      const onSwitchToLocal = vi.fn();
      const { container } = render(
        <SplashScreen
          onFinished={onFinished}
          status="Connecting"
          onSwitchToLocal={onSwitchToLocal}
        />,
      );
      expect(onFinished).toHaveBeenCalledOnce();
      expect(
        screen.getByText("Connecting").closest(".splash-hand-stage"),
      ).toBeNull();
      act(() => vi.advanceTimersByTime(11999));
      expect(
        screen.queryByRole("button", { name: "Switch to local mode" }),
      ).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      const button = screen.getByRole("button", {
        name: "Switch to local mode",
      });
      expect(button.closest(".splash-hand-stage")).toBeNull();
      fireEvent.click(button);
      expect(onSwitchToLocal).toHaveBeenCalledOnce();
      expect(
        container
          .querySelector(".splash-hand-stage")!
          .getAttribute("aria-hidden"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
