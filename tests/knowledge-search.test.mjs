import assert from "node:assert/strict";
import test from "node:test";

import {
  loadKnowledgePack,
  materializeKnowledgePattern,
  retrieveKnowledge,
  retrieveStructuralKnowledge,
  searchKnowledge,
} from "../local-oriedita/knowledge-search.mjs";

const pack = await loadKnowledgePack();

test("loads the bundled CC0 origami knowledge pack", () => {
  assert.equal(pack.patternCount, 5157);
  assert.equal(pack.patterns.length, 5157);
  assert.equal(pack.finishedModelCount, 486);
  assert.equal(pack.finishedModels.length, 486);
  assert.equal(pack.finishedModelSources.length, 6);
  assert.equal(
    pack.patterns.some(({ fold }) => Object.keys(fold).some((key) => key.startsWith("metadata_"))),
    false,
  );
});

test("retrieves structural priors without treating them as finished works", () => {
  for (const prompt of ["鶴", "うさぎ", "金魚", "カブトムシ"]) {
    const matches = retrieveStructuralKnowledge(pack, prompt);
    assert.ok(matches.length >= 1 && matches.length <= 3);
    assert.equal(matches.every(({ matchKind }) => matchKind === "structural_reference"), true);
    assert.equal(matches.every(({ pattern }) => pattern.is_finished_model !== true), true);
    assert.equal(matches.every(({ pattern }) => pattern.fold && pattern.frame_classes?.[0] !== "foldedForm"), true);
  }
  assert.deepEqual(retrieveStructuralKnowledge(pack, "存在しない架空モチーフxyzxyz"), []);
});

test("loads the additional CC0 structural corpus without treating it as finished models", () => {
  const additional = pack.patterns.filter(({ source }) => source === "Origami Search Additional 3000 2026-08-27");
  assert.equal(additional.length, 3000);
  assert.equal(additional.every(({ human_verified }) => human_verified === false), true);
  assert.equal(additional.every(({ is_finished_model }) => is_finished_model === false), true);
  assert.equal(additional.every(({ activation_sequence }) => activation_sequence?.human_verified === false), true);
  assert.equal(searchKnowledge(pack, "次数22の単頂点")?.params.degree, 22);
  assert.equal(searchKnowledge(pack, "アコーディオン30本")?.params.count, 30);
  assert.equal(searchKnowledge(pack, "32本のファンプリーツ")?.params.rays, 32);
  assert.deepEqual(
    {
      rows: searchKnowledge(pack, "13×18のヘリンボーン")?.params.rows,
      cols: searchKnowledge(pack, "13×18のヘリンボーン")?.params.cols,
    },
    { rows: 13, cols: 18 },
  );
});

test("finds registered structural patterns from Japanese prompts", () => {
  assert.equal(searchKnowledge(pack, "ミウラ折りの構造")?.family, "miura_like");
  assert.equal(searchKnowledge(pack, "水爆折りのテセレーション")?.family, "waterbomb_tessellation");
  assert.equal(searchKnowledge(pack, "川崎定理を使った単頂点")?.family, "single_vertex_kawasaki");
});

test("finds semantic models in the open FOLD library", () => {
  const crane = retrieveKnowledge(pack, "鶴")[0];
  assert.equal(crane.matchKind, "exact");
  assert.equal(crane.pattern.family, "crane");
  assert.match(crane.pattern.title, /crane/i);
  assert.equal(crane.pattern.source_kind, "remote_open_fold");

  const rabbit = retrieveKnowledge(pack, "耳の長いうさぎ")[0];
  assert.equal(rabbit.matchKind, "exact");
  assert.equal(rabbit.pattern.family, "rabbit");
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

test("falls back to structural references when requested semantics do not exist", () => {
  const matches = retrieveKnowledge(pack, "9つの頭の竜");
  assert.deepEqual(matches.map(({ matchKind }) => matchKind), [
    "structural_reference",
    "structural_reference",
    "structural_reference",
  ]);
  assert.equal(matches[0].pattern.family, "box_pleat");
  assert.equal(new Set(matches.map(({ pattern }) => pattern.family)).size, 3);

  const theoremRabbit = retrieveKnowledge(pack, "川崎定理を使ったうさぎ");
  assert.equal(theoremRabbit[0].matchKind, "structural_reference");
  assert.equal(theoremRabbit[0].pattern.params.degree, 8);
});

test("matches an available head count but does not substitute a different dragon", () => {
  const threeHeaded = retrieveKnowledge(pack, "3つの頭の竜")[0];
  assert.equal(threeHeaded.matchKind, "exact");
  assert.equal(threeHeaded.pattern.head_count, 3);
  assert.match(threeHeaded.pattern.title, /three headed dragon/i);
  assert.notEqual(retrieveKnowledge(pack, "9つの頭の竜")[0].matchKind, "exact");
});

test("materializes a registered remote FOLD with an injectable fetch implementation", async () => {
  const registered = retrieveKnowledge(pack, "鶴")[0].pattern;
  const fold = {
    file_spec: 1.2,
    vertices_coords: [[0, 0], [1, 0]],
    edges_vertices: [[0, 1]],
    edges_assignment: ["B"],
  };
  const materialized = await materializeKnowledgePattern(registered, {
    fetchImpl: async () => new Response(JSON.stringify(fold), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  });
  assert.deepEqual(materialized.fold.vertices_coords, fold.vertices_coords);
  assert.equal(materialized.source_url, registered.source_url);
});
