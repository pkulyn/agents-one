# Agents One Alpha source status

This MIT-licensed source candidate is intended for development and community review. It is not a signed or stable binary release; repository visibility and the published commit must be checked independently of installer acceptance.

## Local OpenCode verification

The local ACP adapter separates the thirty-second handshake deadline from the Runtime task deadline, with a five-minute default for prompts. Cancellation gives the native agent up to five seconds to acknowledge tool shutdown before process cleanup, preserving its session identity.

Sixteen distinct automated ACP cases passed, including long prompts, delayed cancellation acknowledgement, configured deadlines and forced cleanup. Node and renderer typechecks and the local production build passed. A real OpenCode 1.18.27 check completed a controlled long task in about seventy seconds, cancelled a subsequent tool turn, then recalled a fresh random phrase without tools in the same native session. These checks exercise the actual desktop adapter; they do not claim a new packaged UI or clean-machine acceptance.

## Windows desktop and taskbar icon

An afterPack hook embeds the existing nine-size rainbow-ring ICO into the Windows main executable while preserving other PE resources and the unsigned-build policy. Three focused tests and a local unpacked package passed; the native Windows Shell extracted the rainbow ring from the resulting executable. Previously installed binaries and cached pinned items require a new installation or shortcut refresh before they reflect the fix.

## Remote Hermes limitation

Remote Hermes conversation recall and restart continuation failed in the existing independent candidate test. Its deployed Connector and Hermes version are currently unavailable for inspection, so this integration remains experimental and is not certified to preserve multi-turn context.

SDK 0.1.5 exposes `sessionId`; absence of a different field named `providerSessionId` is not evidence that a native session was omitted. The integration must keep per-turn run identity separate from the native transcript session and restore that mapping after restart. Ordinary answers or tool retrieval of a saved report do not establish short-term conversation recall.

## Scope and license

The candidate includes the existing continuation fixes, the local ACP deadline and cancellation patch, and repository documentation and license notices. Unrelated uncommitted desktop UI, tray, web Provider and website work are outside this candidate.

The licensor-owned Agents One contributions in this candidate are offered under MIT. The inherited hermes-desktop author's MIT notice and the Oxanium font license remain in THIRD_PARTY_NOTICES.md and its linked font notice. Third-party dependencies and assets keep their own terms. The former noncommercial evaluation permission has been removed from the current source and package notice list; historical copies retain the terms under which they were received.

The [mobile and macOS PRD](AGENTS_ONE_MOBILE_MAC_DEVELOPMENT_PRD_20261003.md) defines future work, not available applications or accepted release assets.

The source publication decision is separate from binary acceptance. No new installer, tag, public Release or stable-runtime claim is included in this preparation.

## 后续边界

本次准备公开的是 Alpha 开发源码，已有实测通过项保留。远程 Hermes 的短期记忆与重启续接仍是已知问题，取得真实 Connector 和版本后只复测受影响路径，不重新开始全部验收。
