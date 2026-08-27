import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFoldCandidate,
  isApprovedTrainingRecord,
  normalizeTrainingItem,
} from "../local-oriedita/origami-training.mjs";
import { validateFoldDocument } from "../local-oriedita/api-contract.mjs";

test("normalizes source metadata and preserves absolute provenance URLs", () => {
  const item = normalizeTrainingItem({
    id: "sample",
    title: "Crane",
    creator: "Designer",
    source_url: "https://example.com/crane",
    diagram_image_urls: ["/diagrams/crane/page-1.png"],
    formats: ["PDF"],
  }, "https://dataset.example");
  assert.equal(item.source_url, "https://example.com/crane");
  assert.deepEqual(item.diagram_image_urls, ["https://dataset.example/diagrams/crane/page-1.png"]);
});

test("builds a planar FOLD graph by splitting intersecting authorized creases", () => {
  const result = buildFoldCandidate({
    item_id: "sample",
    title: "Cross",
    completeness: "complete",
    source_coordinate_system: "original_square",
    steps: [
      {
        step_number: 1,
        fold_type: "mountain",
        confidence: 0.98,
        crease: { a: [0, 0.5], b: [1, 0.5], coordinate_system: "original_square" },
      },
      {
        step_number: 2,
        fold_type: "valley",
        confidence: 0.99,
        crease: { a: [0.5, 0], b: [0.5, 1], coordinate_system: "original_square" },
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.fold.vertices_coords.length, 9);
  assert.equal(result.fold.edges_vertices.length, 12);
  assert.equal(result.fold.edges_assignment.filter((value) => value === "M").length, 2);
  assert.equal(result.fold.edges_assignment.filter((value) => value === "V").length, 2);
  assert.equal(validateFoldDocument(result.fold), result.fold);
});

test("quarantines folded-state guesses and conflicting assignments", () => {
  const foldedState = buildFoldCandidate({
    source_coordinate_system: "folded_state",
    steps: [],
  });
  assert.equal(foldedState.ok, false);
  assert.match(foldedState.reasons.join(" "), /元の正方形/);

  const conflict = buildFoldCandidate({
    source_coordinate_system: "original_square",
    steps: [
      { step_number: 1, fold_type: "mountain", confidence: 1, crease: { a: [0, 0], b: [1, 1], coordinate_system: "original_square" } },
      { step_number: 2, fold_type: "valley", confidence: 1, crease: { a: [1, 1], b: [0, 0], coordinate_system: "original_square" } },
    ],
  });
  assert.equal(conflict.ok, false);
  assert.match(conflict.reasons.join(" "), /競合/);
});

test("quarantines a mostly unreadable sequence instead of training on a partial crease pattern", () => {
  const result = buildFoldCandidate({
    source_coordinate_system: "original_square",
    steps: [
      { step_number: 1, fold_type: "valley", confidence: 0.99, crease: { a: [0, 0], b: [1, 1], coordinate_system: "original_square" } },
      { step_number: 2, fold_type: "mountain", confidence: 0.95, crease: { a: [0, 1], b: [1, 0], coordinate_system: "original_square" } },
      { step_number: 3, fold_type: "reverse", confidence: 0.98, crease: null },
      { step_number: 4, fold_type: "sink", confidence: 0.97, crease: null },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reasons.join(" "), /50%/);
});

test("registers only complete, Oriedita-verified, human-approved records", () => {
  const complete = isApprovedTrainingRecord({
    extraction: { completeness: "complete" },
    build: { ok: true },
    verification: { status: "done", orieditaCompleted: true },
    review: { approved: true },
  });
  assert.equal(complete.approved, true);

  const unreviewed = isApprovedTrainingRecord({
    extraction: { completeness: "complete" },
    build: { ok: true },
    verification: { status: "done", orieditaCompleted: true },
    review: null,
  });
  assert.equal(unreviewed.approved, false);
  assert.match(unreviewed.reasons.join(" "), /人手照合/);
});

test("accepts a fully assigned crease-pattern panel as the preferred geometry source", () => {
  const result = buildFoldCandidate({
    source_coordinate_system: "original_square",
    crease_pattern: {
      present: true,
      creases: [
        { a: [0, 0], b: [1, 1], assignment: "M", confidence: 0.99 },
        { a: [0, 1], b: [1, 0], assignment: "V", confidence: 0.99 },
      ],
    },
    steps: [{ step_number: 1, fold_type: "reverse", confidence: 1, crease: null }],
  });
  assert.equal(result.ok, true);
  assert.equal(result.stats.coverage.source, "crease_pattern");
});

test("drops intersection fragments that collapse after deterministic coordinate rounding", () => {
  const result = buildFoldCandidate({
    source_coordinate_system: "original_square",
    crease_pattern: {
      present: true,
      creases: [
        { a: [0, 0.5], b: [0.1, 0.5], assignment: "M", confidence: 1 },
        { a: [0.000000002, 0], b: [0.000000002, 1], assignment: "V", confidence: 1 },
      ],
    },
    steps: [],
  });
  assert.equal(result.ok, true);
  assert.equal(validateFoldDocument(result.fold), result.fold);
  assert.equal(result.fold.edges_vertices.some(([first, second]) => first === second), false);
});
