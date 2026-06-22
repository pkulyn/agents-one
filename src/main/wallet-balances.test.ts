// @vitest-environment node
// @lat: [[wallet-token-balances#Tests]]

import { describe, expect, it, vi } from "vitest";
import { formatTokenBalance } from "../shared/tokens";

describe("formatTokenBalance", () => {
  it('returns "0" for zero raw value', () => {
    expect(formatTokenBalance("0", 18)).toBe("0");
  });

  it('returns "0" for empty raw value', () => {
    expect(formatTokenBalance("", 18)).toBe("0");
  });

  it("formats exactly 1 token (1e18 raw, 18 decimals)", () => {
    expect(formatTokenBalance("1000000000000000000", 18)).toBe("1");
  });

  it("formats a whole number with no fractional part", () => {
    expect(formatTokenBalance("5000000000000000000", 18)).toBe("5");
  });

  it("formats a small fractional balance (0.5 token)", () => {
    expect(formatTokenBalance("500000000000000000", 18)).toBe("0.5");
  });

  it("formats with up to 4 significant digits", () => {
    // 0.1234 tokens
    expect(formatTokenBalance("123400000000000000", 18)).toBe("0.1234");
  });

  it("trims trailing zeros from fractional part", () => {
    // 0.1200 tokens → "0.12"
    expect(formatTokenBalance("120000000000000000", 18)).toBe("0.12");
  });

  it('shows "< 0.0001" for tiny non-zero balances beyond 4 decimals', () => {
    // 0.00001 tokens = 1e13 raw
    expect(formatTokenBalance("10000000000000", 18)).toBe("< 0.0001");
  });

  it("formats a large balance correctly", () => {
    // 1,000,000 tokens
    expect(formatTokenBalance("1000000000000000000000000", 18)).toBe("1000000");
  });

  it("formats mixed integer + fractional (123.4567)", () => {
    const raw = BigInt("123456700000000000000").toString();
    expect(formatTokenBalance(raw, 18)).toBe("123.4567");
  });

  it("formats when the fractional part has leading zeros then significant digits", () => {
    // 0.001234 tokens — 4 significant digits from first non-zero
    expect(formatTokenBalance("1234000000000000", 18)).toBe("0.001234");
  });

  it("works with 6-decimal tokens (USDC-like)", () => {
    // 1.5 USDC
    expect(formatTokenBalance("1500000", 6)).toBe("1.5");
  });

  it("trims trailing zeros for 6-decimal tokens", () => {
    // 0.12 USDC
    expect(formatTokenBalance("120000", 6)).toBe("0.12");
  });
});

// Use vi.hoisted so the mock closures can reference the mock objects
// even though vi.mock is hoisted above the describe block.
const mockState = vi.hoisted(() => ({
  getBalance: vi.fn().mockResolvedValue(BigInt("2000000000000000000")),
  hdBalanceOf: vi.fn().mockResolvedValue(BigInt("100000000000000000")),
}));

vi.mock("ethers", () => ({
  JsonRpcProvider: vi.fn().mockImplementation(function () {
    return { getBalance: mockState.getBalance };
  }),
  Contract: vi.fn().mockImplementation(function (address: string) {
    if (address === "0xfda75f77a22b4f4b783bbbb21915ef64d149bba3") {
      return { balanceOf: mockState.hdBalanceOf };
    }
    return { balanceOf: vi.fn().mockResolvedValue(BigInt(0)) };
  }),
}));

describe("getTokenBalances", () => {
  it("returns balances for all tokens including native ETH", async () => {
    const { getTokenBalances } = await import("./wallet-balances");
    const result = await getTokenBalances(
      "0x1234567890abcdef1234567890abcdef12345678",
    );

    expect(result.address).toBe(
      "0x1234567890abcdef1234567890abcdef12345678",
    );
    expect(result.balances).toHaveLength(2);
    expect(result.balances[0].tokenId).toBe("eth");
    expect(result.balances[0].formatted).toBe("2");
    expect(result.balances[1].tokenId).toBe("hd");
    expect(result.balances[1].formatted).toBe("0.1");
    expect(result.fetchedAt).toBeGreaterThan(0);
  });

  it("includes error field when a token call fails", async () => {
    // Override HD mock to reject for this test
    mockState.hdBalanceOf.mockRejectedValueOnce(new Error("RPC timeout"));

    const { getTokenBalances } = await import("./wallet-balances");
    const result = await getTokenBalances(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );

    expect(result.balances).toHaveLength(2);
    // HD should have an error
    const hd = result.balances.find((b) => b.tokenId === "hd");
    expect(hd?.error).toBeTruthy();
    // ETH should still succeed
    const eth = result.balances.find((b) => b.tokenId === "eth");
    expect(eth?.error).toBeUndefined();
  });
});
