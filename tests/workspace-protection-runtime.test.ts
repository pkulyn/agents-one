vi.mock("../src/main/claude-capabilities", () => ({
  verifyClaudeStrictCapabilities: async (invocation: {
    command: string;
    prefix: string[];
  }) => ({ invocation, assertUnchanged: () => {} }),
}));
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("child_process")>()),
  spawn: spawnMock,
}));
vi.mock("electron", () => ({ app: { getPath: () => "" } }));
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  spawnMock.mockReset();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("Runtime workspace recovery completion", () => {
  it.each(["close", "error"] as const)(
    "settles %s with a recovery error and retains the original backup",
    async (event) => {
      const home = mkdtempSync(join(tmpdir(), "agents-one-runtime-recovery-"));
      roots.push(home);
      const workspace = join(home, "workspace");
      mkdirSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(
        join(workspace, "docs", "original.txt"),
        "synthetic original",
      );
      vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", home);
      vi.stubEnv("HERMES_HOME", home);
      vi.resetModules();
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        pid: undefined,
      });
      spawnMock.mockReturnValue(child);
      const { startClaudeCodeProcess } =
        await import("../src/main/claude-code-runtime");
      const process = await startClaudeCodeProcess(
        { executablePath: "claude" },
        { prompt: "synthetic task", mode: "safe_write", workspace },
        () => {},
      );
      rmSync(join(workspace, "docs"), { recursive: true });
      writeFileSync(join(workspace, "docs"), "blocking file");
      if (event === "close") child.emit("close", 0);
      else child.emit("error", new Error("synthetic spawn failure"));
      const result = await process.completion;
      expect(result.error).toContain("恢复未完成");
      const retainedPath = result.error!.match(/备份保留于：(.+?)。/)?.[1];
      expect(retainedPath).toBeTruthy();
      expect(
        readFileSync(join(retainedPath!, "docs", "original.txt"), "utf8"),
      ).toBe("synthetic original");
      expect(readdirSync(retainedPath!)).toContain("docs");
    },
  );
});
