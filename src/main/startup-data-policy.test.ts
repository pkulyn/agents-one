import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { automaticLegacyImportAllowed } from "./startup-data-policy";

describe("portable legacy-data isolation", () => {
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
