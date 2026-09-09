// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeSkills } from "./runtime-skills";

const roots: string[] = [];

afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);

describe("runtime skill discovery", () => {
  it("reads only SKILL.md metadata and assigns a non-main-process boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "agents-one-skills-"));
    roots.push(root);
    const skill = join(root, "review");
    mkdirSync(skill);
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: Review\ndescription: Safe review\n---\nignored body",
      "utf8",
    );
    expect(discoverRuntimeSkills(root, "project")).toEqual([
      expect.objectContaining({
        id: "project:review",
        name: "Review",
        trust: "project-unreviewed",
        executionBoundary: "documentation-only",
      }),
    ]);
  });
});
