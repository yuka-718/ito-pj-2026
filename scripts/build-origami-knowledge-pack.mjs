#!/usr/bin/env node

import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const inputRoot = resolve(process.argv[2] ?? "knowledge/origami-cp-world");
const outputPath = resolve(process.argv[3] ?? "knowledge/origami-cp-world/patterns.pack.json.gz");
const metadataPath = resolve(inputRoot, "metadata", "patterns.jsonl");
const lines = (await readFile(metadataPath, "utf8")).split("\n").filter(Boolean);
const patterns = [];

function makeOrieditaCompatible(fold) {
  return Object.fromEntries(
    Object.entries(fold).filter(([key]) => !key.startsWith("metadata_")),
  );
}

for (const line of lines) {
  const metadata = JSON.parse(line);
  const foldPath = resolve(inputRoot, metadata.fold_path);
  if (!foldPath.startsWith(`${inputRoot}/`)) throw new Error(`Unsafe fold path: ${metadata.fold_path}`);
  const fold = makeOrieditaCompatible(JSON.parse(await readFile(foldPath, "utf8")));
  patterns.push({ ...metadata, fold });
}

const payload = JSON.stringify({
  format: "ori-ai-knowledge-pack-v1",
  source: "Origami CP World Collection 2026-08-24",
  license: "CC0-1.0",
  patternCount: patterns.length,
  patterns,
});

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, gzipSync(payload, { level: 9, mtime: 0 }));
process.stdout.write(`${patterns.length} patterns -> ${outputPath}\n`);
