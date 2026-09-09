import { beforeEach, describe, expect, it } from "vitest";
import { readMigratedStorageValue } from "./brandMigration";

describe("readMigratedStorageValue", () => {
  beforeEach(() => localStorage.clear());

  it("prefers an existing Agents One value", () => {
    localStorage.setItem("agents-one.theme.v1", "dark");
    localStorage.setItem("hermes-theme", "light");

    expect(
      readMigratedStorageValue("agents-one.theme.v1", "hermes-theme"),
    ).toBe("dark");
  });

  it("copies a legacy value without deleting it", () => {
    localStorage.setItem("hermes-theme", "light");

    expect(
      readMigratedStorageValue("agents-one.theme.v1", "hermes-theme"),
    ).toBe("light");
    expect(localStorage.getItem("agents-one.theme.v1")).toBe("light");
    expect(localStorage.getItem("hermes-theme")).toBe("light");
  });
});
