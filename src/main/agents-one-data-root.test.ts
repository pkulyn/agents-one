// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { join, resolve } from "path";

vi.mock("electron", () => ({
  app: { getPath: () => "C:/fallback-user-data" },
}));

import {
  agentsOneDataRoot,
  agentsOneProfileHome,
} from "./agents-one-data-root";

describe("Agents One data root", () => {
  // @lat: [[runtime-chat#Profile-scoped conversation history storage]]
  it("keeps the default profile in the app-owned profile directory", () => {
    const userData = "C:/agents-one-user-data";
    expect(agentsOneDataRoot(userData)).toBe(join(resolve(userData), "data"));
    expect(agentsOneProfileHome("default", userData)).toBe(
      join(resolve(userData), "data", "profiles", "default"),
    );
  });

  it("keeps named profiles separate and rejects invalid profile names", () => {
    const userData = "C:/agents-one-user-data";
    expect(agentsOneProfileHome("work", userData)).toBe(
      join(resolve(userData), "data", "profiles", "work"),
    );
    expect(() => agentsOneProfileHome("../outside", userData)).toThrow(
      "Invalid Agents One profile name.",
    );
  });
});
