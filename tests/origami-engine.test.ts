import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDescription,
  candidateToFold,
  candidateToSvg,
  generateCandidates,
  kawasakiResidualFromAngles,
  withAngleOffset,
} from "../app/origami-engine.ts";

test("Kawasaki residual recognizes exact and perturbed single vertices", () => {
  const exact = kawasakiResidualFromAngles([0, Math.PI / 2, Math.PI, Math.PI * 1.5]);
  assert.equal(exact.status, "ok");
  assert.ok(exact.residualRad < 1e-12);

  const perturbed = kawasakiResidualFromAngles([0, Math.PI / 3, Math.PI, (Math.PI * 4) / 3]);
  assert.equal(perturbed.status, "ok");
  assert.ok(perturbed.residualRad > 0.1);
  assert.equal(kawasakiResidualFromAngles([0, 1, 2, 3, 4]).status, "invalid");
});

test("generates deterministic, valid candidates and recalculates edits", () => {
  const analysis = analyzeDescription("大きな尾びれがある金魚");
  assert.equal(analysis.presetKey, "goldfish");
  const input = {
    description: "大きな尾びれがある金魚",
    parts: analysis.parts,
    complexity: 3,
    symmetry: true,
    seed: 26,
  };
  const first = generateCandidates(input);
  const second = generateCandidates(input);
  assert.equal(first.length, 3);
  assert.deepEqual(first, second);
  first.forEach((candidate) => {
    assert.ok(candidate.residualRad < 1e-10);
    assert.equal(candidate.maekawaDifference, 2);
    assert.deepEqual(candidate.validationIssues, []);
  });
  const changed = withAngleOffset(first[0], 5, input.parts, true);
  assert.ok(changed.residualDeg > 1);
});

test("exports the selected graph as standalone SVG and FOLD 1.2 JSON", () => {
  const analysis = analyzeDescription("左右に翼を広げた鶴");
  const candidate = generateCandidates({
    description: "左右に翼を広げた鶴",
    parts: analysis.parts,
    complexity: 4,
    symmetry: true,
    seed: 718,
  })[0];
  const svg = candidateToSvg(candidate, "鶴 <test>");
  assert.match(svg, /<title>鶴 &lt;test&gt;/);
  assert.match(svg, /Local Kawasaki residual only/);
  assert.doesNotMatch(svg, /<script|(?:href|src)="https?:\/\//);
  assert.doesNotMatch(svg, /NaN|undefined/);

  const fold = JSON.parse(candidateToFold(candidate, "鶴"));
  assert.equal(fold.file_spec, 1.2);
  assert.equal(fold.vertices_coords.length, candidate.vertices.length);
  assert.equal(fold.edges_vertices.length, fold.edges_assignment.length);
  assert.equal(fold["mitou:localValidation"].globalFlatFoldability, "unchecked");
});
