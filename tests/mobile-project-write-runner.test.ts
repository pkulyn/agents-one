import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ProjectWriteRunner } from "../src/main/mobile-control/project-write-runner";
const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  terminate: vi.fn(),
  identity: vi.fn(),
  current: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: mocks.terminate,
}));
vi.mock("../src/main/mobile-control/codex-invocation-identity", () => ({
  captureCodexInspectionIdentity: mocks.identity,
  assertReviewedCodexInspectionNative: vi.fn(),
  assertCodexInspectionIdentity: mocks.current,
}));
let base: string, root: string, directory: string, workerPath: string;
const hash = (text: string): string =>
  createHash("sha256").update(text).digest("hex");
const command =
  (): import("../src/main/mobile-control/project-write-runner").ProjectWriteCommand => ({
    key: "tool-one",
    path: "file.txt",
    text: "replacement",
    expectedSha256: hash("original"),
    signal: new AbortController().signal,
  });
const options = (): ConstructorParameters<typeof ProjectWriteRunner>[0] => ({
  root,
  directory,
  namespace: "owner-space-epoch-run",
  workerPath,
  executablePath: "reviewed-native",
  authorize: () => undefined,
  assertWritesAllowed: () => undefined,
});
const records = (): Record<string, unknown>[] =>
  readdirSync(directory)
    .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(join(directory, n), "utf8")));
const recordFile = (): string =>
  join(
    directory,
    readdirSync(directory).find((n) => /^[a-f0-9]{64}\.json$/.test(n))!,
  );
it("rejects substituted worker bytes before launching Native and keeps a failed audit", async () => {
  const expected = createHash("sha256")
    .update(readFileSync(workerPath))
    .digest("hex");
  const runner = new ProjectWriteRunner({
    ...options(),
    expectedWorkerSha256: expected,
  });
  writeFileSync(workerPath, "substituted-worker");
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
  expect(records()).toEqual([expect.objectContaining({ phase: "failed" })]);
  expect(readdirSync(directory).some((name) => name.endsWith(".lock"))).toBe(
    false,
  );
});
function spawnFixture(
  mode: "success" | "after-permit-error" | "malformed" | "hold" = "success",
): void {
  mocks.spawn.mockImplementation(() => {
    const proc = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    proc.stdin.on("data", (chunk) => {
      const frame = JSON.parse(chunk.toString());
      if (frame.root) {
        queueMicrotask(() => {
          proc.stdout.write(
            JSON.stringify(
              mode === "malformed"
                ? { kind: "prepared", intent: { path: "foreign" } }
                : {
                    kind: "prepared",
                    intent: {
                      path: "file.txt",
                      previousText: "original",
                      previousSha256: hash("original"),
                      sha256: hash("replacement"),
                      bytes: 11,
                    },
                  },
            ) + "\n",
          );
        });
      } else if (frame.commit) {
        expect(records()[0]).toMatchObject({
          phase: "committing",
          intent: { previousText: "original" },
        });
        if (mode === "hold") return;
        queueMicrotask(() => {
          if (mode === "after-permit-error")
            proc.stdout.write('{"kind":"failed"}\n');
          else
            proc.stdout.write(
              JSON.stringify({
                kind: "applied",
                receipt: {
                  path: "file.txt",
                  previousSha256: hash("original"),
                  sha256: hash("replacement"),
                  bytes: 11,
                },
              }) + "\n",
            );
          proc.emit("close", mode === "after-permit-error" ? 1 : 0);
        });
      }
    });
    mocks.terminate.mockImplementation(async () => {
      queueMicrotask(() => proc.emit("close", null));
    });
    return proc;
  });
}
it("requires explicit recovery authority and current review, preserves the unknown outcome and never redelivers it", async () => {
  spawnFixture("after-permit-error");
  let allowed = true;
  const runner = new ProjectWriteRunner({
    ...options(),
    authorizeRecovery: () => {
      if (!allowed) throw Error("profile_changed");
    },
  });
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  const [previous] = await runner.reviewRetainedWrites();
  expect(previous).toMatchObject({
    path: "file.txt",
    state: "matches_previous",
    sha256: hash("original"),
  });
  expect(JSON.stringify(previous)).not.toContain(root);
  await expect(
    runner.releaseRetainedWrite(previous.id, previous.reviewToken, false),
  ).rejects.toThrow("confirmation_required");
  writeFileSync(join(root, "file.txt"), "replacement");
  await expect(
    runner.releaseRetainedWrite(previous.id, previous.reviewToken, true),
  ).rejects.toThrow("revision_conflict");
  const [current] = await runner.reviewRetainedWrites();
  expect(current.state).toBe("matches_requested");
  allowed = false;
  await expect(
    runner.releaseRetainedWrite(current.id, current.reviewToken, true),
  ).rejects.toThrow("profile_changed");
  allowed = true;
  await runner.releaseRetainedWrite(current.id, current.reviewToken, true);
  expect(readdirSync(directory).some((n) => n.endsWith(".lock"))).toBe(false);
  expect(records()[0]).toMatchObject({
    phase: "uncertain",
    ownerReleaseAuthorized: { state: "matches_requested" },
  });
  expect(runner.artifacts()).toEqual([]);
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(await runner.reviewRetainedWrites()).toEqual([]);
});

