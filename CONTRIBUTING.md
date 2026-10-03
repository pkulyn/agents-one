# Contributing to Agents One

Thanks for your interest in contributing to Agents One! Whether it's a bug fix, a new feature, improved docs, or just a typo — every contribution helps.

## Languages

- English: `CONTRIBUTING.md`
- 简体中文: `CONTRIBUTING.zh-CN.md`

## Getting Started

1. **Fork** the repository and clone your fork locally.
2. Install Node.js 24 or newer. On managed Windows machines without administrator access, use the official portable ZIP, extract it to a user-writable folder, and add that folder to the user-level `PATH`; no system service, driver, Visual Studio, or global npm package is required. Node 24 is required because the test and fallback database path imports the built-in `node:sqlite` module.
3. **Install dependencies from the lockfile:**

   ```bash
   npm run install:clean
   ```

   This reproducible installer uses the lockfile, installs Electron explicitly,
   and verifies SQLite under both Node.js and Electron without requiring a local
   C++ build toolchain.

4. **Start the app in development mode:**

   ```bash
   npm run dev
   ```

## Making Changes

1. Create a new branch from `main`:

   ```bash
   git checkout -b your-branch-name
   ```

2. Make your changes. Keep commits focused — one logical change per commit.

3. Run the same checks used by the release gate before submitting:

   ```bash
   npm run format:check
   npm run typecheck
   npm run lint -- --no-cache --quiet
   npm run test:all
   npm audit --audit-level=high
   npm run build
   ```

4. Test your changes locally with `npm run dev` to make sure everything works as expected.

## Submitting a Pull Request

1. Push your branch to your fork.
2. Open a pull request against `main` on the upstream repo.
3. Write a clear description of what you changed and why.
4. If your PR addresses an open issue, reference it (e.g., `Fixes #42`).

### Keep Pull Requests Small

Please keep PRs small and focused — they are much easier to review and merge. PRs that touch too many files or bundle unrelated changes will likely be asked for splitting up or may not be accepted.

- Stick to one logical change per PR (one fix, one feature, one refactor).
- If you find yourself touching many unrelated files, split the work into multiple PRs.
- Avoid bundling formatting/style sweeps with functional changes.
- Smaller PRs get reviewed and merged faster.

A maintainer will review your PR and may request changes. Once approved, it will be merged.

## Reporting Bugs

Found a bug? [Open an issue](https://github.com/pkulyn/agents-one/issues/new) with:

- A clear title and description.
- Steps to reproduce the issue.
- What you expected to happen vs. what actually happened.
- Your OS and app version, if relevant.

## Requesting Features

Have an idea? [Open an issue](https://github.com/pkulyn/agents-one/issues/new) and describe:

- The problem you're trying to solve.
- How you'd like it to work.
- Any alternatives you've considered.

## Project Structure

```text
src/main/                Electron main process, IPC handlers, Runtime integrations
src/preload/             Secure renderer bridge
src/renderer/src/        React app and UI components
resources/               App icons and packaged assets
build/                   Packaging resources
```

## Code Style

- The project uses TypeScript, React, and Electron.
- Run `npm run lint` to check for lint errors.
- Run `npm run format:check` to verify repository formatting.
- Run `npm run typecheck` to verify type safety.
- Run `npm run test:all` to test the desktop and all three subprojects.
- Follow existing patterns and conventions in the codebase.

## Community

- Use [GitHub Issues](https://github.com/pkulyn/agents-one/issues) for bugs and feature requests.
- Read the project README for the current architecture, supported Runtimes, and development workflow.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md), [Security Policy](SECURITY.md), and [known release limitations](KNOWN_ISSUES.md).

## License

By contributing original material to Agents One, you agree to license that contribution under the [MIT License](LICENSE) while retaining your own copyright. Only contribute material you have the right to license under MIT. Identify any third-party material and retain its existing license and notices; inherited `hermes-desktop` material keeps its original author's MIT notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
