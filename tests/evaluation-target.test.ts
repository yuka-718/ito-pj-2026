import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluatedRubric,
  FINAL_JUDGE_COUNT,
  hasPassedIndependentEvaluation,
  INDEPENDENT_EVALUATION_MODE,
} from "../app/evaluation-target.ts";

const passingEvidence = () => ({
  mode: INDEPENDENT_EVALUATION_MODE,
  passed: true,
  physical: {
    passed: true,
    foldCompleted: true,
    forbiddenOperationsAbsent: true,
    violationFree: true,
  },
  rubric: {
    motifRecognizability: 4,
    requiredParts: 4,
    proportionBalance: 4,
    referenceSimilarity: null,
  },
  judges: {
    count: FINAL_JUDGE_COUNT,
    passVotes: 2,
    requiredVotes: 2,
    aggregation: "median_and_majority",
  },
});

test("the public result gate requires physical checks and three independent final judges", () => {
  assert.equal(hasPassedIndependentEvaluation(passingEvidence()), true);
  assert.equal(hasPassedIndependentEvaluation({ score: 100 }), false);
  assert.equal(hasPassedIndependentEvaluation({
    mode: "codex_oriedita_mcp_loop",
    targetScore: 99,
    appearance: { score: 100 },
  }), false);
  assert.equal(hasPassedIndependentEvaluation({
    ...passingEvidence(),
    physical: { ...passingEvidence().physical, violationFree: false },
  }), false);
  assert.equal(hasPassedIndependentEvaluation({
    ...passingEvidence(),
    judges: { ...passingEvidence().judges, count: 1 },
  }), false);
});

test("the 0-to-5 rubric must be complete and finite", () => {
  assert.deepEqual(evaluatedRubric(passingEvidence()), passingEvidence().rubric);
  assert.equal(evaluatedRubric({
    ...passingEvidence(),
    rubric: { ...passingEvidence().rubric, requiredParts: Number.NaN },
  }), null);
  assert.equal(evaluatedRubric({
    ...passingEvidence(),
    rubric: { ...passingEvidence().rubric, proportionBalance: 6 },
  }), null);
});
