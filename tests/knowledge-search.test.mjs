import assert from "node:assert/strict";
import test from "node:test";

import {
  loadKnowledgePack,
  materializeKnowledgePattern,
  parseStructuralIntent,
  retrieveKnowledge,
  retrieveStructuralKnowledge,
  searchKnowledge,
  selectStructuralCorpus,
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
  const generic = retrieveStructuralKnowledge(pack, "存在しない架空モチーフxyzxyz");
  assert.ok(generic.length >= 1 && generic.length <= 3);
  assert.equal(generic.every(({ matchKind }) => matchKind === "structural_reference"), true);
});

test("searches the same deterministic 5,000-pattern corpus as the downloadable archive", () => {
  const selected = selectStructuralCorpus(pack, 5_000);
  const reversed = selectStructuralCorpus({ patterns: [...pack.patterns].reverse() }, 5_000);
  assert.equal(selected.length, 5_000);
  assert.deepEqual(selected.map(({ id }) => id), reversed.map(({ id }) => id));
  const selectedIds = new Set(selected.map(({ id }) => id));
  for (const prompt of ["鶴", "うさぎ", "金魚", "カブトムシ", "宇宙船"]) {
    const matches = retrieveStructuralKnowledge(pack, prompt, { limit: 12, corpusSize: 5_000 });
    assert.equal(matches.every(({ pattern }) => selectedIds.has(pattern.id)), true);
    assert.equal(new Set(matches.map(({ pattern }) => pattern.id)).size, matches.length);
    assert.equal(new Set(matches.map(({ pattern }) => pattern.canonical_sha256)).size, matches.length);
  }
});

test("structural similarity ranking is deterministic and keeps inspectable score components", () => {
  for (const prompt of ["翼を広げた鶴", "耳の長いうさぎ", "尾びれの大きい金魚", "角の大きいカブトムシ"]) {
    const first = retrieveStructuralKnowledge(pack, prompt);
    const second = retrieveStructuralKnowledge(pack, prompt);
    assert.deepEqual(
      first.map(({ pattern, score, scoreBreakdown, reason }) => ({ id: pattern.id, score, scoreBreakdown, reason })),
      second.map(({ pattern, score, scoreBreakdown, reason }) => ({ id: pattern.id, score, scoreBreakdown, reason })),
    );
    assert.ok(first.length >= 1 && first.length <= 3);
    for (const match of first) {
      const componentTotal = Object.values(match.scoreBreakdown).reduce((sum, value) => sum + value, 0);
      assert.ok(Math.abs(componentTotal - match.score) < 0.02);
      assert.equal(match.corpus.searchedPatternCount, 5_000);
      assert.equal(match.requiresOrieditaValidation, true);
    }
    assert.deepEqual(first.map(({ score }) => score), [...first.map(({ score }) => score)].sort((a, b) => b - a));
  }
});

test("Japanese design constraints influence the selected structural parameters", () => {
  const flowerIntent = parseStructuralIntent("8枚の花びら");
  assert.equal(flowerIntent.preferred[0].family, "radial_flasher_like");
  assert.equal(flowerIntent.preferred[0].params.rays, 8);

  const roof = retrieveStructuralKnowledge(pack, "6×9の折板屋根", { limit: 12 });
  assert.equal(roof.some(({ pattern }) => pattern.params.rows === 6 && pattern.params.cols === 9), true);

  const towerIntent = parseStructuralIntent("12階の円筒タワー");
  assert.equal(towerIntent.preferred[0].family, "kresling_like");
  assert.equal(towerIntent.preferred[0].params.levels, 12);
  const tower = retrieveStructuralKnowledge(pack, "12階の円筒タワー", { limit: 3 });
  assert.equal(tower.every(({ requiresOrieditaValidation }) => requiresOrieditaValidation), true);
});

test("explicit supported families reach Oriedita validation instead of being prefiltered to square", () => {
  for (const [prompt, family] of [
    ["フラッシャー", "radial_flasher_like"],
    ["クレスリング", "kresling_like"],
  ]) {
    const matches = retrieveStructuralKnowledge(pack, prompt, { limit: 12 });
    assert.ok(matches.length >= 1 && matches.length <= 12, prompt);
    assert.equal(matches.every(({ pattern }) => pattern.family === family), true, prompt);
    assert.equal(matches.every(({ requiresOrieditaValidation }) => requiresOrieditaValidation), true, prompt);
    assert.equal(matches.every(({ requiresModifiabilitySmokeTest }) => requiresModifiabilitySmokeTest), true, prompt);
  }
});

test("the Oriedita validation pool is family-diverse and retains safe data-derived fallbacks", () => {
  const pool = retrieveStructuralKnowledge(pack, "鶴", { limit: 12 });
  const familyCounts = Object.groupBy(pool, ({ pattern }) => pattern.family);
  assert.equal(Math.max(...Object.values(familyCounts).map((matches) => matches.length)), 2);
  assert.equal(pool.some(({ pattern, validationFallback }) =>
    pattern.family === "accordion_pleats" && validationFallback === true), true);
  assert.equal(pool.some(({ pattern }) => pattern.id === "sv_d08_s0000"), false);
  assert.equal(pool.some(({ pattern }) =>
    pattern.family === "single_vertex_kawasaki"
    && pattern.params.degree === 8
    && pattern.source === "Origami Search Additional 3000 2026-08-27"), true);
  assert.equal(pool.every(({ pattern }) => pattern.is_finished_model !== true), true);
});

test("known motifs retain capacity-matched references without predeclaring modifiability", () => {
  for (const [prompt, count] of [["鶴", 8], ["うさぎ", 8], ["金魚", 6], ["カブトムシ", 12]]) {
    const pool = retrieveStructuralKnowledge(pack, prompt, { limit: 12 });
    const capacityReference = pool.find(({ pattern }) =>
      pattern.family === "accordion_pleats" && pattern.params.count === count);
    assert.ok(capacityReference, prompt);
    assert.equal(capacityReference.validationFallback, false, prompt);
    assert.equal(capacityReference.requiresModifiabilitySmokeTest, true, prompt);
    assert.equal("incrementalModificationReady" in capacityReference, false, prompt);
    const fallback = pool.find(({ validationFallback }) => validationFallback);
    assert.ok(fallback, prompt);
    assert.equal(fallback.pattern.family, "accordion_pleats", prompt);
    assert.ok(fallback.pattern.params.count <= 3, prompt);
    assert.equal(fallback.requiresModifiabilitySmokeTest, true, prompt);
    assert.equal("incrementalModificationReady" in fallback, false, prompt);
    assert.ok(pool.indexOf(capacityReference) < pool.indexOf(fallback), prompt);
  }
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
