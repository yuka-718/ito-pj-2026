"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import OrigamiSimulator3D from "./OrigamiSimulator3D";
import {
  evaluatedRubric,
  hasPassedIndependentEvaluation,
} from "./evaluation-target";
import {
  createCOrigamiFinalState,
  foldFromDataUrl,
  type COrigamiFinalState,
  type FinalStateStageId,
  type FoldDocument,
} from "./corigami-final-state";
import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
  hashString,
} from "./origami-engine";

const API_DISCOVERY_URL = "https://api.github.com/repos/yuka-718/oriai/contents/oriedita-upstream.json?ref=runtime";
const API_RECONNECT_ATTEMPTS = 30;
const API_RECONNECT_DELAY_MS = 2_000;
const ACTIVE_JOB_STORAGE_KEY = "oriai:active-codex-job:v1";
let cachedApiOrigin = "";

type UploadedImage = {
  file: File;
  name: string;
  url: string;
};

type EvaluationStep = {
  step: number;
  score: number;
  status: string;
};

type Evaluation = {
  score: number;
  iterations: number;
  summary: string;
  mode: string;
  passed?: boolean;
  appearance?: { score?: number };
  physical?: {
    foldCompleted?: boolean;
    forbiddenOperationsAbsent?: boolean;
    violationFree?: boolean;
    passed?: boolean;
  };
  rubric?: {
    motifRecognizability: number;
    requiredParts: number;
    proportionBalance: number;
    referenceSimilarity: number | null;
  };
  judges?: {
    count: number;
    passVotes: number;
    requiredVotes: number;
    aggregation: string;
  };
  models?: {
    operator?: { model?: string; reasoningEffort?: string };
    intermediate?: { model?: string; reasoningEffort?: string };
    final?: { model?: string; reasoningEffort?: string; runs?: number };
  };
  steps?: EvaluationStep[];
};

type OrieditaResult = {
  evaluation: Evaluation;
  creaseImage: string;
  foldedImage: string;
  foldFile: string;
  sourceFoldFile?: string;
};

type DisplayResult = OrieditaResult & {
  finalState: COrigamiFinalState;
};

type StoredActiveJob = {
  id: string;
  description: string;
  startedAt: number;
};

type LocalJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  message: string;
  result: OrieditaResult | null;
  error: string | null;
};

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("画像を読み取れませんでした"));
    reader.readAsDataURL(file);
  });
}

async function resolveApiOrigin(force = false) {
  if (!force && cachedApiOrigin) return cachedApiOrigin;
  if (["127.0.0.1", "localhost"].includes(window.location.hostname)) {
    cachedApiOrigin = `http://${window.location.hostname}:8788`;
    return cachedApiOrigin;
  }
  const discovery = new URL(API_DISCOVERY_URL);
  discovery.searchParams.set("refresh", String(Date.now()));
  const response = await fetch(discovery, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github.raw+json" },
  });
  if (!response.ok) throw new Error("Oriedita実行環境を見つけられませんでした");
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Oriedita実行環境のURLが不正です");
  const origin = new URL(payload.url).origin;
  if (!origin.startsWith("https://")) throw new Error("Oriedita実行環境へ安全に接続できません");
  cachedApiOrigin = origin;
  return origin;
}

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function readStoredActiveJob() {
  try {
    const value = JSON.parse(window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY) ?? "null") as Partial<StoredActiveJob> | null;
    if (!value || typeof value.id !== "string" || typeof value.description !== "string"
      || typeof value.startedAt !== "number" || !Number.isFinite(value.startedAt)) return null;
    return value as StoredActiveJob;
  } catch {
    return null;
  }
}

function writeStoredActiveJob(job: StoredActiveJob | null) {
  try {
    if (job) window.localStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(job));
    else window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
  } catch {
    // A private browsing/storage failure must not stop the active server job.
  }
}

function createDisplayResult(completed: OrieditaResult, description: string): DisplayResult {
  const checkedFold = foldFromDataUrl(completed.foldFile);
  if (!checkedFold) {
    throw new Error("検証済みの最終FOLDを読み取れなかったため、結果を表示できませんでした");
  }
  const analysis = analyzeDescription(description);
  return {
    ...completed,
    finalState: createCOrigamiFinalState(checkedFold, analysis.parts, description),
  };
}

async function waitForApiOrigin() {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < API_RECONNECT_ATTEMPTS; attempt += 1) {
    try {
      const origin = await resolveApiOrigin(attempt > 0);
      const response = await fetch(`${origin}/health`, { mode: "cors", cache: "no-store" });
      if (response.ok) return origin;
      lastError = new Error("生成サーバーが再接続中です");
    } catch (error) {
      lastError = error;
    }
    cachedApiOrigin = "";
    if (attempt + 1 < API_RECONNECT_ATTEMPTS) await delay(API_RECONNECT_DELAY_MS);
  }
  throw new Error(
    lastError instanceof Error && !/Failed to fetch/i.test(lastError.message)
      ? lastError.message
      : "生成サーバーへ接続できませんでした。少し待ってからもう一度お試しください",
  );
}

