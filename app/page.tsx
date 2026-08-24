"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

import Origami3D from "./Origami3D";
import { analyzeDescription, generateCandidates, hashString, type Candidate } from "./origami-engine";

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
  name: string;
  size: number;
  url: string;
};

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
    setImage({ name: file.name, size: file.size, url: URL.createObjectURL(file) });
    setMessage("");
  }

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    setMessage("生成しました");
  }

  return (
    <main className="generatorPage">
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

        <button className="generate" type="submit">生成する <span>→</span></button>
        <p className="srOnly" role="status" aria-live="polite">{message}</p>
      </form>

      <section className="outputs" aria-label="生成結果">
        <article className="outputPanel">
          <h1>展開図</h1>
          <div className="creaseStage"><CreasePattern candidate={candidate} /></div>
        </article>

        <article className="outputPanel">
          <div className="modelTitle">
            <h1>完成形 3D</h1>
            <span>ドラッグで回転</span>
          </div>
          <div className="modelStage"><Origami3D modelKey={modelKey} /></div>
        </article>
      </section>
    </main>
  );
}
