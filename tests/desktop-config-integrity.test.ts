import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const fault = vi.hoisted(() => ({ mode: "", target: "" }));
vi.mock("fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("fs")>();
  const failure = (): NodeJS.ErrnoException =>
    Object.assign(new Error("fixture IO failure"), { code: "EIO" });
  return {
    ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
      if (fault.mode === "read" && String(args[0]) === fault.target)
        throw failure();
      if (fault.mode === "missing-target" && String(args[0]) === fault.target) {
        throw Object.assign(failure(), { code: "ENOENT" });
      }
      return fs.readFileSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      const file = String(args[0]);
      if (
        fault.mode === "write" &&
        (file === fault.target || file.includes(".desktop.json."))
      ) {
        if (file === fault.target) fs.writeFileSync(file, "{");
        throw failure();
      }
      return fs.writeFileSync(...args);
    },
    renameSync: (...args: Parameters<typeof fs.renameSync>) => {
      if (fault.mode === "rename" && String(args[1]) === fault.target)
        throw failure();
      return fs.renameSync(...args);
    },
  };
});
let directory: string;
let file: string;
async function config(): Promise<typeof import("../src/main/config")> {
  return import("../src/main/config");
}
beforeEach(() => {
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), "desktop-config-integrity-"));
  vi.stubEnv("AGENTS_ONE_USER_DATA_DIR", directory);
  mkdirSync(join(directory, "data"));
  file = join(directory, "data", "desktop.json");
  fault.mode = "";
  fault.target = file;
});
afterEach(() => {
  fault.mode = "";
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("desktop configuration integrity", () => {
  for (const contents of [
    '{"secret":"fixture-private-token",broken',
    "null",
    "[]",
    '"string"',
    "false",
  ]) {
    it(
      "preserves invalid existing state and blocks a replacing write: " +
        contents.slice(0, 12),
      async () => {
        writeFileSync(file, contents);
        const store = await config();
        expect(() => store.readDesktopConfig()).toThrow(
          /Desktop configuration/,
        );
        expect(() => store.writeDesktopConfig({ locale: "en" })).toThrow(
          /Desktop configuration/,
        );
        expect(readFileSync(file, "utf8")).toBe(contents);
        try {
          store.readDesktopConfig();
        } catch (error) {
          expect(String(error)).not.toContain("fixture-private-token");
        }
        expect(readdirSync(join(directory, "data"))).toEqual(["desktop.json"]);
      },
    );
  }
  for (const mode of ["write", "rename"]) {
    it("keeps original bytes if " + mode + " fails", async () => {
      const original = JSON.stringify({
        futureKey: { preserved: true },
        locale: "en",
      });
      writeFileSync(file, original);
      const store = await config();
      fault.mode = mode;
      expect(() =>
        store.writeDesktopConfig({
          ...store.readDesktopConfig(),
          locale: "zh-CN",
        }),
      ).toThrow("fixture IO failure");
      expect(readFileSync(file, "utf8")).toBe(original);
      expect(readdirSync(join(directory, "data"))).toEqual(["desktop.json"]);
    });
  }
  it("does not treat an unreadable existing file as a new store", async () => {
    writeFileSync(file, '{"keep":true}');
    const store = await config();
    fault.mode = "read";
    expect(() => store.readDesktopConfig()).toThrow(/Desktop configuration/);
    expect(() => store.writeDesktopConfig({})).toThrow(/Desktop configuration/);
    fault.mode = "";
    expect(readFileSync(file, "utf8")).toBe('{"keep":true}');
  });
  it("does not assume a new store when ENOENT is returned but the path still exists", async () => {
    writeFileSync(file, '{"keep":true}');
    const store = await config();
    fault.mode = "missing-target";
    expect(() => store.readDesktopConfig()).toThrow(/Desktop configuration/);
    expect(() => store.writeDesktopConfig({})).toThrow(/Desktop configuration/);
    fault.mode = "";
    expect(readFileSync(file, "utf8")).toBe('{"keep":true}');
  });
  it("initializes only an absent store and preserves unknown keys through a real locale update", async () => {
    const store = await config();
    expect(store.readDesktopConfig()).toEqual({});
    store.writeDesktopConfig({
      futureKey: { preserved: true },
      agentRuntimes: [{ id: "fixture" }],
    });
    const locale = await import("../src/main/locale");
    locale.setAppLocale("zh-CN");
    expect(store.readDesktopConfig()).toMatchObject({
      futureKey: { preserved: true },
      agentRuntimes: [{ id: "fixture" }],
      locale: "zh-CN",
    });
    expect(readdirSync(join(directory, "data"))).toEqual(["desktop.json"]);
  });
  it("supports valid BOM data and explicit repair without deleting the damaged file", async () => {
    const store = await config();
    writeFileSync(file, "broken");
    expect(() => store.writeDesktopConfig({})).toThrow();
    writeFileSync(file, '\uFEFF{"futureKey":{"keep":true}}');
    store.writeDesktopConfig({ ...store.readDesktopConfig(), locale: "en" });
    expect(store.readDesktopConfig()).toMatchObject({
      futureKey: { keep: true },
      locale: "en",
    });
  });
  it("allows locale module initialization for an invalid file but cannot save or change memory locale", async () => {
    writeFileSync(file, "broken");
    const locale = await import("../src/main/locale");
    const i18n = await import("../src/shared/i18n");
    const before = i18n.getLocale();
    expect(() => locale.getAppLocale()).not.toThrow();
    const next = before === "en" ? "zh-CN" : "en";
    expect(() => locale.setAppLocale(next)).toThrow(/Desktop configuration/);
    expect(i18n.getLocale()).toBe(before);
    expect(readFileSync(file, "utf8")).toBe("broken");
  });
});
