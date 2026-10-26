import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { collectDependencyNotices } from "../scripts/collect-dependency-notices.mjs";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dependency-notices-"));
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir())))
    throw Error("Unsafe fixture");
  rmSync(root, { recursive: true, force: true });
});
function dependency(
  name: string,
  version: string,
  license: string,
  text?: string,
): void {
  const path = join(root, "node_modules", name);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "package.json"),
    JSON.stringify({ name, version, license }),
  );
  if (text) writeFileSync(join(path, "LICENSE.md"), text);
}
function lock(packages: Record<string, unknown>): void {
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }),
  );
}
// @lat: [[brand-startup#Packaged dependency notices]]
it("preserves original commercial/OSS terms and records absent optional and declaration-only packages", () => {
  dependency("oss", "1.0.0", "MIT", "Owned MIT notice\n");
  dependency(
    "commercial",
    "2.0.0",
    "SEE LICENSE IN LICENSE.md",
    "Owned commercial terms\n",
  );
  dependency("declaration", "1.0.0", "BSD-2-Clause");
  lock({
    "node_modules/oss": { version: "1.0.0" },
    "node_modules/commercial": { version: "2.0.0" },
    "node_modules/declaration": { version: "1.0.0" },
    "node_modules/other-os": { version: "1.0.0", optional: true },
    "node_modules/development": { version: "1.0.0", dev: true },
  });
  const result = collectDependencyNotices(root);
  expect(result.index.packages.map((p) => p.name)).toEqual([
    "commercial",
    "declaration",
    "oss",
  ]);
  expect(result.text).toContain(
    readFileSync(join(root, "node_modules/commercial/LICENSE.md"), "utf8"),
  );
  expect(result.index.withoutStandaloneNotice).toEqual([
    { name: "declaration", version: "1.0.0" },
  ]);
  expect(result.index.skippedOptional).toEqual(["node_modules/other-os"]);
  expect(collectDependencyNotices(root)).toEqual(result);
  expect(result.text).not.toContain(root);
});
it("refuses missing required dependencies and lock/version drift instead of inventing a notice", () => {
  lock({ "node_modules/required": { version: "1.0.0" } });
  expect(() => collectDependencyNotices(root)).toThrow("missing");
  dependency("required", "2.0.0", "MIT", "Owned notice");
  expect(() => collectDependencyNotices(root)).toThrow("does not match lock");
});
