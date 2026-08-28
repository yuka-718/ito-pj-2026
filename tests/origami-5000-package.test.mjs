import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { foldToCp, selectPatterns, validateFold } from "../scripts/package-origami-fold-cp-5000.mjs";

const pack = JSON.parse(gunzipSync(await readFile("knowledge/origami-cp-world/patterns.pack.json.gz")));

test("selects exactly 5000 unique patterns deterministically", () => {
  const first = selectPatterns(pack.patterns, 5_000);
  const second = selectPatterns([...pack.patterns].reverse(), 5_000);
  assert.equal(first.length, 5_000);
  assert.deepEqual(first.map(({ id }) => id), second.map(({ id }) => id));
  assert.equal(new Set(first.map(({ id }) => id)).size, 5_000);
  assert.equal(new Set(first.map(({ canonical_sha256 }) => canonical_sha256)).size, 5_000);
});

test("all selected FOLD files pass structural validation", () => {
  for (const pattern of selectPatterns(pack.patterns, 5_000)) assert.equal(validateFold(pattern.fold), true);
});

test("CP conversion emits one Oriedita line per FOLD edge", () => {
  for (const pattern of selectPatterns(pack.patterns, 5_000)) {
    const dataLines = foldToCp(pattern).split("\n").filter((line) => line && !line.startsWith("#"));
    assert.equal(dataLines.length, pattern.fold.edges_vertices.length, pattern.id);
    for (const line of dataLines) assert.match(line, /^[0-3] -?\d+\.\d{10} -?\d+\.\d{10} -?\d+\.\d{10} -?\d+\.\d{10}$/);
  }
});

test("selected records never claim finished models or human verification", () => {
  for (const pattern of selectPatterns(pack.patterns, 5_000)) {
    assert.equal(pattern.license, "CC0-1.0");
    assert.notEqual(pattern.human_verified, true);
    assert.notEqual(pattern.is_finished_model, true);
    assert.notEqual(pattern.produces_named_finished_model, true);
  }
});
