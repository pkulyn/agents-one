vi.mock("../src/main/pi-config-policy", () => ({
  assertPiNonExecutingConfig: (): void => {},
}));
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  version: "0.61.0",
  startAllowed: true,
  cancelDuringProbe: false,
  args: [] as string[],
  spawns: 0,
  prepared: vi.fn(),
  protected: vi.fn(),
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: fixture.prepared,
}));
vi.mock("../src/main/workspace-protection", () => ({
  protectWorkspaceFromRemoval: fixture.protected,
}));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    execFile: Object.assign(
      (
        _command: string,
        args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        fixture.args = args;
        queueMicrotask(() => callback(null, fixture.version, ""));
      },
      {
        [Symbol.for("nodejs.util.promisify.custom")]: async (
          _command: string,
          args: string[],
        ) => {
          fixture.args = args;
          if (fixture.cancelDuringProbe) fixture.startAllowed = false;
          return { stdout: fixture.version, stderr: "" };
        },
      },
    ),
    spawn: (_command: string, _args: string[], options: object) => {
      fixture.spawns++;
      return original.spawn(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify({type:'agent_end',messages:[]}))",
        ],
        options,
      );
    },
  };
});
import { startPiProcess } from "../src/main/pi-runtime";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-capability-main-"));
beforeEach(() => {
  fixture.args = [];
  fixture.spawns = 0;
  fixture.version = "0.61.0";
  fixture.startAllowed = true;
  fixture.cancelDuringProbe = false;
  fixture.prepared
    .mockReset()
    .mockReturnValue({ files: [], artifacts: [], promptContext: "" });
  fixture.protected
    .mockReset()
    .mockReturnValue({ restoreAndDispose: () => [] });
});
afterAll(() => {
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-capability-main-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
// @lat: [[runtime-chat#Pi strict CLI capability gate]]
it.each(["safe_write", "analysis", undefined] as const)(
  "rejects an unverified CLI before task effects for %s mode",
  async (mode) => {
    await expect(
      startPiProcess(
        { executablePath: process.execPath },
        { prompt: "private-task-must-not-be-sent", mode, workspace: directory },
        () => {},
      ),
    ).rejects.toThrow("本轮任务未发送");
    expect(fixture.spawns).toBe(0);
    expect(fixture.prepared).not.toHaveBeenCalled();
    expect(fixture.protected).not.toHaveBeenCalled();
    expect(fixture.args).toContain("--version");
    expect(fixture.args.join(" ")).not.toContain("private-task");
    expect(fs.readdirSync(directory)).toEqual([]);
  },
);
it.each(["safe_write", "analysis"] as const)(
  "keeps verified %s task dispatch and attachment preparation",
  async (mode) => {
    fixture.version = "1.4.0";
    const task = await startPiProcess(
      { executablePath: process.execPath },
      { prompt: "fixture", mode, workspace: directory },
      () => {},
    );
    await task.completion;
    expect(fixture.spawns).toBe(1);
    expect(fixture.prepared).toHaveBeenCalledOnce();
  },
);
it("keeps unreviewed full access available after non-executing version discovery", async () => {
  const task = await startPiProcess(
    { executablePath: process.execPath },
    { prompt: "fixture", mode: "full_access", workspace: directory },
    () => {},
  );
  await task.completion;
  expect(fixture.args).toContain("--version");
  expect(fixture.args.join(" ")).not.toContain("fixture");
  expect(fixture.spawns).toBe(1);
});

it.each(["before", "during"])(
  "does not dispatch a task cancelled %s capability verification",
  async (when) => {
    fixture.version = "1.4.0";
    fixture.startAllowed = when !== "before";
    fixture.cancelDuringProbe = when === "during";
    await expect(
      startPiProcess(
        { executablePath: process.execPath },
        {
          prompt: "cancelled-fixture",
          mode: "safe_write",
          workspace: directory,
        },
        () => {},
        () => fixture.startAllowed,
      ),
    ).rejects.toThrow("cancelled");
    expect(fixture.spawns).toBe(0);
    expect(fixture.prepared).not.toHaveBeenCalled();
    if (when === "before") expect(fixture.args).toEqual([]);
  },
);
