"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import OrigamiSimulator3D from "./OrigamiSimulator3D";
import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
  hashString,
} from "./origami-engine";

const initialPrompt = "";

type UploadedImage = {
  file: File;
  name: string;
  size: number;
  url: string;
};

type Evaluation = {
  score: number;
  iterations: number;
  stop_reason: string;
  summary: string;
  issues: string[];
  mode?: string;
  physical?: { score: number; orieditaCompleted: boolean };
  appearance?: { score: number; rotationNormalized: boolean; dimensions: string };
  foldability?: { score: number; layerCount: string; clearanceIsProxy: boolean };
  maxCycles?: number;
  targetScore?: number;
  bestCycle?: number;
  cycles?: Array<{ cycle: number; status: string; score: number; issues: string[] }>;
};

type OrieditaResult = {
  evaluation: Evaluation;
  knowledgeMatch: {
    id: string;
    title: string;
    family: string;
    category: string;
    params: Record<string, unknown>;
    license: string;
    foldability: string;
    source: string;
  } | null;
  creaseImage: string;
  foldedImage: string;
  foldFile: string;
};

type LocalJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  message: string;
  result: OrieditaResult | null;
  error: string | null;
  progress?: {
    cycle: number;
    maxCycles: number;
    bestScore: number | null;
    step?: number;
    maxSteps?: number;
    evaluatedNodes?: number;
    mode?: string;
  } | null;
};

const configuredApiServer = process.env.NEXT_PUBLIC_ORI_AI_API_URL?.trim();
const apiServer = (configuredApiServer || "http://127.0.0.1:8788").replace(/\/$/, "");
const apiIsLoopback = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(apiServer);

function apiFetch(path: string, init?: RequestInit) {
  const options = {
    ...init,
    mode: "cors",
    ...(apiIsLoopback ? { targetAddressSpace: "loopback" as const } : {}),
  } as RequestInit & { targetAddressSpace?: "loopback" };
  return fetch(`${apiServer}${path}`, options);
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("画像を読み取れませんでした"));
    reader.readAsDataURL(file);
  });
}

async function waitForJob(id: string, onProgress?: (job: LocalJob) => void) {
  let transientFailures = 0;
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1200 : 2500));
    let response: Response;
    try {
      response = await apiFetch(`/jobs/${id}`);
    } catch {
      transientFailures += 1;
      if (transientFailures <= 12) continue;
      throw new Error("処理状況の通信が繰り返し途切れました");
    }
    if (response.status >= 500 && transientFailures < 12) {
      transientFailures += 1;
      continue;
    }
    const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理状況を取得できませんでした");
    transientFailures = 0;
    onProgress?.(payload.job);
    if (payload.job.status === "done" && payload.job.result) return payload.job.result;
    if (payload.job.status === "failed") throw new Error(payload.job.error ?? "Oriedita処理に失敗しました");
  }
  throw new Error("Oriedita処理がタイムアウトしました");
}

