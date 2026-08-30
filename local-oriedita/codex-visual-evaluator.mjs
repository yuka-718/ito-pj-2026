import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCHEMA = join(here, "visual-evaluation.schema.json");

export const ORIAI_OPERATOR_MODEL = process.env.ORI_AI_OPERATOR_MODEL?.trim() || "gpt-5.6-terra";
export const ORIAI_INTERMEDIATE_EVALUATOR_MODEL = process.env.ORI_AI_INTERMEDIATE_EVALUATOR_MODEL?.trim()
  || "gpt-5.6-terra";
export const ORIAI_FINAL_EVALUATOR_MODEL = process.env.ORI_AI_FINAL_EVALUATOR_MODEL?.trim()
  || "gpt-5.6-sol";
export const ORIAI_FINAL_JUDGE_COUNT = 3;

export const VISUAL_RUBRIC_THRESHOLDS = Object.freeze({
  motifRecognizability: 4,
  requiredParts: 4,
  proportionBalance: 3,
  referenceSimilarity: 3,
});

function cleanText(value, maximum = 800, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maximum) || fallback : fallback;
}

function cleanIssues(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => cleanText(item, 240)).filter(Boolean))].slice(0, 8)
    : [];
}

function rubricScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(5, Math.round(score))) : 0;
}

function referenceScore(value, hasReference) {
  return hasReference ? rubricScore(value) : null;
}

export function visualRubricPass(rubric, { hasReference = false } = {}) {
  return rubric?.motifRecognizability >= VISUAL_RUBRIC_THRESHOLDS.motifRecognizability
    && rubric?.requiredParts >= VISUAL_RUBRIC_THRESHOLDS.requiredParts
    && rubric?.proportionBalance >= VISUAL_RUBRIC_THRESHOLDS.proportionBalance
    && (!hasReference || rubric?.referenceSimilarity >= VISUAL_RUBRIC_THRESHOLDS.referenceSimilarity);
}

