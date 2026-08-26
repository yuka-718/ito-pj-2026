import assert from "node:assert/strict";
import test from "node:test";

import { normalizeGroqJudge, requestGroqEvaluation } from "../local-oriedita/groq-evaluator.mjs";

test("normalizes Groq visual judge output", () => {
  assert.deepEqual(normalizeGroqJudge({
    score: 82.6,
    iterations: 99,
    stop_reason: "groq_visual_judge",
    summary: "  耳が見える  ",
    issues: [" 耳を太くする ", null, "左右対称を強める"],
  }), {
    score: 83,
    iterations: 1,
    stop_reason: "groq_visual_judge",
    summary: "耳が見える",
    issues: ["耳を太くする", "左右対称を強める"],
  });
});

test("sends the Oriedita image and optional reference image to Groq", async () => {
  let request;
  const result = await requestGroqEvaluation({
    apiKey: "test-key",
    prompt: "うさぎ",
    goal: { symmetry: true, parts: [{ label: "耳" }] },
    preflight: { selectedCandidateId: "candidate-01", selectedScores: { physical: 100 } },
    foldedImage: { mimeType: "image/png", data: "Zm9sZGVk" },
    referenceImage: { mimeType: "image/jpeg", data: "cmVmZXJlbmNl" },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        headers: { get: () => "request-1" },
        json: async () => ({
          model: "qwen/qwen3.6-27b",
          choices: [{ message: { content: JSON.stringify({ score: 75, summary: "確認", issues: ["耳を長くする"] }) } }],
          usage: { total_tokens: 20 },
        }),
      };
    },
  });

  assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(request.body.response_format.type, "json_object");
  assert.equal(request.body.reasoning_effort, "none");
  assert.equal(request.body.messages[1].content.filter((item) => item.type === "image_url").length, 2);
  assert.equal(result.judge.score, 75);
  assert.equal(result.metadata.provider, "groq");
});
