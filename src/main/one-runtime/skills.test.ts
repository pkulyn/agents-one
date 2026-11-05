import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadOneSkills } from "./skills";

it("loads only explicitly selected user skill documents", () => {
  const root = mkdtempSync(join(tmpdir(), "one-skills-"));
  try {
    mkdirSync(join(root, "chosen"));
    writeFileSync(join(root, "chosen", "SKILL.md"), "# Selected instructions");
    const agentsRoot = join(root, "agents");
    mkdirSync(join(agentsRoot, "chosen"), { recursive: true });
    writeFileSync(
      join(agentsRoot, "chosen", "SKILL.md"),
      "# Agents-specific instructions",
    );
    mkdirSync(join(root, "other"));
    writeFileSync(join(root, "other", "SKILL.md"), "# Private other skill");
    expect(loadOneSkills(root, ["user:chosen"])).toEqual([
      expect.stringContaining("Selected instructions"),
    ]);
    expect(
      loadOneSkills(root, ["user:chosen", "agents-user:chosen"], agentsRoot),
    ).toEqual([
      expect.stringContaining("Selected instructions"),
      expect.stringContaining("Agents-specific instructions"),
    ]);
    expect(() => loadOneSkills(root, ["agents-user:chosen"])).toThrow(
      "source is unavailable",
    );
    expect(() =>
      loadOneSkills(join(root, "missing"), ["user:chosen"], agentsRoot),
    ).toThrow();
    expect(() =>
      loadOneSkills(root, ["agents-user:../other"], agentsRoot),
    ).toThrow();
    expect(loadOneSkills(root, [])).toEqual([]);
    expect(() => loadOneSkills(root, ["user:../other"])).toThrow();
    expect(() => loadOneSkills(root, ["project:other"])).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
