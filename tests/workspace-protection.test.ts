import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  it("retains failed originals, restores other files, and supports recovery retry", () => {
    const profileHome = mkdtempSync(
      join(tmpdir(), "agents-one-recovery-profile-"),
    );
    const workspace = mkdtempSync(
      join(tmpdir(), "agents-one-recovery-workspace-"),
    );
    roots.push(profileHome, workspace);
    mkdirSync(join(workspace, "docs"));
    writeFileSync(join(workspace, "docs", "original.txt"), "original document");
    writeFileSync(join(workspace, "other.txt"), "other original");
    const protection = protectWorkspaceFromRemoval(
      workspace,
      undefined,
      profileHome,
    );
    rmSync(join(workspace, "docs"), { recursive: true });
    writeFileSync(join(workspace, "docs"), "blocking file");
    rmSync(join(workspace, "other.txt"));

    expect(protection.restoreAndDispose()).toEqual(["other.txt"]);
    expect(protection.recoveryError).toMatch(/恢复未完成/);
    const backups = join(profileHome, "desktop", "safe-write-backups");
    const [backup] = readdirSync(backups);
    expect(
      readFileSync(join(backups, backup, "docs", "original.txt"), "utf8"),
    ).toBe("original document");
    expect(readFileSync(join(workspace, "other.txt"), "utf8")).toBe(
      "other original",
    );

    rmSync(join(workspace, "docs"));
    expect(protection.restoreAndDispose()).toEqual([
      join("docs", "original.txt"),
    ]);
    expect(protection.recoveryError).toBeUndefined();
    expect(readFileSync(join(workspace, "docs", "original.txt"), "utf8")).toBe(
      "original document",
    );
    expect(readdirSync(backups)).toEqual([]);
  });

  it("keeps the backup when an original parent becomes an outside junction", () => {
    const profileHome = mkdtempSync(
      join(tmpdir(), "agents-one-recovery-profile-"),
    );
    const workspace = mkdtempSync(
      join(tmpdir(), "agents-one-recovery-workspace-"),
    );
    const outside = mkdtempSync(join(tmpdir(), "agents-one-recovery-outside-"));
    roots.push(profileHome, workspace, outside);
    mkdirSync(join(workspace, "docs"));
    writeFileSync(join(workspace, "docs", "original.txt"), "original document");
    const protection = protectWorkspaceFromRemoval(
      workspace,
      undefined,
      profileHome,
    );
    rmSync(join(workspace, "docs"), { recursive: true });
    symlinkSync(outside, join(workspace, "docs"), "junction");

    expect(protection.restoreAndDispose()).toEqual([]);
    expect(protection.recoveryError).toBeTruthy();
    expect(existsSync(join(outside, "original.txt"))).toBe(false);
    const backups = join(profileHome, "desktop", "safe-write-backups");
    const [backup] = readdirSync(backups);
    expect(
      readFileSync(join(backups, backup, "docs", "original.txt"), "utf8"),
    ).toBe("original document");
  });
});
