import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it } from "vitest";
import { streamCommandToFile } from "../scripts/before-pack-direct-npm.mjs";
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "npm-collection-"));
});
afterEach(() => {
  if (!resolve(root).startsWith(resolve(tmpdir())))
    throw Error("Unsafe fixture");
  rmSync(root, { recursive: true, force: true });
});
// @lat: [[brand-startup#Windows direct npm collection]]
it("captures real large JSON output and literal arguments before resolving", async () => {
  const output = join(root, "tree.json");
  await streamCommandToFile(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify({arg:process.argv[1],payload:'x'.repeat(1024*1024)}))",
      "--",
      "owned arg & literal",
    ],
    root,
    output,
  );
  const result = JSON.parse(readFileSync(output, "utf8"));
  expect(result.arg).toBe("owned arg & literal");
  expect(result.payload).toHaveLength(1024 * 1024);
});
it("preserves npm list code1 tolerance while surfacing other process failures", async () => {
  await streamCommandToFile(
    process.execPath,
    ["-e", "process.stdout.write('{}');process.exitCode=1", "--", "list"],
    root,
    join(root, "expected.json"),
  );
  await expect(
    streamCommandToFile(
      process.execPath,
      ["-e", "process.stderr.write('owned failure');process.exitCode=2"],
      root,
      join(root, "failed.json"),
    ),
  ).rejects.toThrow("owned failure");
});
