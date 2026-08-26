# Open FOLD search catalog

This catalog contains metadata and immutable raw-file URLs, not copied third-party
FOLD payloads. The local API fetches one matching file on demand, validates its
basic FOLD structure, and exposes the source URL, author, and license with the
result. A public URL without a verified repository license is never cataloged.

Registered sources:

| Source | Scope | License |
| --- | --- | --- |
| [origamimagiro/flat-folder](https://github.com/origamimagiro/flat-folder) | 366 authorized example FOLD files | MIT |
| [rabbit-ear/rabbit-ear](https://github.com/rabbit-ear/rabbit-ear) | repository test/example FOLD files | GPL-3.0 |
| [osbo/rigid-origami](https://github.com/osbo/rigid-origami) | bundled FOLD patterns | MIT |
| [edemaine/fold](https://github.com/edemaine/fold) | canonical FOLD examples | MIT |
| [maciekmm/origami](https://github.com/maciekmm/origami) | bundled model and Origuide FOLD files | GPL-3.0 |
| [dozingpip/origami-db](https://github.com/dozingpip/origami-db) | database FOLD files | GPL-3.0 |

`catalog.json` pins every source to an immutable Git commit. Run
`node scripts/build-finished-model-catalog.mjs` to rebuild it from those pinned
trees. Upstream foldability remains unverified unless the local Oriedita pipeline
successfully processes the selected file.

License texts and copyright notices remain available from each immutable
`source_url` and its repository root. The API must keep `sourceUrl`, `author`,
and `license` in any public search result.
