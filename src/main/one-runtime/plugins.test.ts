import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { inspectOnePlugin, loadOnePluginInstructions } from "./plugins";

function createPlugin(root: string): string {
  const plugin = join(root, "sample-plugin");
  mkdirSync(join(plugin, ".zcode-plugin"), { recursive: true });
  mkdirSync(join(plugin, "skills", "summarize"), { recursive: true });
  mkdirSync(join(plugin, "hooks"), { recursive: true });
  writeFileSync(
    join(plugin, ".zcode-plugin", "plugin.json"),
    JSON.stringify({
      id: "sample.plugin",
      name: "Sample plugin",
      version: "1.0.0",
      skills: ["skills"],
      hooks: { SessionStart: [{ command: "dangerous.js" }] },
    }),
  );
  writeFileSync(
    join(plugin, "skills", "summarize", "SKILL.md"),
    "---\nname: summarize\ndescription: Summarize a file\n---\nRead only the requested file.",
  );
  writeFileSync(
    join(plugin, "hooks", "dangerous.js"),
    'throw new Error("plugin hook must never run");',
  );
  return plugin;
}

// @lat: [[main-process#Main Process#One session resume reconciliation#One plugin import and execution boundary#Imports ZCode plugin skill instructions without running scripts or hooks]]
it("loads declared plugin skills but never executes plugin scripts or hooks", () => {
  const root = mkdtempSync(join(tmpdir(), "one-plugin-"));
  try {
    const directory = createPlugin(root);
    expect(inspectOnePlugin(directory)).toMatchObject({
      id: "sample.plugin",
      name: "Sample plugin",
      skillCount: 1,
    });
    expect(
      loadOnePluginInstructions([
        {
          id: "sample.plugin",
          name: "Sample plugin",
          directory,
          enabled: true,
        },
      ]),
    ).toEqual([expect.stringContaining("Read only the requested file.")]);
    expect(
      loadOnePluginInstructions([
        {
          id: "sample.plugin",
          name: "Sample plugin",
          directory,
          enabled: false,
        },
      ]),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects plugin skill folders that escape the selected directory", () => {
  const root = mkdtempSync(join(tmpdir(), "one-plugin-path-"));
  try {
    const directory = createPlugin(root);
    writeFileSync(
      join(directory, ".zcode-plugin", "plugin.json"),
      JSON.stringify({
        id: "sample.plugin",
        name: "Sample",
        skills: ["../outside"],
      }),
    );
    expect(() => inspectOnePlugin(directory)).toThrow(
      "inside the plugin folder",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("skips an enabled plugin that has been removed since it was configured", () => {
  const root = mkdtempSync(join(tmpdir(), "one-plugin-removed-"));
  try {
    const directory = createPlugin(root);
    rmSync(directory, { recursive: true, force: true });
    expect(
      loadOnePluginInstructions([
        {
          id: "removed.plugin",
          name: "Removed plugin",
          directory,
          enabled: true,
        },
      ]),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
