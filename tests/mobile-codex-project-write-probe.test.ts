import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { probeCodexProjectWriteFilesystem } from "../src/main/mobile-control/codex-project-write-probe";

const mock = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
vi.mock("../src/main/codex-runtime", () => ({
  codexInvocation: () => ({ command: process.execPath, prefix: [] }),
}));
vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: mock.terminate,
}));
let root: string;
const good =
  '{"read":true,"insideWritten":true,"outsideDenied":true,"linkedOutsideDenied":true}';
const child = (): EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
} =>
  Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
const input = (): {
  executablePath: string;
  nodeExecutable: string;
  privateDirectory: string;
  timeoutMs: number;
} => ({
  executablePath: process.execPath,
  nodeExecutable: process.execPath,
  privateDirectory: root,
  timeoutMs: 1000,
});
function respond(
  output = good,
  code = 0,
  effect?: (cwd: string) => void,
): void {
  mock.spawn.mockImplementation(
    (_command, args: string[], options: { cwd: string }) => {
      expect(args.slice(0, 3)).toEqual([
        "sandbox",
        "--permission-profile",
        ":workspace",
      ]);
      const proc = child();
      writeFileSync(
        join(options.cwd, "write.txt"),
        "agents-one-inside-written",
      );
      effect?.(options.cwd);
      queueMicrotask(() => {
        proc.stdout.write(output);
        proc.stderr.write("private-diagnostic");
        proc.emit("close", code);
      });
      return proc;
    },
  );
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-write-probe-test-"));
  mock.spawn.mockReset();
  mock.terminate.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith("agents-one-write-probe-test-")
  )
    throw Error("unsafe_test_cleanup");
  rmSync(root, { recursive: true, force: true });
});

// @lat: [[mobile-data#Mobile data#Project write probe actual bytes and policy separation]]
it("requires actual inside bytes and preserved outside data without granting a complete execution policy", async () => {
  respond();
  const result = await probeCodexProjectWriteFilesystem(input());
  expect(result).toMatchObject({
    projectWriteFilesystemVerified: true,
    completeExecutionPolicyVerified: false,
    invocationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(readdirSync(root)).toEqual([]);
});

// @lat: [[mobile-data#Mobile data#Project write probe outside and junction detection]]
it("rejects forged denial flags when either outside data or a junction target was written", async () => {
  for (const path of [
    "../outside/write.txt",
    "linked-outside/linked-write.txt",
  ]) {
    respond(good, 0, (cwd) => writeFileSync(join(cwd, path), "escaped-write"));
    expect(await probeCodexProjectWriteFilesystem(input())).toMatchObject({
      projectWriteFilesystemVerified: false,
      error: "outside_write_allowed",
    });
    expect(readdirSync(root)).toEqual([]);
  }
});

// @lat: [[mobile-data#Mobile data#Project write probe inside capability refusal]]
it("rejects a claimed inside capability without the exact actual bytes", async () => {
  respond(good, 0, (cwd) =>
    writeFileSync(join(cwd, "write.txt"), "wrong-bytes"),
  );
  expect(await probeCodexProjectWriteFilesystem(input())).toMatchObject({
    error: "probe_failed",
    projectWriteFilesystemVerified: false,
  });
});

// @lat: [[mobile-data#Mobile data#Project write probe strict response and diagnostics]]
it("rejects malformed, extended, oversized, false and nonzero results without leaking diagnostics", async () => {
  for (const [output, code] of [
    ["not-json", 0],
    ["x".repeat(17000), 0],
    [good.replace('"read":true', '"read":false'), 0],
    [good.slice(0, -1) + ',"extra":true}', 0],
    ["null", 0],
    [good, 1],
  ] as const) {
    respond(output, code);
    const result = await probeCodexProjectWriteFilesystem(input());
    expect(result.projectWriteFilesystemVerified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-diagnostic");
    expect(readdirSync(root)).toEqual([]);
  }
});

// @lat: [[mobile-data#Mobile data#Project write probe termination and invalid admission]]
it("waits for process close after timeout and refuses invalid timeouts before spawning", async () => {
  vi.useFakeTimers();
  const proc = child();
  mock.spawn.mockReturnValue(proc);
  let close: (() => void) | undefined;
  mock.terminate.mockImplementation(async () => {
    close = () => proc.emit("close", null);
  });
  const pending = probeCodexProjectWriteFilesystem({
    ...input(),
    timeoutMs: 20,
  });
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(20);
  expect(mock.terminate).toHaveBeenCalledOnce();
  expect(settled).toBe(false);
  close!();
  expect(await pending).toMatchObject({ error: "timed_out" });
  vi.useRealTimers();
  mock.spawn.mockClear();
  for (const timeoutMs of [0, -1, 60001, NaN, Infinity, 1.5])
    expect(
      await probeCodexProjectWriteFilesystem({ ...input(), timeoutMs }),
    ).toMatchObject({ error: "probe_failed" });
  expect(mock.spawn).not.toHaveBeenCalled();
});

it("returns launch failure without exposing the exception or deleting preexisting parent files", async () => {
  writeFileSync(join(root, "parent.txt"), "preserve");
  mock.spawn.mockImplementation(() => {
    const proc = child();
    queueMicrotask(() => proc.emit("error", Error("private-diagnostic")));
    return proc;
  });
  expect(await probeCodexProjectWriteFilesystem(input())).toMatchObject({
    error: "launch_failed",
    projectWriteFilesystemVerified: false,
  });
  expect(readFileSync(join(root, "parent.txt"), "utf8")).toBe("preserve");
  expect(readdirSync(root)).toEqual(["parent.txt"]);
});
