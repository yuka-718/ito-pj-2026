import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
} from "../app/origami-engine.ts";
import { buildDesignGoal, validateCandidatePool } from "../local-oriedita/fast-evaluation.mjs";
import {
  foldGeometrySignature,
  regenerateCandidatePool,
} from "../local-oriedita/regeneration.mjs";

function rabbitFixture() {
  const description = "長い耳のうさぎ";
  const analysis = analyzeDescription(description);
  const candidates = generateCandidates({
    description,
    parts: analysis.parts,
    complexity: 3,
    symmetry: true,
    seed: 718,
  });
  const fold = JSON.parse(candidateToFold(candidates[0], description));
  const goal = buildDesignGoal(description, {
    presetKey: analysis.presetKey,
    symmetry: true,
    parts: analysis.parts,
  });
  return { fold, goal };
}

test("regenerates deterministic candidate pools from evaluation feedback", () => {
  const { fold, goal } = rabbitFixture();
  const input = {
    currentFold: fold,
    goal,
    feedback: ["長い耳が輪郭で識別しにくい"],
    cycle: 2,
    count: 12,
  };
  const first = regenerateCandidatePool(input);
  const second = regenerateCandidatePool(input);
  assert.equal(first.length, 12);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(foldGeometrySignature)).size, 12);
  assert.ok(first.every((candidate) => candidate["mitou:regeneration"].cycle === 2));
});

test("changes regenerated geometry when judge feedback changes", () => {
  const { fold, goal } = rabbitFixture();
  const ears = regenerateCandidatePool({
    currentFold: fold,
    goal,
    feedback: ["長い耳を強調する"],
    cycle: 2,
    count: 3,
  });
  const legs = regenerateCandidatePool({
    currentFold: fold,
    goal,
    feedback: ["後脚を強調する"],
    cycle: 2,
    count: 3,
  });
  assert.notDeepEqual(ears.map(foldGeometrySignature), legs.map(foldGeometrySignature));
});

test("constructs regenerated candidates that pass the local physical checks", () => {
  const { fold, goal } = rabbitFixture();
  const candidates = regenerateCandidatePool({
    currentFold: fold,
    goal,
    feedback: ["長い耳が短い"],
    cycle: 3,
    count: 6,
  });
  for (const candidate of candidates) {
    const evaluation = validateCandidatePool([candidate], goal);
    assert.deepEqual(evaluation.validations.slice(0, 6).map(({ passed }) => passed), [true, true, true, true, true, true]);
    assert.equal(evaluation.selectedScores.physical, 100);
  }
});
