import assert from "node:assert/strict";
import test from "node:test";

import {
  createCOrigamiFinalState,
  foldFromDataUrl,
} from "../app/corigami-final-state.ts";
import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
} from "../app/origami-engine.ts";

function craneFixture() {
  const description = "長い首と左右に広がる翼を持つ鶴";
  const analysis = analyzeDescription(description);
  const candidate = generateCandidates({
    description,
    parts: analysis.parts,
    complexity: 4,
    symmetry: true,
    seed: 718,
  })[0];
  const fold = JSON.parse(candidateToFold(candidate, description));
  return { description, analysis, candidate, fold };
}

test("base FOLD contains bounded faces and stable semantic edge metadata", () => {
  const { candidate, fold } = craneFixture();
  assert.equal(fold.faces_vertices.length, candidate.degree);
  assert.equal(fold.edges_foldAngle.length, fold.edges_vertices.length);
  assert.equal(fold["edges_oriai:id"].length, fold.edges_vertices.length);
  assert.equal(new Set(fold["edges_oriai:id"]).size, fold.edges_vertices.length);
  assert.equal(fold["oriai:generator"].semanticTree.nodes.length, candidate.semanticTree.nodes.length);
  assert.equal(fold["oriai:generator"].semanticTree.edges.length, candidate.semanticTree.nodes.length - 1);
  assert.equal(fold["oriai:generator"].packing.adapter, "radial_single_vertex");
  assert.equal(fold["oriai:generator"].packing.boxPleatPacking, "not_implemented");
  assert.equal(fold["oriai:generator"].packing.flaps.length, candidate.degree);

  const edges = new Set(fold.edges_vertices.map(([a, b]: [number, number]) =>
    a < b ? `${a}:${b}` : `${b}:${a}`
  ));
  fold.faces_vertices.forEach((face: number[]) => {
    assert.ok(face.length >= 3);
    face.forEach((vertex, index) => {
      const next = face[(index + 1) % face.length];
      assert.ok(edges.has(vertex < next ? `${vertex}:${next}` : `${next}:${vertex}`));
    });
  });
});

test("creates phases 2–4 on exactly the same crease-pattern graph", () => {
  const { description, analysis, fold } = craneFixture();
  const finalState = createCOrigamiFinalState(fold, analysis.parts, description);
  assert.equal(finalState.schema, "oriai-corigami-final-state-v1");
  assert.equal(finalState.angleConvention, "degree:absolute:M-negative:V-positive");
  assert.deepEqual(finalState.stages.map(({ id, phase }) => ({ id, phase })), [
    { id: "angle-preview", phase: 2 },
    { id: "simple-fold", phase: 3 },
    { id: "narrowing", phase: 4 },
  ]);

  finalState.stages.forEach((stage) => {
    assert.deepEqual(stage.fold.vertices_coords, fold.vertices_coords);
    assert.deepEqual(stage.fold.edges_vertices, fold.edges_vertices);
    assert.deepEqual(stage.fold.faces_vertices, fold.faces_vertices);
    assert.equal(stage.fold.edges_foldAngle?.length, fold.edges_vertices.length);
    assert.equal(foldFromDataUrl(stage.foldFile)?.faces_vertices.length, fold.faces_vertices.length);
  });
});

test("simple folds target semantic parts and narrowing uses mountain-valley pairs", () => {
  const { description, analysis, fold } = craneFixture();
  const finalState = createCOrigamiFinalState(fold, analysis.parts, description);
  const simple = finalState.stages[1];
  const narrowing = finalState.stages[2];
  assert.ok(simple.operations.length >= 2);
  assert.ok(simple.operations.every((operation) => operation.kind === "simple_fold"));
  assert.ok(simple.operations.some((operation) => /首|翼/.test(operation.partLabel)));
  assert.ok(narrowing.operations.length >= 1);
  narrowing.operations.forEach((operation) => {
    assert.equal(operation.kind, "narrowing");
    assert.equal(operation.edgeIds.length, 2);
    assert.equal(operation.targetAnglesDeg.length, 2);
    assert.ok(operation.targetAnglesDeg[0] < 0);
    assert.ok(operation.targetAnglesDeg[1] > 0);
  });
});
