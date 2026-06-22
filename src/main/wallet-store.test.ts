// @vitest-environment node
// @lat: [[wallet-token-balances#Tests]]

import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  hermesHome: "",
  encryptionAvailable: true,
}));

vi.mock("./installer", () => ({
  get HERMES_HOME() {
    return mockState.hermesHome;
  },
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => mockState.encryptionAvailable,
    encryptString: (value: string) =>
      Buffer.from(`encrypted:${value}`, "utf-8"),
  },
}));

describe("wallet store", () => {
  beforeEach(() => {
    mockState.hermesHome = mkdtempSync(join(tmpdir(), "hermes-wallets-"));
    mockState.encryptionAvailable = true;
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(mockState.hermesHome, { recursive: true, force: true });
  });

  async function store(): Promise<typeof import("./wallet-store")> {
    return import("./wallet-store");
  }

  it("creates a Base wallet and only lists public metadata", async () => {
    const wallets = await store();
    const result = wallets.createWallet("default", "Primary");

    expect(result.success).toBe(true);
    expect(result.recoveryPhrase?.split(" ")).toHaveLength(12);
    expect(result.wallet).toMatchObject({
      name: "Primary",
      network: "base",
      imported: false,
    });
    expect(result.wallet?.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(wallets.listWallets("default")).toEqual([result.wallet]);
  });

  it("imports an existing recovery phrase into a profile", async () => {
    const wallets = await store();
    const created = wallets.createWallet("default", "Source");
    const imported = wallets.importWallet({
      profile: "coder",
      name: "Imported",
      recoveryPhrase: created.recoveryPhrase || "",
    });

    expect(imported.success).toBe(true);
    expect(imported.wallet?.address).toBe(created.wallet?.address);
    expect(imported.wallet?.imported).toBe(true);
    expect(wallets.listWallets("default")).toHaveLength(1);
    expect(wallets.listWallets("coder")).toHaveLength(1);
  });

  it("does not persist recovery phrases as plaintext", async () => {
    const wallets = await store();
    const result = wallets.createWallet("default", "Primary");
    const raw = readFileSync(
      join(mockState.hermesHome, "wallets.json"),
      "utf-8",
    );

    expect(raw).not.toContain(result.recoveryPhrase || "");
    expect(raw).toContain("encryptedRecoveryPhrase");
  });

  it("prevents duplicate imported wallets in the same profile", async () => {
    const wallets = await store();
    const created = wallets.createWallet("default", "Primary");
    const duplicate = wallets.importWallet({
      profile: "default",
      name: "Duplicate",
      recoveryPhrase: created.recoveryPhrase || "",
    });

    expect(duplicate.success).toBe(false);
    expect(wallets.listWallets("default")).toHaveLength(1);
  });

  it("silently enforces the per-profile wallet cap", async () => {
    const wallets = await store();

    for (let index = 0; index < 10; index += 1) {
      expect(wallets.createWallet("default", `Wallet ${index}`).success).toBe(
        true,
      );
    }

    const blocked = wallets.createWallet("default", "Extra");
    expect(blocked.success).toBe(false);
    expect(blocked.error).not.toContain("10");
    expect(wallets.listWallets("default")).toHaveLength(10);
  });

  it("does not create a wallet when secure storage is unavailable", async () => {
    mockState.encryptionAvailable = false;
    const wallets = await store();
    const result = wallets.createWallet("default", "Primary");

    expect(result.success).toBe(false);
    expect(wallets.listWallets("default")).toHaveLength(0);
  });
});
