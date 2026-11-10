import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { copyOneSkillDirectory, removeOneSkillDirectory } from "./skill-copy";

it("copies a shared skill into One and removes only the One copy", () => {
  const root = mkdtempSync(join(tmpdir(), "one-skill-copy-"));
  try {
    const source = join(root, "shared", "chosen");
    mkdirSync(join(source, "notes"), { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "# Selected instructions");
    writeFileSync(join(source, "notes", "details.txt"), "details");
    const targetRoot = join(root, "one", "skills");
    const target = join(targetRoot, "chosen");
    copyOneSkillDirectory(source, target);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toContain(
      "Selected instructions",
    );
    expect(readFileSync(join(target, "notes", "details.txt"), "utf8")).toBe(
      "details",
    );
    removeOneSkillDirectory(targetRoot, "chosen");
    expect(readFileSync(join(source, "SKILL.md"), "utf8")).toContain(
      "Selected instructions",
    );
    expect(readFileSync(join(source, "notes", "details.txt"), "utf8")).toBe(
      "details",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("preserves an installed One copy when re-enabled even if the source disappeared", () => {
  const root = mkdtempSync(join(tmpdir(), "one-skill-preserve-"));
  try {
    const source = join(root, "source");
    const target = join(root, "owned", "demo");
    mkdirSync(source);
    writeFileSync(join(source, "SKILL.md"), "source");
    copyOneSkillDirectory(source, target);
    writeFileSync(join(target, "SKILL.md"), "custom instructions");
    rmSync(source, { recursive: true });
    copyOneSkillDirectory(source, target);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe(
      "custom instructions",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
