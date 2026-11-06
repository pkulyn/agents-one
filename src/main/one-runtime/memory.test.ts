import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  readOneMemoryFile,
  readOneProjectMemoryFile,
  writeOneMemoryFile,
  writeOneProjectMemoryFile,
} from "./memory";

it("keeps editable memory scoped by profile and One identity", () => {
  const root = mkdtempSync(join(tmpdir(), "one-memory-"));
  try {
    const a = join(root, "profile-a");
    const b = join(root, "profile-b");
    writeOneMemoryFile(a, "one-a", "  Preference\n");
    expect(readOneMemoryFile(a, "one-a")).toBe("  Preference\n");
    expect(readOneMemoryFile(a, "one-b")).toBe("");
    expect(readOneMemoryFile(b, "one-a")).toBe("");
    expect(() => writeOneMemoryFile(a, "../bad", "x")).toThrow();
    expect(() => writeOneMemoryFile(a, "one-a", "x".repeat(110000))).toThrow();
    expect(readOneMemoryFile(a, "one-a")).toBe("  Preference\n");
    writeOneMemoryFile(a, "one-a", "");
    expect(readOneMemoryFile(a, "one-a")).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects existing and dangling directory links in the memory path", () => {
  const root = mkdtempSync(join(tmpdir(), "one-memory-link-"));
  try {
    for (const kind of ["existing", "missing"] as const) {
      const profile = join(root, "profile-" + kind);
      const target = join(root, "target-" + kind);
      mkdirSync(profile);
      if (kind === "existing") mkdirSync(target);
      symlinkSync(
        target,
        join(profile, "desktop"),
        process.platform === "win32" ? "junction" : "dir",
      );
      expect(() => readOneMemoryFile(profile, "one-a")).toThrow(
        "symbolic link",
      );
      expect(() => writeOneMemoryFile(profile, "one-a", "private")).toThrow(
        "symbolic link",
      );
      if (kind === "missing") expect(existsSync(target)).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("keeps project memory scoped to the profile, One runtime, and project capability", () => {
  const root = mkdtempSync(join(tmpdir(), "one-project-memory-"));
  const projectA = "project-aaaaaaaaaaaaaaaaaaaaaaaa";
  const projectB = "project-bbbbbbbbbbbbbbbbbbbbbbbb";
  try {
    writeOneProjectMemoryFile(root, "one-a", projectA, "project A facts");
    expect(readOneProjectMemoryFile(root, "one-a", projectA)).toBe(
      "project A facts",
    );
    expect(readOneProjectMemoryFile(root, "one-a", projectB)).toBe("");
    expect(readOneProjectMemoryFile(root, "one-b", projectA)).toBe("");
    expect(
      readOneProjectMemoryFile(join(root, "other-profile"), "one-a", projectA),
    ).toBe("");
    expect(() =>
      readOneProjectMemoryFile(root, "one-a", "  project-a  "),
    ).toThrow("workspace ID is invalid");
    const importedWorkspaceId = "legacy:workspace/identifier";
    writeOneProjectMemoryFile(
      root,
      "one-a",
      importedWorkspaceId,
      "imported project facts",
    );
    expect(readOneProjectMemoryFile(root, "one-a", importedWorkspaceId)).toBe(
      "imported project facts",
    );

    const projectDir = join(root, "desktop", "one", "one-a", "project-memory");
    const names = readdirSync(projectDir);
    expect(names).toContain(
      createHash("sha256").update(projectA).digest("hex") + ".md",
    );
    expect(names).toContain(
      createHash("sha256").update(importedWorkspaceId).digest("hex") + ".md",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("rejects project memory files and directories reached through links", () => {
  const root = mkdtempSync(join(tmpdir(), "one-project-memory-link-"));
  const projectId = "project-aaaaaaaaaaaaaaaaaaaaaaaa";
  try {
    writeOneProjectMemoryFile(root, "one-a", projectId, "safe");
    const runtimeDir = join(root, "desktop", "one", "one-a");
    const projectDir = join(runtimeDir, "project-memory");
    const targetDir = join(root, "target-dir");
    rmSync(projectDir, { recursive: true, force: true });
    mkdirSync(targetDir);
    symlinkSync(
      targetDir,
      projectDir,
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => readOneProjectMemoryFile(root, "one-a", projectId)).toThrow(
      "symbolic link",
    );
    expect(() =>
      writeOneProjectMemoryFile(root, "one-a", projectId, "no"),
    ).toThrow("symbolic link");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
