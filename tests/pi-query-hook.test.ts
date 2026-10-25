import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPiQueryContext } from "../src/main/pi-query-context";
import { piReadOnlyExtensionSource } from "../src/main/pi-runtime";
let container: string,
  project: string,
  state: Awaited<ReturnType<typeof createPiQueryContext>>;
beforeEach(async () => {
  container = fs.mkdtempSync(path.join(tmpdir(), "pi-query-hook-"));
  project = path.join(container, "project");
  fs.mkdirSync(project);
  state = await createPiQueryContext(
    path.join(container, "control"),
    project,
    path.join(container, "agent"),
    {},
  );
});
afterEach(() => {
  if (
    !path.resolve(container).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(container).startsWith("pi-query-hook-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(container, { recursive: true, force: true });
});
function install(): {
  call: (name: string) => unknown;
  chdir: ReturnType<typeof vi.fn>;
} {
  let callback!: (event: unknown, ctx: { cwd: string }) => unknown;
  const chdir = vi.fn();
  const source = piReadOnlyExtensionSource(
    "safe_write",
    project,
    [],
    state.binding,
  );
  const load = new Function(
    "fs",
    "path",
    "process",
    source
      .replace(/^import .*;\r?$/gm, "")
      .replace(
        "export default function agentsOneReadOnly",
        "return function agentsOneReadOnly",
      ),
  )(fs, path, { chdir });
  load({
    on: (_name: string, handler: typeof callback): void => {
      callback = handler;
    },
  });
  return {
    call: (name) =>
      callback(
        { toolName: name, input: { path: "draft.txt" } },
        { cwd: project },
      ),
    chdir,
  };
}
it("enters the neutral process directory while preserving the actual project context for writes", () => {
  const hook = install();
  expect(hook.chdir).toHaveBeenCalledWith(state.binding.directory);
  expect(hook.call("write")).toBeUndefined();
  expect(hook.call("grep")).toBeUndefined();
});
it("does not lose the permission hook when initial neutral entry is denied", () => {
  fs.writeFileSync(path.join(state.binding.directory, "rg.exe"), "fixture");
  const hook = install();
  expect(hook.call("grep")).toMatchObject({ block: true });
  expect(hook.call("write")).toMatchObject({ block: true });
  expect(hook.chdir).not.toHaveBeenCalled();
});
it("refuses later tool calls if the neutral folder is populated", () => {
  const hook = install();
  fs.writeFileSync(path.join(state.binding.directory, "fd.exe"), "fixture");
  hook.chdir.mockClear();
  expect(hook.call("find")).toMatchObject({ block: true });
  expect(hook.chdir).not.toHaveBeenCalled();
});
