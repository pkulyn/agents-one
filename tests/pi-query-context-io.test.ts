import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fault = vi.hoisted(() => ({
  alias: "",
  project: "",
  delayed: "",
  hit: false,
  release: (): void => {},
}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    promises: {
      ...original.promises,
      realpath: async (file: fs.PathLike) => {
        if (String(file) === fault.delayed) {
          fault.hit = true;
          return new Promise<string>((resolve, reject) => {
            fault.release = (): void => {
              void original.promises.realpath(file).then(resolve, reject);
            };
          });
        }
        return original.promises.realpath(file);
      },
      stat: (file: fs.PathLike, options?: { bigint?: boolean }) =>
        Reflect.apply(original.promises.stat, original.promises, [
          String(file) === fault.alias ? fault.project : file,
          options,
        ]),
    },
  };
});
import { createPiQueryContext } from "../src/main/pi-query-context";
const root = fs.mkdtempSync(path.join(tmpdir(), "pi-query-io-")),
  project = path.join(root, "project"),
  agent = path.join(root, "agent"),
  alias = path.join(root, "alias");
for (const directory of [project, agent, alias]) fs.mkdirSync(directory);
beforeEach(() => {
  fault.alias = "";
  fault.project = project;
  fault.delayed = "";
  fault.hit = false;
});
afterAll(() => {
  vi.useRealTimers();
  if (
    !path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(root).startsWith("pi-query-io-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(root, { recursive: true, force: true });
});
it("rejects a directory identity alias even if canonical spellings differ", async () => {
  fault.alias = alias;
  const result = await createPiQueryContext(
    path.join(root, "control"),
    project,
    agent,
    { PATH: alias },
  );
  expect(result.environment.PATH).toBe("");
});
it("bounds delayed filesystem discovery and stops before creating control state after timeout", async () => {
  vi.useFakeTimers();
  fault.delayed = project;
  const pending = createPiQueryContext(
    path.join(root, "not-created"),
    project,
    agent,
    {},
  );
  const rejected = expect(pending).rejects.toThrow("本轮任务未发送");
  await vi.waitFor(() => expect(fault.hit).toBe(true));
  await vi.advanceTimersByTimeAsync(5000);
  await rejected;
  fault.release();
  await vi.advanceTimersByTimeAsync(1);
  expect(fs.existsSync(path.join(root, "not-created"))).toBe(false);
  vi.useRealTimers();
});
