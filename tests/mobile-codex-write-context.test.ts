import { afterEach, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createCodexProjectWriteRunner } from "../src/main/mobile-control/codex-project-write-context";

const state = vi.hoisted(() => ({ home: "" }));
vi.mock("../src/main/utils", () => {
  const mocked = {
  getActiveProfileNameSync: () => "owner",
  profileHome: (profile?: string) =>
    profile ? join(state.home, "profiles", profile) : state.home,
};
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () => join(state.home, "..", "project"),
}));
const roots: string[] = [];
function fixture(): Parameters<typeof createCodexProjectWriteRunner>[0] & {
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), "agents-one-write-context-"));
  roots.push(root);
  state.home = join(root, "home");
  const workspace = join(root, "project");
  mkdirSync(state.home);
  mkdirSync(workspace);
  mkdirSync(join(state.home, "profiles", "owner"), { recursive: true });
  return {
    root,
    workspace,
    runId: "run-11111111-1111-4111-8111-111111111111",
    executablePath: "fixture-codex",
    workerPath: join(root, "worker.cjs"),
    authorize: () => undefined,
    assertWritesAllowed: () => undefined,
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("agents-one-write-context-")
    )
      throw Error("unsafe_cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});

it("refuses non-Main Run ids, project-contained private storage and redirected private directories", () => {
  const f = fixture();
  expect(() =>
    createCodexProjectWriteRunner({ ...f, runId: "phone-selected-run" }),
  ).toThrow("context is unavailable");
  expect(existsSync(join(state.home, "desktop"))).toBe(false);
  expect(() =>
    createCodexProjectWriteRunner({ ...f, workspace: f.root }),
  ).toThrow("context is unavailable");
  expect(existsSync(join(state.home, "desktop"))).toBe(false);
  symlinkSync(f.workspace, join(state.home, "desktop"), "junction");
  expect(() => createCodexProjectWriteRunner(f)).toThrow(
    "context is unavailable",
  );
  expect(existsSync(join(f.workspace, "mobile-control"))).toBe(false);
});

it("places audit in its fixed profile and uses a common host coordination directory", () => {
  const f = fixture();
  const first = createCodexProjectWriteRunner({ ...f, profile: "owner" });
  const second = createCodexProjectWriteRunner({
    ...f,
    runId: "run-22222222-2222-4222-8222-222222222222",
  });
  expect(first.projectRoot()).toBe(f.workspace);
  expect(second.projectRoot()).toBe(f.workspace);
  expect(
    existsSync(
      join(
        state.home,
        "profiles",
        "owner",
        "desktop",
        "mobile-control",
        "project-writes",
      ),
    ),
  ).toBe(true);
  expect(
    existsSync(
      join(state.home, "desktop", "mobile-control", "project-write-locks"),
    ),
  ).toBe(true);
  expect(
    existsSync(
      join(
        state.home,
        "profiles",
        "owner",
        "desktop",
        "mobile-control",
        "project-write-locks",
      ),
    ),
  ).toBe(false);
});
