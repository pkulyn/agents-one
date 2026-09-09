import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, describe, expect, it, vi } from "vitest";

const listProjectFoldersMock = vi.hoisted(() => vi.fn(() => []));
const resolveProjectFolderPathMock = vi.hoisted(() => vi.fn(() => null));

vi.mock("../src/main/project-folders", () => ({
  listProjectFolders: listProjectFoldersMock,
  resolveProjectFolderPath: resolveProjectFolderPathMock,
}));

import {
  authorizeUserSelectedWorkspace,
  isAuthorizedWorkspacePath,
  isAuthorizedWorkspaceRoot,
  resolveAuthorizedWorkspaceId,
  resolveAuthorizedWorkspaceRelativePath,
} from "../src/main/workspace-authority";

const roots: string[] = [];

afterEach(() => {
  listProjectFoldersMock.mockReset();
  listProjectFoldersMock.mockReturnValue([]);
  resolveProjectFolderPathMock.mockReset();
  resolveProjectFolderPathMock.mockReturnValue(null);
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(name: string): string {
  const root = join(tmpdir(), `agents-one-workspace-authority-${name}-${Date.now()}-${Math.random()}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
}

describe("workspace authority", () => {
  it("authorizes only a directory returned by the native-selection capability and its descendants", () => {
    const root = makeRoot("selected");
    const child = join(root, "docs", "guide.md");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(child, "guide");
    const outside = makeRoot("outside");

    expect(isAuthorizedWorkspaceRoot(root)).toBe(false);
    expect(authorizeUserSelectedWorkspace(root)).toBe(true);
    expect(isAuthorizedWorkspaceRoot(root)).toBe(true);
    expect(isAuthorizedWorkspacePath(child)).toBe(true);
    expect(isAuthorizedWorkspacePath(outside)).toBe(false);
  });

  it("does not follow a junction inside an authorized root to an outside file", () => {
    const root = makeRoot("symlink-root");
    const outside = makeRoot("symlink-outside");
    const outsideFile = join(outside, "secret.txt");
    const link = join(root, "external");
    writeFileSync(outsideFile, "secret");
    // A Windows junction requires no developer-mode symbolic-link privilege,
    // so this regression runs under the same ordinary-user account as RC1.
    symlinkSync(outside, link, "junction");
    authorizeUserSelectedWorkspace(root);

    expect(isAuthorizedWorkspacePath(join(link, "secret.txt"))).toBe(false);
  });

  it("accepts descendants of a persisted project root without needing a new chooser result", () => {
    const root = makeRoot("registered");
    const file = join(root, "README.md");
    writeFileSync(file, "readme");
    listProjectFoldersMock.mockReturnValue([{ path: root }]);

    expect(isAuthorizedWorkspacePath(file)).toBe(true);
  });

  it("resolves a registered workspace by opaque id only when its root is still valid", () => {
    const root = makeRoot("registered-id");
    listProjectFoldersMock.mockReturnValue([{ id: "project-safe", path: root }]);
    resolveProjectFolderPathMock.mockImplementation((id: string) =>
      id === "project-safe" ? root : null,
    );

    expect(resolveAuthorizedWorkspaceId("project-safe")).toBe(root.toLowerCase());
    expect(resolveAuthorizedWorkspaceId("project-forged")).toBeNull();
  });

  it("resolves only safe existing relative paths below an opaque workspace id", () => {
    const root = makeRoot("relative-id");
    const file = join(root, "docs", "guide.md");
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(file, "guide");
    listProjectFoldersMock.mockReturnValue([{ id: "project-relative", path: root }]);
    resolveProjectFolderPathMock.mockImplementation((id: string) =>
      id === "project-relative" ? root : null,
    );

    expect(resolveAuthorizedWorkspaceRelativePath("project-relative", "docs/guide.md"))
      .toBe(file.toLowerCase());
    expect(resolveAuthorizedWorkspaceRelativePath("project-relative", "../secret.txt"))
      .toBeNull();
    expect(resolveAuthorizedWorkspaceRelativePath("project-relative", "C:/secret.txt"))
      .toBeNull();
  });
});
