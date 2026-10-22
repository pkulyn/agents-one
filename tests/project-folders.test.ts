import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { setPath: vi.fn(), getPath: () => "C:\\temp" },
}));

let testHome: string;

async function loadStore(): Promise<
  typeof import("../src/main/project-folders")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", testHome);
  return import("../src/main/project-folders");
}

describe("project folder registry", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-project-folders-"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists selected project folders without duplicating them", async () => {
    const store = await loadStore();

    const first = store.registerProjectFolder("D:/Projects/Alpha");
    expect(first).toMatchObject({
      name: "Alpha",
      id: expect.stringMatching(/^project-/),
    });

    store.registerProjectFolder("D:/Projects/Beta");
    store.registerProjectFolder("D:/Projects/Alpha");

    const folders = store.listProjectFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({ path: "D:\\Projects\\Alpha" });
    expect(folders[1]).toMatchObject({ path: "D:\\Projects\\Beta" });
  });

  it("stores the default profile registry under the app-owned data root", async () => {
    const store = await loadStore();
    const registered = store.registerProjectFolder("D:/Projects/Alpha");
    const appOwnedPath = join(
      testHome,
      "data",
      "profiles",
      "default",
      "desktop",
      "project-folders.json",
    );

    expect(existsSync(appOwnedPath)).toBe(true);
    expect(JSON.parse(readFileSync(appOwnedPath, "utf8"))).toMatchObject({
      folders: [expect.objectContaining({ id: registered?.id, name: "Alpha" })],
    });
    expect(store.listProjectWorkspaceCapabilities()).toEqual([
      expect.objectContaining({ id: registered?.id, name: "Alpha" }),
    ]);
    expect(existsSync(join(testHome, "desktop", "project-folders.json"))).toBe(
      false,
    );
  });

  it("reads a legacy registry without deleting it and writes updates to the app root", async () => {
    const legacyPath = join(testHome, "desktop", "project-folders.json");
    const appOwnedPath = join(
      testHome,
      "data",
      "profiles",
      "default",
      "desktop",
      "project-folders.json",
    );
    const legacy = {
      version: 2,
      folders: [
        {
          id: "project-legacy",
          path: "D:\\Projects\\Legacy",
          name: "Legacy workspace",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    mkdirSync(join(testHome, "desktop"), { recursive: true });
    writeFileSync(legacyPath, JSON.stringify(legacy), "utf8");
    const legacyBefore = readFileSync(legacyPath, "utf8");
    const store = await loadStore();

    expect(store.listProjectWorkspaceCapabilities()).toEqual([
      expect.objectContaining({
        id: "project-legacy",
        name: "Legacy workspace",
      }),
    ]);
    store.updateProjectFolder({
      id: "project-legacy",
      name: "Renamed workspace",
    });

    expect(JSON.parse(readFileSync(appOwnedPath, "utf8"))).toMatchObject({
      folders: [
        expect.objectContaining({
          id: "project-legacy",
          name: "Renamed workspace",
        }),
      ],
    });
    expect(readFileSync(legacyPath, "utf8")).toBe(legacyBefore);
  });

  it("resolves a stable opaque id without exposing a caller-supplied path", async () => {
    const store = await loadStore();
    const registered = store.registerProjectFolder("D:/Projects/Alpha");
    expect(registered?.id).toBeTruthy();
    expect(store.resolveProjectFolderPath(registered!.id!)).toBe(
      "D:\\Projects\\Alpha",
    );
    expect(store.resolveProjectFolderPath("project-not-registered")).toBeNull();
  });

  it("lists renderer-safe project capabilities without local paths", async () => {
    const store = await loadStore();
    store.registerProjectFolder("D:/Projects/Alpha");

    expect(store.listProjectWorkspaceCapabilities()).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^project-/),
        name: "Alpha",
      }),
    ]);
    expect(store.listProjectWorkspaceCapabilities()[0]).not.toHaveProperty(
      "path",
    );
  });

  it("removes only the registered project entry", async () => {
    const store = await loadStore();
    store.registerProjectFolder("D:/Projects/Alpha");
    expect(store.removeProjectFolder("D:/Projects/Alpha")).toBe(true);
    expect(store.listProjectFolders()).toEqual([]);
  });

  it("persists a custom name and pin state without changing the path", async () => {
    const store = await loadStore();
    store.registerProjectFolder("D:/Projects/Alpha");
    store.updateProjectFolder({
      path: "D:/Projects/Alpha",
      name: "核心项目",
      pinned: true,
    });
    // A later registration refresh must not overwrite the custom title.
    store.registerProjectFolder("D:/Projects/Alpha");
    expect(store.listProjectFolders()[0]).toMatchObject({
      path: "D:\\Projects\\Alpha",
      name: "核心项目",
      pinned: true,
    });
  });

  it("updates and removes a project by opaque id without requiring a path", async () => {
    const store = await loadStore();
    const registered = store.registerProjectFolder("D:/Projects/Alpha");
    const id = registered?.id;
    expect(id).toBeTruthy();

    const updated = store.updateProjectFolder({
      id,
      name: "安全项目",
      pinned: true,
    });
    expect(store.projectWorkspaceCapability(updated)).toEqual(
      expect.objectContaining({ id, name: "安全项目", pinned: true }),
    );
    expect(store.removeProjectWorkspace(id!)).toBe(true);
    expect(store.listProjectFolders()).toEqual([]);
  });
});
