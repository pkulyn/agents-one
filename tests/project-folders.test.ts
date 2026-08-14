import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;

async function loadStore(): Promise<typeof import("../src/main/project-folders")> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
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
    expect(first).toMatchObject({ name: "Alpha" });

    store.registerProjectFolder("D:/Projects/Beta");
    store.registerProjectFolder("D:/Projects/Alpha");

    const folders = store.listProjectFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0]).toMatchObject({ path: "D:\\Projects\\Alpha" });
    expect(folders[1]).toMatchObject({ path: "D:\\Projects\\Beta" });
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
});
