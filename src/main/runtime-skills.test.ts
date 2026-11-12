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
  it("reports individual invalid files without hiding valid skills", () => {
    const root = mkdtempSync(join(tmpdir(), "agents-one-skill-diagnostics-"));
    roots.push(root);
    for (const name of ["good", "oversize", "bad name", "unsafe"])
      mkdirSync(join(root, name));
    writeFileSync(join(root, "good", "SKILL.md"), "---\nname: Good\n---\nbody");
    writeFileSync(join(root, "oversize", "SKILL.md"), Buffer.alloc(65537, 65));
    writeFileSync(join(root, "bad name", "SKILL.md"), "ignored");
    mkdirSync(join(root, "unsafe", "SKILL.md"));
    const entries = discoverRuntimeSkills(root, "user");
    expect(entries.find((entry) => entry.id === "user:good")).toMatchObject({
      name: "Good",
    });
    expect(
      entries.find((entry) => entry.id === "user:oversize")?.oneIssue,
    ).toBe("too_large");
    expect(
      entries.find((entry) => entry.id === "user:bad name")?.oneIssue,
    ).toBe("invalid_name");
    expect(entries.find((entry) => entry.id === "user:unsafe")?.oneIssue).toBe(
      "unsafe_file",
    );
  });

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

// @lat: [[main-process#Main Process#One session resume reconciliation#Skill metadata descriptions]]
it("reads folded, literal and quoted YAML descriptions without treating body text as metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-yaml-"));
  roots.push(root);
  const cases = {
    folded: "description: >\n  提取视频字幕，\n  保存到知识库。",
    literal: "description: |\n  制作演示文档。\n  保留格式。",
    quoted: 'description: "Reader’s guide: Word and PDF"',
    invalid: "description: [unclosed",
  };
  for (const [name, header] of Object.entries(cases)) {
    mkdirSync(join(root, name));
    writeFileSync(
      join(root, name, "SKILL.md"),
      "---\nname: " +
        name +
        "\n" +
        header +
        "\n---\n# Body\ndescription: not metadata",
    );
  }
  const entries = discoverRuntimeSkills(root, "user");
  expect(entries.find((e) => e.name === "folded")?.description).toBe(
    "提取视频字幕， 保存到知识库。",
  );
  expect(entries.find((e) => e.name === "literal")?.description).toBe(
    "制作演示文档。\n保留格式。",
  );
  expect(entries.find((e) => e.name === "quoted")?.description).toBe(
    "Reader’s guide: Word and PDF",
  );
  expect(
    entries.find((e) => e.id === "user:invalid")?.description,
  ).toBeUndefined();
});
