import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// GitHub Windows runners may expose TEMP through an 8.3 alias. Test fixtures
// use one physical spelling; explicit alias/junction tests still create aliases.
if (process.platform === "win32") {
  for (const key of ["TEMP", "TMP"]) {
    if (process.env[key])
      process.env[key] = realpathSync.native(process.env[key]);
  }
}

// Keep isolated unit tests away from a developer's real desktop userData.
const testUserData = mkdtempSync(join(tmpdir(), "agents-one-vitest-data-"));
process.env.AGENTS_ONE_USER_DATA_DIR = testUserData;

afterAll(() => {
  rmSync(testUserData, { recursive: true, force: true });
});
