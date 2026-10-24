import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ root: "", enabled: true }));
vi.mock("../src/main/project-folders", () => ({
  listProjectFolders: () =>
    state.enabled ? [{ id: "project-valid", path: state.root }] : [],
  resolveProjectFolderPath: (id: string) =>
    state.enabled && id === "project-valid" ? state.root : null,
}));
import {
  authorizeUserSelectedWorkspace,
  resolveAuthorizedChatWorkspace,
} from "../src/main/workspace-authority";
const canonical = (value: string): string =>
  process.platform === "win32" ? value.toLowerCase() : value;
let temp: string;
let outside: string;
beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), "agents-one-chat-root-"));
  state.root = join(temp, "project");
  outside = join(temp, "outside");
  mkdirSync(state.root);
  mkdirSync(outside);
  state.enabled = true;
});
afterEach(() => {
  rmSync(temp, { recursive: true, force: true });
});
describe("chat working directory authority", () => {
  // @lat: [[context-folder#Chat execution root authority#Unauthorized legacy root]]
  it("rejects an unregistered root instead of forwarding it as a runtime cwd", () => {
    expect(() => resolveAuthorizedChatWorkspace(outside)).toThrow("未获授权");
  });
  // @lat: [[context-folder#Chat execution root authority#Opaque workspace identity]]
  it("does not turn an unknown workspace ID into default or raw-path execution", () => {
    expect(() =>
      resolveAuthorizedChatWorkspace(state.root, "forged-id"),
    ).toThrow("未获授权");
  });
  // @lat: [[context-folder#Chat execution root authority#Registered root compatibility]]
  it("accepts the registered root or opaque ID and lets the ID win over a caller path", () => {
    expect(resolveAuthorizedChatWorkspace(state.root)).toBe(
      canonical(state.root),
    );
    expect(resolveAuthorizedChatWorkspace(outside, "project-valid")).toBe(
      canonical(state.root),
    );
  });
  // @lat: [[context-folder#Chat execution root authority#Exact selected root]]
  it("rejects a descendant or junction escape unless the exact root was selected", () => {
    const child = join(state.root, "child");
    mkdirSync(child);
    symlinkSync(outside, join(state.root, "linked"), "junction");
    expect(() => resolveAuthorizedChatWorkspace(child)).toThrow("未获授权");
    expect(() =>
      resolveAuthorizedChatWorkspace(join(state.root, "linked")),
    ).toThrow("未获授权");
    authorizeUserSelectedWorkspace(child);
    expect(resolveAuthorizedChatWorkspace(child)).toBe(canonical(child));
  });
  // @lat: [[context-folder#Chat execution root authority#No-project context]]
  it("preserves no-project requests and treats blank legacy context as no selection", () => {
    expect(resolveAuthorizedChatWorkspace()).toBeUndefined();
    expect(resolveAuthorizedChatWorkspace("   ")).toBeUndefined();
  });
  it.each([{}, 42, "relative/path", "C:/missing/project"])(
    "rejects malformed or nonexistent context %j",
    (value) => {
      expect(() => resolveAuthorizedChatWorkspace(value as string)).toThrow(
        "未获授权",
      );
    },
  );
  it.each([{}, 42, "", "   "])(
    "rejects an explicitly invalid workspace ID %j",
    (value) => {
      expect(() =>
        resolveAuthorizedChatWorkspace(state.root, value as string),
      ).toThrow("未获授权");
    },
  );
  // @lat: [[context-folder#Chat execution root authority#Revoked project root]]
  it("does not reuse a removed registration", () => {
    state.enabled = false;
    expect(() => resolveAuthorizedChatWorkspace(state.root)).toThrow(
      "未获授权",
    );
  });
});
