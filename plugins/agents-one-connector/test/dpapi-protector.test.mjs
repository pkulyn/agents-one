import assert from "node:assert/strict";
import test from "node:test";
import {
  DPAPI_TIMEOUT_MS,
  protectForCurrentWindowsUser,
  unprotectForCurrentWindowsUser,
} from "../src/dpapi-protector.mjs";

test("Windows DPAPI allows a bounded cold start", () => {
  assert.equal(DPAPI_TIMEOUT_MS, 60_000);
});

test(
  "Windows DPAPI protects credentials for the current interactive user",
  {
    skip:
      process.platform !== "win32" ||
      process.env.CI ||
      process.env.GITHUB_ACTIONS
        ? "requires an interactive Windows user profile"
        : false,
  },
  () => {
    const secret = "agents-one-dpapi-round-trip";
    const ciphertext = protectForCurrentWindowsUser(secret);
    assert.notEqual(ciphertext, Buffer.from(secret, "utf8").toString("base64"));
    assert.equal(unprotectForCurrentWindowsUser(ciphertext), secret);
  },
);
