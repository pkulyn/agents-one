import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RuntimeModelPicker } from "./RuntimeModelPicker";
vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
it("groups provider models, searches across groups and forwards only clicked model and reasoning choices", () => {
  const select = vi.fn(),
    think = vi.fn(),
    close = vi.fn();
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => new DOMRect(100, 600, 80, 30);
  render(
    <RuntimeModelPicker
      anchor={anchor}
      models={[
        {
          id: "a/first",
          provider: "Provider A",
          displayName: "First",
          reasoningEfforts: ["off", "low", "high"],
        },
        {
          id: "b/second",
          provider: "Provider B",
          displayName: "Second",
          imageInput: true,
        },
      ]}
      selected="a/first"
      thinking="low"
      disabled={false}
      onSelect={select}
      onThinking={think}
      onClose={close}
    />,
  );
  expect(screen.getByRole("dialog")).toHaveStyle({
    left: "100px",
    bottom: window.innerHeight - 600 + 10 + "px",
  });
  expect(screen.getByRole("option", { name: "First" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.queryByRole("option", { name: /Second/ }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Second" },
  });
  fireEvent.click(screen.getByRole("option", { name: /Second/ }));
  expect(select).toHaveBeenCalledWith("b/second");
  const high = screen.getByRole("group").querySelectorAll("button")[2];
  fireEvent.click(high);
  expect(think).toHaveBeenCalledWith("high");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(close).toHaveBeenCalled();
});

it("preserves search text, option focus and placement when control callbacks rerender", () => {
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => new DOMRect(100, 600, 80, 30);
  const models = [{ id: "first", reasoningEfforts: ["off", "medium", "max"] }];
  const view = render(
    <RuntimeModelPicker
      anchor={anchor}
      models={models}
      selected="first"
      thinking="medium"
      disabled={false}
      onSelect={() => {}}
      onThinking={() => {}}
      onClose={() => {}}
    />,
  );
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "first" } });
  const max = screen.getByRole("button", { name: "max" });
  max.focus();
  const before = screen.getByRole("dialog").getAttribute("style");
  view.rerender(
    <RuntimeModelPicker
      anchor={anchor}
      models={models}
      selected="first"
      thinking="max"
      disabled={false}
      onSelect={() => {}}
      onThinking={() => {}}
      onClose={() => {}}
    />,
  );
  expect(max).toHaveFocus();
  expect(input).toHaveValue("first");
  expect(screen.getByRole("dialog").getAttribute("style")).toBe(before);
  expect(document.querySelector(".runtime-thinking-segments")).toHaveAttribute(
    "data-level",
    "max",
  );
});