export function normalizeVisualJudgement(value, { hasReference = false, hasBest = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("独立画像評価の結果がJSONオブジェクトではありません");
  }
  const rubric = {
    motifRecognizability: rubricScore(value.motif_recognizability),
    requiredParts: rubricScore(value.required_parts),
    proportionBalance: rubricScore(value.proportion_balance),
    referenceSimilarity: referenceScore(value.reference_similarity, hasReference),
  };
  const allowedPreferences = hasBest
    ? new Set(["current", "best", "tie"])
    : new Set(["not_available"]);
  const preference = allowedPreferences.has(value.pairwise_preference)
    ? value.pairwise_preference
    : hasBest ? "tie" : "not_available";
  return {
    rubric,
    pairwisePreference: preference,
    passed: visualRubricPass(rubric, { hasReference }),
    summary: cleanText(value.summary, 800, "完成画像を独立評価しました"),
    issues: cleanIssues(value.issues),
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).toSorted((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function majorityPreference(judgements, hasBest) {
  if (!hasBest) return "not_available";
  const counts = { current: 0, best: 0, tie: 0 };
  for (const judgement of judgements) counts[judgement.pairwisePreference] += 1;
  const maximum = Math.max(counts.current, counts.best, counts.tie);
  const winners = Object.entries(counts).filter(([, count]) => count === maximum).map(([key]) => key);
  return winners.length === 1 ? winners[0] : "tie";
}

export function aggregateVisualJudgements(judgements, {
  hasReference = false,
  hasBest = false,
  model,
  reasoningEffort,
} = {}) {
  if (!Array.isArray(judgements) || !judgements.length) {
    throw new Error("集約する独立画像評価がありません");
  }
  const rubric = {
    motifRecognizability: median(judgements.map(({ rubric: item }) => item.motifRecognizability)),
    requiredParts: median(judgements.map(({ rubric: item }) => item.requiredParts)),
    proportionBalance: median(judgements.map(({ rubric: item }) => item.proportionBalance)),
    referenceSimilarity: hasReference
      ? median(judgements.map(({ rubric: item }) => item.referenceSimilarity))
      : null,
  };
  const requiredVotes = Math.floor(judgements.length / 2) + 1;
  const passVotes = judgements.filter(({ passed }) => passed).length;
  const passed = passVotes >= requiredVotes && visualRubricPass(rubric, { hasReference });
  const availableScores = Object.values(rubric).filter(Number.isFinite);
  const normalizedScore = availableScores.length
    ? Math.round((availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length) * 20)
    : 0;
  return {
    schema: "oriai-independent-visual-evaluation-v1",
    model,
    reasoningEffort,
    judgeCount: judgements.length,
    aggregation: judgements.length === 1 ? "single" : "median_and_majority",
    passVotes,
    requiredVotes,
    passed,
    normalizedScore,
    rubric,
    pairwisePreference: majorityPreference(judgements, hasBest),
    summary: judgements.map(({ summary }) => summary).find(Boolean) ?? "完成画像を独立評価しました",
    issues: [...new Set(judgements.flatMap(({ issues }) => issues))].slice(0, 12),
    judgements,
  };
}

function requiredPartLabels(goal) {
  const parts = Array.isArray(goal?.parts) ? goal.parts : [];
  return parts.map((part) => cleanText(part?.label ?? part?.name, 80)).filter(Boolean).slice(0, 12);
}

export function buildVisualEvaluationPrompt({
  stage,
  prompt,
  goal,
  hasReference = false,
  hasBest = false,
} = {}) {
  const finalStage = stage === "final";
  const imageOrder = [
    "1枚目: 評価対象の現在候補（Orieditaが計算した完成2D画像）",
    ...(hasReference ? ["2枚目: ユーザーが指定した参照画像"] : []),
    ...(hasBest ? [`${hasReference ? "3" : "2"}枚目: それまでのベスト候補の完成2D画像`] : []),
  ];
  return `あなたは折り紙完成画像の${finalStage ? "最終" : "途中"}評価だけを行う独立審査担当です。折り操作は行わず、過去の操作履歴・自己採点・以前の評価点は参照しません。

制作目標:
${JSON.stringify({ description: cleanText(prompt, 1_200), required_parts: requiredPartLabels(goal) }, null, 2)}

添付画像の順序:
${imageOrder.map((label) => `- ${label}`).join("\n")}

観察できる完成画像だけを、回転方向に依存せず次の明確な基準で評価してください。
- motif_recognizability: 指定モチーフとして認識できる度合い（0〜5）
- required_parts: 必要な部位が輪郭として存在する度合い（0〜5）
- proportion_balance: 比率・太さ・左右バランス（0〜5）
- reference_similarity: ${hasReference ? "参照画像との形状・比率の類似度（0〜5）" : "参照画像なしのためnull"}
- pairwise_preference: ${hasBest ? "現在候補が良ければcurrent、従来ベストが良ければbest、差がなければtie" : "比較画像なしのためnot_available"}

折りの物理完了や禁止操作の有無はサーバーが別途実測します。画像から推測して合格扱いにしないでください。説明の流暢さではなく画像内で確認できる形だけを根拠にし、指定JSONだけを返してください。`;
}

export function buildCodexVisualEvaluatorArgs({
  directory,
  outputPath,
  imagePaths,
  task,
  model,
  reasoningEffort,
  schemaPath = DEFAULT_SCHEMA,
} = {}) {
  return [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox", "read-only",
    "--model", model,
    "-c", "approval_policy=\"never\"",
    "--disable", "plugins",
    "--disable", "remote_plugin",
    "--disable", "plugin_sharing",
    "--disable", "apps",
    "--disable", "skill_search",
    "--disable", "recommended_plugins",
    "--disable", "hooks",
    "--disable", "code_mode",
    "--disable", "shell_tool",
    "--cd", resolve(directory),
    "--output-schema", resolve(schemaPath),
    "--output-last-message", resolve(outputPath),
    "--color", "never",
    "-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    ...imagePaths.flatMap((path) => ["--image", resolve(path)]),
    "--",
    task,
  ];
}

function evaluatorEnvironment(source = process.env) {
  return { ...source, NO_COLOR: "1" };
}

async function runOneVisualJudge({
  directory,
  candidateImagePath,
  referenceImagePath = null,
  bestImagePath = null,
  prompt,
  goal,
  stage,
  model,
  reasoningEffort,
  judgeIndex,
  timeoutMs,
  codexPath,
  signal,
}) {
  const judgeDirectory = join(directory, `${stage}-judge-${String(judgeIndex).padStart(2, "0")}`);
  const outputPath = join(judgeDirectory, "result.json");
  const logPath = join(judgeDirectory, "codex.log");
  await mkdir(judgeDirectory, { recursive: true, mode: 0o700 });
  await rm(outputPath, { force: true });
  const hasReference = Boolean(referenceImagePath);
  const hasBest = Boolean(bestImagePath);
  const task = buildVisualEvaluationPrompt({ stage, prompt, goal, hasReference, hasBest });
  const imagePaths = [candidateImagePath, ...(referenceImagePath ? [referenceImagePath] : []), ...(bestImagePath ? [bestImagePath] : [])];
  const args = buildCodexVisualEvaluatorArgs({
    directory: judgeDirectory,
    outputPath,
    imagePaths,
    task,
    model,
    reasoningEffort,
  });
  await writeFile(logPath, `Started ${new Date().toISOString()}\nmodel=${model}\nreasoning=${reasoningEffort}\n`, { mode: 0o600 });
  await new Promise((resolveRun, rejectRun) => {
    if (signal?.aborted) {
      const error = new Error("独立画像評価はキャンセルされました");
      error.name = "AbortError";
      rejectRun(error);
      return;
    }
    const child = spawn(codexPath, args, {
      cwd: judgeDirectory,
      env: evaluatorEnvironment(process.env),
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let settled = false;
    let childError = null;
    let timedOut = false;
    let forceKillTimer = null;
    let timer = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      signal?.removeEventListener?.("abort", abortRun);
      callback(value);
    };
    const terminate = (killSignal) => {
      try {
        if (process.platform !== "win32" && child.pid) process.kill(-child.pid, killSignal);
        else child.kill(killSignal);
      } catch (error) {
        if (error?.code !== "ESRCH") childError ??= error;
      }
    };
    const stopProcess = () => {
      terminate("SIGTERM");
      forceKillTimer = setTimeout(() => terminate("SIGKILL"), 5_000);
      forceKillTimer.unref?.();
    };
    const abortRun = () => stopProcess();
    signal?.addEventListener("abort", abortRun, { once: true });
    child.stdout.on("data", (chunk) => void writeFile(logPath, chunk, { flag: "a", mode: 0o600 }));
    child.stderr.on("data", (chunk) => void writeFile(logPath, chunk, { flag: "a", mode: 0o600 }));
    child.once("error", (error) => { childError = error; });
    child.once("close", (code, closeSignal) => {
      if (signal?.aborted) {
        const error = new Error("独立画像評価はキャンセルされました");
        error.name = "AbortError";
        finish(rejectRun, error);
      } else if (timedOut) {
        finish(rejectRun, new Error("独立画像評価がタイムアウトしました"));
      } else if (childError) finish(rejectRun, childError);
      else if (code === 0) finish(resolveRun);
      else finish(rejectRun, new Error(`独立画像評価Codexが終了しました (${code ?? closeSignal})`));
    });
    timer = setTimeout(() => {
      timedOut = true;
      stopProcess();
    }, Math.max(30_000, timeoutMs));
    timer.unref?.();
  });
  const raw = JSON.parse(await readFile(outputPath, "utf8"));
  return normalizeVisualJudgement(raw, { hasReference, hasBest });
}

export async function runIndependentVisualEvaluation({
  directory,
  candidateImagePath,
  referenceImagePath = null,
  bestImagePath = null,
  prompt,
  goal,
  stage = "intermediate",
  judgeCount = stage === "final" ? ORIAI_FINAL_JUDGE_COUNT : 1,
  model = stage === "final" ? ORIAI_FINAL_EVALUATOR_MODEL : ORIAI_INTERMEDIATE_EVALUATOR_MODEL,
  reasoningEffort = stage === "final" ? "high" : "medium",
  timeoutMs = 600_000,
  codexPath = process.env.ORI_AI_CODEX_PATH ?? "codex",
  signal = null,
} = {}) {
  const count = Math.max(1, Math.min(3, Math.floor(Number(judgeCount) || 1)));
  const judgements = [];
  for (let index = 1; index <= count; index += 1) {
    if (signal?.aborted) {
      const error = new Error("独立画像評価はキャンセルされました");
      error.name = "AbortError";
      throw error;
    }
    judgements.push(await runOneVisualJudge({
      directory,
      candidateImagePath,
      referenceImagePath,
      bestImagePath,
      prompt,
      goal,
      stage,
      model,
      reasoningEffort,
      judgeIndex: index,
      timeoutMs,
      codexPath,
      signal,
    }));
  }
  return aggregateVisualJudgements(judgements, {
    hasReference: Boolean(referenceImagePath),
    hasBest: Boolean(bestImagePath),
    model,
    reasoningEffort,
  });
}
