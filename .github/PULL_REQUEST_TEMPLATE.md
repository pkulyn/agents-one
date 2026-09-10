## What changed and why

<!-- Describe one focused change and the user/developer outcome. -->

## Scope and compatibility

<!-- List affected runtimes, IPC/protocol surfaces, stored data, operating systems, and intentional non-goals. -->

## Safety and rollback

<!-- Explain credential, workspace, artifact, migration, and rollback implications. Write "No change" where appropriate. -->

## Verification

- [ ] `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm run lint -- --no-cache --quiet`
- [ ] Relevant focused tests
- [ ] `npm run test:all` when the change affects shared/release behavior
- [ ] `npm audit --audit-level=high` when dependencies change
- [ ] `npm run build`
- [ ] Documentation, `lat.md`, and known issues updated where applicable

## Screenshots or artifacts

<!-- Add reviewed, redacted evidence for visual or packaged behavior. Never attach credentials or private user data. -->

## Related issues

<!-- Example: Fixes #123 -->
