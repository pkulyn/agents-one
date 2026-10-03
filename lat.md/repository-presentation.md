# Repository presentation and licensing

The repository homepage introduces Agents One through its actual desktop experience and states the license boundaries before a reader downloads or modifies the product.

## Bilingual README story

The English and Chinese homepages follow the same sequence and use actual product visuals to explain Agents One.

`README.md` and `README.zh-CN.md` share the order of product promise, development-build proof, core workflow, first-use path, trust boundaries, and license. Their SVG heroes reuse the Dawn Ring wordmark and depict local and remote agents converging on one workspace. The full original startup image and the existing chat screenshot provide visual proof; UI details may change before release.

## MIT license and inherited notices

Original Agents One contributions use MIT while inherited code, fonts, dependencies, and historical permissions remain identifiable.

The root `LICENSE` covers licensor-owned Agents One contributions. `THIRD_PARTY_NOTICES.md` retains the inherited hermes-desktop author's MIT notice and links to the Oxanium OFL notice; dependencies and other assets keep their own licenses. README and contribution guidance state the current MIT grant without rewriting historical copies or upstream authorship.

`electron-builder.yml` copies the current MIT license, inherited MIT notice, and Oxanium font notice into packaged `resources/notices` so binary recipients can inspect the applicable terms.

## Alpha source publication boundary

Publishing development source and certifying a Windows installer are separate decisions with explicit evidence and known integration limits.

Both READMEs link the public known issues. Local OpenCode deadline and cancellation checks establish the adapter's tested behavior; remote Hermes transcript continuation remains experimental until its actual Connector contract is verified. The public README does not claim a replacement packaged UI, signed installer, or stable binary release.

## Dependency audit gate

CI blocks new high or critical advisories and records one narrow exception for an unpatched development-only builder dependency.

The gate checks production dependencies independently, then checks the full graph. It accepts only GHSA-ch52-4w7c-c8xp through the known electron-builder chain while the registry has no patched http-cache-semantics version. A new advisory, affected package, or production path fails the gate. Remove the exception when upstream releases a fix.

## Public documentation boundary

Public documentation covers supported usage, integration contracts and safe contributions; internal requirements, future plans and development evidence remain private.

`docs/` uses a default-deny Git ignore policy. `.github/public-documents.json` explicitly lists permitted Markdown and documentation files; `scripts/check-public-documents.mjs` validates the tracked tree in CI. Local skills, agent settings and internal planning records are excluded. Necessary architecture and test specifications remain linked to source through lat.
