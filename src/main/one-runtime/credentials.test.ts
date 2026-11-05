import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  configureDesktopSecretStore,
  DesktopSecretStore,
} from "../desktop-secret-store";
import {
  getOneCredential,
  oneCredentialKey,
  oneCredentialStatus,
  setOneCredential,
} from "./credentials";

it("keeps distinct One credentials in the protected store and refuses plaintext fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "one-secrets-"));
  const file = join(root, "secrets.json");
  try {
    configureDesktopSecretStore(
      new DesktopSecretStore(file, {
        available: true,
        backend: "test",
        encrypt: (value) => Buffer.from(value.split("").reverse().join("")),
        decrypt: (value) => value.toString().split("").reverse().join(""),
      }),
    );
    setOneCredential("one-a", "first-test-key");
    setOneCredential("one-b", "second-test-key");
    expect(getOneCredential("one-a")).toBe("first-test-key");
    expect(getOneCredential("one-b")).toBe("second-test-key");
    expect(oneCredentialKey("one-a")).not.toBe(oneCredentialKey("one-b"));
    expect(oneCredentialStatus("one-a").configured).toBe(true);
    expect(readFileSync(file, "utf8")).not.toContain("first-test-key");
    configureDesktopSecretStore(
      new DesktopSecretStore(file, {
        available: false,
        backend: "test",
        encrypt: () => {
          throw Error("unavailable");
        },
        decrypt: () => {
          throw Error("unavailable");
        },
      }),
    );
    expect(() => setOneCredential("one-a", "new-test-key")).toThrow(
      "unavailable",
    );
    expect(getOneCredential("one-a")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
