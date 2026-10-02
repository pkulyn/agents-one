# Repository presentation and licensing

The repository homepage introduces Agents One through its actual desktop experience and states the license boundaries before a reader downloads or modifies the product.

## Bilingual README story

The English and Chinese homepages follow the same sequence and use actual product visuals to explain Agents One.

`README.md` and `README.zh-CN.md` share the order of product promise, development-build proof, core workflow, first-use path, trust boundaries, and license. Their SVG heroes reuse the Dawn Ring wordmark and depict local and remote agents converging on one workspace. The full original startup image and the existing chat screenshot provide visual proof; UI details may change before release.

## Noncommercial license boundary

New Agents One contributions use PolyForm Noncommercial 1.0.0 while inherited and historical permissions remain identifiable.

The root `LICENSE` covers licensor-owned Agents One contributions. `THIRD_PARTY_NOTICES.md` retains the inherited hermes-desktop MIT notice; dependencies and other assets keep their own licenses. Earlier MIT grants remain valid for copies received under those terms. README and contribution guidance say source-available rather than OSI-defined open source because commercial use of new contributions is restricted.

`COMMERCIAL_EVALUATION_PERMISSION.md` grants commercial organizations unlimited-duration internal evaluation and research of licensor-owned contributions, including internal test modifications. It excludes production operations, access by other legal entities, external distribution, and white-label promotion. Contributor guidance requests both grants for new original contributions.

`electron-builder.yml` copies the current license, commercial evaluation permission, inherited MIT notice, and Oxanium font notice into packaged `resources/notices` so binary recipients can inspect the same terms.

## Alpha source publication boundary

Publishing development source and certifying a Windows installer are separate decisions with explicit evidence and known integration limits.

Both READMEs link the Alpha source status and known issues. Local OpenCode deadline and cancellation checks establish the adapter's tested behavior; remote Hermes transcript continuation remains experimental until its actual Connector contract is verified. The source status does not claim a replacement packaged UI, signed installer, or stable binary release.
