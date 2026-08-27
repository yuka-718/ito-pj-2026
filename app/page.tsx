"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import OrigamiSimulator3D from "./OrigamiSimulator3D";
import {
  analyzeDescription,
  candidateToFold,
  generateCandidates,
  hashString,
} from "./origami-engine";

const API_DISCOVERY_URL = "https://raw.githubusercontent.com/yuka-718/oriai/runtime/oriedita-upstream.json";
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
  steps?: EvaluationStep[];
};

type OrieditaResult = {
  evaluation: Evaluation;
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
  const discovery = new URL(API_DISCOVERY_URL);
  discovery.searchParams.set("refresh", String(Date.now()));
  const response = await fetch(discovery, { cache: "no-store" });
  if (!response.ok) throw new Error("Oriedita実行環境を見つけられませんでした");
  const payload = await response.json() as { url?: unknown };
  if (typeof payload.url !== "string") throw new Error("Oriedita実行環境のURLが不正です");
  const origin = new URL(payload.url).origin;
  if (!origin.startsWith("https://")) throw new Error("Oriedita実行環境へ安全に接続できません");
  cachedApiOrigin = origin;
  return origin;
}

async function apiFetch(path: string, init?: RequestInit) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const origin = await resolveApiOrigin(attempt > 0 || init?.method === "POST");
      const response = await fetch(`${origin}${path}`, { ...init, mode: "cors", cache: "no-store" });
      if (response.status >= 500 && attempt === 0) {
        cachedApiOrigin = "";
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      cachedApiOrigin = "";
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Oriedita実行環境へ接続できませんでした");
}

async function waitForJob(id: string, onMessage: (message: string) => void) {
  let transientFailures = 0;
  for (let attempt = 0; attempt < 720; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 1200 : 2500));
    try {
      const response = await apiFetch(`/jobs/${id}`);
      const payload = await response.json() as { ok: boolean; job?: LocalJob; error?: string };
      if (!response.ok || !payload.job) throw new Error(payload.error ?? "処理状況を取得できませんでした");
      transientFailures = 0;
      onMessage(payload.job.message);
      if (payload.job.status === "done" && payload.job.result) return payload.job.result;
      if (payload.job.status === "failed") throw new Error(payload.job.error ?? "生成に失敗しました");
    } catch (error) {
      transientFailures += 1;
      if (transientFailures > 12) throw error;
    }
  }
  throw new Error("生成処理がタイムアウトしました");
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [result, setResult] = useState<OrieditaResult | null>(null);
  const [runState, setRunState] = useState<"idle" | "running" | "error">("idle");
  const [message, setMessage] = useState("");

  useEffect(() => () => {
    if (image?.url) URL.revokeObjectURL(image.url);
  }, [image]);

  function resetResult() {
    setResult(null);
    setRunState("idle");
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
    setRunState("running");
    setMessage("CodexがOrieditaを準備中");

    try {
      const analysis = analyzeDescription(description);
      const seed = hashString(`${description}:${image?.file.size ?? 0}:${image?.file.lastModified ?? 0}`);
      const candidates = generateCandidates({
        description,
        parts: analysis.parts,
        complexity: 4,
        symmetry: true,
        seed,
      }).map((candidate) => JSON.parse(candidateToFold(candidate, description)));
      const response = await apiFetch("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: description,
          referenceImage: image ? await fileToDataUrl(image.file) : null,
          fold: candidates[0],
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
      const completed = await waitForJob(payload.job.id, setMessage);
      setResult(completed);
      setRunState("idle");
      setMessage("生成が完了しました");
    } catch (error) {
      setRunState("error");
      setMessage(error instanceof Error ? error.message : "生成できませんでした");
    }
  }

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
                ? "CodexがOrieditaを操作・評価中…"
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
          {runState === "running" ? "生成中…" : runState === "error" ? "もう一度生成" : "生成する"}
          <span aria-hidden="true">{runState === "running" ? "◇" : "→"}</span>
        </button>
        <p className="srOnly" role="status" aria-live="polite">{message}</p>
      </form>

      {result && (
        <section className="outputs" aria-label="生成結果">
          <article className="outputPanel">
            <div className="outputTitle">
              <h1>展開図</h1>
              <span>CODEX × ORIEDITA</span>
            </div>
            <div className="creaseStage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="orieditaCrease" src={result.creaseImage} alt="CodexがOrieditaで作成した展開図" />
            </div>
          </article>

          <article className="outputPanel">
            <div className="modelTitle">
              <h1>完成形 3D</h1>
              <span>{result.evaluation.iterations} EVALUATIONS</span>
            </div>
            <div className="modelStage">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="foldedModelFallback" src={result.foldedImage} alt="Orieditaの折り上がり結果" />
              <OrigamiSimulator3D foldFile={result.foldFile} />
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
