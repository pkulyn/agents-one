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
  getOneProviderCredential,
  oneCredentialKey,
  oneCredentialStatus,
  oneProviderCredentialStatus,
  setOneCredential,
  setOneProviderCredential,
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

it("keeps provider credentials isolated from the runtime credential", () => {
  const root = mkdtempSync(join(tmpdir(), "one-provider-secrets-"));
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
    setOneCredential("one-a", "legacy-key");
    setOneProviderCredential("one-a", "p-ark", "ark-key");
    setOneProviderCredential("one-a", "p-openai", "openai-key");
    expect(getOneProviderCredential("one-a", "p-ark")).toBe("ark-key");
    expect(getOneProviderCredential("one-a", "p-openai")).toBe("openai-key");
    expect(getOneProviderCredential("one-a", "p-missing")).toBeNull();
    expect(oneProviderCredentialStatus("one-a", "p-ark").configured).toBe(true);
    expect(getOneCredential("one-a")).toBe("legacy-key");
    expect(readFileSync(file, "utf8")).not.toContain("ark-key");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
