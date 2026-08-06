import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listTaskCenterTasksMock = vi.hoisted(() => vi.fn());

vi.mock("../src/main/task-center", () => ({
  listTaskCenterTasks: listTaskCenterTasksMock,
}));

let testHome: string;

async function loadConversationTasks(): Promise<
  typeof import("../src/main/conversation-tasks")
> {
  vi.resetModules();
  vi.stubEnv("HERMES_HOME", testHome);
  return import("../src/main/conversation-tasks");
}

describe("conversation task links", () => {
  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "agents-one-conversation-tasks-"));
    listTaskCenterTasksMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(testHome, { recursive: true, force: true });
  });

  it("persists a link once and can remove it", async () => {
    const links = await loadConversationTasks();
    const first = links.linkConversationTask("runtime-conv-1", "task-1");
    const duplicate = links.linkConversationTask("runtime-conv-1", "task-1");

    expect(duplicate).toEqual(first);
    expect(links.listConversationTaskLinks("runtime-conv-1")).toEqual([
      first,
    ]);
    const persisted = JSON.parse(
      readFileSync(
        join(testHome, "desktop", "conversation-tasks.json"),
        "utf8",
      ),
    ) as { version: number; links: unknown[] };
    expect(persisted.version).toBe(1);
    expect(persisted.links).toHaveLength(1);

    expect(links.unlinkConversationTask("runtime-conv-1", "task-1")).toBe(true);
    expect(links.listConversationTaskLinks("runtime-conv-1")).toEqual([]);
  });

  it("returns only tasks linked to the requested conversation in link order", async () => {
    const links = await loadConversationTasks();
    links.linkConversationTask("conversation-a", "task-second");
    links.linkConversationTask("conversation-a", "task-first");
    links.linkConversationTask("conversation-b", "task-third");
    listTaskCenterTasksMock.mockResolvedValue([
      { id: "task-first", title: "First" },
      { id: "task-second", title: "Second" },
      { id: "task-third", title: "Third" },
    ]);

    await expect(links.listConversationTasks("conversation-a")).resolves.toEqual([
      { id: "task-first", title: "First" },
      { id: "task-second", title: "Second" },
    ]);
  });
});
