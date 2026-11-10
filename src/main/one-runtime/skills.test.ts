import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadOneSkills } from "./skills";

// @lat: [[main-process#Main Process#One session resume reconciliation#One explicit skill resource loading]]
it("loads only explicitly selected user skill documents", () => {
  const root = mkdtempSync(join(tmpdir(), "one-skills-"));
  try {
    mkdirSync(join(root, "chosen"));
    writeFileSync(join(root, "chosen", "SKILL.md"), "# Selected instructions");
    writeFileSync(
      join(root, "chosen", "setup.js"),
      'throw new Error("unselected skill script was executed");',
    );
    const agentsRoot = join(root, "agents");
    mkdirSync(join(agentsRoot, "chosen"), { recursive: true });
    writeFileSync(
      join(agentsRoot, "chosen", "SKILL.md"),
      "# Agents-specific instructions",
    );
    const oneRoot = join(root, "one-skills");
    mkdirSync(join(oneRoot, "chosen"), { recursive: true });
    writeFileSync(
      join(oneRoot, "chosen", "SKILL.md"),
      "# One copy instructions",
    );
    mkdirSync(join(root, "other"));
    writeFileSync(join(root, "other", "SKILL.md"), "# Private other skill");
    expect(loadOneSkills(root, ["user:chosen"]).instructions).toEqual([
      expect.stringContaining("Selected instructions"),
    ]);
    expect(
      loadOneSkills(root, ["user:chosen", "agents-user:chosen"], agentsRoot)
        .instructions,
    ).toEqual([
      expect.stringContaining("Selected instructions"),
      expect.stringContaining("Agents-specific instructions"),
    ]);
    expect(
      loadOneSkills(root, ["one:chosen"], agentsRoot, oneRoot).instructions,
    ).toEqual([expect.stringContaining("One copy instructions")]);
    expect(loadOneSkills(root, ["agents-user:chosen"]).skipped).toEqual([
      "agents-user:chosen",
    ]);
    expect(
      loadOneSkills(join(root, "missing"), ["user:chosen"], agentsRoot)
        .instructions,
    ).toEqual([]);
    expect(
      loadOneSkills(join(root, "missing"), ["user:chosen"], agentsRoot).skipped,
    ).toEqual(["user:chosen"]);
    expect(
      loadOneSkills(root, ["agents-user:../other"], agentsRoot).skipped,
    ).toEqual(["agents-user:../other"]);
    expect(loadOneSkills(root, []).instructions).toEqual([]);
    expect(loadOneSkills(root, ["user:../other"]).skipped).toEqual([
      "user:../other",
    ]);
    expect(loadOneSkills(root, ["project:other"]).skipped).toEqual([
      "project:other",
    ]);
    expect(
      loadOneSkills(root, ["user:missing", "user:chosen"]).instructions,
    ).toEqual([expect.stringContaining("Selected instructions")]);
    expect(
      loadOneSkills(root, ["user:missing", "user:chosen"]).skipped,
    ).toEqual(["user:missing"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
