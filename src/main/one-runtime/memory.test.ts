import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readOneMemoryFile, writeOneMemoryFile } from "./memory";

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
