import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexLoopPrompt,
  normalizeCodexLoopResult,
} from "../local-oriedita/codex-oriedita-runner.mjs";

function resultWithSteps(count = 10) {
  return {
    score: 73,
    iterations: count,
    best_step: 8,
    stop_reason: "completed_iteration_budget",
    summary: "評価完了",
    issues: [],
    steps: Array.from({ length: count }, (_, index) => ({
      step: index + 1,
      score: 20 + index * 6,
      accepted: index % 2 === 0,
      action: `crease ${index + 1}`,
      summary: "折り上がり画像を比較",
      issues: [],
    })),
  };
}

test("Codex loop prompt requires one crease, fold calculation, image review when valid, and rollback", () => {
  const prompt = buildCodexLoopPrompt({
    prompt: "翼を広げた鶴",
    goal: { parts: [{ label: "翼" }] },
    rootPath: "/tmp/job/root.fold",
    finalFoldPath: "/tmp/job/final.fold",
    finalCreasePath: "/tmp/job/final.png",
    maximumIterations: 10,
  });

  assert.match(prompt, /候補の追加と評価をちょうど10回/);
  assert.match(prompt, /一回につき add_line をちょうど1回/);
  assert.match(prompt, /calculate_fold/);
  assert.match(prompt, /get_folded_figure/);
  assert.match(prompt, /open_fileで開き直して巻き戻す/);
  assert.match(prompt, /2D平坦折り計算/);
  assert.match(prompt, /逐次3D物理折りを行ったとは述べない/);
});

test("normalization preserves exactly ten evaluations and clamps scores", () => {
  const source = resultWithSteps();
  source.score = 110;
  source.steps[0].score = -5;
  const result = normalizeCodexLoopResult(source, 10);
  assert.equal(result.iterations, 10);
  assert.equal(result.steps.length, 10);
  assert.equal(result.score, 100);
  assert.equal(result.steps[0].score, 0);
});

test("normalization rejects a loop that stopped before all evaluations", () => {
  assert.throws(
    () => normalizeCodexLoopResult(resultWithSteps(9), 10),
    /9\/10/,
  );
});