async function apiFetch(path: string, init?: RequestInit) {
  if ((init?.method ?? "GET").toUpperCase() === "POST") {
    const origin = await waitForApiOrigin();
    try {
      return await fetch(`${origin}${path}`, { ...init, mode: "cors", cache: "no-store" });
    } catch {
      cachedApiOrigin = "";
      throw new Error("生成サーバーとの通信が切れました。もう一度お試しください");
    }
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const origin = await resolveApiOrigin(attempt > 0);
      const response = await fetch(`${origin}${path}`, { ...init, mode: "cors", cache: "no-store" });
      if (response.status >= 500 && attempt < 5) {
        cachedApiOrigin = "";
        await delay(1_000);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      cachedApiOrigin = "";
      if (attempt < 5) await delay(1_000);
    }
  }
  throw new Error(
    lastError instanceof Error && !/Failed to fetch/i.test(lastError.message)
      ? lastError.message
      : "生成サーバーとの通信が切れました。再接続しています",
  );
}

async function waitForJob(id: string, onMessage: (message: string) => void, signal?: AbortSignal) {
  for (let attempt = 0; ; attempt += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 1200 : 2500));
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    let response: Response;
    try {
      response = await apiFetch(`/jobs/${id}`);
    } catch {
      continue;
    }

    let payload: { ok: boolean; job?: LocalJob; error?: string };
    try {
      payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
    } catch {
      continue;
    }

    if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理状況を取得できませんでした");
    onMessage(payload.job.message);
    if (payload.job.status === "done" && payload.job.result) {
      if (!hasPassedIndependentEvaluation(payload.job.result.evaluation)) {
        throw new Error("独立した最終評価の合格証跡を確認できませんでした");
      }
      return payload.job.result;
    }
    if (payload.job.status === "failed") throw new Error(payload.job.error ?? "生成に失敗しました");
    if (payload.job.status === "cancelled") throw new Error("生成を中止しました");
  }
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [result, setResult] = useState<DisplayResult | null>(null);
  const [activeStageId, setActiveStageId] = useState<FinalStateStageId>("angle-preview");
  const [runState, setRunState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);

  useEffect(() => () => {
    if (image?.url) URL.revokeObjectURL(image.url);
  }, [image]);

  useEffect(() => {
    if (runState !== "running") return;
    const startedAt = runStartedAt ?? Date.now();
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [runStartedAt, runState]);

  useEffect(() => {
    const stored = readStoredActiveJob();
    if (!stored) return;
    const controller = new AbortController();
    const resumeTimer = window.setTimeout(() => {
      setPrompt(stored.description);
      setResult(null);
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - stored.startedAt) / 1_000)));
      setRunStartedAt(stored.startedAt);
      setRunState("running");
      setMessage("Terraが操作し、独立したSolが0〜5基準で評価中");
      void waitForJob(stored.id, setMessage, controller.signal).then((completed) => {
        if (controller.signal.aborted) return;
        setResult(createDisplayResult(completed, stored.description));
        setRunState("idle");
        setRunStartedAt(null);
        setMessage("生成が完了しました");
        writeStoredActiveJob(null);
      }).catch((error) => {
        if (controller.signal.aborted) return;
        setRunState("error");
        setRunStartedAt(null);
        setMessage(error instanceof Error ? error.message : "生成できませんでした");
        writeStoredActiveJob(null);
      });
    }, 0);
    return () => {
      window.clearTimeout(resumeTimer);
      controller.abort();
    };
  }, []);

  function resetResult() {
    setResult(null);
    setActiveStageId("angle-preview");
    setRunState("idle");
    setRunStartedAt(null);
    setMessage("");
  }

  function handlePrompt(event: ChangeEvent<HTMLTextAreaElement>) {
    setPrompt(event.target.value);
    if (result || runState === "error") resetResult();
  }

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setRunState("error");
      setMessage("画像ファイルを選んでください");
      return;
    }
    setImage({ file, name: file.name, url: URL.createObjectURL(file) });
    resetResult();
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runState === "running") return;
    const description = prompt.trim() || image?.name.replace(/\.[^.]+$/, "").trim() || "";
    if (!description) {
      setRunState("error");
      setMessage("つくりたい折り紙を入力するか、画像を追加してください");
      return;
    }

    setResult(null);
    setElapsedSeconds(0);
    const startedAt = Date.now();
    setRunStartedAt(startedAt);
    setRunState("running");
    setMessage("Terraが操作し、独立したSolが0〜5基準で評価中");

    try {
      const analysis = analyzeDescription(description);
      const seed = hashString(`${description}:${image?.file.size ?? 0}:${image?.file.lastModified ?? 0}`);
      const candidateModels = generateCandidates({
        description,
        parts: analysis.parts,
        complexity: 4,
        symmetry: true,
        seed,
      });
      const candidates = candidateModels.map((candidate) =>
        JSON.parse(candidateToFold(candidate, description)) as FoldDocument
      );
      const primaryFold = candidates[0];
      const response = await apiFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: description,
          referenceImage: image ? await fileToDataUrl(image.file) : null,
          fold: primaryFold,
          candidates,
          goal: {
            presetKey: analysis.presetKey,
            symmetry: true,
            parts: analysis.parts.map(({ label, importance, direction }) => ({ label, importance, direction })),
          },
        }),
      });
      const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "生成を開始できませんでした");
      writeStoredActiveJob({ id: payload.job.id, description, startedAt });
      const completed = await waitForJob(payload.job.id, setMessage);
      setResult(createDisplayResult(completed, description));
      setRunState("idle");
      setRunStartedAt(null);
      setMessage("生成が完了しました");
      writeStoredActiveJob(null);
    } catch (error) {
      setRunState("error");
      setRunStartedAt(null);
      setMessage(error instanceof Error ? error.message : "生成できませんでした");
      writeStoredActiveJob(null);
    }
  }

  const activeStage = result?.finalState.stages.find((stage) => stage.id === activeStageId)
    ?? result?.finalState.stages[0]
    ?? null;
  const finalRubric = evaluatedRubric(result?.evaluation);

  return (
    <main className="generatorPage">
      <header className="simpleHeader">
        <a href="./" className="simpleLogo" aria-label="ORIAI ホーム">ORIAI</a>
      </header>

      <form className="promptArea" onSubmit={generate}>
        <label className="promptField" htmlFor="prompt">
          <span className={runState === "error" ? "fieldError" : undefined}>
            {runState === "error"
              ? message
              : runState === "running"
                ? "展開図と4段階の最終状態を生成中…"
                : "つくりたい折り紙を入力"}
          </span>
          <textarea
            id="prompt"
            value={prompt}
            onChange={handlePrompt}
            placeholder="例：翼を広げた鶴"
            rows={3}
            maxLength={200}
            disabled={runState === "running"}
          />
        </label>

        <div className={`uploadField ${image ? "hasImage" : ""}`}>
          <input id="reference-image" type="file" accept="image/*" onChange={handleImage} disabled={runState === "running"} />
          <label htmlFor="reference-image">
            {image ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image.url} alt="アップロードした参考画像" />
                <span>{image.name}</span>
              </>
            ) : (
              <>
                <b aria-hidden="true">＋</b>
                <span>画像をアップロード</span>
              </>
            )}
          </label>
          {image && (
            <button
              type="button"
              className="removeImage"
              aria-label="アップロード画像を削除"
              disabled={runState === "running"}
              onClick={() => {
                setImage(null);
                resetResult();
              }}
            >×</button>
          )}
        </div>

        <button className="generate" type="submit" disabled={runState === "running"}>
          {runState === "running" ? `生成中… ${elapsedSeconds}秒` : runState === "error" ? "もう一度生成" : "生成する"}
          <span aria-hidden="true">{runState === "running" ? "◇" : "→"}</span>
        </button>
        <p className="srOnly" role="status" aria-live="polite">{message}</p>
      </form>

      {result && hasPassedIndependentEvaluation(result.evaluation) && (
        <section className="outputs" aria-label="生成結果">
          <div className="phaseOneGrid">
            <article className="outputPanel creasePanel">
              <div className="outputTitle">
                <h1><b>1A</b> 展開図</h1>
                <span>ORIEDITA CHECKED</span>
              </div>
              <div className="creaseStage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="orieditaCrease" src={result.creaseImage} alt="Orieditaで検証した展開図" />
              </div>
              <div className="artifactBar">
                <span>局所平坦折り・2D計算</span>
                <a href={result.foldFile} download="oriai-final.fold">FOLDを保存</a>
              </div>
            </article>

            <article className="outputPanel foldedPanel">
              <div className="foldedTitle">
                <h1><b>1B</b> 折り上がり 2D</h1>
                <span>FLAT FOLD</span>
              </div>
              <div className="folded2dStage">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result.foldedImage} alt="Orieditaが計算した2D折り上がり" />
              </div>
              <div className="artifactBar">
                <span>Oriedita flat-fold completed</span>
                <span>{result.evaluation.mode}</span>
              </div>
            </article>
          </div>

          {finalRubric && (
            <article className="evaluationPanel" aria-label="独立AI評価">
              <header>
                <div>
                  <p>INDEPENDENT FINAL REVIEW</p>
                  <h1>操作AIと評価AIを分離</h1>
                </div>
                <strong>合格</strong>
              </header>
              <div className="evaluationFlow">
                <span>操作 {result.evaluation.models?.operator?.model ?? "gpt-5.6-terra"} / high</span>
                <i aria-hidden="true">→</i>
                <span>途中評価 {result.evaluation.models?.intermediate?.model ?? "gpt-5.6-terra"} / medium</span>
                <i aria-hidden="true">→</i>
                <span>最終評価 {result.evaluation.models?.final?.model ?? "gpt-5.6-sol"} / high ×3</span>
              </div>
              <dl className="rubricGrid">
                <div><dt>モチーフ認識</dt><dd>{finalRubric.motifRecognizability}<small>/5</small></dd></div>
                <div><dt>必要な部位</dt><dd>{finalRubric.requiredParts}<small>/5</small></dd></div>
                <div><dt>比率・バランス</dt><dd>{finalRubric.proportionBalance}<small>/5</small></dd></div>
                <div><dt>参照画像との類似</dt><dd>{finalRubric.referenceSimilarity ?? "—"}<small>{finalRubric.referenceSimilarity === null ? "画像なし" : "/5"}</small></dd></div>
              </dl>
              <footer>
                <span>折り完了 ✓</span>
                <span>禁止操作なし ✓</span>
                <span>違反なし ✓</span>
                <span>Sol多数決 {result.evaluation.judges?.passVotes}/{result.evaluation.judges?.count}</span>
              </footer>
            </article>
          )}

          {activeStage && (
            <article className="shapingPanel">
              <header className="shapingHeader">
                <div>
                  <p>CORIGAMI-INSPIRED FINAL STATE</p>
                  <h1>折角・姿勢・細部造形</h1>
                </div>
                <div className="cpIdentity">
                  <span>SAME CP</span>
                  <code>{result.finalState.cpHash}</code>
                </div>
              </header>

              <div className="stageTabs" role="tablist" aria-label="造形段階">
                {result.finalState.stages.map((stage) => (
                  <button
                    key={stage.id}
                    type="button"
                    role="tab"
                    aria-selected={stage.id === activeStage.id}
                    className={stage.id === activeStage.id ? "isActive" : undefined}
                    onClick={() => setActiveStageId(stage.id)}
                  >
                    <b>0{stage.phase}</b>
                    <span>{stage.shortTitle}</span>
                  </button>
                ))}
              </div>

              <div className="shapingBody">
                <div className="shapingViewport">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="foldedModelFallback" src={result.foldedImage} alt="3D表示読込中の2D折り上がり" />
                  <OrigamiSimulator3D foldFile={activeStage.foldFile} />
                  <span className="dragHint">DRAG TO ROTATE</span>
                </div>

                <aside className="stageInspector">
                  <div className="stageNumber">PHASE 0{activeStage.phase}</div>
                  <h2>{activeStage.title}</h2>
                  <p>{activeStage.description}</p>

                  <dl className="angleStats">
                    <div><dt>ACTIVE HINGES</dt><dd>{activeStage.angleSummary.activeCreases}</dd></div>
                    <div><dt>ANGLE RANGE</dt><dd>{activeStage.angleSummary.minimumDeg}–{activeStage.angleSummary.maximumDeg}°</dd></div>
                  </dl>

                  <div className="operationList">
                    <h3>{activeStage.id === "angle-preview" ? "角度設定" : "造形操作"}</h3>
                    {activeStage.operations.map((operation) => (
                      <div className="operationCard" key={operation.id}>
                        <span>{operation.kind.replace("_", " ")}</span>
                        <b>{operation.partLabel}</b>
                        <p>{operation.instructionJa}</p>
                      </div>
                    ))}
                  </div>

                  <div className="validationBadges" aria-label="検証範囲">
                    <span className="checked">同一CPグラフ</span>
                    <span>ゼロ厚みpreview</span>
                    <span>衝突未検証</span>
                  </div>
                  <a className="downloadFold" href={activeStage.foldFile} download={`oriai-phase-${activeStage.phase}.fold`}>
                    この段階のFOLDを保存 <span aria-hidden="true">↓</span>
                  </a>
                </aside>
              </div>

              <footer className="scopeNote">
                <strong>COrigami-inspired clean-room実装</strong>
                <span>第1段階はOriedita検証済み。第2〜4段階は折順ではなく、同じ展開図へ折角を与えた最終状態previewです。紙厚・自己衝突は未検証です。</span>
              </footer>
            </article>
          )}
        </section>
      )}
    </main>
  );
}
