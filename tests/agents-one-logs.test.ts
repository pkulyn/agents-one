import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("electron", () => ({
  app: { getPath: (): string => join(tmpdir(), "unused-agents-one-user-data") },
}));

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "agents-one-logs-"));
  process.env.AGENTS_ONE_LOG_DIR = testDir;
});

afterEach(() => {
  delete process.env.AGENTS_ONE_LOG_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

describe("Agents One diagnostic logs", () => {
  it("writes application, task and error diagnostics under the product directory", async () => {
    const logs = await import("../src/main/agents-one-logs");
    logs.logApplicationDiagnostic("app.ready");
    logs.logTaskDiagnostic("task.started", { runId: "run-1" });
    logs.logErrorDiagnostic("task.failed", "network unavailable");

    expect(existsSync(join(testDir, "application.log"))).toBe(true);
    expect(existsSync(join(testDir, "tasks.log"))).toBe(true);
    expect(existsSync(join(testDir, "errors.log"))).toBe(true);
    expect(readFileSync(join(testDir, "tasks.log"), "utf-8")).toContain(
      "run-1",
    );
  });

  it("redacts secrets and never resolves an arbitrary log path", async () => {
    const logs = await import("../src/main/agents-one-logs");
    logs.logErrorDiagnostic(
      "request.failed",
      "Authorization: Bearer abcdefghijklmnop",
    );

    const errorLog = readFileSync(join(testDir, "errors.log"), "utf-8");
    expect(errorLog).toContain("Authorization: [redacted]");
    expect(errorLog).not.toContain("abcdefghijklmnop");

    const result = logs.readAgentsOneLogs("../../outside.log", 20);
    expect(result.path).toBe(join(testDir, "application.log"));
  });
});
