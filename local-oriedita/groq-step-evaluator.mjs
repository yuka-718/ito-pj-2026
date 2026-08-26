const DEFAULT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_STEP_MODEL = "qwen/qwen3.6-27b";

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function cleanText(value, maximumLength, fallback = "") {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, maximumLength) || fallback;
}

function cleanIssues(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((issue) => typeof issue === "string")
    .map((issue) => issue.trim().slice(0, 240))
    .filter(Boolean)
    .slice(0, 8);
}

function goalPartLabels(goal) {
  if (!Array.isArray(goal?.parts)) return [];
  return [...new Set(goal.parts.flatMap((part) => {
    const label = cleanText(part?.label, 60);
    return label ? [label] : [];
  }))];
}

function cleanPartScores(value, labels) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(labels.map((label) => [label, clampScore(source[label])]));
}

function cleanNextFocus(value) {
  if (typeof value === "string") {
    return {
      part: null,
      direction: null,
      width: null,
      rationale: cleanText(value, 300, "次の一手で輪郭の差が見える部分を改善する"),
    };
  }
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const direction = Number(source.direction);
  const width = Number(source.width);
  return {
    part: cleanText(source.part, 60) || null,
    direction: Number.isFinite(direction) ? ((direction % 360) + 360) % 360 : null,
    width: Number.isFinite(width) ? Math.max(0, Math.min(1, width)) : null,
    rationale: cleanText(source.rationale, 300, "次の一手で輪郭の差が見える部分を改善する"),
  };
}

function candidateList(parent, siblings = []) {
  if (!parent || typeof parent !== "object") throw new Error("親候補がありません");
  if (!Array.isArray(siblings)) throw new Error("sibling候補が配列ではありません");
  if (siblings.length > 3) throw new Error("sibling候補は最大3件です");
  const candidates = [parent, ...siblings];
  const ids = candidates.map((candidate) => cleanText(candidate?.id, 160));
  if (ids.some((id) => !id)) throw new Error("候補IDがありません");
  if (new Set(ids).size !== ids.length) throw new Error("候補IDが重複しています");
  return candidates.map((candidate, index) => ({ ...candidate, id: ids[index] }));
}

function validateImage(image, label) {
  if (!image || typeof image !== "object") throw new Error(`${label}の折り上がり画像がありません`);
  if (!/^image\/(?:png|jpeg|webp)$/.test(image.mimeType ?? "") || typeof image.data !== "string" || !image.data) {
    throw new Error(`${label}の折り上がり画像が不正です`);
  }
  return image;
}

function safeJson(value, maximumLength = 4_000) {
  try {
    const serialized = JSON.stringify(value ?? null);
    return serialized.length > maximumLength ? `${serialized.slice(0, maximumLength)}…` : serialized;
  } catch {
    return "null";
  }
}

function responseRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.judgements)) return value.judgements;
  throw new Error("Groqの一手評価結果がJSON配列ではありません");
}

function groqRetryDelayMs(response, payload) {
  if (response?.status !== 429) return null;
  const retryAfter = Number(response.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(30_000, Math.max(100, Math.ceil(retryAfter * 1_000) + 250));
  }
  const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
  const match = message.match(/try again in\s+([0-9.]+)s/i);
  if (!match) return null;
  return Math.min(30_000, Math.max(100, Math.ceil(Number(match[1]) * 1_000) + 250));
}

export function normalizeStepJudgements(value, {
  parentId,
  siblingIds = [],
  goal = null,
} = {}) {
  const expectedIds = [parentId, ...siblingIds].map((id) => cleanText(id, 160));
  if (expectedIds.some((id) => !id)) throw new Error("期待する候補IDがありません");
  if (new Set(expectedIds).size !== expectedIds.length) throw new Error("期待する候補IDが重複しています");

  const rows = responseRows(value);
  const seen = new Set();
  const byId = new Map();
  const allowed = new Set(expectedIds);
  const labels = goalPartLabels(goal);

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Groqの候補評価がJSONオブジェクトではありません");
    }
    const id = cleanText(row.id, 160);
    if (!id || !allowed.has(id)) throw new Error(`Groqの評価に未知の候補IDがあります: ${id || "(missing)"}`);
    if (seen.has(id)) throw new Error(`Groqの評価で候補IDが重複しています: ${id}`);
    seen.add(id);
    byId.set(id, {
      id,
      targetScore: clampScore(row.targetScore),
      partScores: cleanPartScores(row.partScores, labels),
      silhouetteScore: clampScore(row.silhouetteScore),
      summary: cleanText(row.summary, 600, "輪郭の途中経過を評価しました"),
      issues: cleanIssues(row.issues),
      nextFocus: cleanNextFocus(row.nextFocus),
    });
  }

  const missing = expectedIds.filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`Groqの評価に候補IDが不足しています: ${missing.join("、")}`);
  const parentScore = byId.get(parentId).targetScore;
  return expectedIds.map((id) => {
    const judgement = byId.get(id);
    return {
      ...judgement,
      deltaFromParent: id === parentId ? 0 : judgement.targetScore - parentScore,
    };
  });
}

