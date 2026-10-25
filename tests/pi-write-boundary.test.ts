import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { piReadOnlyExtensionSource } from "../src/main/pi-runtime";
type Event = { toolName: string; input?: Record<string, unknown> };
type Gate = (event: Event, ctx?: { cwd: string }) => unknown;
let fixture: string, root: string, outside: string;
function gate(
  writableRoot: string | undefined = root,
  fsApi: typeof fs = fs,
  protectedPaths: string[] = [],
): Gate {
  let callback!: Gate;
  const source = Reflect.apply(piReadOnlyExtensionSource, undefined, [
    "safe_write",
    writableRoot,
    protectedPaths,
  ]);
  const install = new Function(
    "fs",
    "path",
    source
      .replace(/^import .*;\r?$/gm, "")
      .replace(
        "export default function agentsOneReadOnly",
        "return function agentsOneReadOnly",
      ),
  )(fsApi, path);
  install({
    on: (_name: string, handler: Gate) => {
      callback = handler;
    },
  });
  return callback;
}
function write(
  target: unknown,
  handler = gate(),
  cwd = root,
  toolName = "write",
): unknown {
  return handler(
    { toolName, input: { path: target, content: "fixture" } },
    { cwd },
  );
}
beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(tmpdir(), "pi-write-boundary-"));
  root = path.join(fixture, "workspace");
  outside = path.join(fixture, "outside.txt");
  fs.mkdirSync(root);
  fs.writeFileSync(outside, "original");
});
afterEach(() => {
  const resolved = path.resolve(fixture);
  if (
    !resolved.startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(resolved).startsWith("pi-write-boundary-")
  )
    throw Error("Unsafe fixture cleanup");
  fs.rmSync(resolved, { recursive: true, force: true });
});
describe("Pi automatic write scope", () => {
  it.each([
    "bad\u0000file",
    "bad\nfile",
    "../outside.txt",
    ".git/config",
    ".GIT/hooks/post-checkout",
    ".agents-one/state.json",
    ".pi/settings.json",
    ".codex/config.toml",
    ".claude/settings.json",
    ".opencode/config.json",
    ".vscode/tasks.json",
    ".idea/workspace.xml",
    "~/outside.txt",
    "@../outside.txt",
    "file:///C:/outside.txt",
    "name with-space.txt",
    ".",
    "",
  ])("blocks unsafe target %s", (target) => {
    expect(write(target)).toMatchObject({
      block: true,
      reason: expect.stringContaining("完全访问"),
    });
  });
  it.each([undefined, null, 12])("rejects a non-path input %s", (target) =>
    expect(write(target)).toMatchObject({ block: true }),
  );
  it("rejects an absolute outside path for edit as well as write", () => {
    for (const tool of ["write", "edit"])
      expect(write(outside, gate(), root, tool)).toMatchObject({ block: true });
    expect(fs.readFileSync(outside, "utf8")).toBe("original");
  });
  it("requires Main to supply a writable root", () =>
    expect(write("file.txt", gate(""))).toMatchObject({ block: true }));
  it("requires the actual native context cwd to match", () => {
    expect(write("file.txt", gate(), fixture)).toMatchObject({ block: true });
    expect(
      gate()({ toolName: "write", input: { path: "file.txt" } }),
    ).toMatchObject({ block: true });
  });
  it("binds the original directory identity rather than adopting a replacement", () => {
    const handler = gate();
    fs.renameSync(root, root + "-old");
    fs.mkdirSync(root);
    expect(write("file.txt", handler)).toMatchObject({ block: true });
  });
  it("rejects a directory junction inside scope", () => {
    const directory = path.join(fixture, "external");
    fs.mkdirSync(directory);
    fs.symlinkSync(directory, path.join(root, "linked"), "junction");
    expect(write("linked/changed.txt")).toMatchObject({ block: true });
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("rejects a hardlink to a file outside scope", () => {
    fs.linkSync(outside, path.join(root, "shared.txt"));
    expect(write("shared.txt")).toMatchObject({ block: true });
    expect(fs.readFileSync(outside, "utf8")).toBe("original");
  });
  it("fails closed on filesystem inspection errors", () => {
    const fsApi = {
      ...fs,
      lstatSync: () => {
        throw Object.assign(Error("fixture error"), { code: "EACCES" });
      },
    } as typeof fs;
    expect(write("file.txt", gate(root, fsApi))).toMatchObject({ block: true });
  });
  it("fails closed when the filesystem cannot identify the root directory", () => {
    const stat = fs.statSync(root, { bigint: true });
    const fsApi = {
      ...fs,
      statSync: () => ({ ...stat, ino: 0n, isDirectory: () => true }),
    } as typeof fs;
    expect(write("file.txt", gate(root, fsApi))).toMatchObject({ block: true });
  });
  it("does not traverse a regular file as a directory", () => {
    fs.writeFileSync(path.join(root, "file.txt"), "original");
    expect(write("file.txt/child.txt")).toMatchObject({ block: true });
  });
  it("protects the executing CLI source even if it is inside the selected project", () => {
    const cli = path.join(root, "runner.mjs");
    fs.writeFileSync(cli, "original");
    expect(write("runner.mjs", gate(root, fs, [cli]))).toMatchObject({
      block: true,
    });
    expect(write("normal.txt", gate(root, fs, [cli]))).toMatchObject({
      block: true,
    });
  });
  it("rejects a scope nested inside an executing CLI installation", () => {
    expect(write("file.txt", gate(root, fs, [fixture]))).toMatchObject({
      block: true,
    });
  });
  it("checks canonical control-directory names as well as input spelling", () => {
    fs.mkdirSync(path.join(root, "alias"));
    fs.mkdirSync(path.join(root, ".git"));
    const fsApi = {
      ...fs,
      realpathSync: (value: string) =>
        String(value) === path.join(root, "alias")
          ? path.join(root, ".git")
          : fs.realpathSync(value),
    } as typeof fs;
    expect(write("alias/config", gate(root, fsApi))).toMatchObject({
      block: true,
    });
  });
  it("keeps ordinary nested creation and existing file edits available", () => {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src/main.ts"), "original");
    for (const tool of ["write", "edit"]) {
      expect(write("src/new.ts", gate(), root, tool)).toBeUndefined();
      expect(
        write(path.join(root, "src/main.ts"), gate(), root, tool),
      ).toBeUndefined();
    }
    expect(write("src/中文文件.ts")).toBeUndefined();
  });
  it("does not restrict native readers through the write scope", () => {
    for (const toolName of ["read", "grep", "find", "ls"])
      expect(
        gate("")({ toolName, input: { path: outside } }, { cwd: root }),
      ).toBeUndefined();
  });
  it
    .runIf(process.platform === "win32")
    .each([
      "C:relative.txt",
      "file.txt:stream",
      "folder./file.txt",
      "folder /file.txt",
      "NUL.txt",
      "CONIN$",
      "CONOUT$",
      "COM1.log",
      "//?/C:/outside.txt",
      "/c/outside.txt",
      "/mnt/c/outside.txt",
    ])("rejects ambiguous Windows spelling %s", (target) =>
    expect(write(target)).toMatchObject({ block: true }),
  );
});

it("fails closed if a protected root cannot be inspected", () => {
  const protectedRoot = path.join(fixture, "private");
  const fsApi = {
    ...fs,
    realpathSync: (target: fs.PathLike) => {
      if (String(target) === protectedRoot)
        throw Object.assign(Error("private fixture"), { code: "EACCES" });
      return fs.realpathSync(target);
    },
  } as typeof fs;
  expect(write("draft.txt", gate(root, fsApi, [protectedRoot]))).toMatchObject({
    block: true,
  });
});
