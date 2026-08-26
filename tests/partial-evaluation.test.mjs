import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePartialFold } from "../local-oriedita/partial-evaluation.mjs";

function squareFold(interior = []) {
  const vertices = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0], [0.5, 1]];
  return {
    file_spec: 1.2,
    frame_classes: ["creasePattern"],
    vertices_coords: vertices,
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], ...interior.map(({ edge }) => edge)],
    edges_assignment: ["B", "B", "B", "B", ...interior.map(({ assignment }) => assignment)],
  };
}

const goal = { description: "うさぎ", parts: [], symmetry: true };

test("defers local theorems for a one-crease intermediate state", () => {
  const fold = squareFold([{ edge: [4, 5], assignment: "M" }]);
  const evaluation = evaluatePartialFold({
    fold,
    goal,
    action: { type: "add_crease", a: [0.5, 0], b: [0.5, 1], assignment: "M" },
    orieditaCompleted: true,
    targetCreaseCount: 4,
  });
  assert.equal(evaluation.hardFailures, 0);
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.checks.find(({ name }) => name === "kawasaki_local").status, "deferred");
  assert.equal(evaluation.checks.find(({ name }) => name === "maekawa_local").status, "deferred");
  assert.equal(evaluation.sequentialPhysicalFolding, false);
  assert.equal(evaluation.physicalScope, "oriedita_flat_fold_2d");
});

test("treats a broken paper boundary as a hard failure", () => {
  const fold = squareFold([{ edge: [4, 5], assignment: "M" }]);
  fold.edges_vertices.splice(2, 1);
  fold.edges_assignment.splice(2, 1);
  const evaluation = evaluatePartialFold({ fold, goal, orieditaCompleted: true });
  assert.ok(evaluation.hardFailures > 0);
  assert.equal(evaluation.passed, false);
});

test("requires a completed Oriedita projection", () => {
  const fold = squareFold([{ edge: [4, 5], assignment: "V" }]);
  const evaluation = evaluatePartialFold({ fold, goal, orieditaCompleted: false });
  assert.equal(evaluation.passed, false);
  assert.match(evaluation.checks.at(-1).issues[0], /Oriedita/);
});

test("does not use semantic self-labels for the structure progress score", () => {
  const plain = squareFold([{ edge: [4, 5], assignment: "M" }]);
  const labelled = structuredClone(plain);
  labelled["edges_mitou:semanticPart"] = [null, null, null, null, "完璧なうさぎ"];
  const first = evaluatePartialFold({ fold: plain, goal, orieditaCompleted: true, targetCreaseCount: 4 });
  const second = evaluatePartialFold({ fold: labelled, goal, orieditaCompleted: true, targetCreaseCount: 4 });
  assert.equal(first.scores.target, second.scores.target);
  assert.equal(first.structure.source, "geometry_only");
});
