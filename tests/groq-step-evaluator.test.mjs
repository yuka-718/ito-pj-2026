import assert from "node:assert/strict";
import test from "node:test";

import {
  fallbackStepJudgements,
  normalizeStepJudgements,
  requestGroqStepEvaluation,
} from "../local-oriedita/groq-step-evaluator.mjs";

const goal = {
  motif: "rabbit",
  parts: [{ label: "耳" }, { label: "胴体" }],
};

function candidate(id, score = 100) {
  return {
    id,
    foldedImage: { mimeType: "image/png", data: Buffer.from(id).toString("base64") },
    actionSummary: { kind: "add_crease", semanticPart: "耳" },
    physicalSummary: { physical: { score }, foldability: { score: score - 10 }, hardFailures: 0 },
  };
}

test("normalizes all expected IDs, clamps scores, and computes delta from the parent", () => {
  const result = normalizeStepJudgements({
    judgements: [
      {
        id: "parent",
        targetScore: 61.4,
        partScores: { "耳": 140, "胴体": -2, "自己申告ラベル": 99 },
        silhouetteScore: 58.6,
        summary: " 親 ",
        issues: [" まだ耳が短い ", null],
        nextFocus: " 耳の輪郭 ",
      },
      {
        id: "child-a",
        targetScore: 78.8,
        partScores: { "耳": 76, "胴体": 70 },
        silhouetteScore: 101,
        summary: "改善",
        issues: [],
        nextFocus: "後脚",
      },
    ],
  }, { parentId: "parent", siblingIds: ["child-a"], goal });

  assert.deepEqual(result[0], {
    id: "parent",
    targetScore: 61,
    partScores: { "耳": 100, "胴体": 0 },
    silhouetteScore: 59,
    summary: "親",
    issues: ["まだ耳が短い"],
    nextFocus: { part: null, direction: null, width: null, rationale: "耳の輪郭" },
    deltaFromParent: 0,
  });
  assert.equal(result[1].targetScore, 79);
  assert.equal(result[1].silhouetteScore, 100);
  assert.equal(result[1].deltaFromParent, 18);
  assert.deepEqual(Object.keys(result[1].partScores), ["耳", "胴体"]);
});

test("rejects unknown, missing, and duplicate response IDs", () => {
  const row = (id) => ({ id, targetScore: 50, partScores: {}, silhouetteScore: 50 });
  assert.throws(
    () => normalizeStepJudgements([row("parent"), row("unknown")], {
      parentId: "parent", siblingIds: ["child"], goal,
    }),
    /未知の候補ID/,
  );
  assert.throws(
    () => normalizeStepJudgements([row("parent")], {
      parentId: "parent", siblingIds: ["child"], goal,
    }),
    /候補IDが不足/,
  );
  assert.throws(
    () => normalizeStepJudgements([row("parent"), row("parent")], {
      parentId: "parent", siblingIds: ["child"], goal,
    }),
    /候補IDが重複/,
  );
});

test("sends the parent, up to three siblings, summaries, goal, and reference in one Groq request", async () => {
  let requestCount = 0;
  let request;
  const candidates = [candidate("parent"), candidate("child-a"), candidate("child-b"), candidate("child-c")];
  const rows = candidates.map(({ id }, index) => ({
    id,
    targetScore: 50 + index * 5,
    partScores: { "耳": 40 + index, "胴体": 45 + index },
    silhouetteScore: 42 + index,
    summary: id,
    issues: [],
    nextFocus: "輪郭",
    deltaFromParent: 999,
  }));
  const result = await requestGroqStepEvaluation({
    apiKey: "test-key",
    prompt: "長い耳のうさぎ",
    goal,
    step: 2,
    parent: candidates[0],
    siblings: candidates.slice(1),
    referenceImage: { mimeType: "image/jpeg", data: "cmVmZXJlbmNl" },
    fetchImpl: async (url, options) => {
      requestCount += 1;
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        headers: { get: (name) => name === "x-request-id" ? "step-request-1" : null },
        json: async () => ({
          model: "qwen/qwen3.6-27b",
          choices: [{ message: { content: JSON.stringify({ judgements: rows }) } }],
          usage: { total_tokens: 40 },
        }),
      };
    },
  });

  assert.equal(requestCount, 1);
  assert.equal(request.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(request.body.response_format.type, "json_object");
  const userContent = request.body.messages[1].content;
  assert.equal(userContent.filter((item) => item.type === "image_url").length, 5);
  const promptText = userContent.filter((item) => item.type === "text").map(({ text }) => text).join("\n");
  assert.match(promptText, /途中段階/);
  assert.match(promptText, /完成形でないこと自体を減点理由にせず/);
  assert.match(promptText, /semantic label.*証拠として採点してはいけません/);
  assert.match(promptText, /action summary/);
  assert.match(promptText, /physical summary/);
  assert.match(promptText, /長い耳のうさぎ/);
  assert.deepEqual(result.judgements.map(({ id }) => id), candidates.map(({ id }) => id));
  assert.deepEqual(result.judgements.map(({ deltaFromParent }) => deltaFromParent), [0, 5, 10, 15]);
  assert.equal(result.metadata.requestId, "step-request-1");
});