it("refuses to release locks or audit records whose bytes were replaced after worker close", async () => {
  spawnFixture("after-permit-error");
  const runner = new ProjectWriteRunner({
    ...options(),
    authorizeRecovery: () => undefined,
  });
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  const [review] = await runner.reviewRetainedWrites();
  const lock = join(
    directory,
    readdirSync(directory).find((n) => n.endsWith(".lock"))!,
  );
  const original = readFileSync(lock);
  writeFileSync(lock, "foreign-lock");
  await expect(
    runner.releaseRetainedWrite(review.id, review.reviewToken, true),
  ).rejects.toThrow("reconciliation_required");
  expect(readFileSync(lock, "utf8")).toBe("foreign-lock");
  writeFileSync(lock, original);
  writeFileSync(
    recordFile(),
    JSON.stringify({ ...records()[0], foreignField: true }),
  );
  await expect(
    runner.releaseRetainedWrite(review.id, review.reviewToken, true),
  ).rejects.toThrow("reconciliation_required");
  expect(records()[0]).toHaveProperty("foreignField", true);
  expect(readFileSync(lock)).toEqual(original);
});

it("keeps the original lock and unknown result when backup recovery blocks release intent persistence", async () => {
  spawnFixture("after-permit-error");
  let locked = false;
  const runner = new ProjectWriteRunner({
    ...options(),
    authorizeRecovery: () => undefined,
    assertWritesAllowed: () => {
      if (locked) throw Error("restore_locked");
    },
  });
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  const [review] = await runner.reviewRetainedWrites();
  locked = true;
  await expect(
    runner.releaseRetainedWrite(review.id, review.reviewToken, true),
  ).rejects.toThrow("restore_locked");
  expect(readdirSync(directory).some((n) => n.endsWith(".lock"))).toBe(true);
  expect(records()[0]).not.toHaveProperty("ownerReleaseAuthorized");
});
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "agents-one-write-runner-"));
  root = join(base, "project");
  directory = join(base, "private");
  workerPath = join(base, "worker.cjs");
  mkdirSync(root);
  mkdirSync(directory);
  writeFileSync(workerPath, "reviewed worker fixture");
  writeFileSync(join(root, "file.txt"), "original");
  mocks.spawn.mockReset();
  mocks.terminate.mockReset();
  mocks.identity.mockReturnValue({ nativePath: "reviewed-native" });
  mocks.current.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  if (
    dirname(resolve(base)) !== resolve(tmpdir()) ||
    !basename(base).startsWith("agents-one-write-runner-")
  )
    throw Error("unsafe_cleanup");
  rmSync(base, { recursive: true, force: true });
});

