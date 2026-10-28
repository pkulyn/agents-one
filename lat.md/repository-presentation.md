# Repository presentation and licensing

The repository homepage introduces Agents One through its actual desktop experience and states the license boundaries before a reader downloads or modifies the product.

## Bilingual README story

The English and Chinese homepages follow the same sequence and use actual product visuals to explain Agents One.

The hero and introduction describe AI agent management and collaboration, with conversations, tasks, collaboration and artifacts; local agent examples include Pi Agent, Codex, Claude Code and OpenCode alongside remote Gateway agents.

`README.md` and `README.zh-CN.md` share the order of product promise, development-build proof, core workflow, first-use path, trust boundaries, and license. Their SVG heroes reuse the Dawn Ring wordmark and depict local and remote agents converging on one workspace. The full original startup image and the existing chat screenshot provide visual proof; UI details may change between releases.

## Installation and connection guidance

Both READMEs explain verified Windows downloads, SmartScreen, local CLI prerequisites, remote Gateway/Connector/Connect deployment and independent Android Owner pairing.

The guide distinguishes released packages from main-branch improvements, links the Android debug prerelease and its checksum, and separates remote-agent pairing credentials from mobile Owner management keys. Detailed mobile provisioning remains in the already-public Connect README; private deployment configuration and acceptance evidence are not linked or published.

## MIT license and inherited notices

Original Agents One contributions use MIT while inherited code, fonts, dependencies, and historical permissions remain identifiable.

The root `LICENSE` covers licensor-owned Agents One contributions. `THIRD_PARTY_NOTICES.md` retains the inherited hermes-desktop author's MIT notice and links to the Oxanium OFL notice; dependencies and other assets keep their own licenses. README and contribution guidance state the current MIT grant without rewriting historical copies or upstream authorship.

`electron-builder.yml` copies the current MIT license, inherited MIT notice, and Oxanium font notice into packaged `resources/notices` so binary recipients can inspect the applicable terms.

## Release and source publication boundary

Publishing development source and certifying a Windows installer are separate decisions with explicit evidence and known integration limits.

Both READMEs link the public known issues. Local OpenCode deadline and cancellation checks establish the adapter's tested behavior; remote Hermes transcript continuation remains experimental until its actual Connector contract is verified. The README identifies Windows 0.1.0 as the published binary and separates later main-branch fixes from those immutable assets. Android 0.1.13-dev-debug is distributed separately as a debuggable prerelease with its own source identity and checksum; it does not change the Windows release.

## Dependency audit gate

CI blocks high or critical advisories in both production dependencies and the full dependency graph.

The gate checks production dependencies independently, then checks the full graph. Historical dependency exceptions do not waive a new candidate audit; unavailable or malformed results also fail the gate.

## Public documentation boundary

Public documentation covers supported usage, integration contracts and safe contributions; internal requirements, future plans and development evidence remain private.

`docs/` uses a default-deny Git ignore policy. `.github/public-documents.json` explicitly lists permitted Markdown and documentation files; `scripts/check-public-documents.mjs` validates the tracked tree in CI. Local skills, agent settings and internal planning records are excluded. Necessary architecture and test specifications remain linked to source through lat.

## Private specification boundary

Public source and tests are self-contained. Local execution plans, device acceptance records and private architecture specifications stay outside the repository and are not required to build or test a clean checkout.

## Generated contract checkout consistency

Generated JSON and Kotlin contract files retain LF bytes even when Git core.autocrlf is enabled. Fresh Windows checkouts must pass the same exact generation check as other hosts.

A regression exports the tracked files with real Git checkout-index and compares them to index bytes; schema or fixture changes still require regeneration.

## Portable development fixtures

Public tests use reserved example endpoints and generic project names. Screenshot tests write to the Java temporary directory; developer launch/build scripts take tool locations from explicit arguments or standard user environment settings.

The desktop launcher accepts an optional NodePath and otherwise uses PATH. Android builds accept explicit portable tool paths or JAVA_HOME, ANDROID_SDK_ROOT/ANDROID_HOME, GRADLE_USER_HOME and GRADLE_HOME; no machine-specific drive layout is required. These choices do not migrate application configuration or change packaged Runtime behavior.

## Generated Android build output

Repository lint and formatting gates exclude Gradle build and cache directories. Generated reports are not authored JavaScript or HTML and must not change source quality results after Android tests run.

The exclusion is limited to Android build/cache output; Android source, development scripts and tracked contract inputs remain subject to the existing checks.
