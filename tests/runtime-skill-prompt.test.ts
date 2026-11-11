import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runtimeSkillPrompt,
  onePluginSkillCommands,
  onePluginSkillPrompt,
} from "../src/main/runtime-skill-prompt";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fixture(): { user: string; agents: string; one: string } {
  const base = mkdtempSync(join(tmpdir(), "skill-command-"));
  dirs.push(base);
  const roots = {
    user: join(base, "user"),
    agents: join(base, "agents"),
    one: join(base, "one"),
  };
  for (const r of Object.values(roots))
    mkdirSync(join(r, "demo"), { recursive: true });
  return roots;
}
describe("explicit Runtime skill invocation", () => {
  it("loads one selected document and preserves multiline user input without executing scripts", () => {
    const roots = fixture();
    writeFileSync(
      join(roots.user, "demo/SKILL.md"),
      "# Demo\nUse scripts/run.js for this task.",
    );
    const result = runtimeSkillPrompt(
      "user:demo inspect\nthen summarize",
      roots,
    );
    expect(result).toMatchObject({
      type: "send-prompt",
      prompt: expect.stringContaining("# Demo"),
    });
    if (result.type === "send-prompt") {
      expect(result.prompt).toContain("inspect\nthen summarize");
      expect(result.prompt).toContain(join(roots.user, "demo"));
    }
    expect(existsSync(join(roots.user, "demo/ran"))).toBe(false);
  });
  it("resolves equal names by selected source and never loads all skills", () => {
    const roots = fixture();
    writeFileSync(join(roots.user, "demo/SKILL.md"), "USER ONLY");
    writeFileSync(join(roots.agents, "demo/SKILL.md"), "AGENTS ONLY");
    const result = runtimeSkillPrompt("agents-user:demo task", roots);
    expect(result).toMatchObject({
      prompt: expect.stringContaining("AGENTS ONLY"),
    });
    expect(JSON.stringify(result)).not.toContain("USER ONLY");
  });
  it("rejects arbitrary paths, project IDs, missing and oversized files", () => {
    const roots = fixture();
    for (const id of [
      "user:../private",
      "project:demo",
      "C:/secret",
      "user:missing",
      "one:demo",
    ])
      expect(
        runtimeSkillPrompt(id, { user: roots.user, agents: roots.agents }).type,
      ).toBe("error");
    writeFileSync(join(roots.user, "demo/SKILL.md"), "x".repeat(65537));
    expect(runtimeSkillPrompt("user:demo", roots).type).toBe("error");
  });
});

it("offers enabled plugin skills and expands only the selected safe document", () => {
  const roots = fixture();
  const directory = join(roots.one, "plugin");
  mkdirSync(join(directory, "skills/a"), { recursive: true });
  mkdirSync(join(directory, "skills/b"), { recursive: true });
  writeFileSync(
    join(directory, "plugin.json"),
    JSON.stringify({ name: "demo-plugin", skills: ["skills"] }),
  );
  writeFileSync(
    join(directory, "skills/a/SKILL.md"),
    "name: alpha\n# ALPHA ONLY",
  );
  writeFileSync(join(directory, "skills/b/SKILL.md"), "# BETA ONLY");
  const plugin = { id: "demo-plugin", name: "Demo", directory, enabled: true };
  const commands = onePluginSkillCommands([plugin]);
  expect(commands).toHaveLength(2);
  const command = commands.find((c) => c.displayName === "alpha")!;
  const result = onePluginSkillPrompt([plugin], command.name, "review this");
  expect(result).toMatchObject({
    type: "send-prompt",
    prompt: expect.stringContaining("ALPHA ONLY"),
  });
  expect(JSON.stringify(result)).not.toContain("BETA ONLY");
  expect(onePluginSkillCommands([{ ...plugin, enabled: false }])).toEqual([]);
  expect(onePluginSkillPrompt([plugin], "plugin:../private", "task").type).toBe(
    "error",
  );
});
