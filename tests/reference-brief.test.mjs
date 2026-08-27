import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreliminaryDesignBrief,
  buildReferenceDocument,
  chooseValidatedInitialFold,
  completeDesignBrief,
} from "../local-oriedita/reference-brief.mjs";

const square = {
  file_spec: 1.2,
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
  edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
  edges_assignment: ["B", "B", "B", "B"],
};

test("falls back to a square when no structural reference passes Oriedita", () => {
  const selected = chooseValidatedInitialFold([], [], square);
  assert.equal(selected.source, "square_fallback");
  assert.equal(selected.fallback, true);
  assert.deepEqual(selected.fold, square);
});

test("uses only an Oriedita-validated structural reference as the initial FOLD", () => {
  const structural = [{ pattern: { id: "prior-1", fold: { ...square, file_title: "structural prior" } } }];
  const rejected = chooseValidatedInitialFold(structural, [{
    pattern_id: "prior-1", status: "failed", oriedita_completed: false, violation_count: 2,
  }], square);
  assert.equal(rejected.fallback, true);
  const accepted = chooseValidatedInitialFold(structural, [{
    pattern_id: "prior-1", status: "passed", oriedita_completed: true, violation_count: 0,
  }], square);
  assert.equal(accepted.pattern_id, "prior-1");
  assert.equal(accepted.source, "validated_structural_knowledge");
});

test("reference documents retain permissions and provenance without redistributing local paths", () => {
  const document = buildReferenceDocument({
    prompt: "鶴",
    catalog: {
      permission: { status: "user_confirmed", source: "https://example.test" },
      index: { schema: "oriai-origami-search-source-v1", source: "https://example.test", item_count: 625 },
    },
    works: [{ id: "crane", title: "Crane", creator: "Author", source_url: "https://example.test/crane", score: 99 }],
    images: [{ work_id: "crane", role: "representative", local_path: "/private/reference.png", source_url: "https://example.test/image.png" }],
    structures: [{ id: "prior", isFinishedModel: false }],
  });
  assert.equal(document.permission.status, "user_confirmed");
  assert.equal(document.origami_search.matches[0].creator, "Author");
  assert.equal(document.policy.redistribute_reference_images, false);
  assert.doesNotMatch(JSON.stringify(document), /\/private\/reference\.png/);
  assert.equal(document.structural_knowledge.human_verified_steps, false);
});

test("Codex design organization is written into the final design brief", () => {
  const preliminary = buildPreliminaryDesignBrief({
    prompt: "鶴",
    goal: { symmetry: true, parts: [{ label: "翼", importance: 4 }] },
  });
  const completed = completeDesignBrief(preliminary, { basic_form: "bird base" });
  assert.equal(completed.status, "completed");
  assert.equal(completed.codex_design.basic_form, "bird base");
});