it("exports only confirmed replacement bytes independently of the mutable project and deduplicates replay", async () => {
  spawnFixture();
  const runner = new ProjectWriteRunner(options());
  const value = command();
  const pending = runner.write(value);
  value.text = "caller-altered-after-queue";
  await pending;
  value.text = "replacement";
  writeFileSync(join(root, "file.txt"), "later-editor-version");
  const first = runner.artifacts();
  expect(first).toEqual([
    expect.objectContaining({
      kind: "file",
      label: "file.txt",
      content: "replacement",
      sha256: hash("replacement"),
      size: 11,
      mime: "text/plain",
    }),
  ]);
  expect(first[0]).not.toHaveProperty("path");
  expect(JSON.stringify(first)).not.toContain("original");
  first[0].content = "caller-mutated";
  await runner.write(value);
  expect(runner.artifacts()).toHaveLength(1);
  expect(runner.artifacts()[0].content).toBe("replacement");
  const recovered = new ProjectWriteRunner(options());
  await recovered.write(value);
  expect(recovered.artifacts()).toEqual(runner.artifacts());
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("does not publish content for a write whose worker failed after commit permission", async () => {
  spawnFixture("after-permit-error");
  const runner = new ProjectWriteRunner(options());
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  expect(runner.artifacts()).toEqual([]);
  expect(records()[0].phase).toBe("uncertain");
});

it("bounds distinct applied versions and explicitly marks additional snapshots unavailable", async () => {
  spawnFixture();
  const runner = new ProjectWriteRunner(options());
  await runner.write(command());
  const sample = records()[0];
  for (let i = 0; i < 100; i++) {
    const value = { ...command(), key: `version-${i}`, text: `version-${i}` };
    const receipt = {
      path: value.path,
      previousSha256: value.expectedSha256,
      sha256: hash(value.text),
      bytes: Buffer.byteLength(value.text),
    };
    const row = {
      ...sample,
      inputHash: hash(
        JSON.stringify([value.path, value.text, value.expectedSha256]),
      ),
      receipt,
    };
    const file = join(
      directory,
      `${hash(JSON.stringify([sample.namespace, value.key]))}.json`,
    );
    writeFileSync(file, JSON.stringify(row));
    await runner.write(value);
  }
  const snapshots = runner.artifacts();
  expect(snapshots).toHaveLength(100);
  expect(
    snapshots.slice(0, 99).every((a) => typeof a.content === "string"),
  ).toBe(true);
  expect(snapshots[99].unavailableReason).toContain("snapshot limit");
  expect(snapshots[99]).not.toHaveProperty("content");
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("persists original text and committing before permit and replays applied after reconstructing Main without dispatch", async () => {
  spawnFixture();
  const value = command();
  const receipt = await new ProjectWriteRunner(options()).write(value);
  expect(records()[0]).toMatchObject({
    phase: "applied",
    intent: { previousText: "original" },
    receipt,
  });
  expect(await new ProjectWriteRunner(options()).write(value)).toEqual(receipt);
  expect(mocks.spawn).toHaveBeenCalledOnce();
  await expect(
    new ProjectWriteRunner(options()).write({ ...value, text: "different" }),
  ).rejects.toThrow("idempotency_conflict");
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("retains uncertainty after permit and refuses repeat dispatch across reconstruction", async () => {
  spawnFixture("after-permit-error");
  const value = command();
  await expect(new ProjectWriteRunner(options()).write(value)).rejects.toThrow(
    "reconciliation_required",
  );
  expect(records()[0]).toMatchObject({
    phase: "uncertain",
    intent: { previousText: "original" },
  });
  expect(readdirSync(directory).some((name) => name.endsWith(".lock"))).toBe(
    true,
  );
  await expect(
    new ProjectWriteRunner(options()).write({
      ...value,
      key: "another-change",
    }),
  ).rejects.toThrow("project_write_busy");
  await expect(new ProjectWriteRunner(options()).write(value)).rejects.toThrow(
    "reconciliation_required",
  );
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("rechecks cancellation raised synchronously inside the authorization callback before sending permit", async () => {
  spawnFixture();
  const abort = new AbortController();
  const runner = new ProjectWriteRunner({
    ...options(),
    authorize: () => {
      if (records().some((r) => r.phase === "committing")) abort.abort();
    },
  });
  await expect(
    runner.write({ ...command(), signal: abort.signal }),
  ).rejects.toThrow("reconciliation_required");
  expect(records()[0].phase).toBe("failed");
  expect(mocks.terminate).toHaveBeenCalledOnce();
  expect(readFileSync(join(root, "file.txt"), "utf8")).toBe("original");
});

it("terminates malformed preparation and refuses commit when audit persistence is locked", async () => {
  spawnFixture("malformed");
  await expect(
    new ProjectWriteRunner(options()).write(command()),
  ).rejects.toThrow("reconciliation_required");
  expect(records()[0].phase).toBe("failed");
  mocks.spawn.mockClear();
  const runner = new ProjectWriteRunner({
    ...options(),
    assertWritesAllowed: () => {
      throw Error("restore_locked");
    },
  });
  await expect(runner.write({ ...command(), key: "other" })).rejects.toThrow(
    "reconciliation_required",
  );
  expect(mocks.spawn).not.toHaveBeenCalled();
});

it("rejects corrupt extended receipts and prevents journals inside the writable project", async () => {
  spawnFixture();
  const value = command();
  await new ProjectWriteRunner(options()).write(value);
  const record = records()[0];
  (record.receipt as Record<string, unknown>).previousText = "private-original";
  writeFileSync(recordFile(), JSON.stringify(record));
  await expect(new ProjectWriteRunner(options()).write(value)).rejects.toThrow(
    "reconciliation_required",
  );
  expect(mocks.spawn).toHaveBeenCalledOnce();
  expect(
    () =>
      new ProjectWriteRunner({
        ...options(),
        directory: join(root, "private"),
      }),
  ).toThrow("unverified_policy");
});

it("retains committing when terminal receipt storage fails and never redelivers that attempt", async () => {
  spawnFixture();
  const spawn = mocks.spawn.getMockImplementation()!;
  let locked = false;
  mocks.spawn.mockImplementation((...args) => {
    const child = spawn(...args);
    child.stdin.on("data", (chunk) => {
      if (JSON.parse(chunk.toString()).commit) locked = true;
    });
    return child;
  });
  const runner = new ProjectWriteRunner({
    ...options(),
    assertWritesAllowed: () => {
      if (locked) throw Error("storage_locked");
    },
  });
  await expect(runner.write(command())).rejects.toThrow(
    "reconciliation_required",
  );
  expect(records()[0]).toMatchObject({
    phase: "committing",
    intent: { previousText: "original" },
  });
  locked = false;
  await expect(
    new ProjectWriteRunner(options()).write(command()),
  ).rejects.toThrow("reconciliation_required");
  expect(mocks.spawn).toHaveBeenCalledOnce();
});

it("waits for actual process close after timeout before settling the attempt", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  mocks.spawn.mockReturnValue(child);
  mocks.terminate.mockResolvedValue(undefined);
  const pending = new ProjectWriteRunner({ ...options(), timeoutMs: 20 }).write(
    command(),
  );
  let settled = false;
  void pending.catch(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(mocks.terminate).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  child.emit("close", null);
  await expect(pending).rejects.toThrow("reconciliation_required");
  expect(records()[0].phase).toBe("failed");
});

it("excludes a second namespace and journal from the same project until Native closes", async () => {
  spawnFixture("hold");
  const runner = new ProjectWriteRunner(options()),
    pending = runner.write(command());
  await vi.waitFor(() => expect(records()[0]?.phase).toBe("committing"));
  const other = new ProjectWriteRunner({
    ...options(),
    directory: join(base, "other-journal"),
    namespace: "other-run",
    coordinationDirectory: directory,
  });
  await expect(other.write({ ...command(), key: "second" })).rejects.toThrow(
    "project_write_busy",
  );
  expect(mocks.spawn).toHaveBeenCalledOnce();
  const child = mocks.spawn.mock.results[0].value;
  child.stdout.write(
    JSON.stringify({
      kind: "applied",
      receipt: {
        path: "file.txt",
        previousSha256: hash("original"),
        sha256: hash("replacement"),
        bytes: 11,
      },
    }) + "\n",
  );
  child.emit("close", 0);
  await pending;
  expect(readdirSync(directory).filter((n) => n.endsWith(".lock"))).toEqual([]);
});

it("preserves an unknown replacement lock and refuses subsequent dispatch", async () => {
  spawnFixture("hold");
  const pending = new ProjectWriteRunner(options()).write(command());
  await vi.waitFor(() => expect(records()[0]?.phase).toBe("committing"));
  const lock = join(
    directory,
    readdirSync(directory).find((n) => n.endsWith(".lock"))!,
  );
  renameSync(lock, lock + ".saved");
  writeFileSync(lock, "unknown-lock-owner");
  const child = mocks.spawn.mock.results[0].value;
  child.stdout.write(
    JSON.stringify({
      kind: "applied",
      receipt: {
        path: "file.txt",
        previousSha256: hash("original"),
        sha256: hash("replacement"),
        bytes: 11,
      },
    }) + "\n",
  );
  child.emit("close", 0);
  await pending;
  expect(readFileSync(lock, "utf8")).toBe("unknown-lock-owner");
  await expect(
    new ProjectWriteRunner(options()).write({ ...command(), key: "other" }),
  ).rejects.toThrow("project_write_busy");
});
