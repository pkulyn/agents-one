import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  home: "",
  allowed: true,
  cancelDuringCheck: false,
  supported: false,
  changed: false,
  spawns: vi.fn(),
  prepared: vi.fn(),
  protected: vi.fn(),
  checked: vi.fn(),
  asserted: vi.fn(),
}));
vi.mock("../src/main/utils", () => ({
  agentsOneProfileHome: () => join(fixture.home, "profile"),
}));
vi.mock("../src/main/runtime-inputs", () => ({
  prepareRuntimeInputs: fixture.prepared,
}));
vi.mock("../src/main/workspace-protection", () => ({
  protectWorkspaceFromRemoval: fixture.protected,
}));
vi.mock("../src/main/claude-capabilities", () => ({
  verifyClaudeStrictCapabilities: fixture.checked,
}));
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: fixture.spawns,
}));
import {
  claudeCodeExecArgs,
  startClaudeCodeProcess,
} from "../src/main/claude-code-runtime";
const roots: string[] = [];
let workspace: string;
beforeEach(() => {
  fixture.home = mkdtempSync(join(tmpdir(), "claude-capability-start-"));
  roots.push(fixture.home);
  workspace = join(fixture.home, "project");
  mkdirSync(workspace);
  vi.stubEnv("HOME", fixture.home);
  vi.stubEnv("USERPROFILE", fixture.home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  fixture.allowed = true;
  fixture.cancelDuringCheck = false;
  fixture.supported = false;
  fixture.changed = false;
  fixture.prepared
    .mockReset()
    .mockReturnValue({ files: [], artifacts: [], promptContext: "" });
  fixture.protected
    .mockReset()
    .mockReturnValue({ restoreAndDispose: () => [] });
  fixture.asserted.mockReset().mockImplementation(() => {
    if (fixture.changed) throw Error("executor changed");
  });
  fixture.checked.mockReset().mockImplementation(async (requested) => {
    if (fixture.cancelDuringCheck) fixture.allowed = false;
    if (!fixture.supported)
      throw Error("strict capabilities unavailable; 本轮任务未发送");
    return { invocation: requested, assertUnchanged: fixture.asserted };
  });
  fixture.spawns.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined,
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of roots.splice(0)) {
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("claude-capability-start-")
    )
      throw Error("Unsafe cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
// @lat: [[runtime-chat#Claude strict native task dispatch]]
it.each(["analysis", "safe_write", undefined] as const)(
  "rejects unknown %s executor before task content/effects",
  async (mode) => {
    await expect(
      startClaudeCodeProcess(
        { executablePath: "owned-cli" },
        { prompt: "private task", mode, workspace },
        () => {},
      ),
    ).rejects.toThrow("本轮任务未发送");
    expect(fixture.prepared).not.toHaveBeenCalled();
    expect(fixture.protected).not.toHaveBeenCalled();
    expect(fixture.spawns).not.toHaveBeenCalled();
    expect(readdirSync(workspace)).toEqual([]);
    expect(JSON.stringify(fixture.checked.mock.calls)).not.toContain(
      "private task",
    );
  },
);
it.each(["before", "during"])(
  "honors cancellation %s async executor check",
  async (when) => {
    fixture.supported = true;
    fixture.allowed = when !== "before";
    fixture.cancelDuringCheck = when === "during";
    await expect(
      startClaudeCodeProcess(
        { executablePath: "owned-cli" },
        { prompt: "private task", mode: "safe_write", workspace },
        () => {},
        () => fixture.allowed,
      ),
    ).rejects.toThrow("cancelled");
    expect(fixture.prepared).not.toHaveBeenCalled();
    expect(fixture.spawns).not.toHaveBeenCalled();
    if (when === "before") expect(fixture.checked).not.toHaveBeenCalled();
  },
);
it("rejects an executor changed before preparation", async () => {
  fixture.supported = true;
  fixture.changed = true;
  await expect(
    startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "private task", mode: "safe_write", workspace },
      () => {},
    ),
  ).rejects.toThrow("executor changed");
  expect(fixture.prepared).not.toHaveBeenCalled();
  expect(fixture.spawns).not.toHaveBeenCalled();
});
it.each(["analysis", "safe_write"] as const)(
  "keeps verified %s dispatch and exact native restrictions",
  async (mode) => {
    fixture.supported = true;
    const task = await startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "--private prompt", mode, workspace },
      () => {},
    );
    expect((await task.completion).error).toBeUndefined();
    const args = fixture.spawns.mock.calls[0][1] as string[];
    expect(args).not.toContain("--dangerously-skip-permissions");
    for (const flag of [
      "--restricted",
      "--safe-mode",
      "--strict-mcp-config",
      "--permission-prompts",
    ])
      expect(args).toContain(flag);
    expect(args[args.indexOf("--tools") + 1]).toBe(
      mode === "analysis" ? "Read,Glob,Grep" : "Read,Write,Edit,Glob,Grep",
    );
    expect(args.slice(-2)).toEqual(["--", "--private prompt"]);
  },
);
it("keeps full access native dispatch for unreviewed executors", async () => {
  const task = await startClaudeCodeProcess(
    { executablePath: "owned-cli" },
    { prompt: "fixture", mode: "full_access", workspace },
    () => {},
  );
  await task.completion;
  expect(fixture.checked).not.toHaveBeenCalled();
  expect(fixture.spawns.mock.calls[0][1]).toContain(
    "--dangerously-skip-permissions",
  );
});
it("terminates native options before a strict prompt even without attachments", () => {
  expect(claudeCodeExecArgs("safe_write", "--owned fixture").slice(-2)).toEqual(
    ["--", "--owned fixture"],
  );
});
