import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { protectWorkspaceFromRemoval } from "../src/main/workspace-protection";

describe("safe-write workspace protection", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores pre-existing files after delete or move while retaining writes", () => {
    const profileHome = mkdtempSync(join(tmpdir(), "agents-one-profile-"));
    const workspace = mkdtempSync(join(tmpdir(), "agents-one-safe-write-"));
    roots.push(profileHome, workspace);
    mkdirSync(join(workspace, "docs"), { recursive: true });
    writeFileSync(join(workspace, "keep.txt"), "original", "utf8");
    writeFileSync(join(workspace, "docs", "edit.txt"), "before", "utf8");

    const protection = protectWorkspaceFromRemoval(
      workspace,
      undefined,
      profileHome,
    );
    renameSync(join(workspace, "keep.txt"), join(workspace, "moved.txt"));
    writeFileSync(join(workspace, "docs", "edit.txt"), "after", "utf8");
    writeFileSync(join(workspace, "created.txt"), "new", "utf8");

    expect(protection.restoreAndDispose()).toEqual(["keep.txt"]);
    expect(readFileSync(join(workspace, "keep.txt"), "utf8")).toBe("original");
    expect(readFileSync(join(workspace, "docs", "edit.txt"), "utf8")).toBe(
      "after",
    );
    expect(readFileSync(join(workspace, "created.txt"), "utf8")).toBe("new");
    expect(existsSync(join(workspace, "moved.txt"))).toBe(true);
    expect(protection.restoreAndDispose()).toEqual([]);
  });

  it("restores an original file instead of following a replacement symlink", () => {
    const profileHome = mkdtempSync(join(tmpdir(), "agents-one-profile-"));
    const workspace = mkdtempSync(join(tmpdir(), "agents-one-safe-write-"));
    const outside = mkdtempSync(join(tmpdir(), "agents-one-outside-"));
    roots.push(profileHome, workspace, outside);
    const original = join(workspace, "keep.txt");
    const outsideFile = join(outside, "outside.txt");
    writeFileSync(original, "original", "utf8");
    writeFileSync(outsideFile, "outside", "utf8");
    const protection = protectWorkspaceFromRemoval(
      workspace,
      undefined,
      profileHome,
    );

    rmSync(original);
    try {
      symlinkSync(outsideFile, original, "file");
    } catch {
      // Developer Mode/enterprise policy may forbid symlinks on Windows.
      return;
    }

    expect(protection.restoreAndDispose()).toEqual(["keep.txt"]);
    expect(readFileSync(original, "utf8")).toBe("original");
    expect(readFileSync(outsideFile, "utf8")).toBe("outside");
  });
});
