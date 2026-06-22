# Wallet & Token Balances

Profile-scoped Ethereum wallets on Base mainnet, with on-chain token balance reads.

## Wallet Store

Profile wallets are stored per-profile in `wallets.json` alongside profile metadata. Keys and recovery phrases never leave the main process.

[[src/main/wallet-store.ts]] provides create, import, rename, delete, and list operations. Recovery phrases are encrypted via Electron `safeStorage` and stripped by [[src/main/wallet-store.ts#publicWallet]] before any data crosses IPC. The per-profile cap is 10 wallets ([[src/main/wallet-store.ts#MAX_WALLETS_PER_PROFILE]]).

Wallet metadata types live in [[src/shared/wallets.ts]]: `ProfileWallet` (public shape), `WalletMutationResult` (one-time recovery phrase on create/import), and `ImportWalletInput`.

## Token Balances

On-chain balance reads for Base mainnet ERC-20 tokens, fetched via ethers v6 `JsonRpcProvider`.

[[src/main/wallet-balances.ts#getTokenBalances]] takes a wallet address and returns a `TokenBalancesResponse` containing native ETH plus all configured ERC-20 token balances. Uses `Promise.allSettled()` so one token RPC failure does not block others — each failed token gets an `error` field.

Token metadata (contract address, symbol, decimals, icon path) lives in [[src/shared/tokens.ts]] as `BASE_TOKENS`. Currently tracks ETH (native, icon: `icons/etherium.webp`) and $HD (`0xfda75f77a22b4f4b783bbbb21915ef64d149bba3`, icon: `icons/hdtoken.webp`), both 18 decimals. $H1 is held back for a future release.

### Balance formatting

[[src/shared/tokens.ts#formatTokenBalance]] converts raw BigInt strings to human-readable form: zero → "0", tiny non-zero → "< 0.0001", otherwise up to 4 significant digits with trailing zeros removed.

### IPC & UI

The `get-token-balances` IPC channel exposes balance reads to the renderer. Balances auto-fetch when the wallet pane loads and display as icon-labeled pill badges on each wallet card, with a per-card refresh button.

Token icons (`etherium.webp`, `hdtoken.webp`) are Vite-imported in the renderer component and mapped by token ID via a `TOKEN_ICONS` lookup — the shared `KnownToken` type intentionally omits icon paths since the main process doesn't need them and the renderer resolves them through its bundler. Wallet deletion uses a confirmation modal with red warnings about losing access without a backed-up recovery phrase, instead of a two-click inline confirm.

## Tests

Vitest test suites for wallet store and balance reads.

- [[src/main/wallet-store.test.ts]] — wallet CRUD, encryption, dedup, caps
- [[src/main/wallet-balances.test.ts]] — formatTokenBalance edge cases, getTokenBalances with mocked RPC