test("rejects more than three siblings and duplicate input IDs before calling Groq", async () => {
  await assert.rejects(
    requestGroqStepEvaluation({
      apiKey: "test-key",
      parent: candidate("parent"),
      siblings: [candidate("a"), candidate("b"), candidate("c"), candidate("d")],
      fetchImpl: async () => { throw new Error("must not run"); },
    }),
    /最大3件/,
  );
  await assert.rejects(
    requestGroqStepEvaluation({
      apiKey: "test-key",
      parent: candidate("same"),
      siblings: [candidate("same")],
      fetchImpl: async () => { throw new Error("must not run"); },
    }),
    /候補IDが重複/,
  );
});

test("can compare siblings without resending the parent image", async () => {
  let imageCount = 0;
  const result = await requestGroqStepEvaluation({
    apiKey: "test-key",
    prompt: "うさぎ",
    goal,
    parent: candidate("parent"),
    siblings: [candidate("child")],
    includeParentImage: false,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      imageCount = body.messages[1].content.filter(({ type }) => type === "image_url").length;
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ judgements: [
            { id: "parent", targetScore: 40, partScores: {}, silhouetteScore: 40 },
            { id: "child", targetScore: 55, partScores: {}, silhouetteScore: 55 },
          ] }) } }],
        }),
      };
    },
  });
  assert.equal(imageCount, 1);
  assert.equal(result.judgements[1].deltaFromParent, 15);
});

test("retries a Groq rate limit using the server-provided delay", async () => {
  let calls = 0;
  const result = await requestGroqStepEvaluation({
    apiKey: "test-key",
    parent: candidate("parent"),
    siblings: [candidate("child")],
    goal,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({ error: { message: "Rate limit reached. Please try again in 0.001s" } }, {
          status: 429,
        });
      }
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          judgements: [
            { id: "parent", targetScore: 10, partScores: {}, silhouetteScore: 10 },
            { id: "child", targetScore: 20, partScores: {}, silhouetteScore: 20 },
          ],
        }) } }],
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.judgements[1].deltaFromParent, 10);
});

test("does not wait through a long Groq quota window", async () => {
  let calls = 0;
  await assert.rejects(
    requestGroqStepEvaluation({
      apiKey: "test-key",
      parent: candidate("parent"),
      siblings: [candidate("child")],
      goal,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ error: { message: "Rate limit reached. Please try again in 30s" } }, {
          status: 429,
        });
      },
    }),
    /Rate limit reached/,
  );
  assert.equal(calls, 1);
});

test("provides a pure conservative fallback without pretending to see the silhouette", () => {
  const input = {
    parent: {
      ...candidate("parent", 50),
      physicalSummary: { ...candidate("parent", 50).physicalSummary, priorTargetScore: 17 },
    },
    siblings: [candidate("child", 100)],
    goal,
  };
  const first = fallbackStepJudgements(input);
  const second = fallbackStepJudgements(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(({ silhouetteScore }) => silhouetteScore), [0, 0]);
  assert.deepEqual(first.map(({ partScores }) => partScores), [
    { "耳": 0, "胴体": 0 },
    { "耳": 0, "胴体": 0 },
  ]);
  assert.deepEqual(first.map(({ targetScore }) => targetScore), [17, 17]);
  assert.equal(first[0].deltaFromParent, 0);
  assert.equal(first[1].deltaFromParent, 0);
  assert.match(first[0].summary, /物理検査だけ/);
});
