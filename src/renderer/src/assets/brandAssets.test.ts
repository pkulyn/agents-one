import { describe, expect, it } from "vitest";
import splashWordmark from "./agents-one-splash.svg?raw";
import sidebarWordmark from "./agents-one-wordmark.svg?raw";
import sidebarWordmarkOnDark from "./agents-one-wordmark-on-dark.svg?raw";

describe("Agents One wordmarks", () => {
  it.each([
    ["sidebar", sidebarWordmark],
    ["sidebar on dark", sidebarWordmarkOnDark],
    ["splash", splashWordmark],
  ])(
    "uses the outlined Oxanium wordmark with the dawn ring as the O (%s)",
    (_, svg) => {
      expect(svg).toContain("<circle");
      expect(svg.match(/<path /g)).toHaveLength(2);
      expect(svg).toContain("Oxanium 700");
      expect(svg).not.toContain("<text");
      expect(svg).not.toContain("font-family");
      expect(svg).not.toContain("<rect");
    },
  );

  it("uses high-contrast solid lettering for each sidebar surface", () => {
    expect(sidebarWordmark).toContain('fill="#171A21"');
    expect(sidebarWordmarkOnDark).toContain('fill="#F5F7FA"');
  });
});
