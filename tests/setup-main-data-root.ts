import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

// Keep isolated unit tests away from a developer's real desktop userData.
const testUserData = mkdtempSync(join(tmpdir(), "agents-one-vitest-data-"));
process.env.AGENTS_ONE_USER_DATA_DIR = testUserData;

afterAll(() => {
  rmSync(testUserData, { recursive: true, force: true });
});
