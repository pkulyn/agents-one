import { beforeEach, expect, it, vi } from "vitest";
import {
  readOneThinkingPreference,
  saveOneThinkingPreference,
} from "./oneThinkingPreference";
beforeEach(() => localStorage.clear());
it("defaults to medium and restores accepted choices independently per profile and runtime", () => {
  expect(readOneThinkingPreference("default", "one")).toBe("medium");
  saveOneThinkingPreference("default", "one", "high");
  expect(readOneThinkingPreference("default", "one")).toBe("high");
  expect(readOneThinkingPreference("other", "one")).toBe("medium");
  expect(readOneThinkingPreference("default", "other")).toBe("medium");
  saveOneThinkingPreference("default", "one", "off");
  expect(readOneThinkingPreference("default", "one")).toBe("off");
  saveOneThinkingPreference("default", "one", "max");
  saveOneThinkingPreference("default", "one", "invalid");
  expect(readOneThinkingPreference("default", "one")).toBe("max");
});
it("keeps the composer usable when browser preference storage is unavailable", () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw Error("denied");
  });
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw Error("denied");
  });
  expect(readOneThinkingPreference("default", "one")).toBe("medium");
  expect(() =>
    saveOneThinkingPreference("default", "one", "high"),
  ).not.toThrow();
  get.mockRestore();
  set.mockRestore();
});
