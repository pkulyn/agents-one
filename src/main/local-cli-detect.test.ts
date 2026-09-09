import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { detectLocalCliPaths, findExecutableOnPath } from "./local-cli-detect";

let testHome: string;

beforeEach(() => {
  testHome = mkdtempSync(join(tmpdir(), "local-cli-detect-"));
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("findExecutableOnPath", () => {
  it("finds a bare command on PATH for POSIX", async () => {
    const { delimiter } = await import("path");
    writeFileSync(join(testHome, "codex"), "", { mode: 0o755 });
    vi.stubEnv("PATH", testHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(findExecutableOnPath("codex")).toBe(join(testHome, "codex"));
    expect(delimiter).toBeDefined();
  });

  it("finds a .cmd shim on Windows PATH", async () => {
    writeFileSync(join(testHome, "pi.cmd"), "");
    vi.stubEnv("PATH", testHome);
    vi.stubEnv("Path", testHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");

    expect(findExecutableOnPath("pi")).toBe(join(testHome, "pi.cmd"));
  });

  it("returns null when the command is not on PATH", async () => {
    vi.stubEnv("PATH", testHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(findExecutableOnPath("missing-cli")).toBeNull();
  });
});

describe("detectLocalCliPaths", () => {
  it("detects pi / claude / codex present on PATH", async () => {
    writeFileSync(join(testHome, "pi"), "");
    writeFileSync(join(testHome, "claude"), "");
    writeFileSync(join(testHome, "codex"), "");
    vi.stubEnv("PATH", testHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(detectLocalCliPaths()).toEqual({
      pi: join(testHome, "pi"),
      "claude-code": join(testHome, "claude"),
      codex: join(testHome, "codex"),
      opencode: null,
    });
  });

  it("reports null for commands missing from PATH", async () => {
    writeFileSync(join(testHome, "pi"), "");
    vi.stubEnv("PATH", testHome);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const detected = detectLocalCliPaths();
    expect(detected.pi).toBe(join(testHome, "pi"));
    expect(detected.codex).toBeNull();
    expect(detected["claude-code"]).toBeNull();
    expect(detected.opencode).toBeNull();
  });
});
