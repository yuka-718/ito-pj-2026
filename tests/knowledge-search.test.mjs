import assert from "node:assert/strict";
import test from "node:test";

import { loadKnowledgePack, searchKnowledge } from "../local-oriedita/knowledge-search.mjs";

const pack = await loadKnowledgePack();

test("loads the bundled CC0 origami knowledge pack", () => {
  assert.equal(pack.patternCount, 2157);
  assert.equal(pack.patterns.length, 2157);
  assert.equal(
    pack.patterns.some(({ fold }) => Object.keys(fold).some((key) => key.startsWith("metadata_"))),
    false,
  );
});

test("finds registered structural patterns from Japanese prompts", () => {
  assert.equal(searchKnowledge(pack, "ミウラ折りの構造")?.family, "miura_like");
  assert.equal(searchKnowledge(pack, "水爆折りのテセレーション")?.family, "waterbomb_tessellation");
  assert.equal(searchKnowledge(pack, "川崎定理を使った単頂点")?.family, "single_vertex_kawasaki");
});

test("does not pretend an unrelated animal exists in the knowledge corpus", () => {
  assert.equal(searchKnowledge(pack, "耳の長いうさぎ"), null);
});
