import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForWindowsSecretMetadata } from "./windows-secret-ready";

describe("Windows protected credential readiness", () => {
  it("waits for complete metadata and rejects a timeout", async () => {
    const root = mkdtempSync(join(tmpdir(), "one-oscrypt-"));
    try {
      const file = join(root, "Local State");
      await expect(
        waitForWindowsSecretMetadata(root, { timeoutMs: 20, pollMs: 5 }),
      ).rejects.toThrow(/尚未完成/);
      writeFileSync(file, "{");
      const waiting = waitForWindowsSecretMetadata(root, {
        timeoutMs: 1000,
        pollMs: 5,
      });
      setTimeout(
        () =>
          writeFileSync(
            file,
            JSON.stringify({
              os_crypt: { encrypted_key: "test-encrypted-metadata" },
            }),
          ),
        25,
      );
      await expect(waiting).resolves.toBeUndefined();
      await expect(
        waitForWindowsSecretMetadata(root, { timeoutMs: 20, pollMs: 5 }),
      ).resolves.toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
