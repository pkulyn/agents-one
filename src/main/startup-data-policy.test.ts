import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  automaticLegacyImportAllowed,
  isPortableLaunch,
  PORTABLE_MARKER_NAME,
} from "./startup-data-policy";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("portable legacy-data isolation", () => {
  it("recognizes only a valid Windows ZIP marker without launcher environment", () => {
    const resources = mkdtempSync(
      join(tmpdir(), "agents-one-portable-policy-"),
    );
    folders.push(resources);
    expect(isPortableLaunch({}, resources, "win32")).toBe(false);
    for (const invalid of [
      "invalid",
      "null",
      "{}",
      '{"schema":2,"mode":"agents-one-portable"}',
    ]) {
      writeFileSync(join(resources, PORTABLE_MARKER_NAME), invalid);
      expect(isPortableLaunch({}, resources, "win32")).toBe(false);
    }
    writeFileSync(
      join(resources, PORTABLE_MARKER_NAME),
      JSON.stringify({ schema: 1, mode: "agents-one-portable" }),
    );
    expect(isPortableLaunch({}, resources, "win32")).toBe(true);
    expect(isPortableLaunch({}, resources, "linux")).toBe(false);
    expect(
      automaticLegacyImportAllowed(
        { AGENTS_ONE_USER_DATA_DIR: "override" },
        resources,
        "win32",
      ),
    ).toBe(false);
  });
  it("keeps installer upgrade migration while blocking portable adoption regardless of data overrides", () => {
    expect(automaticLegacyImportAllowed({})).toBe(true);
    expect(
      automaticLegacyImportAllowed({ PORTABLE_EXECUTABLE_DIR: "D:/portable" }),
    ).toBe(false);
  });
  it("guards both startup migration entry points", () => {
    const index = readFileSync(join(__dirname, "index.ts"), "utf8");
    const start = readFileSync(join(__dirname, "app/start.ts"), "utf8");
    expect(index).toContain("!automaticLegacyImportAllowed() ||");
    expect(start).toContain("importLegacy: automaticLegacyImportAllowed()");
  });
});
