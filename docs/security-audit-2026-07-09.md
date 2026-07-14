# Security audit notes

Date: 2026-07-09

Scope: first-pass audit of the Electron security boundary before adding Agent Console multi-agent dispatch features.

## Verified strengths

- Main window uses hardened defaults: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, and `allowRunningInsecureContent: false` in `src/main/app/start.ts`.
- Webview attachment is filtered and hardened in `src/main/app/start.ts` and `src/main/security.ts`.
- External URL opening is protocol-gated through `isAllowedExternalUrl`.
- Account access tokens are not exposed through the public account view and are encrypted at rest through Electron safeStorage.
- Secrets command-provider code already has rate limiting and cross-key leak tests.

## Fixed in this pass

- `read-file` IPC previously used `readFile(filePath)` and then truncated to `maxBytes`. A large file preview could therefore read the whole file into main-process memory. It now opens the file, checks `stat()`, caps reads at 1 MB, and reads only the requested slice.
- Windows test stability:
  - POSIX shell quoting tests now skip execution when `bash` is unavailable.
  - PATH prepending in the SSH test now uses `path.delimiter`.
  - Markdown tests mock the highlighter for deterministic JSDOM behavior.
  - The cron create test has an explicit timeout because full-suite parallelism can exceed Vitest's 5 second default.

## Open risks

### High: dependency audit debt

`npm audit --omit=dev --json` currently reports:

- 1 high
- 4 moderate
- 1 low
- 0 critical

Main affected packages:

- `vite`
- `esbuild`
- `js-yaml`
- `postcss`
- `brace-expansion`
- `@wesbos/code-icons`

Most Vite/esbuild findings are dev-server or build-chain focused, but several are Windows file-read/path traversal issues. Because this project is developed and tested on Windows, dependency remediation should happen before broad local dev usage.

### Medium: very large preload/IPC surface

`src/preload/index.ts` exposes a broad `window.hermesAPI` surface. The most sensitive IPC groups are:

- file and directory reads
- opening files and terminals
- SSH tunnel and remote SSH actions
- skill and MCP installation/removal
- config and env mutation
- backup/import/dump
- wallet and account operations

The current model assumes the renderer is trusted. Before adding Agent Console-style remote task dispatch, add a small authorization/validation layer for high-risk IPC calls.

### Medium: arbitrary local path operations

Several IPC handlers accept renderer-provided paths. Some are expected for worktree browsing, but the allowed roots are not yet explicit. Recommended next step: track user-selected workspace roots and restrict file preview/open-terminal operations to those roots, unless the user picks a path through an Electron dialog in the same flow.

### Medium: web preview inspector trust boundary

The web preview can load remote HTTPS and inject an inspector script with `executeJavaScript`. The webview itself is sandboxed and has no preload, which is good. However, when inspection mode is active, page console messages are parsed as inspector results. Treat the returned payload as untrusted data and validate its shape before it influences app behavior.

### Low: CSP remains permissive

The default CSP still includes `script-src 'unsafe-inline' 'wasm-unsafe-eval'` and `style-src 'unsafe-inline'`. This may be required by the current renderer stack, but it should be reviewed after the dependency upgrade.

## Recommended security gates before new agent dispatch

1. Upgrade or override dependencies to remove `npm audit --omit=dev` high findings.
2. Add shared runtime validators for high-risk IPC inputs.
3. Restrict local file/directory IPC to selected workspace roots.
4. Add regression tests for path rejection, large file reads, and unsafe URL rejection.
5. Re-review MCP and skill install flows before allowing remote agents to trigger them.
