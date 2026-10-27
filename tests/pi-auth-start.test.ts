import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ spawns: 0, prepared: vi.fn() }));
vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: async (invocation: {
    command: string;
    prefix: string[];
  }) => ({ invocation, assertUnchanged: (): void => {} }),
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: fixture.prepared,
}));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
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
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-auth-start-"));
const native = path.join(directory, "native");
const workspace = path.join(directory, "project");
fs.mkdirSync(native);
fs.mkdirSync(workspace);
beforeEach(() => {
  fixture.spawns = 0;
  fixture.prepared
    .mockReset()
    .mockReturnValue({ files: [], artifacts: [], promptContext: "" });
  vi.stubEnv("PI_CODING_AGENT_DIR", native);
  fs.writeFileSync(
    path.join(native, "models.json"),
    JSON.stringify({
      providers: { fixture: { apiKey: "!synthetic-command-must-not-run" } },
    }),
  );
  fs.writeFileSync(path.join(native, "auth.json"), "{}");
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-auth-start-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
// @lat: [[runtime-chat#Pi non-executing native credentials]]
it.each(["safe_write", "analysis"] as const)(
  "refuses native command config before %s task preparation or prompt dispatch",
  async (mode) => {
    const before = fs.readFileSync(path.join(native, "models.json"), "utf8");
    await expect(
      startPiProcess(
        { executablePath: process.execPath },
        { prompt: "private-fixture", mode, workspace },
        () => {},
      ),
    ).rejects.toThrow("本轮任务未发送");
    expect(fixture.spawns).toBe(0);
    expect(fixture.prepared).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(native, "models.json"), "utf8")).toBe(
      before,
    );
  },
);
it("refuses stored command credentials even with a literal models config", async () => {
  fs.writeFileSync(
    path.join(native, "models.json"),
    JSON.stringify({ providers: { fixture: { apiKey: "literal-fixture" } } }),
  );
  fs.writeFileSync(
    path.join(native, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "!synthetic-auth-command" },
    }),
  );
  await expect(
    startPiProcess(
      { executablePath: process.execPath },
      { prompt: "fixture", mode: "safe_write", workspace },
      () => {},
    ),
  ).rejects.toThrow("本轮任务未发送");
  expect(fixture.spawns).toBe(0);
  expect(fixture.prepared).not.toHaveBeenCalled();
});
it("retains the explicit full-access native credential contract", async () => {
  const started = await startPiProcess(
    { executablePath: process.execPath },
    { prompt: "fixture", mode: "full_access", workspace },
    () => {},
  );
  await started.completion;
  expect(fixture.spawns).toBe(1);
});

it("rechecks native configuration changed during input preparation before spawning", async () => {
  fs.writeFileSync(
    path.join(native, "models.json"),
    JSON.stringify({ providers: { fixture: { apiKey: "literal" } } }),
  );
  fixture.prepared.mockImplementationOnce(() => {
    fs.writeFileSync(
      path.join(native, "auth.json"),
      JSON.stringify({
        fixture: { type: "api_key", key: "!changed-during-preparation" },
      }),
    );
    return { files: [], artifacts: [], promptContext: "" };
  });
  await expect(
    startPiProcess(
      { executablePath: process.execPath },
      { prompt: "fixture", mode: "analysis", workspace },
      () => {},
    ),
  ).rejects.toThrow("本轮任务未发送");
  expect(fixture.spawns).toBe(0);
});
