import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, expect, it, vi } from "vitest";
import { verifyPiStrictCapabilities } from "../src/main/pi-capabilities";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-capability-fixture-"));
let sequence = 0;
function script(body: string): { command: string; prefix: string[] } {
  const entry = path.join(directory, "cli-" + sequence++ + ".cjs");
  fs.writeFileSync(entry, body);
  return { command: process.execPath, prefix: [entry] };
}
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-capability-fixture-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
it.each([
  "0.61.0",
  "1.3.9",
  "1.4.1",
  "2.0.0",
  "v1.4.0",
  "1.4.0-beta",
  "1.4.0\nextra",
  "",
  "{version:1.4.0}",
])("refuses unreviewed metadata %j", async (version) => {
  await expect(
    verifyPiStrictCapabilities(
      script("process.stdout.write(" + JSON.stringify(version) + ")"),
    ),
  ).rejects.toThrow("本轮任务未发送");
});
it("uses an isolated environment, native metadata flags and an ephemeral cwd", async () => {
  const report = path.join(directory, "environment.json");
  vi.stubEnv("PI_CAP_TEST_SECRET", "fixture-only");
  vi.stubEnv("PI_PACKAGE_DIR", "untrusted-package-override");
  const invocation = script(
    "require('fs').writeFileSync(" +
      JSON.stringify(report) +
      ",JSON.stringify({cwd:process.cwd(),home:process.env.HOME,agent:process.env.PI_CODING_AGENT_DIR,args:process.argv.slice(2),secret:process.env.PI_CAP_TEST_SECRET,package:process.env.PI_PACKAGE_DIR}));process.stdout.write('1.4.0\\n')",
  );
  const verified = await verifyPiStrictCapabilities(invocation);
  expect(verified.invocation).toEqual(invocation);
  expect(() => verified.assertUnchanged()).not.toThrow();
  const state = JSON.parse(fs.readFileSync(report, "utf8"));
  expect(state.secret).toBeUndefined();
  expect(state.package).toBeUndefined();
  expect(state.agent).toBe(path.join(state.cwd, "agent"));
  expect(state.home).toBe(state.cwd);
  expect(state.args).toEqual([
    "--version",
    "--offline",
    "--no-extensions",
    "--no-mcp",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
  ]);
  expect(fs.existsSync(state.cwd)).toBe(false);
});
it.each([
  "process.stderr.write('secret-fixture');process.stdout.write('1.4.0')",
  "process.stderr.write('secret-fixture');process.exit(1)",
  "process.stdout.write('x'.repeat(8192))",
])(
  "refuses failed or ambiguous probes without native diagnostics",
  async (body) => {
    await expect(verifyPiStrictCapabilities(script(body))).rejects.toThrow(
      "无法确认 Pi",
    );
    try {
      await verifyPiStrictCapabilities(script(body));
    } catch (error) {
      expect(String(error)).not.toContain("secret-fixture");
    }
  },
);
it("detects entry modification during the metadata request", async () => {
  const invocation = script(
    "require('fs').appendFileSync(__filename,'\\n// changed');process.stdout.write('1.4.0')",
  );
  await expect(verifyPiStrictCapabilities(invocation)).rejects.toThrow(
    "无法确认 Pi",
  );
});
it("detects entry replacement after the metadata request", async () => {
  const invocation = script("process.stdout.write('1.4.0')");
  const verified = await verifyPiStrictCapabilities(invocation);
  fs.writeFileSync(invocation.prefix[0], "process.stdout.write('1.3.9')");
  expect(() => verified.assertUnchanged()).toThrow("无法确认 Pi");
});
it("does not reuse capability approval after a binary or entry changes", async () => {
  const invocation = script("process.stdout.write('1.4.0')");
  await verifyPiStrictCapabilities(invocation);
  fs.writeFileSync(invocation.prefix[0], "process.stdout.write('1.3.9')");
  await expect(verifyPiStrictCapabilities(invocation)).rejects.toThrow(
    "无法确认 Pi",
  );
});
it("fails closed for a missing wrapper entry or missing executable", async () => {
  const invocation = script("process.stdout.write('1.4.0')");
  fs.unlinkSync(invocation.prefix[0]);
  await expect(verifyPiStrictCapabilities(invocation)).rejects.toThrow(
    "无法确认 Pi",
  );
  await expect(
    verifyPiStrictCapabilities({
      command: path.join(directory, "missing.exe"),
      prefix: [],
    }),
  ).rejects.toThrow("无法确认 Pi");
});
it("binds a PATH-resolved Node command and entry rather than forwarding a bare command", async () => {
  const invocation = script("process.stdout.write('1.4.0')");
  vi.stubEnv("PATH", path.dirname(process.execPath));
  const verified = await verifyPiStrictCapabilities({
    command: path.basename(process.execPath),
    prefix: invocation.prefix,
  });
  expect(verified.invocation.command).toBe(fs.realpathSync(process.execPath));
  expect(verified.invocation.prefix).toEqual(invocation.prefix);
});

it("bounds a hung metadata request without passing through its diagnostics", async () => {
  const invocation = script(
    "process.stderr.write('secret-fixture');setInterval(()=>{},1000)",
  );
  await expect(verifyPiStrictCapabilities(invocation)).rejects.toThrow(
    "本轮任务未发送",
  );
}, 15_000);
