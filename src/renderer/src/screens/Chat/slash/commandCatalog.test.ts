import { describe, expect, it } from "vitest";
import { agentCommandsFromCatalog, createSlashCatalog } from "./commandCatalog";
import type { AgentSlashCommand, DesktopSlashCommand } from "./types";

const status: AgentSlashCommand = {
  name: "status",
  description: "Show status",
  category: "Agent",
  source: "agent",
  target: "agent",
};

describe("slash command catalog", () => {
  it("normalizes upstream command and alias names with leading slashes", () => {
    const upstream = agentCommandsFromCatalog({
      pairs: [["/new", "Start a session"]],
      canon: { "/reset": "/new", "/new": "/new" },
    });
    const catalog = createSlashCatalog({
      agentCommands: upstream.commands,
      aliases: upstream.aliases,
    });

    expect(catalog.resolve("/new")?.name).toBe("new");
    expect(catalog.resolve("reset")?.name).toBe("new");
  });

  it("rejects duplicate canonical names", () => {
    const desktop: DesktopSlashCommand = {
      name: "status",
      description: "Desktop status",
      category: "Desktop",
      source: "desktop",
      target: "desktop",
      execute: async () => ({ type: "handled" }),
    };

    expect(() =>
      createSlashCatalog({
        agentCommands: [status],
        desktopCommands: [desktop],
      }),
    ).toThrow("Duplicate slash command: /status");
  });

  it("rejects aliases that collide with canonical commands", () => {
    expect(() =>
      createSlashCatalog({
        agentCommands: [
          { ...status, aliases: ["inspect"] },
          { ...status, name: "inspect" },
        ],
      }),
    ).toThrow("Duplicate slash command: /inspect");
  });

  it("drops a canon alias whose name is already a standalone command", () => {
    // Regression for #802 / #804: the backend can expose the same name both as
    // a first-class command (via `pairs`) and as an alias of another command
    // (via `canon`) — e.g. `/compact` is a standalone TUI command *and* an
    // alias of `/compress`. The reconciled catalog must not list the name in
    // both `commands` and `aliases`, or createSlashCatalog throws and the app
    // crashes on agent connect.
    const discovered = agentCommandsFromCatalog({
      pairs: [
        ["/compress", "Compress conversation context"],
        ["/compact", "Toggle compact display mode"],
      ],
      canon: { "/compact": "/compress" },
    });

    expect(discovered.aliases).not.toHaveProperty("compact");
    expect(discovered.commands.map((c) => c.name)).toContain("compact");

    expect(() =>
      createSlashCatalog({
        agentCommands: discovered.commands,
        aliases: discovered.aliases,
      }),
    ).not.toThrow();

    const catalog = createSlashCatalog({
      agentCommands: discovered.commands,
      aliases: discovered.aliases,
    });
    // The standalone command wins deterministically.
    expect(catalog.resolve("/compact")?.name).toBe("compact");
  });
});
