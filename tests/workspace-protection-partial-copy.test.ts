import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, expect, it, vi } from "vitest";
const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("fs")>();
  return {
    ...fs,
    copyFileSync: (...args: Parameters<typeof fs.copyFileSync>) => {
      if (fault.enabled) {
        fs.writeFileSync(args[1], "partial");
        throw Object.assign(new Error("synthetic disk full"), {
          code: "ENOSPC",
        });
      }
      return fs.copyFileSync(...args);
    },
  };
});
import { protectWorkspaceFromRemoval } from "../src/main/workspace-protection";
const roots: string[] = [];
afterEach(() => {
  fault.enabled = false;
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
it("does not discard the original when a failed copy leaves a partial destination", () => {
  const home = mkdtempSync(join(tmpdir(), "agents-one-partial-recovery-"));
  const workspace = mkdtempSync(
    join(tmpdir(), "agents-one-partial-workspace-"),
  );
  roots.push(home, workspace);
  const original = join(workspace, "original.txt");
  writeFileSync(original, "complete synthetic original");
  const protection = protectWorkspaceFromRemoval(workspace, undefined, home);
  rmSync(original);
  fault.enabled = true;
  expect(protection.restoreAndDispose()).toEqual([]);
  expect(protection.recoveryError).toBeTruthy();
  fault.enabled = false;
  expect(protection.restoreAndDispose()).toEqual([]);
  expect(protection.recoveryError).toBeTruthy();
  const backups = join(home, "desktop", "safe-write-backups");
  const [backup] = readdirSync(backups);
  expect(readFileSync(join(backups, backup, "original.txt"), "utf8")).toBe(
    "complete synthetic original",
  );
  rmSync(original);
  expect(protection.restoreAndDispose()).toEqual(["original.txt"]);
  expect(protection.recoveryError).toBeUndefined();
  expect(readFileSync(original, "utf8")).toBe("complete synthetic original");
});
