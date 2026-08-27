import assert from "node:assert/strict";
import test from "node:test";

import {
  loadOrigamiSearchCatalog,
  searchOrigamiWorks,
  selectOrigamiReferenceImages,
} from "../local-oriedita/origami-search-retriever.mjs";

const catalog = await loadOrigamiSearchCatalog();

for (const prompt of ["鶴", "うさぎ", "金魚", "カブトムシ"]) {
  test(`${prompt} returns three to five Origami Search references`, () => {
    const matches = searchOrigamiWorks(catalog, prompt);
    assert.ok(matches.length >= 3 && matches.length <= 5);
    assert.equal(new Set(matches.map(({ id }) => id)).size, matches.length);
    assert.equal(new Set(matches.map(({ title }) => title.toLowerCase())).size, matches.length);
    for (const match of matches) {
      assert.equal(typeof match.source_url, "string");
      assert.equal(typeof match.reason, "string");
      assert.equal(Number.isFinite(match.score), true);
      assert.ok("creator" in match);
    }
  });
}

test("the same Japanese prompt has a deterministic rank order", () => {
  const first = searchOrigamiWorks(catalog, "翼を広げた鶴").map(({ id, score }) => ({ id, score }));
  const second = searchOrigamiWorks(catalog, "翼を広げた鶴").map(({ id, score }) => ({ id, score }));
  assert.deepEqual(first, second);
});

test("selects representative and folding images without exceeding eight", async () => {
  const works = searchOrigamiWorks(catalog, "鶴");
  const images = await selectOrigamiReferenceImages(catalog, works, {
    maximum: 8,
    exists: async () => true,
  });
  assert.equal(images.length, 8);
  assert.equal(new Set(images.map(({ local_path }) => local_path)).size, images.length);
  assert.ok(images.some(({ role }) => role === "representative"));
  assert.ok(images.some(({ role }) => role === "folding_structure"));
});

test("unknown motifs can continue without retrieved works", () => {
  assert.deepEqual(searchOrigamiWorks(catalog, "存在しない架空モチーフxyzxyz"), []);
});
