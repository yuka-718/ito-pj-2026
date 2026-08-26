const DEFAULT_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
export const DEFAULT_GROQ_MODEL = "qwen/qwen3.6-27b";

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizeGroqJudge(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Groqの評価結果がJSONオブジェクトではありません");
  }
  const summary = typeof value.summary === "string" ? value.summary.trim().slice(0, 600) : "";
  const issues = Array.isArray(value.issues)
    ? value.issues
      .filter((issue) => typeof issue === "string")
      .map((issue) => issue.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 8)
    : [];
  return {
    score: clampScore(value.score),
    iterations: 1,
    stop_reason: typeof value.stop_reason === "string"
      ? value.stop_reason.trim().slice(0, 120)
      : "groq_visual_judge",
    summary: summary || "Groqによる折り上がり画像の評価を完了しました",
    issues,
  };
}

function evaluationPrompt({ prompt, goal, preflight, cycle, knowledgeMatch }) {
  return `折り紙生成の第${cycle}サイクルを評価してください。

作りたい形: ${prompt || "参考画像をもとにした形"}
設計条件: ${JSON.stringify(goal)}
事前検査: ${JSON.stringify({
    selectedCandidateId: preflight?.selectedCandidateId,
    selectedScores: preflight?.selectedScores,
    paretoCandidateIds: preflight?.paretoCandidateIds,
  })}
登録構造との完全一致: ${knowledgeMatch ? "はい（形状を完成作品とはみなさない）" : "いいえ"}

最初の画像はOrieditaが計算した2Dの折り上がり画像です。2枚目がある場合はユーザーの参考画像です。
0°・90°・180°・270°の回転は同一として、設計条件の部位が輪郭で識別できるかを評価してください。
Orieditaの画像を立体完成形、折り順、物理的に制作可能であることの証明とは扱わないでください。
不足部位、向き、太さ、左右対称性など、次の再生成で直せる指摘をissuesへ日本語で入れてください。

次の形のJSONオブジェクトだけを返してください:
{"score":0から100の整数,"iterations":1,"stop_reason":"groq_visual_judge","summary":"短い日本語の評価","issues":["具体的な改善点"]}`;
}

export async function requestGroqEvaluation({
  apiKey,
  model = DEFAULT_GROQ_MODEL,
  endpoint = DEFAULT_GROQ_ENDPOINT,
  prompt,
  goal,
  preflight,
  cycle = 1,
  knowledgeMatch = null,
  foldedImage,
  referenceImage = null,
  timeoutMs = 90_000,
  fetchImpl = fetch,
}) {
  if (!apiKey?.trim()) throw new Error("GROQ_API_KEYが設定されていません");
  if (!foldedImage?.mimeType || !foldedImage?.data) {
    throw new Error("Orieditaの折り上がり画像がありません");
  }

  const content = [
    { type: "text", text: evaluationPrompt({ prompt, goal, preflight, cycle, knowledgeMatch }) },
    {
      type: "image_url",
      image_url: { url: `data:${foldedImage.mimeType};base64,${foldedImage.data}` },
    },
  ];
  if (referenceImage?.mimeType && referenceImage?.data) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${referenceImage.mimeType};base64,${referenceImage.data}` },
    });
  }

  const requestBody = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: "あなたは折り紙の輪郭評価担当です。観察できる範囲だけを採点し、必ず有効なJSONオブジェクトだけを返します。",
      },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    reasoning_effort: "none",
    reasoning_format: "hidden",
    temperature: 0.7,
    top_p: 0.8,
    max_completion_tokens: 500,
    stream: false,
  });

  let response;
  let payload;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    timeout.unref?.();
    try {
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
    } catch (error) {
      if (attempt === 7) {
        if (error?.name === "AbortError") throw new Error("Groqの評価がタイムアウトしました");
        throw new Error("Groq APIへ接続できませんでした");
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(8_000, 1_000 * 2 ** attempt)));
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) break;
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "";
    const retryableGeneration = response.status === 400 && /failed to (?:generate|validate) json/i.test(message);
    if (response.status !== 429 && response.status < 500 && !retryableGeneration) {
      throw new Error(message ? `Groq API: ${message}` : `Groq APIがHTTP ${response.status}を返しました`);
    }
    if (attempt === 7) {
      throw new Error(response.status === 429
        ? "Groq APIの利用上限が続いています。時間をおいて再実行してください"
        : "Groq APIの評価を再試行しても完了できませんでした");
    }
    const retryAfterHeader = Number(response.headers?.get?.("retry-after"));
    const retryAfterMessage = Number(message.match(/try again in ([\d.]+)s/i)?.[1]);
    const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader
      : Number.isFinite(retryAfterMessage) && retryAfterMessage > 0
        ? retryAfterMessage
        : Math.min(30, 2 ** attempt);
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.ceil(retryAfterSeconds * 1000) + 750));
  }

  if (!response?.ok) throw new Error("Groq APIの評価を完了できませんでした");
  const contentText = payload?.choices?.[0]?.message?.content;
  if (typeof contentText !== "string") throw new Error("Groq APIの評価本文がありません");
  let judge;
  try {
    judge = JSON.parse(contentText);
  } catch {
    throw new Error("Groq APIの評価JSONを読み取れませんでした");
  }
  return {
    judge: normalizeGroqJudge(judge),
    metadata: {
      provider: "groq",
      model: payload?.model ?? model,
      requestId: response.headers?.get?.("x-request-id") ?? null,
      usage: payload?.usage ?? null,
    },
  };
}
