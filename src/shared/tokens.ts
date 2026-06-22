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
  /** Human-readable formatted balance, e.g. "1.0". */
  formatted: string;
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

/** Format a raw token balance (BigInt as decimal string) into a
 *  human-readable string with up to 4 significant digits.
 *  - Zero → "0"
 *  - Tiny non-zero (< 1e-decimals × 0.0001) → "< 0.0001"
 *  - Otherwise → trimmed to 4 significant digits with trailing zeros removed */
export function formatTokenBalance(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";

  // Pad the raw string to at least (decimals + 1) digits so we can
  // insert a decimal point at the right position.
  const padded = raw.padStart(decimals + 1, "0");
  const integerPart = padded.slice(0, padded.length - decimals) || "0";
  const fractionalPart = padded.slice(padded.length - decimals);

  // Find the first non-zero digit in the fractional part.
  const firstNonZero = fractionalPart.search(/[1-9]/);

  // Entire fractional part is zeros → pure integer.
  if (firstNonZero === -1) return integerPart;

  // Trim trailing zeros from the fractional part.
  const trimmedFrac = fractionalPart.replace(/0+$/, "");

  if (integerPart !== "0") {
    // Has a non-zero integer portion — show up to 4 fractional digits
    // (4 significant digits total since integer part already has ≥1).
    const capped = trimmedFrac.slice(0, 4);
    return capped ? `${integerPart}.${capped}` : integerPart;
  }

  // Integer part is zero — first non-zero digit is at position firstNonZero.
  // If the first non-zero digit is beyond 4 decimal places, it's tiny.
  if (firstNonZero >= 4) return "< 0.0001";

  // Show up to 4 significant digits from the first non-zero position.
  // leadingZeros: zeros before the first significant digit.
  const significantDigits = trimmedFrac.slice(firstNonZero);
  const visible = significantDigits.slice(0, 4);
  return `0.${"0".repeat(firstNonZero)}${visible}`;
}
