import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
const fault = vi.hoisted(() => ({
  code: "",
  changed: false,
  stats: 0,
  closed: 0,
}));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    openSync: (...args: Parameters<typeof original.openSync>) => {
      if (fault.code)
        throw Object.assign(Error("secret-native-error-fixture"), {
          code: fault.code,
        });
      return original.openSync(...args);
    },
    fstatSync: (fd: number, options: { bigint: true }) => {
      const stat = original.fstatSync(fd, options);
      fault.stats++;
      return fault.changed && fault.stats > 1
        ? { ...stat, mtimeNs: stat.mtimeNs + 1n }
        : stat;
    },
    closeSync: (fd: number) => {
      fault.closed++;
      return original.closeSync(fd);
    },
  };
});
import { assertPiNonExecutingConfig } from "../src/main/pi-config-policy";
const directory = fs.mkdtempSync(path.join(tmpdir(), "pi-auth-io-"));
fs.writeFileSync(
  path.join(directory, "models.json"),
  JSON.stringify({ providers: {} }),
);
beforeEach(() => {
  fault.code = "";
  fault.changed = false;
  fault.stats = 0;
  fault.closed = 0;
});
afterAll(() => {
  if (
    !path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep) ||
    !path.basename(directory).startsWith("pi-auth-io-")
  )
    throw Error("Unsafe fixture");
  fs.rmSync(directory, { recursive: true, force: true });
});
it.each(["EACCES", "EIO", "ENOENT"])(
  "does not treat a present config's %s open failure as empty state",
  (code) => {
    fault.code = code;
    try {
      assertPiNonExecutingConfig(directory);
      throw Error("unexpected acceptance");
    } catch (error) {
      expect(String(error)).toContain("本轮任务未发送");
      expect(String(error)).not.toContain("secret-native-error-fixture");
    }
  },
);
it("refuses a config changed during its bounded read and closes the descriptor", () => {
  fault.changed = true;
  expect(() => assertPiNonExecutingConfig(directory)).toThrow("本轮任务未发送");
  expect(fault.closed).toBe(1);
});
