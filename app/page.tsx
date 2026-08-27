"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import Origami3D from "./Origami3D";
import {
  analyzeDescription,
  candidateToSvg,
  generateCandidates,
  hashString,
} from "./origami-engine";

type UploadedImage = {
  file: File;
  name: string;
  url: string;
};

type GeneratedResult = {
  title: string;
  creaseImage: string;
  modelKey: string;
  seed: number;
};

function imageName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "画像から作る折り紙";
}

function svgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<UploadedImage | null>(null);
  const [result, setResult] = useState<GeneratedResult | null>(null);
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

    const description = prompt.trim() || (image ? imageName(image.name) : "");
    if (!description) {
      setRunState("error");
      setMessage("つくりたい折り紙を入力するか、画像を追加してください");
      return;
    }

    setResult(null);
    setRunState("running");
    setMessage("展開図と3Dを生成中");

    try {
      // Give the running state a frame of its own so incomplete results never flash.
      await new Promise((resolve) => window.setTimeout(resolve, 700));
      const seed = hashString(`${description}:${image?.file.size ?? 0}:${image?.file.lastModified ?? 0}`);
      const analysis = analyzeDescription(description);
      const candidates = generateCandidates({
        description,
        parts: analysis.parts,
        complexity: 4,
        symmetry: true,
        seed,
      });
      const candidate = candidates[seed % candidates.length];
      const creaseImage = svgDataUrl(candidateToSvg(candidate, description));

      setResult({
        title: description,
        creaseImage,
        modelKey: analysis.presetKey,
        seed,
      });
      setRunState("idle");
      setMessage("生成が完了しました");
    } catch {
      setRunState("error");
      setMessage("生成できませんでした。もう一度お試しください");
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
                ? "展開図と3Dを生成中…"
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
          <input
            id="reference-image"
            type="file"
            accept="image/*"
            onChange={handleImage}
            disabled={runState === "running"}
          />
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
              disabled={runState === "running"}
              onClick={() => {
                setImage(null);
                resetResult();
              }}
            >
              ×
            </button>
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
              <span>{result.title}</span>
            </div>
            <div className="creaseStage">
              {/* Generated locally as a standalone SVG data URL. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="creasePattern" src={result.creaseImage} alt={`${result.title}の展開図`} />
            </div>
          </article>

          <article className="outputPanel">
            <div className="modelTitle">
              <h1>完成形 3D</h1>
              <span>ドラッグで回転</span>
            </div>
            <div className="modelStage">
              <Origami3D modelKey={result.modelKey} seed={result.seed} />
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
