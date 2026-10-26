import {
  afterEach,
  beforeEach,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverClosedProjectWrites,
  persistClosedProjectWrite,
} from "../src/main/mobile-control/closed-project-write";
const state = vi.hoisted(() => ({
  home: "",
  root: "",
  profile: "owner",
  locked: false,
}));
vi.mock("../src/main/utils", () => {
  const mocked = {
    profileHome: () => state.home,
    getActiveProfileNameSync: () => state.profile,
  };
  return { ...mocked, agentsOneProfileHome: mocked.profileHome };
});
vi.mock("../src/main/project-folders", () => ({
  listProjectFolders: () => [{ id: "project-one", name: "Registered project" }],
}));
vi.mock("../src/main/workspace-authority", () => ({
  resolveAuthorizedWorkspaceId: () => state.root,
}));
vi.mock("../src/main/restore-write-lock", () => ({
  assertAgentsOneWritesAllowed: () => {
    if (state.locked) throw Error("restore_write_locked");
  },
}));
const hash = (v: string | Buffer): string =>
  createHash("sha256").update(v).digest("hex");
const identity = (
  path: string,
): { dev: number; ino: number; birthtimeMs: number } => {
  const s = lstatSync(path);
  return { dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs };
};
const roots: string[] = [];
beforeEach(() => {
  state.profile = "owner";
  state.locked = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      dirname(resolve(root)) !== resolve(tmpdir()) ||
      !basename(root).startsWith("agents-one-closed-write-")
    )
      throw Error("unsafe_cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture(): {
  root: string;
  folder: string;
  coordination: string;
  runId: string;
  journal: string;
  localId: string;
  target: string;
  lock: string;
  marker: string;
  pid: MockInstance<typeof process.kill>;
} {
  const root = mkdtempSync(join(tmpdir(), "agents-one-closed-write-"));
  roots.push(root);
  state.home = join(root, "home");
  state.root = join(root, "project");
  const folder = join(state.home, "desktop/mobile-control/project-writes"),
    coordination = join(
      state.home,
      "desktop/mobile-control/project-write-locks",
    );
  mkdirSync(folder, { recursive: true });
  mkdirSync(coordination, { recursive: true });
  mkdirSync(state.root);
  state.root = realpathSync(state.root);
  const runId = "run-" + randomUUID(),
    namespace = hash(
      JSON.stringify([
        JSON.stringify([realpathSync(state.home), runId]),
        state.root,
      ]),
    );
  const journalName = hash("journal") + ".json",
    journal = join(folder, journalName),
    localId = hash(journal),
    target = join(state.root, "file.txt");
  const lockName =
      "project-" +
      hash(
        process.platform === "win32" ? state.root.toLowerCase() : state.root,
      ) +
      ".lock",
    lock = join(coordination, lockName);
  writeFileSync(target, "requested");
  writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, nonce: randomUUID() }),
  );
  writeFileSync(
    journal,
    JSON.stringify({
      version: 1,
      namespace,
      phase: "uncertain",
      intent: {
        path: "file.txt",
        sha256: hash("requested"),
        previousSha256: hash("old"),
        bytes: 9,
        previousText: "old",
      },
    }),
  );
  const evidence = {
    root: state.root,
    rootIdentity: identity(state.root),
    directoryIdentity: identity(folder),
    coordinationIdentity: identity(coordination),
    namespace,
    journalName,
    journalSha256: hash(readFileSync(journal)),
    lockName,
    lockSha256: hash(readFileSync(lock)),
    lockIdentity: identity(lock),
    path: "file.txt",
    sha256: hash("requested"),
    previousSha256: hash("old"),
    bytes: 9,
  };
  persistClosedProjectWrite({
    profile: "owner",
    projectId: "project-one",
    runId,
    localId,
    generation: "legacy",
    homeIdentity: identity(state.home),
    evidence,
  });
  const marker = join(folder, "closed-" + localId + ".json");
  const pid = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(Error("dead"), { code: "ESRCH" });
  });
  return {
    root,
    folder,
    coordination,
    runId,
    journal,
    localId,
    target,
    lock,
    marker,
    pid,
  };
}
it("requires current confirmation after restart and preserves unknown audit while releasing only the original lease", async () => {
  const f = fixture(),
    result = discoverClosedProjectWrites("owner", new Set());
  expect(result.blocked).toEqual([]);
  expect(result.entries).toHaveLength(1);
  const entry = result.entries[0],
    runner = entry.runner;
  expect(entry).toMatchObject({
    restarted: true,
    runId: f.runId,
    localId: f.localId,
  });
  const initial = (await runner.reviewRetainedWrites())[0];
  expect(initial.state).toBe("matches_requested");
  await expect(
    runner.releaseRetainedWrite(f.localId, initial.reviewToken, false),
  ).rejects.toThrow("confirmation_required");
  writeFileSync(f.target, "external change");
  await expect(
    runner.releaseRetainedWrite(f.localId, initial.reviewToken, true),
  ).rejects.toThrow("revision_conflict");
  expect(existsSync(f.lock)).toBe(true);
  const current = (await runner.reviewRetainedWrites())[0];
  expect(current.state).toBe("changed");
  await expect(
    runner.releaseRetainedWrite(f.localId, current.reviewToken, true, () => {
      throw Error("scope_denied");
    }),
  ).rejects.toThrow("scope_denied");
  await runner.releaseRetainedWrite(f.localId, current.reviewToken, true);
  expect(existsSync(f.lock)).toBe(false);
  expect(JSON.parse(readFileSync(f.journal, "utf8"))).toMatchObject({
    phase: "uncertain",
    ownerReleaseAuthorized: {
      state: "changed",
      observedSha256: hash("external change"),
    },
  });
  expect(readFileSync(f.target, "utf8")).toBe("external change");
  expect(discoverClosedProjectWrites("owner", new Set()).entries).toEqual([]);
});
it.each(["alive", "EPERM"])(
  "does not recover when the old PID is %s",
  (mode) => {
    const f = fixture();
    f.pid.mockImplementation(() => {
      if (mode === "EPERM")
        throw Object.assign(Error("denied"), { code: "EPERM" });
      return true;
    });
    const result = discoverClosedProjectWrites("owner", new Set());
    expect(result.entries).toEqual([]);
    expect(result.blocked[0].state).toBe("blocked");
    expect(existsSync(f.lock)).toBe(true);
  },
);
it.each(["audit", "lock", "proof", "generation", "project"])(
  "keeps the lock when the %s binding changes",
  (field) => {
    const f = fixture();
    if (field === "audit") writeFileSync(f.journal, "{}");
    if (field === "lock")
      writeFileSync(
        f.lock,
        JSON.stringify({ pid: process.pid, nonce: "foreign" }),
      );
    if (field === "proof") writeFileSync(f.marker, "{}");
    if (field === "generation")
      writeFileSync(
        join(state.home, "desktop/mobile-control/data-generation.json"),
        JSON.stringify({ version: 1, generation: randomUUID() }),
      );
    if (field === "project") state.root = "";
    expect(discoverClosedProjectWrites("owner", new Set()).entries).toEqual([]);
    expect(existsSync(f.lock)).toBe(true);
  },
);
it("rejects a junction replacing private audit storage and a restored/profile-switched capability", async () => {
  const f = fixture(),
    entry = discoverClosedProjectWrites("owner", new Set()).entries[0];
  state.locked = true;
  await expect(entry.runner.reviewRetainedWrites()).rejects.toThrow(
    "restore_write_locked",
  );
  state.locked = false;
  state.profile = "other";
  await expect(entry.runner.reviewRetainedWrites()).rejects.toThrow(
    "requires_owner_action",
  );
  state.profile = "owner";
  const external = join(f.root, "external");
  mkdirSync(external);
  // The fixture's contained directory is empty only after its own bounded files are removed.
  if (
    resolve(f.folder) !==
    resolve(f.root, "home/desktop/mobile-control/project-writes")
  )
    throw Error("unsafe_cleanup");
  rmSync(f.folder, { recursive: true });
  symlinkSync(external, f.folder, "junction");
  await expect(entry.runner.reviewRetainedWrites()).rejects.toThrow(
    "requires_owner_action",
  );
  expect(existsSync(f.lock)).toBe(true);
});
