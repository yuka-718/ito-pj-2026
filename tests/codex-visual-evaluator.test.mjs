import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateVisualJudgements,
  buildCodexVisualEvaluatorArgs,
  buildVisualEvaluationPrompt,
  normalizeVisualJudgement,
  ORIAI_FINAL_EVALUATOR_MODEL,
  ORIAI_INTERMEDIATE_EVALUATOR_MODEL,
  ORIAI_OPERATOR_MODEL,
} from "../local-oriedita/codex-visual-evaluator.mjs";

const raw = (overrides = {}) => ({
  motif_recognizability: 4,
  required_parts: 4,
  proportion_balance: 3,
  reference_similarity: 4,
  pairwise_preference: "current",
  summary: "輪郭を評価",
  issues: [],
  ...overrides,
});

test("the role defaults pin Terra for operation/screening and Sol for final review", () => {
  assert.equal(ORIAI_OPERATOR_MODEL, "gpt-5.6-terra");
  assert.equal(ORIAI_INTERMEDIATE_EVALUATOR_MODEL, "gpt-5.6-terra");
  assert.equal(ORIAI_FINAL_EVALUATOR_MODEL, "gpt-5.6-sol");
});

test("visual judgements use bounded 0-to-5 scores and explicit pairwise comparison", () => {
  const judgement = normalizeVisualJudgement(raw(), { hasReference: true, hasBest: true });
  assert.equal(judgement.passed, true);
  assert.equal(judgement.pairwisePreference, "current");
  assert.deepEqual(judgement.rubric, {
    motifRecognizability: 4,
    requiredParts: 4,
    proportionBalance: 3,
    referenceSimilarity: 4,
  });
  const clamped = normalizeVisualJudgement(raw({ motif_recognizability: 99, required_parts: -4 }), {
    hasReference: true,
    hasBest: true,
  });
  assert.equal(clamped.rubric.motifRecognizability, 5);
  assert.equal(clamped.rubric.requiredParts, 0);
  assert.equal(clamped.passed, false);
});

test("three final reviews are aggregated by median and majority", () => {
  const judgements = [
    normalizeVisualJudgement(raw(), { hasReference: true }),
    normalizeVisualJudgement(raw({ proportion_balance: 4 }), { hasReference: true }),
    normalizeVisualJudgement(raw({ motif_recognizability: 2 }), { hasReference: true }),
  ];
  const result = aggregateVisualJudgements(judgements, {
    hasReference: true,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  });
  assert.equal(result.judgeCount, 3);
  assert.equal(result.passVotes, 2);
  assert.equal(result.requiredVotes, 2);
  assert.equal(result.rubric.motifRecognizability, 4);
  assert.equal(result.passed, true);
});

test("final judge prompt receives finished images and criteria, not prior scores or operation history", () => {
  const prompt = buildVisualEvaluationPrompt({
    stage: "final",
    prompt: "翼を広げた鶴",
    goal: { parts: [{ label: "翼" }] },
    hasReference: true,
    hasBest: false,
  });
  assert.match(prompt, /過去の操作履歴・自己採点・以前の評価点は参照しません/);
  assert.match(prompt, /motif_recognizability/);
  assert.match(prompt, /required_parts/);
  assert.match(prompt, /proportion_balance/);
  assert.match(prompt, /reference_similarity/);
  assert.doesNotMatch(prompt, /99点/);
});

test("judge process pins its model and has no Oriedita MCP or shell tools", () => {
  const args = buildCodexVisualEvaluatorArgs({
    directory: "/tmp/judge",
    outputPath: "/tmp/judge/result.json",
    imagePaths: ["/tmp/candidate.png"],
    task: "judge",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  });
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "gpt-5.6-sol"]);
  assert.ok(args.includes("read-only"));
  assert.ok(args.includes("shell_tool"));
  assert.ok(!args.some((arg) => /mcp_servers\.oriedita/.test(arg)));
});
