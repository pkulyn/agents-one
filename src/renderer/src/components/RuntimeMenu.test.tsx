import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeDefinition } from "../../../shared/agent-runtimes";
import { RuntimeMenuItems } from "./RuntimeMenu";
vi.mock("./useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key.endsWith("runtimeMeta")
        ? options?.kind + " / " + options?.location
        : key.split(".").at(-1),
  }),
}));
const runtimes = [
  { id: "a", name: "Alpha", kind: "pi", enabled: true },
  { id: "b", name: "Beta", kind: "hermes", enabled: true, location: "remote" },
  { id: "c", name: "Gamma", kind: "web-agent", enabled: false },
].map((runtime) => ({
  location: "local",
  managed: "user",
  config: {},
  ...runtime,
})) as AgentRuntimeDefinition[];
function drag(from: Element, to: Element): void {
  const values: Record<string, string> = {};
  const dataTransfer = {
    setData: (key: string, value: string) => {
      values[key] = value;
    },
    getData: (key: string) => values[key],
    types: ["application/x-agents-one-runtime"],
  };
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
}
const names = (): (string | undefined)[] =>
  screen
    .getAllByRole("menuitemradio")
    .map((button) => button.textContent?.split(/Pi|Hermes|webAgent/)[0]);
describe("shared runtime display order", () => {
  beforeEach(() => localStorage.clear());
  // @lat: [[sidebar-navigation#Shared agent presentation]]
  it("moves both ways, synchronizes menus, survives remount, and selects the original runtime", () => {
    const select = vi.fn();
    const view = render(
      <RuntimeMenuItems runtimes={runtimes} selectedId="a" onSelect={select} />,
    );
    drag(
      screen.getByRole("menuitemradio", { name: /Alpha/ }),
      screen.getByRole("menuitemradio", { name: /Beta/ }),
    );
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Beta/ }));
    expect(select).toHaveBeenCalledWith(runtimes[1]);
    view.unmount();
    render(<RuntimeMenuItems runtimes={runtimes} onSelect={select} />);
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
    drag(
      screen.getByRole("menuitemradio", { name: /Alpha/ }),
      screen.getByRole("menuitemradio", { name: /Beta/ }),
    );
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(screen.getByRole("menuitemradio", { name: /Gamma/ })).toBeDisabled();
    cleanup();
    render(
      <>
        <RuntimeMenuItems runtimes={runtimes} onSelect={select} />
        <RuntimeMenuItems runtimes={runtimes} onSelect={select} />
      </>,
    );
    drag(
      screen.getAllByRole("menuitemradio", { name: /Alpha/ })[0],
      screen.getAllByRole("menuitemradio", { name: /Beta/ })[0],
    );
    expect(names()).toEqual([
      "Beta",
      "Alpha",
      "Gamma",
      "Beta",
      "Alpha",
      "Gamma",
    ]);
  });
  it("preserves hidden agent positions and remains usable when storage fails", () => {
    localStorage.setItem(
      "agents-one.runtime-display-order.v1",
      JSON.stringify(["a", "c", "b"]),
    );
    render(
      <RuntimeMenuItems
        runtimes={runtimes.filter((runtime) => runtime.enabled)}
        onSelect={vi.fn()}
      />,
    );
    drag(
      screen.getByRole("menuitemradio", { name: /Beta/ }),
      screen.getByRole("menuitemradio", { name: /Alpha/ }),
    );
    expect(
      JSON.parse(localStorage.getItem("agents-one.runtime-display-order.v1")!),
    ).toEqual(["b", "c", "a"]);
    const failure = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    drag(
      screen.getByRole("menuitemradio", { name: /Alpha/ }),
      screen.getByRole("menuitemradio", { name: /Beta/ }),
    );
    expect(names()).toEqual(["Alpha", "Beta"]);
    failure.mockRestore();
  });
  it("tolerates malformed order, retains new agents and ignores unrelated drops", () => {
    localStorage.setItem("agents-one.runtime-display-order.v1", "{bad");
    const view = render(
      <RuntimeMenuItems runtimes={runtimes} onSelect={vi.fn()} />,
    );
    expect(names()).toEqual(["Alpha", "Beta", "Gamma"]);
    fireEvent.drop(screen.getAllByRole("menuitemradio")[0], {
      dataTransfer: { getData: () => "external" },
    });
    expect(localStorage.getItem("agents-one.runtime-display-order.v1")).toBe(
      "{bad",
    );
    view.unmount();
    localStorage.setItem(
      "agents-one.runtime-display-order.v1",
      JSON.stringify(["missing", "b", "b", 4]),
    );
    render(<RuntimeMenuItems runtimes={runtimes} onSelect={vi.fn()} />);
    expect(names()).toEqual(["Beta", "Alpha", "Gamma"]);
  });
});