export default function Home() {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [message, setMessage] = useState("");
  const [runState, setRunState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [orieditaResult, setOrieditaResult] = useState<OrieditaResult | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => () => {
    if (image?.url) URL.revokeObjectURL(image.url);
  }, [image]);

  useEffect(() => {
    if (runState !== "running" || startedAt == null) return;
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [runState, startedAt]);

  function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage("画像ファイルを選んでください");
      return;
    }
    setImage({ file, name: file.name, size: file.size, url: URL.createObjectURL(file) });
    setMessage("");
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (runState === "running") return;
    if (!prompt.trim() && !image) {
      setMessage("プロンプトか画像を追加してください");
      return;
    }
    setOrieditaResult(null);
    setRunState("running");
    const runStartedAt = Date.now();
    setStartedAt(runStartedAt);
    setElapsedSeconds(0);
    setMessage("折り線を一手ずつ追加して評価します");

    try {
      const analysis = analyzeDescription(prompt || image?.name || "折り紙");
      const seed = hashString(`${prompt}-${image?.name ?? ""}-${image?.size ?? 0}`);
      const generated = generateCandidates({
        description: prompt || image?.name || "折り紙",
        parts: analysis.parts,
        complexity: 3,
        symmetry: true,
        seed,
      });
      const folds = generated.map((item) =>
        JSON.parse(candidateToFold(item, prompt || image?.name || "折り紙")),
      );
      const response = await apiFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          referenceImage: image ? await fileToDataUrl(image.file) : null,
          fold: folds[0],
          candidates: folds,
          goal: {
            presetKey: analysis.presetKey,
            symmetry: true,
            parts: analysis.parts.map(({ label, importance, direction }) => ({ label, importance, direction })),
          },
        }),
      });
      const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理サーバーへ接続できませんでした");
      const result = await waitForJob(payload.job.id, (job) => {
        if (job.progress?.step || job.progress?.cycle) {
          const step = job.progress.step ?? job.progress.cycle;
          const maximum = job.progress.maxSteps ?? job.progress.maxCycles;
          const best = job.progress.bestScore == null ? "" : `・現在の最高${job.progress.bestScore}点`;
          setMessage(`折り線を一手ずつ追加・評価 ${step}/${maximum}${best}`);
        }
      });
      setOrieditaResult(result);
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - runStartedAt) / 1000)));
      setStartedAt(null);
      setRunState("done");
      setMessage(result.knowledgeMatch
        ? `知識ベースから「${result.knowledgeMatch.title}」を表示しました`
        : `${result.evaluation.iterations}手の追加・評価が完了。最良評価${result.evaluation.score}点`);
    } catch (error) {
      setElapsedSeconds(Math.max(1, Math.floor((Date.now() - runStartedAt) / 1000)));
      setStartedAt(null);
      setRunState("error");
      setMessage(error instanceof Error ? error.message : "処理サーバーへ接続できませんでした");
    }
  }

  return (
    <main className="generatorPage">
      <header className="simpleHeader">
        <a href="./" className="simpleLogo" aria-label="ORIAI ホーム">ORIAI</a>
      </header>

      <form className="promptArea" onSubmit={generate}>
        <label className="promptField" htmlFor="prompt">
          <span>つくりたい折り紙を入力</span>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="つくりたい形を自由に入力"
            rows={3}
            maxLength={200}
          />
        </label>

        <div className={`uploadField ${image ? "hasImage" : ""}`}>
          <input id="reference-image" type="file" accept="image/*" onChange={handleImage} />
          <label htmlFor="reference-image">
            {image ? (
              <>
                {/* User-selected object URLs cannot be handled by next/image. */}
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
              onClick={() => setImage(null)}
            >
              ×
            </button>
          )}
        </div>

        <button className="generate" type="submit" disabled={runState === "running"}>
          {runState === "running" ? "一手ずつ設計中…" : runState === "error" ? "再接続して生成" : "生成する"}
          <span>{runState === "idle" ? "→" : `${elapsedSeconds}秒`}</span>
        </button>
        <p className="srOnly" role="status" aria-live="polite">{message}</p>
      </form>

      {runState === "done" && orieditaResult && (
        <section className="outputs" aria-label="生成結果">
          <article className="outputPanel">
            <div className="outputTitle">
              <h1>展開図</h1>
              {orieditaResult.knowledgeMatch && <span>KNOWLEDGE MATCH</span>}
            </div>
            <div className="creaseStage">
              {/* Oriedita returns a local data URL after the completed run. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="orieditaCrease" src={orieditaResult.creaseImage} alt="Orieditaで検証した展開図" />
            </div>
          </article>

          <article className="outputPanel">
            <div className="modelTitle">
              <h1>完成形 3D</h1>
              <span>{orieditaResult.knowledgeMatch
                ? orieditaResult.knowledgeMatch.title
                : `ORIEDITA SCORE ${orieditaResult.evaluation.score}`}</span>
            </div>
            <div className="modelStage">
              <OrigamiSimulator3D foldFile={orieditaResult.foldFile} />
              <figure className={`foldedEvidence ${orieditaResult.knowledgeMatch ? "knowledgeEvidence" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={orieditaResult.foldedImage} alt="Orieditaの折り上がり検証画像" />
                <figcaption>{orieditaResult.knowledgeMatch
                  ? `${orieditaResult.knowledgeMatch.license} · ORIEDITA`
                  : "ORIEDITA"}</figcaption>
              </figure>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
