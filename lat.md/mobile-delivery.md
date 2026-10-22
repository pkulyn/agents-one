# Mobile delivery

Desktop and Android delivery gates distinguish package verification from actual loaded resources and device acceptance.

## Imported Main resource verification

Windows packaging verifies the Main chunk actually imported by index.js contains independent ledger and transport workers plus the conversation, schedule and artifact read scopes. Unused leftover chunks cannot satisfy the gate.

`scripts/verify-mobile-resource.mjs` rejects an old imported implementation before the Windows icon hook finishes packaging. Current resource replacement still requires normal exit, a verified latest data backup and actual loaded-path verification.

## Current cutover acceptance

A current resource replacement requires the actual imported Main, independent sync processes, original profile and existing pairing to pass verification.

Windows diagnostic launches preserve APPDATA and LOCALAPPDATA to resolve the same profile.

Desktop loading and short Owner ACK observation are separate from phone installation, cross-network workflows and long-running stability acceptance. Candidate resources and the previous backup rotation are removed only after actual loading passes.
