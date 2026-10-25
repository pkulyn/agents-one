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
import { dirname, join, resolve, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  home: "",
  spawns: vi.fn(),
  prepared: vi.fn(),
  protected: vi.fn(),
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
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("child_process")>()),
  spawn: fixture.spawns,
}));
import { startClaudeCodeProcess } from "../src/main/claude-code-runtime";
const roots: string[] = [];
let home: string, workspace: string;
function put(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
}
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "claude-user-config-"));
  roots.push(home);
  fixture.home = home;
  workspace = join(home, "project");
  mkdirSync(workspace);
  for (const key of ["HOME", "USERPROFILE"]) vi.stubEnv(key, home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  fixture.spawns.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined,
    });
    queueMicrotask(() => child.emit("close", 0));
    return child;
  });
  fixture.prepared
    .mockReset()
    .mockReturnValue({ files: [], artifacts: [], promptContext: "" });
  fixture.protected
    .mockReset()
    .mockReturnValue({ restoreAndDispose: () => [] });
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of roots.splice(0)) {
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("claude-user-config-")
    )
      throw Error("Unsafe fixture cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
const secretCommand = "node private-helper-secret-marker";
async function denied(
  mode?: "analysis" | "safe_write",
  project: string | undefined = workspace,
): Promise<void> {
  await expect(
    startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "private task", mode, workspace: project },
      () => {},
    ),
  ).rejects.toThrow("本轮任务未发送");
  expect(fixture.spawns).not.toHaveBeenCalled();
  expect(fixture.prepared).not.toHaveBeenCalled();
  expect(fixture.protected).not.toHaveBeenCalled();
}
// @lat: [[runtime-chat#Claude non-executing user configuration]]
it.each(["analysis", "safe_write", undefined] as const)(
  "rejects user apiKeyHelper before task effects in %s",
  async (mode) => {
    const file = join(home, ".claude", "settings.json");
    put(file, { apiKeyHelper: secretCommand });
    const before = readFileSync(file);
    await denied(mode);
    expect(readFileSync(file)).toEqual(before);
    expect(readdirSync(workspace)).toEqual([]);
  },
);
it.each([
  "apiKeyHelper",
  "awsAuthRefresh",
  "awsCredentialExport",
  "gcpAuthRefresh",
  "otelHeadersHelper",
  "proxyAuthHelper",
  "policyHelper",
  "policyHelpers",
])("rejects command configuration %s", async (key) => {
  put(join(workspace, ".claude", "settings.local.json"), {
    [key]: key === "policyHelper" ? { path: secretCommand } : secretCommand,
  });
  await denied();
});
it("rejects ancestor project helpers without invoking git", async () => {
  put(join(home, ".claude", "settings.local.json"), {
    apiKeyHelper: secretCommand,
  });
  await denied();
});
it("conceals a legacy global helper and native diagnostics", async () => {
  put(join(home, ".claude.json"), { apiKeyHelper: secretCommand });
  await denied();
  await expect(
    startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "private", mode: "analysis", workspace },
      () => {},
    ),
  ).rejects.not.toThrow(secretCommand);
});
it("uses an absolute custom config root for settings and legacy data", async () => {
  const config = join(home, "custom");
  vi.stubEnv("CLAUDE_CONFIG_DIR", config);
  put(join(config, ".claude.json"), {
    projects: { owned: { apiKeyHelper: secretCommand } },
  });
  await denied();
});
it("rejects relative config roots instead of guessing cwd", async () => {
  vi.stubEnv("CLAUDE_CONFIG_DIR", "relative-config");
  await denied();
});
it.each(["invalid-json", "not-object", "directory", "oversize"])(
  "refuses unverifiable %s config",
  async (kind) => {
    const file = join(home, ".claude", "settings.json");
    if (kind === "directory") mkdirSync(file, { recursive: true });
    else
      put(
        file,
        kind === "invalid-json"
          ? "{owned-secret"
          : kind === "not-object"
            ? "[]"
            : " ".repeat(8 * 1024 * 1024 + 1),
      );
    await denied();
  },
);
it("rejects before creating a no-project conversation directory", async () => {
  put(join(home, ".claude", "settings.json"), { apiKeyHelper: secretCommand });
  await expect(
    startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "private", mode: "analysis" },
      () => {},
    ),
  ).rejects.toThrow("本轮任务未发送");
  expect(readdirSync(home)).toEqual([".claude", "project"]);
});
it.each(["analysis", "safe_write"] as const)(
  "preserves %s literal/env/OAuth data",
  async (mode) => {
    const file = join(home, ".claude", "settings.json");
    put(file, {
      env: { ANTHROPIC_API_KEY: "synthetic-literal" },
      apiKeyHelper: "",
      opaque: {
        oauth: {
          accessToken: "synthetic-oauth",
          refreshToken: "synthetic-refresh",
        },
        template: "$OWNED_KEY",
      },
    });
    const before = readFileSync(file);
    const task = await startClaudeCodeProcess(
      { executablePath: "owned-cli" },
      { prompt: "fixture", mode, workspace },
      () => {},
    );
    expect((await task.completion).error).toBeUndefined();
    expect(fixture.spawns).toHaveBeenCalledOnce();
    expect(readFileSync(file)).toEqual(before);
  },
);
it("keeps explicit full access available with helpers", async () => {
  put(join(home, ".claude", "settings.json"), { apiKeyHelper: secretCommand });
  const task = await startClaudeCodeProcess(
    { executablePath: "owned-cli" },
    { prompt: "fixture", mode: "full_access", workspace },
    () => {},
  );
  expect((await task.completion).error).toBeUndefined();
  expect(fixture.spawns).toHaveBeenCalledOnce();
});
