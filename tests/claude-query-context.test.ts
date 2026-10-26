import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, delimiter, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const hook = vi.hoisted(() => ({
  pending: false,
  release: undefined as undefined | ((value: string) => void),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (path: string) => {
      if (hook.pending)
        return await new Promise<string>((resolve) => {
          hook.release = resolve;
        });
      return actual.realpath(path);
    },
  };
});
import { prepareClaudeQueryEnvironment } from "../src/main/claude-query-context";
const roots: string[] = [];
let home: string, project: string, safe: string;
beforeEach(() => {
  hook.pending = false;
  hook.release = undefined;
  home = mkdtempSync(join(tmpdir(), "claude-query-path-"));
  roots.push(home);
  project = join(home, "project");
  safe = join(home, "safe-bin");
  mkdirSync(project);
  mkdirSync(safe);
});
afterEach(() => {
  vi.useRealTimers();
  for (const dir of roots.splice(0)) {
    if (
      !resolve(dir).startsWith(resolve(tmpdir()) + sep) ||
      !basename(dir).startsWith("claude-query-path-")
    )
      throw Error("Unsafe cleanup");
    rmSync(dir, { recursive: true, force: true });
  }
});
// @lat: [[runtime-chat#Claude canonical helper lookup]]
it("canonicalizes outside lookup directories and excludes project aliases/relative/empty entries", async () => {
  const bin = join(project, "bin"),
    alias = join(home, "alias");
  mkdirSync(bin);
  symlinkSync(bin, alias, process.platform === "win32" ? "junction" : "dir");
  const source = {
    Path: [bin, alias, ".", "bin", "", safe, safe, join(home, "missing")].join(
      delimiter,
    ),
    ANTHROPIC_API_KEY: "owned-key",
    HTTPS_PROXY: "owned-proxy",
  };
  const before = { ...source };
  const result = await prepareClaudeQueryEnvironment(source, project);
  expect(result).toEqual({
    PATH: realpathSync(safe),
    ANTHROPIC_API_KEY: "owned-key",
    HTTPS_PROXY: "owned-proxy",
  });
  expect(source).toEqual(before);
});
it("handles a symlinked project root using its real directory", async () => {
  const alias = join(home, "project-link"),
    bin = join(project, "bin");
  mkdirSync(bin);
  symlinkSync(
    project,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  expect(
    (
      await prepareClaudeQueryEnvironment(
        { PATH: [bin, safe].join(delimiter) },
        alias,
      )
    ).PATH,
  ).toBe(realpathSync(safe));
});
it("rejects ambiguous PATH aliases with a fixed diagnostic", async () => {
  await expect(
    prepareClaudeQueryEnvironment({ PATH: safe, Path: project }, project),
  ).rejects.toThrow("本轮任务未发送");
});
it("rejects a lookup with no safe absolute directories", async () => {
  await expect(
    prepareClaudeQueryEnvironment(
      { PATH: [project, ".", ""].join(delimiter) },
      project,
    ),
  ).rejects.toThrow("本轮任务未发送");
});
it("rejects an invalid project without exposing its path", async () => {
  await expect(
    prepareClaudeQueryEnvironment(
      { PATH: safe },
      join(home, "owned-secret-missing"),
    ),
  ).rejects.not.toThrow("owned-secret-missing");
});
it("refuses cancellation before lookup", async () => {
  await expect(
    prepareClaudeQueryEnvironment({ PATH: safe }, project, () => false),
  ).rejects.toThrow("cancelled");
});
it("refuses cancellation during lookup", async () => {
  hook.pending = true;
  let allowed = true;
  const pending = prepareClaudeQueryEnvironment(
    { PATH: safe },
    project,
    () => allowed,
  );
  await vi.waitFor(() => expect(hook.release).toBeTypeOf("function"));
  allowed = false;
  hook.pending = false;
  hook.release!(realpathSync(project));
  await expect(pending).rejects.toThrow("cancelled");
});
it("times out an unresolved lookup and ignores its later completion", async () => {
  vi.useFakeTimers();
  hook.pending = true;
  const pending = prepareClaudeQueryEnvironment({ PATH: safe }, project);
  const denied = expect(pending).rejects.toThrow("本轮任务未发送");
  await vi.advanceTimersByTimeAsync(5000);
  await denied;
  hook.pending = false;
  hook.release!(realpathSync(project));
  await Promise.resolve();
});
