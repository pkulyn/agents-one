# Mobile and macOS roadmap

Agents One will extend its conversation workspace through a versioned mobile contract before delivering Android, iOS, native HarmonyOS, and macOS clients.

## Mobile trust boundary

A phone is an independently paired client of explicitly authorized remote Runtimes, not a copy of the desktop process or its credentials.

The first mobile release uses [[remote-cli-host#Shared Gateway and Runtime routing|Gateway routing]] and a new device-scoped identity. It must preserve stable Runtime and conversation identities, durable event cursor recovery, and explicit revocation. Existing desktop-local history and project files stay local unless the user opts into a separately validated sync path. Workspace Grants remain bounded per run.

## Platform order and evidence

Each platform ships only after its own real-device conversation, restart, cancellation, identity, privacy, and package checks.

The implementation order is a common contract, Android, iOS, HarmonyOS 5+ native, then macOS desktop. A HarmonyOS build probe begins during Android work, and a Mac/Xcode environment is needed before iOS acceptance even though the desktop Mac release comes later. See [the mobile and macOS PRD](../docs/AGENTS_ONE_MOBILE_MAC_DEVELOPMENT_PRD_20261003.md) for work packets and acceptance gates.
