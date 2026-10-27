import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  version: "1.4.0",
  prepared: vi.fn(),
  inspect: vi.fn(),
  args: [] as string[][],
  unchanged: vi.fn(),
}));
vi.mock("../src/main/pi-capabilities", () => ({
  inspectPiVersion: fixture.inspect,
  verifyPiStrictCapabilities: vi.fn(),
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: fixture.prepared,
}));
vi.mock("child_process", async (original) => {
  const actual = await original<typeof import("child_process")>();
  return {
    ...actual,
    spawn: (
      _command: string,
      args: string[],
      options: import("node:child_process").SpawnOptions,
    ) => {
      fixture.args.push(args);
      return actual.spawn(
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
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-native-tools-start-"));
beforeEach(() => {
  fixture.args.length = 0;
  fixture.version = "1.4.0";
  fixture.unchanged.mockReset();
  fixture.prepared
    .mockReset()
    .mockReturnValue({ files: [], artifacts: [], promptContext: "" });
  fixture.inspect.mockReset().mockImplementation(async (invocation) => ({
    invocation,
    version: fixture.version,
    assertUnchanged: fixture.unchanged,
  }));
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", path.join(directory, "desktop"));
  vi.stubEnv("HERMES_HOME", path.join(directory, "hermes"));
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-native-tools-start-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
it("uses retained registration and a trusted extension for reviewed full startup", async () => {
  const task = await startPiProcess(
    { executablePath: process.execPath },
    { mode: "full_access", prompt: "fixture", workspace: directory },
    () => {},
  );
  await task.completion;
  expect(fixture.args[0]).toContain("--no-builtin-tools");
  expect(fixture.args[0]).not.toContain("--no-tools");
  const extension = fixture.args[0][fixture.args[0].indexOf("--extension") + 1];
  expect(fs.readFileSync(extension, "utf8")).toContain("session_start");
  expect(fixture.unchanged).toHaveBeenCalledOnce();
});
it("retains native startup for an unreviewed full-access version", async () => {
  fixture.version = "2.0.0";
  const task = await startPiProcess(
    { executablePath: process.execPath },
    { mode: "full_access", prompt: "fixture", workspace: directory },
    () => {},
  );
  await task.completion;
  expect(fixture.args[0]).not.toContain("--no-builtin-tools");
});
it("retains explicit full-native execution if safe inspection is unavailable", async () => {
  fixture.inspect.mockRejectedValueOnce(Error("unavailable-fixture"));
  const task = await startPiProcess(
    { executablePath: process.execPath },
    { mode: "full_access", prompt: "fixture", workspace: directory },
    () => {},
  );
  await task.completion;
  expect(fixture.args[0]).not.toContain("--no-builtin-tools");
});
it("does not dispatch a stopped full task after asynchronous inspection", async () => {
  let finish!: (value: unknown) => void;
  let active = true;
  fixture.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = startPiProcess(
    { executablePath: process.execPath },
    { mode: "full_access", prompt: "fixture", workspace: directory },
    () => {},
    () => active,
  );
  active = false;
  finish({
    invocation: { command: process.execPath, prefix: [] },
    version: "1.4.0",
    assertUnchanged: fixture.unchanged,
  });
  await expect(pending).rejects.toThrow("cancelled");
  expect(fixture.args).toHaveLength(0);
  expect(fixture.prepared).not.toHaveBeenCalled();
});

it("rejects an inspected executable identity changed before full dispatch", async () => {
  fixture.unchanged.mockImplementation(() => {
    throw Error("changed-fixture");
  });
  await expect(
    startPiProcess(
      { executablePath: process.execPath },
      { mode: "full_access", prompt: "fixture", workspace: directory },
      () => {},
    ),
  ).rejects.toThrow("changed-fixture");
  expect(fixture.args).toHaveLength(0);
});
