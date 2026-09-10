import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let testHome: string;

async function loadStore(): Promise<
  typeof import("../src/main/archive-store")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/archive-store");
}

describe("archive store", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-archives-"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("archives idempotently and restores without deleting source data", async () => {
    const store = await loadStore();
    store.archiveItem({ kind: "task", targetId: "task-1", title: "测试任务" });
    store.archiveItem({ kind: "task", targetId: "task-1", title: "新标题" });
    expect(store.listArchivedItems()).toHaveLength(1);
    expect(store.listArchivedItems()[0]).toMatchObject({
      id: "task:task-1",
      title: "新标题",
    });
    expect(store.restoreArchivedItem("task:task-1")).toBe(true);
    expect(store.listArchivedItems()).toEqual([]);
  });
});
