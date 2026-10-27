import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { expect, it } from "vitest";
const generated = [
  "contracts/mobile-control/v1/schema.json",
  "contracts/mobile-control/v1/openapi.json",
  "contracts/mobile-control/v1/fixtures.json",
  "apps/android/core/src/main/kotlin/one/agents/mobile/contract/MobileDtos.kt",
  "apps/android/core/src/main/kotlin/one/agents/mobile/contract/MobileSchemaDefinitions.kt",
  "apps/android/core/src/test/kotlin/one/agents/mobile/contract/GeneratedContractTest.kt",
];
// @lat: [[repository-presentation#Generated contract checkout consistency]]
it("keeps generated contract bytes stable in a fresh checkout with core.autocrlf enabled", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "agents-one-contract-checkout-"),
  );
  try {
    execFileSync(
      "git",
      [
        "-c",
        "core.autocrlf=true",
        "checkout-index",
        "--prefix=" + directory.replaceAll(sep, "/") + "/",
        "--",
        ...generated,
      ],
      { windowsHide: true },
    );
    for (const file of generated) {
      const actual = readFileSync(join(directory, file), "utf8");
      expect(actual, file).not.toContain("\r\n");
      expect(actual, file).toBe(
        execFileSync("git", ["show", ":" + file], {
          encoding: "utf8",
          windowsHide: true,
        }),
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
