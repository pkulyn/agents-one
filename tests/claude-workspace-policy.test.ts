import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "" }));
vi.mock("../src/main/agents-one-data-root", () => ({
  agentsOneDataRoot: () => join(state.root, "app-data", "data"),
}));
vi.mock("../src/main/utils", () => ({
  agentsOneProfileHome: () =>
    join(state.root, "app-data", "data", "profiles", "default"),
  profileHome: () => join(state.root, "hermes"),
}));
import { assertClaudeWorkspaceBoundary } from "../src/main/claude-workspace-policy";
beforeEach(() => {
  state.root = mkdtempSync(join(tmpdir(), "claude-private-workspace-"));
  mkdirSync(join(state.root, "app-data", "data", "profiles", "default"), {
    recursive: true,
  });
  mkdirSync(join(state.root, "project"));
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(state.root, "claude"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  if (!resolve(state.root).startsWith(resolve(tmpdir())))
    throw Error("Unsafe fixture");
  rmSync(state.root, { recursive: true, force: true });
});
// @lat: [[runtime-chat#Claude private workspace exclusion]]
it.each([
  "",
  "app-data",
  "app-data/data/profiles/default/desktop",
  "hermes/project",
  "claude/project",
])("refuses private workspace or ancestor %s", (part) => {
  expect(() => assertClaudeWorkspaceBoundary(join(state.root, part))).toThrow(
    "私有数据",
  );
});
it("permits an ordinary sibling project without treating names as path prefixes", () => {
  expect(() =>
    assertClaudeWorkspaceBoundary(join(state.root, "project")),
  ).not.toThrow();
  expect(() =>
    assertClaudeWorkspaceBoundary(join(state.root, "app-data-source")),
  ).not.toThrow();
});
it("refuses a junction alias into private data", () => {
  const alias = join(state.root, "alias");
  symlinkSync(
    join(state.root, "app-data"),
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => assertClaudeWorkspaceBoundary(alias)).toThrow("私有数据");
});
it("allows only the Main-owned conversation directory inside the private root", () => {
  const owned = join(
    state.root,
    "app-data/data/profiles/default/desktop/runtime-chat/claude-code",
  );
  mkdirSync(owned, { recursive: true });
  expect(() =>
    assertClaudeWorkspaceBoundary(owned, undefined, true),
  ).not.toThrow();
  expect(() =>
    assertClaudeWorkspaceBoundary(
      join(state.root, "app-data"),
      undefined,
      true,
    ),
  ).toThrow();
});
it("refuses a replaced owned conversation directory", () => {
  const owned = join(
    state.root,
    "app-data/data/profiles/default/desktop/runtime-chat/claude-code",
  );
  mkdirSync(join(owned, ".."), { recursive: true });
  symlinkSync(
    join(state.root, "project"),
    owned,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(() => assertClaudeWorkspaceBoundary(owned, undefined, true)).toThrow();
});
