"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import Origami3D from "./Origami3D";
import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
  hashString,
  type Candidate,
} from "./origami-engine";

const initialPrompt = "大きな尾びれの金魚";
const initialAnalysis = analyzeDescription(initialPrompt);
const initialCandidate = generateCandidates({
  description: initialPrompt,
  parts: initialAnalysis.parts,
  complexity: 3,
  symmetry: true,
  seed: 26,
})[0];

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

async function waitForJob(id: string) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 4 ? 1200 : 2500));
    const response = await apiFetch(`/jobs/${id}`);
    const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
    if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理状況を取得できませんでした");
    if (payload.job.status === "done" && payload.job.result) return payload.job.result;
    if (payload.job.status === "failed") throw new Error(payload.job.error ?? "Oriedita処理に失敗しました");
  }
  throw new Error("Oriedita処理がタイムアウトしました");
}

function CreasePattern({ candidate }: { candidate: Candidate }) {
  return (
    <svg className="creasePattern" viewBox="0 0 600 600" role="img" aria-label="生成された折り紙の展開図">
      <defs>
        <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M30 0H0V30" fill="none" stroke="rgba(19,34,60,.07)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="600" height="600" className="paper" />
      <rect width="600" height="600" fill="url(#grid)" />
      {candidate.edges.map((edge, index) => {
        const [from, to] = edge.vertices;
        const [x1, y1] = candidate.vertices[from];
        const [x2, y2] = candidate.vertices[to];
        return (
          <line
            key={`${from}-${to}-${index}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={`foldLine fold${edge.assignment}`}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <circle cx="300" cy="300" r="6" className="foldCenter" />
    </svg>
  );
}

export default function Home() {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [candidate, setCandidate] = useState(initialCandidate);
  const [modelKey, setModelKey] = useState(initialAnalysis.presetKey);
  const [message, setMessage] = useState("");
  const [runState, setRunState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [orieditaResult, setOrieditaResult] = useState<OrieditaResult | null>(null);

  useEffect(() => () => {
    if (image?.url) URL.revokeObjectURL(image.url);
  }, [image]);

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
    const analysis = analyzeDescription(prompt || image?.name || "折り紙");
    const seed = hashString(`${prompt}-${image?.name ?? ""}-${image?.size ?? 0}`);
    const next = generateCandidates({
      description: prompt || image?.name || "折り紙",
      parts: analysis.parts,
      complexity: 3,
      symmetry: true,
      seed,
    })[0];
    setCandidate(next);
    setModelKey(analysis.presetKey);
    setOrieditaResult(null);
    setRunState("running");
    setMessage("CodexがOrieditaを操作しています");

    try {
      const response = await apiFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          referenceImage: image ? await fileToDataUrl(image.file) : null,
          fold: JSON.parse(candidateToFold(next, prompt || image?.name || "折り紙")),
        }),
      });
      const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理サーバーへ接続できませんでした");
      const result = await waitForJob(payload.job.id);
      setOrieditaResult(result);
      if (result.knowledgeMatch) setModelKey(result.knowledgeMatch.family);
      setRunState("done");
      setMessage(result.knowledgeMatch
        ? `知識ベースから「${result.knowledgeMatch.title}」を表示しました`
        : `Orieditaで${result.evaluation.iterations}回検証しました。評価${result.evaluation.score}点`);
    } catch (error) {
      setRunState("error");
      setMessage(error instanceof Error ? error.message : "処理サーバーへ接続できませんでした");
    }
  }

  return (
    <main className="generatorPage">
      <div className="dreamDecor" aria-hidden="true">
        <div className="sparkleField">
          {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
        </div>
        <div className="bubbleField">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </div>
        <div className="swimmingFishTrack">
          <div className="swimmingFish">
            <div className="fishTrail">
              {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
            </div>
            {/* Two clipped copies let only the tail move while preserving the illustration. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="fishBody" src="./dream-fish.png" alt="" draggable={false} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="fishTail" src="./dream-fish.png" alt="" draggable={false} />
          </div>
        </div>
      </div>

      <header className="simpleHeader">
        <a href="./" className="simpleLogo" aria-label="ORI AI ホーム">ORI <i>/</i> AI</a>
      </header>

      <form className="promptArea" onSubmit={generate}>
        <label className="promptField" htmlFor="prompt">
          <span>つくりたい折り紙を入力</span>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例：大きな尾びれの金魚"
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
          {runState === "running" ? "Orieditaで処理中…" : runState === "error" ? "再接続して生成" : "生成する"}
          <span>{runState === "running" ? "···" : "→"}</span>
        </button>
        <p className="srOnly" role="status" aria-live="polite">{message}</p>
      </form>

      <section className="outputs" aria-label="生成結果">
        <article className="outputPanel">
          <div className="outputTitle">
            <h1>展開図</h1>
            {orieditaResult?.knowledgeMatch && <span>KNOWLEDGE MATCH</span>}
          </div>
          <div className="creaseStage">
            {orieditaResult ? (
              // Oriedita returns a local data URL after the completed run.
              // eslint-disable-next-line @next/next/no-img-element
              <img className="orieditaCrease" src={orieditaResult.creaseImage} alt="Orieditaで検証した展開図" />
            ) : <CreasePattern candidate={candidate} />}
          </div>
        </article>

        <article className="outputPanel">
          <div className="modelTitle">
            <h1>完成形 3D</h1>
            <span>{orieditaResult?.knowledgeMatch
              ? orieditaResult.knowledgeMatch.title
              : orieditaResult ? `ORIEDITA SCORE ${orieditaResult.evaluation.score}` : "ドラッグで回転"}</span>
          </div>
          <div className="modelStage">
            <Origami3D modelKey={modelKey} />
            {orieditaResult && (
              <figure className={`foldedEvidence ${orieditaResult.knowledgeMatch ? "knowledgeEvidence" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={orieditaResult.foldedImage} alt="Orieditaの折り上がり検証画像" />
                <figcaption>{orieditaResult.knowledgeMatch
                  ? `${orieditaResult.knowledgeMatch.license} · ORIEDITA`
                  : "ORIEDITA"}</figcaption>
              </figure>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}
