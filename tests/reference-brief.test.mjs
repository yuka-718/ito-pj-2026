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

test("skips a rejected top match and starts from the next validated similar FOLD", () => {
  const structural = [
    { pattern: { id: "prior-1", fold: { ...square, file_title: "rank 1" } }, score: 94 },
    { pattern: { id: "prior-2", fold: { ...square, file_title: "rank 2" } }, score: 89 },
  ];
  const selected = chooseValidatedInitialFold(structural, [
    { pattern_id: "prior-1", status: "failed", oriedita_completed: false, violation_count: 1 },
    { pattern_id: "prior-2", status: "passed", oriedita_completed: true, violation_count: 0 },
  ], square);
  assert.equal(selected.pattern_id, "prior-2");
  assert.equal(selected.fold.file_title, "rank 2");
});

test("chooses the highest-ranked passing match even when validation records are reversed", () => {
  const structural = [
    { pattern: { id: "rank-1", fold: { ...square, file_title: "rank 1" } } },
    { pattern: { id: "rank-2", fold: { ...square, file_title: "rank 2" } } },
  ];
  const selected = chooseValidatedInitialFold(structural, [
    { pattern_id: "rank-2", status: "passed", oriedita_completed: true, violation_count: 0 },
    { pattern_id: "rank-1", status: "passed", oriedita_completed: true, violation_count: 0 },
  ], square);
  assert.equal(selected.pattern_id, "rank-1");
});

test("does not accept a validation without an explicit zero violation count", () => {
  const structural = [{ pattern: { id: "unknown", fold: { ...square, file_title: "unknown" } } }];
  const selected = chooseValidatedInitialFold(structural, [
    { pattern_id: "unknown", status: "passed", oriedita_completed: true, violation_count: null },
  ], square);
  assert.equal(selected.source, "square_fallback");
});

test("requires an actually smoke-tested modifiable FOLD when requested", () => {
  const structural = [
    { pattern: { id: "static-prior", fold: { ...square, file_title: "static" } }, score: 99 },
    { pattern: { id: "modifiable-prior", fold: { ...square, file_title: "modifiable" } }, score: 80 },
  ];
  const smoke = (status) => ({
    status,
    add_line_completed: true,
    calculation_started: true,
    violation_count: 0,
    oriedita_completed: status === "passed",
    parent_reloaded: true,
  });
  const validations = [
    {
      pattern_id: "static-prior", status: "passed", oriedita_completed: true, violation_count: 0,
      modifiability: smoke("failed"),
    },
    {
      pattern_id: "modifiable-prior", status: "passed", oriedita_completed: true, violation_count: 0,
      modifiability: smoke("passed"),
    },
  ];
  const selected = chooseValidatedInitialFold(structural, validations, square, {
    requireIncrementalModification: true,
  });
  assert.equal(selected.pattern_id, "modifiable-prior");
});

test("chooses the highest similarity score among base-passing and smoke-passing FOLDs", () => {
  const structural = [
    { pattern: { id: "lower", fold: { ...square, file_title: "lower" } }, score: 70 },
    { pattern: { id: "higher", fold: { ...square, file_title: "higher" } }, score: 91 },
  ];
  const modifiability = {
    status: "passed",
    add_line_completed: true,
    calculation_started: true,
    violation_count: 0,
    oriedita_completed: true,
    parent_reloaded: true,
  };
  const validations = structural.map(({ pattern }) => ({
    pattern_id: pattern.id,
    status: "passed",
    oriedita_completed: true,
    violation_count: 0,
    modifiability,
  }));
  const selected = chooseValidatedInitialFold(structural, validations, square, {
    requireIncrementalModification: true,
  });
  assert.equal(selected.pattern_id, "higher");
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
    structures: [{
      id: "prior",
      isFinishedModel: false,
      corpus: { searchedPatternCount: 5000, sourcePatternCount: 5157 },
    }],
  });
  assert.equal(document.permission.status, "user_confirmed");
  assert.equal(document.origami_search.matches[0].creator, "Author");
  assert.equal(document.policy.redistribute_reference_images, false);
  assert.doesNotMatch(JSON.stringify(document), /\/private\/reference\.png/);
  assert.equal(document.structural_knowledge.human_verified_steps, false);
  assert.equal(document.structural_knowledge.searched_pattern_count, 5000);
  assert.equal(document.structural_knowledge.use, "select_validated_initial_then_modify");
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

test("an image-only job does not claim that 5,000 structural patterns were searched", () => {
  const references = buildReferenceDocument({ prompt: "", works: [], images: [], structures: [] });
  const brief = buildPreliminaryDesignBrief({ prompt: "", goal: { parts: [] }, structures: [] });
  assert.equal(references.structural_knowledge.searched_pattern_count, 0);
  assert.equal(references.structural_knowledge.retrieval_strategy, "not_run");
  assert.equal(references.structural_knowledge.use, "square_fallback");
  assert.equal(brief.design_inputs.structural_search.searched_pattern_count, 0);
});
