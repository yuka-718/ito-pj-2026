import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
  withAngleOffset,
} from "../app/origami-engine.ts";
import {
  buildDesignGoal,
  mergeFinalEvaluation,
  validateCandidatePool,
} from "../local-oriedita/fast-evaluation.mjs";
import { createMountainValleyVariants } from "../local-oriedita/fold-repair.mjs";
import { loadKnowledgePack } from "../local-oriedita/knowledge-search.mjs";

const knowledgePack = await loadKnowledgePack();

function goldfishFixture() {
  const description = "大きな尾びれの金魚";
  const analysis = analyzeDescription(description);
  const input = {
    description,
    parts: analysis.parts,
    complexity: 3,
    symmetry: true,
    seed: 26,
  };
  const candidates = generateCandidates(input);
  const folds = candidates.map((candidate) => JSON.parse(candidateToFold(candidate, description)));
  const goal = buildDesignGoal(description, {
    presetKey: analysis.presetKey,
    symmetry: true,
    parts: analysis.parts,
  });
  return { analysis, candidates, folds, goal, input };
}

test("compares three candidates with nine fast checks and a Pareto selection", () => {
  const { folds, goal } = goldfishFixture();
  const result = validateCandidatePool(folds, goal);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.validations.length, 9);
  assert.ok(result.paretoCandidateIds.includes(result.selectedCandidateId));
  assert.deepEqual(result.validations.slice(0, 6).map(({ passed }) => passed), [true, true, true, true, true, true]);
  assert.equal(result.selectedScores.physical, 100);
});

test("recomputes unresolved assignments and local Kawasaki failures from coordinates", () => {
  const { candidates, folds, goal, input } = goldfishFixture();
  const unresolved = structuredClone(folds[0]);
  const creaseIndex = unresolved.edges_assignment.findIndex((assignment) => assignment === "M");
  unresolved.edges_assignment[creaseIndex] = "U";
  const unresolvedResult = validateCandidatePool([unresolved], goal);
  assert.equal(unresolvedResult.validations[3].passed, false);

  const perturbed = JSON.parse(candidateToFold(
    withAngleOffset(candidates[0], 5, input.parts, input.symmetry),
    input.description,
  ));
  const perturbedResult = validateCandidatePool([perturbed], goal);
  assert.equal(perturbedResult.validations[4].passed, false);
});

test("semantic shape score is invariant under a 90 degree document rotation", () => {
  const { folds, goal } = goldfishFixture();
  const rotated = structuredClone(folds[0]);
  rotated.vertices_coords = rotated.vertices_coords.map(([x, y]) => [1 - y, x]);
  const originalScore = validateCandidatePool([folds[0]], goal).validations[8].score;
  const rotatedScore = validateCandidatePool([rotated], goal).validations[8].score;
  assert.ok(Math.abs(originalScore - rotatedScore) <= 0.01);
});

test("merges the final Oriedita judge as validation ten while preserving legacy fields", () => {
  const { folds, goal } = goldfishFixture();
  const preflight = validateCandidatePool(folds, goal);
  const merged = mergeFinalEvaluation(preflight, {
    score: 72,
    iterations: 1,
    stop_reason: "final_oriedita_visual_judge",
    summary: "輪郭を最終確認しました",
    issues: [],
  });
  assert.equal(merged.iterations, 10);
  assert.equal(merged.validations.length, 10);
  assert.equal(merged.validations[9].kind, "oriedita_codex");
  assert.equal(typeof merged.score, "number");
  assert.equal(typeof merged.summary, "string");
  assert.ok(merged.physical && merged.appearance && merged.foldability);
});

test("builds rabbit-specific design conditions for a plain rabbit prompt", () => {
  const goal = buildDesignGoal("うさぎ", { presetKey: "custom", symmetry: true, parts: [] });
  assert.equal(goal.motif, "rabbit");
  assert.ok(goal.parts.some(({ label }) => label === "長い耳"));
});

test("reuses validated single-vertex mountain/valley templates without changing geometry", () => {
  const { folds } = goldfishFixture();
  const variants = createMountainValleyVariants(knowledgePack, folds[0]);
  assert.ok(variants.length > 1);
  assert.deepEqual(variants[0].vertices_coords, folds[0].vertices_coords);
  assert.deepEqual(variants[0].edges_vertices, folds[0].edges_vertices);
  variants.forEach((variant) => {
    const mountains = variant.edges_assignment.filter((value) => value === "M").length;
    const valleys = variant.edges_assignment.filter((value) => value === "V").length;
    assert.equal(Math.abs(mountains - valleys), 2);
  });
});
