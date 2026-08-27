# ORIAI structural knowledge pack

`patterns.pack.json.gz` contains 5,157 CC0 crease-pattern structures:

- 2,157 patterns from Origami CP World Collection 2026-08-24
- 3,000 patterns from Origami Search Additional 3000 2026-08-27

The additional records include FOLD geometry and machine-generated crease activation order. They are structural references for search and candidate generation, not named finished models or human-verified folding instructions. They do not contain folded-state meshes or verified 3D models.

The archive's separate 565-record external registry is not embedded in this pack. It contains remote pointers with per-source licenses rather than bundled FOLD data; those models must be resolved, attributed, and validated independently before entering the finished-model library.

Rebuild the merged pack from an extracted additional-data directory:

```bash
npm run knowledge:import-additional -- /absolute/path/to/origami_search_additional_3000_2026-08-27
```

The importer rejects duplicate IDs and semantic hashes, non-CC0 primary records, malformed FOLD documents, and activation sequences that claim human or finished-model verification.
