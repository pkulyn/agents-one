/** Known ERC-20 / native token metadata and balance-response types
 *  shared between the main process (RPC reads) and the renderer (UI).
 *
 *  // @lat: [[wallet-token-balances#Token Balances]] */

export interface KnownToken {
  /** Stable identifier, e.g. "eth", "hd". */
  id: string;
  /** Human-readable name, e.g. "Hermes Desktop". */
  name: string;
  /** Ticker symbol, e.g. "HD". */
  symbol: string;
  /** On-chain contract address (omitted for native ETH). */
  contractAddress?: string;
  /** Token decimals (18 for all current tokens). */
  decimals: number;
}

export interface TokenBalanceResult {
  tokenId: string;
  symbol: string;
  /** Raw BigInt balance as a decimal string, e.g. "1000000000000000000". */
  raw: string;
  /** Compact formatted balance with K/M suffixes, e.g. "10.5K". */
  formatted: string;
  /** Full formatted balance without suffixes, e.g. "10500". Used for tooltips. */
  formattedFull: string;
  /** Present when the RPC call for this token failed. */
  error?: string;
}

export interface TokenBalancesResponse {
  address: string;
  balances: TokenBalanceResult[];
  /** Epoch ms when the balances were fetched. */
  fetchedAt: number;
}

/** Live tokens on Base mainnet plus native ETH. */
export const BASE_TOKENS: KnownToken[] = [
  {
    id: "eth",
    name: "Ethereum",
    symbol: "ETH",
    decimals: 18,
  },
  {
    id: "hd",
    name: "Hermes Desktop",
    symbol: "HD",
    contractAddress: "0xfda75f77a22b4f4b783bbbb21915ef64d149bba3",
    decimals: 18,
  },
];

/** Format a raw token balance into a full human-readable string
 *  (no K/M suffixes), suitable for tooltips.
 *  - Zero → "0"
 *  - Otherwise → up to 4 significant digits with trailing zeros removed */
export function formatTokenBalanceFull(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  const padded = raw.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, padded.length - decimals) || "0";
  const fractionalPart = padded.slice(padded.length - decimals);
  const firstNonZero = fractionalPart.search(/[1-9]/);
  if (firstNonZero === -1) return integerPart;
  const trimmedFrac = fractionalPart.replace(/0+$/, "");

  if (integerPart !== "0") {
    const capped = trimmedFrac.slice(0, 4);
    return capped ? `${integerPart}.${capped}` : integerPart;
  }

  if (firstNonZero >= 4) return "< 0.0001";
  const significantDigits = trimmedFrac.slice(firstNonZero);
  const visible = significantDigits.slice(0, 4);
  return `0.${"0".repeat(firstNonZero)}${visible}`;
}

/** Format a raw token balance into a compact string with K/M suffixes.
 *  - Zero → "0"
 *  - ≥ 1M → e.g. "1.5M"
 *  - ≥ 1K → e.g. "10.5K"
 *  - Tiny non-zero (< 0.0001) → "< 0.0001"
 *  - Otherwise → up to 4 significant digits */
export function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  // Convert raw to a floating-point number for K/M comparison.
  const numeric = Number(raw) / Math.pow(10, decimals);

  if (numeric >= 1_000_000) {
    const millions = numeric / 1_000_000;
    const rounded = Math.round(millions * 100) / 100;
    // Remove unnecessary trailing zeros: 1.50 → 1.5
    const str = rounded.toFixed(2).replace(/\.?0+$/, "");
    return `${str}M`;
  }

  if (numeric >= 1_000) {
    const thousands = numeric / 1_000;
    const rounded = Math.round(thousands * 100) / 100;
    const str = rounded.toFixed(2).replace(/\.?0+$/, "");
    return `${str}K`;
  }

  // Fall through to full formatting for small values.
  return formatTokenBalanceFull(raw, decimals);
}
