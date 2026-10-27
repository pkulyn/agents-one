import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const native = vi.hoisted(() => ({ showErrorBox: vi.fn() }));
vi.mock("electron", () => ({
  app: { getPath: () => "unused" },
  dialog: native,
}));
let directory: string;
let file: string;
beforeEach(() => {
  vi.resetModules();
  native.showErrorBox.mockReset();
  directory = mkdtempSync(join(tmpdir(), "desktop-config-startup-"));
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", directory);
  mkdirSync(join(directory, "data"));
  file = join(directory, "data", "desktop.json");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
describe("desktop configuration startup recovery", () => {
  it("preserves damaged JSON and shows a native recovery path without the secret-bearing parse error", async () => {
    const original = '{"secret":"fixture-secret-startup",broken';
    writeFileSync(file, original);
    const { verifyDesktopConfigurationAtStartup } =
      await import("../src/main/app/desktop-config-startup");
    expect(verifyDesktopConfigurationAtStartup()).toBe(false);
    expect(native.showErrorBox).toHaveBeenCalledOnce();
    const [title, message] = native.showErrorBox.mock.calls[0];
    expect(title).toContain("Configuration recovery");
    expect(message).toContain(file);
    expect(message).toContain("保留原文件");
    expect(message).not.toContain("fixture-secret-startup");
    expect(readFileSync(file, "utf8")).toBe(original);
  });
  it("allows healthy and missing configurations without a recovery prompt", async () => {
    const { verifyDesktopConfigurationAtStartup } =
      await import("../src/main/app/desktop-config-startup");
    expect(verifyDesktopConfigurationAtStartup()).toBe(true);
    writeFileSync(file, '{"futureKey":{"keep":true}}');
    expect(verifyDesktopConfigurationAtStartup()).toBe(true);
    expect(native.showErrorBox).not.toHaveBeenCalled();
  });
  it("still denies startup when the native prompt fails", async () => {
    writeFileSync(file, "broken");
    native.showErrorBox.mockImplementation(() => {
      throw new Error("fixture native failure");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { verifyDesktopConfigurationAtStartup } =
        await import("../src/main/app/desktop-config-startup");
      expect(verifyDesktopConfigurationAtStartup()).toBe(false);
      expect(log).toHaveBeenCalledWith(
        "[CONFIG] Desktop configuration recovery required; startup stopped.",
      );
      expect(readFileSync(file, "utf8")).toBe("broken");
    } finally {
      log.mockRestore();
    }
  });
  it("wires validation after durable recovery and migration but before app readiness, Owner, window and scheduler", () => {
    const source = readFileSync(
      join(process.cwd(), "src/main/app/start.ts"),
      "utf8",
    );
    const guard = source.indexOf("if (!verifyDesktopConfigurationAtStartup())");
    expect(guard).toBeGreaterThan(
      source.indexOf("recoverInterruptedAgentsOneRestore()"),
    );
    expect(guard).toBeGreaterThan(
      source.indexOf("if (migrateLegacyAgentsOneData("),
    );
    expect(
      source.slice(
        guard,
        source.indexOf('logApplicationDiagnostic("app.ready")', guard),
      ),
    ).toMatch(/app\.exit\(1\);\s*return;/);
    for (const later of [
      'logApplicationDiagnostic("app.ready")',
      "stopMobileOwner = startDesktopMobileOwner",
      "    createWindow();",
      "    startTaskScheduleRunner();",
    ]) {
      expect(source.indexOf(later)).toBeGreaterThan(guard);
    }
  });
});
