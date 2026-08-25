import assert from "node:assert/strict";
import test from "node:test";

import {
  loadKnowledgePack,
  retrieveKnowledge,
  searchKnowledge,
} from "../local-oriedita/knowledge-search.mjs";

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

test("ranks explicit structural parameters instead of matching arbitrary digits", () => {
  assert.equal(searchKnowledge(pack, "次数10の単頂点")?.params.degree, 10);
  assert.deepEqual(
    {
      rows: searchKnowledge(pack, "8×6のミウラ折り")?.params.rows,
      cols: searchKnowledge(pack, "8×6のミウラ折り")?.params.cols,
    },
    { rows: 8, cols: 6 },
  );
  const radial = searchKnowledge(pack, "12本放射・2層のフラッシャー");
  assert.equal(radial?.params.rays, 12);
  assert.equal(radial?.params.levels, 2);
});

test("retrieves diverse structural references without replacing a rabbit with a corpus pattern", () => {
  const matches = retrieveKnowledge(pack, "耳の長いうさぎ");
  assert.deepEqual(matches.map(({ matchKind }) => matchKind), [
    "structural_reference",
    "structural_reference",
    "structural_reference",
  ]);
  assert.equal(matches[0].pattern.id, "reference_12_blintz_precrease");
  assert.equal(matches[2].pattern.id, "boxpleat_n08_v0_p0");
  assert.equal(matches[1].pattern.params.degree, 8);
  assert.equal(new Set(matches.map(({ pattern }) => pattern.family)).size, 3);

  const theoremRabbit = retrieveKnowledge(pack, "川崎定理を使ったうさぎ");
  assert.equal(theoremRabbit[0].matchKind, "structural_reference");
  assert.equal(theoremRabbit[0].pattern.params.degree, 8);
});
