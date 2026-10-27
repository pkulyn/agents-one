import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeCodexReadOnlyFilesystem } from "../src/main/mobile-control/codex-sandbox-probe";
const mock = vi.hoisted(() => ({ spawn: vi.fn(), terminate: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mock.spawn }));
vi.mock("../src/main/codex-runtime", () => ({
  codexInvocation: () => ({ command: process.execPath, prefix: [] }),
}));
vi.mock("../src/main/process-control", () => ({
  terminateProcessTree: mock.terminate,
}));
let root: string;
type Child = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
function child(): Child {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
}
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
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agents-one-native-sandbox-probe-"));
  mock.spawn.mockReset();
  mock.terminate.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});
describe("Codex filesystem evidence", () => {
  it("requires actual denial evidence and never grants complete execution authority", async () => {
    mock.spawn.mockImplementation((_command, args: string[]) => {
      expect(args.slice(0, 3)).toEqual([
        "sandbox",
        "--permission-profile",
        ":read-only",
      ]);
      const proc = child();
      queueMicrotask(() => {
        proc.stdout.write(
          '{"read":true,"insideDenied":true,"outsideDenied":true}',
        );
        proc.emit("close", 0);
      });
      return proc;
    });
    expect(await probeCodexReadOnlyFilesystem(input())).toMatchObject({
      readonlyFilesystemVerified: true,
      completeExecutionPolicyVerified: false,
      invocationFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(readdirSync(root)).toEqual([]);
  });
  it("rejects a denial response when a target actually exists", async () => {
    mock.spawn.mockImplementation(
      (_command, _args, options: { cwd: string }) => {
        const proc = child();
        writeFileSync(join(options.cwd, "write.txt"), "fixture");
        queueMicrotask(() => {
          proc.stdout.write(
            '{"read":true,"insideDenied":true,"outsideDenied":true}',
          );
          proc.emit("close", 0);
        });
        return proc;
      },
    );
    expect(await probeCodexReadOnlyFilesystem(input())).toMatchObject({
      error: "write_allowed",
      readonlyFilesystemVerified: false,
    });
    expect(readdirSync(root)).toEqual([]);
  });
  it("rejects invalid, oversized, extended and failed results without exposing stderr", async () => {
    for (const [output, code] of [
      ["invalid", 0],
      ["x".repeat(17000), 0],
      [
        '{"read":true,"insideDenied":true,"outsideDenied":true,"extra":true}',
        0,
      ],
      ['{"read":true,"insideDenied":true,"outsideDenied":true}', 1],
    ] as const) {
      mock.spawn.mockImplementation(() => {
        const proc = child();
        queueMicrotask(() => {
          proc.stdout.write(output);
          proc.stderr.write("private-token");
          proc.emit("close", code);
        });
        return proc;
      });
      const result = await probeCodexReadOnlyFilesystem(input());
      expect(result.readonlyFilesystemVerified).toBe(false);
      expect(JSON.stringify(result)).not.toContain("private-token");
      expect(readdirSync(root)).toEqual([]);
    }
  });
  it("awaits close after timed termination and reports launch failure", async () => {
    vi.useFakeTimers();
    const proc = child();
    mock.spawn.mockReturnValue(proc);
    let close: (() => void) | undefined;
    mock.terminate.mockImplementation(async () => {
      close = () => proc.emit("close", null);
    });
    const pending = probeCodexReadOnlyFilesystem({ ...input(), timeoutMs: 20 });
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(mock.terminate).toHaveBeenCalledTimes(1);
    expect(done).toBe(false);
    close!();
    expect(await pending).toMatchObject({ error: "timed_out" });
    vi.useRealTimers();
    mock.spawn.mockImplementation(() => {
      const failed = child();
      queueMicrotask(() => failed.emit("error", Error("private detail")));
      return failed;
    });
    expect(await probeCodexReadOnlyFilesystem(input())).toMatchObject({
      error: "launch_failed",
    });
  });
});
