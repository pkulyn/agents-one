# Windows portable build notes

Date: 2026-07-09（updated 2026-09-10）

This fork is developed on a locked-down corporate Windows machine without administrator rights. Prefer portable tools and user-level environment variables.

## Baseline

- Project: `<repo>`（任意普通用户可写目录，包括含空格路径）
- Upstream base: `fathah/hermes-desktop` 0.7.3
- Node: `<portable-node>\node.exe` >=22.12.0（2026-09-10 clean-clone validation: 25.8.2）
- npm: `<portable-node>\npm.cmd` 11.11.1
- Electron: 43.4.1
- Native dependency: `better-sqlite3` 13.0.3

Use Node 22 explicitly in each PowerShell session:

```powershell
$env:PATH = "<portable-node>;$env:PATH"
$env:NODE_OPTIONS = "--use-system-ca"
$env:ELECTRON_CACHE = "$PWD\.cache\electron"
$env:npm_config_cache = "$PWD\.cache\npm"
```

## Dependency install notes

`better-sqlite3` and Electron both need prebuilt binaries. This environment must not fall back to `node-gyp` because Visual Studio C++ Build Tools are not available.

Use the repository installer instead of plain `npm ci` or `npm install`:

```powershell
npm.cmd run install:clean
```

This command performs a lockfile install with dependency lifecycle scripts disabled, runs Electron's official installer explicitly, and then opens an in-memory SQLite database under both Node.js and Electron. The explicit flow avoids an upstream Windows npm behavior where `better-sqlite3` 13.0.3 can invoke `node-gyp` even though the package already contains platform prebuilds.

All binary/cache artifacts remain under ignored dependency or cache directories. Do not commit `.cache/` or `node_modules/`, and do not copy either directory between clones.

## Verified commands

Run from the repository root (`<repo>`):

```powershell
$env:PATH = "<portable-node>;$env:PATH"
$env:NODE_OPTIONS = "--use-system-ca"
$env:ELECTRON_CACHE = "$PWD\.cache\electron"
$env:npm_config_cache = "$PWD\.cache\npm"

npm.cmd run install:clean
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run start
```

Latest verification:

- `npm.cmd test`: 154 test files passed, 1657 tests passed, 13 skipped.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed.
- `npm.cmd run start`: production build completed and Electron startup reached `starting electron app...`.
- Runtime smoke: Electron process starts from `node_modules\electron\dist\electron.exe`; current warning is GPU/cache creation permission noise, not a startup crash.

## Local test adaptations

Two test-only adaptations were added for this Windows environment:

- `tests/ssh-remote.test.ts` now skips POSIX shell execution tests when `bash` is unavailable, and uses `path.delimiter` when prepending a temporary shim path.
- `src/renderer/src/components/AgentMarkdown.test.tsx` mocks the syntax highlighter so Markdown rendering tests are deterministic under Vitest/JSDOM instead of depending on slow dynamic imports.
- `tests/cronjobs.test.ts` gives the cron create test an explicit 15s timeout because full-suite parallelism can exceed Vitest's 5s default.

No production runtime behavior was changed by these test adaptations.

## Security fixes landed locally

- `read-file` IPC now reads only the requested byte range with a 1 MB hard cap instead of reading the whole file before truncating.

The 2026-07-09 internal audit has been moved to controlled private archives. Current public security requirements and release gates are maintained in `docs/AGENTS_ONE_OPENSOURCE_RELEASE_READINESS_PRD_20260909.md`; the public disclosure policy will be published as `SECURITY.md` under OR-204/OR-602.

## Next integration work

1. Start `Agents-One` visibly and complete a manual smoke pass.
2. Configure remote Hermes NAS through the existing remote connection mode.
3. Verify `/health`, chat, sessions, memory, skills, and tools against the NAS.
4. Inspect OpenClaw's actual API shape and decide whether it enters as a Hermes tool, remote runtime adapter, or existing Claw3D/Hermes Office path.
5. Start the IPC/security audit before adding new agent dispatch capabilities.
