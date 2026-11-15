import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createWindowsPortable } from "./create-windows-portable.mjs";

// @lat: [[brand-startup#ZIP folder portable distribution]]
test("ZIP contains a complete marked folder while installer payload stays unmarked", async () => {
  const root = mkdtempSync(join(tmpdir(), "agents-one-zip-test-"));
  try {
    const source = join(root, "win-unpacked");
    mkdirSync(join(source, "resources"), { recursive: true });
    writeFileSync(join(source, "agents-one.exe"), "fixture executable");
    writeFileSync(join(source, "resources/app.asar"), "fixture app");
    writeFileSync(join(source, "chrome_100_percent.pak"), "fixture resource");
    const archive = await createWindowsPortable(root, "1.0.0");
    const output = join(root, "extracted");
    const sevenZip = await createRequire(import.meta.url)(
      "app-builder-lib/out/toolsets/7zip.js",
    ).getPath7za();
    execFileSync(sevenZip, ["x", archive, `-o${output}`, "-y"]);
    const folder = join(output, "agents-one-1.0.0-portable");
    for (const file of [
      "agents-one.exe",
      "resources/app.asar",
      "chrome_100_percent.pak",
      "resources/agents-one-portable.json",
      "PORTABLE-README.txt",
    ])
      assert.ok(existsSync(join(folder, file)), file);
    assert.equal(
      existsSync(join(source, "resources/agents-one-portable.json")),
      false,
    );
    await assert.rejects(
      () => createWindowsPortable(root, "../invalid"),
      /Invalid/,
    );
    writeFileSync(join(source, "resources/agents-one-portable.json"), "{}");
    await assert.rejects(
      () => createWindowsPortable(root, "1.0.0"),
      /Installer payload/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
