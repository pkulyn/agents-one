import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ env: {} as NodeJS.ProcessEnv }));
vi.mock("../src/main/pi-capabilities", () => ({
  verifyPiStrictCapabilities: async (invocation: {
    command: string;
    prefix: string[];
  }) => ({ invocation, assertUnchanged: (): void => {} }),
}));
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>();
  return {
    ...original,
    spawn: (
      _command: string,
      _args: string[],
      options: { env: NodeJS.ProcessEnv },
    ) => {
      fixture.env = options.env;
      return original.spawn(
        process.execPath,
        [
          "-e",
          "process.stdout.write(JSON.stringify({type:'agent_end',messages:[{role:'assistant',content:[{type:'text',text:'done'}],stopReason:'stop'}]}))",
        ],
        options,
      );
    },
  };
});
import { piChildEnvironment, startPiProcess } from "../src/main/pi-runtime";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-task-env-"));
const preload = path.join(directory, "preload.cjs");
const marker = path.join(directory, "preload-ran");
fs.writeFileSync(
  preload,
  "require('fs').writeFileSync(" + JSON.stringify(marker) + ", 'ran')",
);
beforeEach(() => {
  fs.rmSync(marker, { force: true });
  vi.stubEnv(
    "NODE_OPTIONS",
    "--require=" + JSON.stringify(preload.replaceAll("\\", "/")),
  );
  vi.stubEnv("PI_PACKAGE_DIR", "fixture-package-redirect");
  vi.stubEnv("PI_TEST_PROVIDER_KEY", "synthetic-provider-key");
  vi.stubEnv("HTTPS_PROXY", "http://127.0.0.1:18443");
});
afterAll(() => {
  vi.unstubAllEnvs();
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-task-env-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
// @lat: [[runtime-chat#Pi restricted task environment]]
it.each(["analysis", "safe_write"] as const)(
  "does not execute an inherited preload for actual %s task child",
  async (mode) => {
    const started = await startPiProcess(
      { executablePath: process.execPath },
      { prompt: "fixture", mode, workspace: directory },
      () => {},
    );
    const result = await started.completion;
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(marker)).toBe(false);
    expect(fixture.env.NODE_OPTIONS).toBeUndefined();
    expect(fixture.env.PI_PACKAGE_DIR).toBeUndefined();
    expect(fixture.env.PI_TEST_PROVIDER_KEY).toBe("synthetic-provider-key");
    expect(fixture.env.HTTPS_PROXY).toBe("http://127.0.0.1:18443");
    expect(process.env.NODE_OPTIONS).toContain("--require=");
  },
);
it("retains an explicitly full-access task's native preload and custom environment", async () => {
  const started = await startPiProcess(
    { executablePath: process.execPath },
    { prompt: "fixture", mode: "full_access", workspace: directory },
    () => {},
  );
  expect((await started.completion).error).toBeUndefined();
  expect(fs.readFileSync(marker, "utf8")).toBe("ran");
  expect(fixture.env.NODE_OPTIONS).toBe(process.env.NODE_OPTIONS);
  expect(fixture.env.PI_PACKAGE_DIR).toBe("fixture-package-redirect");
});
it("removes reserved execution controls irrespective of key casing while retaining connection data", () => {
  const source = {
    Node_Options: "--require=fixture",
    NODE_PATH: "fixture",
    LD_PRELOAD: "fixture",
    DYLD_INSERT_LIBRARIES: "fixture",
    OPENSSL_CONF: "fixture",
    NODE_V8_COVERAGE: "fixture",
    NODE_COMPILE_CACHE: "fixture",
    NODE_REDIRECT_WARNINGS: "fixture",
    BUN_OPTIONS: "fixture",
    BASH_ENV: "fixture",
    PYTHONPATH: "fixture",
    Pi_Package_Dir: "fixture",
    OPENAI_API_KEY: "synthetic",
    CUSTOM_PROVIDER_TOKEN: "synthetic",
    NODE_EXTRA_CA_CERTS: "cert.pem",
    SSL_CERT_FILE: "cert.pem",
    PATH: "portable-tools",
    PI_CODING_AGENT_DIR: "native-agent",
    HTTPS_PROXY: "proxy",
  };
  const before = { ...source };
  expect(piChildEnvironment(source, "safe_write")).toEqual({
    OPENAI_API_KEY: "synthetic",
    CUSTOM_PROVIDER_TOKEN: "synthetic",
    NODE_EXTRA_CA_CERTS: "cert.pem",
    SSL_CERT_FILE: "cert.pem",
    PATH: "portable-tools",
    PI_CODING_AGENT_DIR: "native-agent",
    HTTPS_PROXY: "proxy",
  });
  expect(source).toEqual(before);
  expect(piChildEnvironment(source, "full_access")).toEqual(source);
  expect(piChildEnvironment(source, "implementation")).toEqual(source);
});
