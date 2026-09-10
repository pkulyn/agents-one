import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopSecretStore,
  type DesktopSecretProtector,
} from "./desktop-secret-store";

const directories: string[] = [];

function testDirectory(): string {
  const directory = mkdtempSync(
    join(tmpdir(), "agents-one-protected-secrets-"),
  );
  directories.push(directory);
  return directory;
}

function protector(prefix = "protected:"): DesktopSecretProtector {
  return {
    available: true,
    backend: "test-os-store",
    encrypt: (value) => Buffer.from(`${prefix}${value}`, "utf8"),
    decrypt: (value) => {
      const decoded = value.toString("utf8");
      if (!decoded.startsWith(prefix)) throw new Error("wrong user or machine");
      return decoded.slice(prefix.length);
    },
  };
}

afterEach(() => {
  while (directories.length) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe("desktop protected secret store", () => {
  it("migrates a legacy value once and removes plaintext only after verification", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const store = new DesktopSecretStore(file, protector());
    let legacy: string | null = "not-a-real-token";
    let removals = 0;
    const source = {
      read: () => legacy,
      remove: () => {
        removals += 1;
        legacy = null;
      },
    };

    expect(store.get("REMOTE_TOKEN", source)).toBe("not-a-real-token");
    expect(store.get("REMOTE_TOKEN", source)).toBe("not-a-real-token");
    expect(removals).toBe(1);
    expect(readFileSync(file, "utf8")).not.toContain("not-a-real-token");
  });

  it("rolls back to the previous ciphertext when the current generation is damaged", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const store = new DesktopSecretStore(file, protector());
    const legacy = { read: () => null, remove: () => undefined };
    store.set("REMOTE_TOKEN", "first-value", legacy);
    store.set("REMOTE_TOKEN", "second-value", legacy);
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.records.REMOTE_TOKEN.ciphertext =
      Buffer.from("damaged").toString("base64");
    writeFileSync(file, JSON.stringify(data), "utf8");

    expect(store.get("REMOTE_TOKEN", legacy)).toBe("first-value");
    expect(store.status("REMOTE_TOKEN").unreadable).not.toBe(true);
  });

  it("reports a user or machine binding mismatch without inventing an empty credential", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const legacy = { read: () => null, remove: () => undefined };
    new DesktopSecretStore(file, protector("user-a:")).set(
      "REMOTE_TOKEN",
      "bound-value",
      legacy,
    );
    const moved = new DesktopSecretStore(file, protector("user-b:"));

    expect(moved.get("REMOTE_TOKEN", legacy)).toBeNull();
    expect(moved.status("REMOTE_TOKEN")).toMatchObject({
      protection: "unavailable",
      unreadable: true,
    });
  });

  it("keeps using the legacy value and exposes a warning when no keyring exists", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const store = new DesktopSecretStore(file, {
      ...protector(),
      available: false,
      backend: "basic_text",
      warning: "No Linux keyring is available.",
    });
    let removed = false;
    expect(
      store.get("REMOTE_TOKEN", {
        read: () => "legacy-value",
        remove: () => {
          removed = true;
        },
      }),
    ).toBe("legacy-value");
    expect(removed).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(store.status()).toMatchObject({
      protection: "legacy-fallback",
      backend: "basic_text",
    });
  });

  it("does not downgrade an existing protected record to an unconfigured state", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const legacy = { read: () => null, remove: () => undefined };
    new DesktopSecretStore(file, protector()).set(
      "REMOTE_TOKEN",
      "protected-value",
      legacy,
    );
    const unavailable = new DesktopSecretStore(file, {
      ...protector(),
      available: false,
      backend: "basic_text",
      warning: "No Linux keyring is available.",
    });

    expect(unavailable.get("REMOTE_TOKEN", legacy)).toBeNull();
    expect(unavailable.status("REMOTE_TOKEN")).toMatchObject({
      protection: "unavailable",
      unreadable: true,
    });
  });

  it("does not lose the legacy value when migration cleanup fails", () => {
    const file = join(testDirectory(), "protected-secrets.json");
    const store = new DesktopSecretStore(file, protector());
    expect(
      store.get("REMOTE_TOKEN", {
        read: () => "rollback-value",
        remove: () => {
          throw new Error("simulated cleanup failure");
        },
      }),
    ).toBe("rollback-value");
    expect(
      store.get("REMOTE_TOKEN", { read: () => null, remove: () => undefined }),
    ).toBe("rollback-value");
  });
});
