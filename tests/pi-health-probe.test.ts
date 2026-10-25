import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { probePiRuntime } from "../src/main/pi-runtime";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-health-probe-"));
const portable = path.join(directory, "portable");
const entry =
  process.platform === "win32"
    ? path.join(
        portable,
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
      )
    : path.join(directory, "cli.cjs");
fs.mkdirSync(path.dirname(entry), { recursive: true });
if (process.platform === "win32")
  fs.copyFileSync(process.execPath, path.join(portable, "node.exe"));
const wrapper =
  process.platform === "win32" ? path.join(portable, "pi.cmd") : entry;
if (process.platform === "win32") fs.writeFileSync(wrapper, "fixture-only");
const report = path.join(directory, "env.json"),
  marker = path.join(directory, "preload-marker");
const preload = path.join(directory, "preload.cjs");
fs.writeFileSync(
  preload,
  "require('fs').writeFileSync(" + JSON.stringify(marker) + ",'ran')",
);
function cli(version: string, prefix = ""): void {
  fs.writeFileSync(
    entry,
    (process.platform === "win32"
      ? ""
      : "#!" + process.execPath + String.fromCharCode(10)) +
      prefix +
      "require('fs').writeFileSync(" +
      JSON.stringify(report) +
      ",JSON.stringify({cwd:process.cwd(),home:process.env.HOME,agent:process.env.PI_CODING_AGENT_DIR,secret:process.env.PI_TEST_PROBE_SECRET,args:process.argv.slice(2)}));process.stdout.write(" +
      JSON.stringify(version) +
      ")",
  );
  if (process.platform !== "win32") fs.chmodSync(entry, 0o755);
}
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(marker, { force: true });
});
afterAll(() => {
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-health-probe-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
it("does not run inherited loaders or send model credentials during version health discovery", async () => {
  cli("1.4.0");
  vi.stubEnv(
    "NODE_OPTIONS",
    "--require=" + JSON.stringify(preload.replaceAll(path.sep, "/")),
  );
  vi.stubEnv("PI_TEST_PROBE_SECRET", "fixture-not-a-real-secret");
  const originalCwd = process.cwd();
  expect(await probePiRuntime({ executablePath: wrapper })).toMatchObject({
    healthy: true,
    message: "1.4.0",
  });
  expect(fs.existsSync(marker)).toBe(false);
  const state = JSON.parse(fs.readFileSync(report, "utf8"));
  expect(state.secret).toBeUndefined();
  expect(state.home).toBe(state.cwd);
  expect(state.agent).toBe(path.join(state.cwd, "agent"));
  expect(state.args).toContain("--no-extensions");
  expect(state.args).toContain("--no-mcp");
  expect(fs.existsSync(state.cwd)).toBe(false);
  expect(process.cwd()).toBe(originalCwd);
  expect(process.env.PI_TEST_PROBE_SECRET).toBe("fixture-not-a-real-secret");
});
it.each(["1.4.1", "2.0.0", "1.4.0-beta.1"])(
  "keeps nonexecuting health discovery for native version %s",
  async (version) => {
    cli(version);
    expect(await probePiRuntime({ executablePath: wrapper })).toMatchObject({
      healthy: true,
      message: version,
    });
  },
);
it.each(["1.4.0\nsecret-fixture", "", "1.4.0 " + "x".repeat(8192)])(
  "refuses ambiguous metadata without echoing it",
  async (version) => {
    cli(version);
    const result = await probePiRuntime({ executablePath: wrapper });
    expect(result.healthy).toBe(false);
    expect(result.message).not.toContain("secret-fixture");
    expect(result.message).not.toContain("x".repeat(100));
  },
);
it("does not echo native stderr when version discovery fails", async () => {
  cli("1.4.0", "process.stderr.write('secret-fixture');");
  const result = await probePiRuntime({ executablePath: wrapper });
  expect(result.healthy).toBe(false);
  expect(result.message).not.toContain("secret-fixture");
});

it("bounds a hung health probe without echoing its native diagnostics", async () => {
  cli(
    "1.4.0",
    "process.stderr.write('secret-fixture');setInterval(()=>{},1000);",
  );
  const result = await probePiRuntime({ executablePath: wrapper });
  expect(result.healthy).toBe(false);
  expect(result.message).not.toContain("secret-fixture");
}, 15000);