export function fallbackStepJudgements({ parent, siblings = [], goal = null } = {}) {
  const candidates = candidateList(parent, siblings);
  const labels = goalPartLabels(goal);
  const priorTargetScore = clampScore(parent?.physicalSummary?.priorTargetScore);
  const rows = candidates.map((candidate) => {
    return {
      id: candidate.id,
      // Physical checks cannot establish resemblance. Preserve only the last
      // image-backed target score, while physical/foldability stay separate.
      targetScore: priorTargetScore,
      partScores: Object.fromEntries(labels.map((label) => [label, 0])),
      silhouetteScore: 0,
      summary: "画像評価を利用できなかったため、物理検査だけで暫定評価しました",
      issues: ["輪郭と部位の画像評価は未実施です"],
      nextFocus: {
        part: null,
        direction: null,
        width: null,
        rationale: "画像評価を再実行し、輪郭として確認できる部位を一つ改善する",
      },
    };
  });
  return normalizeStepJudgements(rows, {
    parentId: candidates[0].id,
    siblingIds: candidates.slice(1).map(({ id }) => id),
    goal,
  });
}

function evaluationPrompt({ prompt, goal, step, candidates, includeParentImage }) {
  const ids = candidates.map(({ id }) => id);
  return `折り紙設計探索の第${step}手を、親候補とsibling候補で比較してください。

目標: ${cleanText(prompt, 400, "参考画像をもとにした形")}
設計条件: ${safeJson(goal)}
候補ID（この順で必ず全件評価）: ${JSON.stringify(ids)}
親候補の画像: ${includeParentImage ? "添付あり" : "添付なし。physical summary内のpriorTargetScoreを前回評価として維持"}

重要:
- 現在は探索の早期または途中段階です。まだ完成形でないこと自体を減点理由にせず、親から目標の輪郭へ近づいたかを評価してください。
- 画像で観察できる輪郭、太さ、突起、くびれ、左右バランス、目標部位らしさを中心に評価してください。
- action/physical summaryは補助情報です。そこに書かれたsemantic labelや部位名を、画像上で見えた証拠として採点してはいけません。
- Oriedita画像は2Dの折り上がり計算結果です。立体完成形、実際の折り順、人間が物理的に折れることの証明とは扱わないでください。
- 0°・90°・180°・270°の回転は同一として比較してください。
- targetScoreは現時点で目標の輪郭へ進んでいる度合い、partScoresは画像で識別できる設計条件の各部位、silhouetteScoreは輪郭だけの品質です。
- deltaFromParentは返さないでください。バックエンドがtargetScoreから計算します。
- 未知IDを追加せず、候補IDを省略・重複しないでください。

JSONだけを次の形で返してください:
{"judgements":[{"id":"候補ID","targetScore":0,"partScores":{"設計条件の部位":0},"silhouetteScore":0,"summary":"短い日本語評価","issues":["画像から確認できる問題"],"nextFocus":{"part":"次に改善する部位","direction":0から359の角度,"width":0から1,"rationale":"次の一手の狙い"}}]}`;
}

function candidateContent(candidate, index, { includeImage = true } = {}) {
  const content = [
    {
      type: "text",
      text: `${index === 0 ? "親候補" : `sibling候補${index}`} id=${candidate.id}\naction summary: ${safeJson(candidate.actionSummary)}\nphysical summary: ${safeJson(candidate.physicalSummary)}`,
    },
  ];
  if (includeImage) {
    const image = validateImage(candidate.foldedImage, candidate.id);
    content.push({
      type: "image_url",
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    });
  }
  return content;
}

export async function requestGroqStepEvaluation({
  apiKey,
  model = DEFAULT_GROQ_STEP_MODEL,
  endpoint = DEFAULT_GROQ_ENDPOINT,
  prompt,
  goal,
  step = 1,
  parent,
  siblings = [],
  referenceImage = null,
  includeParentImage = true,
  timeoutMs = 90_000,
  fetchImpl = fetch,
}) {
  if (!apiKey?.trim()) throw new Error("GROQ_API_KEYが設定されていません");
  const candidates = candidateList(parent, siblings);
  const content = [
    { type: "text", text: evaluationPrompt({ prompt, goal, step, candidates, includeParentImage }) },
    ...candidates.flatMap((candidate, index) => candidateContent(candidate, index, {
      includeImage: index > 0 || includeParentImage,
    })),
  ];
  if (referenceImage != null) {
    const image = validateImage(referenceImage, "参考");
    content.push(
      { type: "text", text: "ユーザーの目標参考画像（候補画像ではありません）" },
      { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } },
    );
  }

  const requestBody = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: "あなたは折り紙探索の輪郭比較担当です。自己申告された部位ラベルではなく画像を根拠にし、必ず有効なJSONだけを返します。",
      },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "none",
    reasoning_format: "hidden",
    temperature: 0.2,
    top_p: 0.8,
    max_completion_tokens: 800,
    stream: false,
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  let response;
  let payload;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: requestBody,
        signal: controller.signal,
      });
      payload = await response.json().catch(() => null);
      if (response.ok) break;
      const delayMs = groqRetryDelayMs(response, payload);
      if (delayMs == null || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Groqの一手評価がタイムアウトしました");
    throw new Error("Groq APIへ接続できませんでした");
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
    throw new Error(message ? `Groq API: ${message}` : `Groq APIがHTTP ${response.status}を返しました`);
  }
  const contentText = payload?.choices?.[0]?.message?.content;
  if (typeof contentText !== "string") throw new Error("Groq APIの一手評価本文がありません");
  let value;
  try {
    value = JSON.parse(contentText);
  } catch {
    throw new Error("Groq APIの一手評価JSONを読み取れませんでした");
  }
  return {
    judgements: normalizeStepJudgements(value, {
      parentId: candidates[0].id,
      siblingIds: candidates.slice(1).map(({ id }) => id),
      goal,
    }),
    metadata: {
      provider: "groq",
      model: payload?.model ?? model,
      requestId: response.headers?.get?.("x-request-id") ?? null,
      usage: payload?.usage ?? null,
    },
  };
}
