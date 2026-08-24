"use client";

import { useMemo, useState } from "react";

import {
  PRESETS,
  analyzeDescription,
  candidateToFold,
  candidateToSvg,
  createPart,
  generateCandidates,
  withAngleOffset,
  type Candidate,
  type Part,
  type Preset,
} from "./origami-engine";

const defaultDescription = "丸い胴体と大きく広がる尾びれを持つ金魚";
const defaultAnalysis = analyzeDescription(defaultDescription);
const defaultSettings = { complexity: 3, symmetry: true, seed: 26 };
const defaultCandidates = generateCandidates({
  description: defaultDescription,
  parts: defaultAnalysis.parts,
  ...defaultSettings,
});
const complexityLabels = ["", "MINIMAL", "SIMPLE", "STANDARD", "DETAILED", "DENSE"];

function formatResidual(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value < 0.0001 ? value.toExponential(2) : value.toFixed(6);
}

function downloadText(contents: string, filename: string, mimeType: string) {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function CreasePattern({ candidate }: { candidate: Candidate }) {
  const radialEdges = candidate.edges.slice(-candidate.degree);
  const uniqueLabels = candidate.partLabels
    .map((label, index) => ({ label, index }))
    .filter((item, index, items) => items.findIndex((other) => other.label === item.label) === index);

  return (
    <svg className="creaseSvg" viewBox="0 0 600 600" role="img" aria-labelledby="crease-title crease-desc">
      <title id="crease-title">選択中の単頂点折り紙構造候補</title>
      <desc id="crease-desc">赤い実線は仮の山折り、青い破線は仮の谷折り。中央頂点の川崎残差を計算しています。</desc>
      <defs>
        <pattern id="paper-grid" width="30" height="30" patternUnits="userSpaceOnUse">
          <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(19,34,60,.08)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="600" height="600" className="paperFill" />
      <rect width="600" height="600" fill="url(#paper-grid)" />
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
            className={`creaseEdge assignment${edge.assignment}`}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      {uniqueLabels.map(({ label, index }) => {
        const edge = radialEdges[index];
        if (!edge) return null;
        const endpoint = candidate.vertices[edge.vertices[1]];
        const x = 300 + (endpoint[0] - 300) * 0.69;
        const y = 300 + (endpoint[1] - 300) * 0.69;
        return <text key={label} x={x} y={y} className="featureLabel">{label}</text>;
      })}
      <circle cx="300" cy="300" r="7" className="centerNode" />
      <circle cx="300" cy="300" r="16" className="centerHalo" />
    </svg>
  );
}

function MotifSilhouette({ presetKey }: { presetKey: string }) {
  return (
    <svg className="motifSvg" viewBox="0 0 240 130" role="img" aria-label="入力から選ばれた目標シルエット">
      {presetKey === "goldfish" && (
        <>
          <ellipse cx="112" cy="66" rx="60" ry="37" />
          <path d="M55 65 9 24 22 68 8 111 57 78Z" />
          <path d="M104 34 126 8 135 39M108 96 132 121 140 91" />
          <circle cx="151" cy="56" r="4" className="motifEye" />
        </>
      )}
      {presetKey === "beetle" && (
        <>
          <ellipse cx="120" cy="72" rx="33" ry="48" />
          <circle cx="120" cy="31" r="23" />
          <path d="M107 17 79 3 91 31M133 17 161 3 149 31M90 53 42 30M89 72 32 72M94 91 50 116M150 53 198 30M151 72 208 72M146 91 190 116" />
        </>
      )}
      {presetKey === "crane" && (
        <path d="M18 84 94 48 119 60 169 13 153 65 222 86 153 91 129 120 110 91 70 110 92 77Z" />
      )}
      {presetKey === "flower" && (
        <>
          <path d="M120 63C76 45 78 2 120 42 162 2 164 45 120 63ZM120 63C102 107 59 105 99 63 59 21 102 19 120 63ZM120 63C138 19 181 21 141 63 181 105 138 107 120 63Z" />
          <circle cx="120" cy="63" r="17" className="motifEye" />
        </>
      )}
      {!PRESETS.some((preset) => preset.key === presetKey) && (
        <path d="M18 65 67 23 112 43 154 12 224 65 154 118 112 87 67 107Z" />
      )}
    </svg>
  );
}

export default function Home() {
  const [description, setDescription] = useState(defaultDescription);
  const [presetKey, setPresetKey] = useState(defaultAnalysis.presetKey);
  const [parts, setParts] = useState<Part[]>(defaultAnalysis.parts);
  const [complexity, setComplexity] = useState(defaultSettings.complexity);
  const [symmetry, setSymmetry] = useState(defaultSettings.symmetry);
  const [seed, setSeed] = useState(defaultSettings.seed);
  const [candidates, setCandidates] = useState(defaultCandidates);
  const [selectedId, setSelectedId] = useState(defaultCandidates[0].id);
  const [angleOffset, setAngleOffset] = useState(0);
  const [status, setStatus] = useState("金魚のサンプルから3候補を生成しました");

  const baseCandidate = candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0];
  const selectedCandidate = useMemo(
    () => withAngleOffset(baseCandidate, angleOffset, parts, symmetry),
    [angleOffset, baseCandidate, parts, symmetry],
  );
  const localWithinTolerance = selectedCandidate.residualRad <= 0.000001;
  const exportReady = selectedCandidate.validationIssues.length === 0;

  function organizeFeatures() {
    const analysis = analyzeDescription(description);
    setPresetKey(analysis.presetKey);
    setParts(analysis.parts);
    setStatus(`${analysis.presetLabel}の語彙テンプレートで、残したい特徴を整理しました`);
  }

  function regenerate(nextDescription = description, nextParts = parts, nextPresetKey = presetKey) {
    if (!nextDescription.trim()) {
      setStatus("つくりたい形を入力してください");
      return;
    }
    if (nextParts.length < 2) {
      setStatus("構造候補には特徴が2つ以上必要です");
      return;
    }
    const nextCandidates = generateCandidates({
      description: nextDescription,
      parts: nextParts,
      complexity,
      symmetry,
      seed,
    });
    setCandidates(nextCandidates);
    setSelectedId(nextCandidates[0].id);
    setAngleOffset(0);
    setPresetKey(nextPresetKey);
    setStatus(`${nextParts.length}個の特徴から、${nextCandidates[0].degree}本線の候補を3案生成しました`);
  }

  function applyPreset(preset: Preset) {
    const analysis = analyzeDescription(preset.description);
    setDescription(preset.description);
    setParts(analysis.parts);
    setPresetKey(preset.key);
    regenerate(preset.description, analysis.parts, preset.key);
  }

  function updatePart(id: string, patch: Partial<Part>) {
    setParts((current) => current.map((part) => (part.id === id ? { ...part, ...patch } : part)));
  }

  function removePart(id: string) {
    setParts((current) => current.filter((part) => part.id !== id));
  }

  function selectCandidate(candidate: Candidate) {
    setSelectedId(candidate.id);
    setAngleOffset(0);
    setStatus(`${candidate.title} を選択しました`);
  }

  function exportSvg() {
    if (!exportReady) return;
    downloadText(
      candidateToSvg(selectedCandidate, description),
      `ori-ai-${presetKey}-${selectedCandidate.title.toLowerCase().replaceAll(" ", "-")}.svg`,
      "image/svg+xml;charset=utf-8",
    );
    setStatus("選択中の構造候補をSVGで書き出しました");
  }

  function exportFold() {
    if (!exportReady) return;
    downloadText(
      candidateToFold(selectedCandidate, description),
      `ori-ai-${presetKey}-${selectedCandidate.title.toLowerCase().replaceAll(" ", "-")}.fold`,
      "application/json;charset=utf-8",
    );
    setStatus("選択中の構造候補をFOLD 1.2で書き出しました");
  }

  return (
    <main className="appShell">
      <header className="topBar" id="top">
        <a className="brand" href="#top" aria-label="ORI AI Studio トップへ">
          <span className="brandMark" aria-hidden="true"><i /><i /></span>
          <span>ORI AI STUDIO</span>
        </a>
        <nav aria-label="メインナビゲーション">
          <a href="#studio">STUDIO</a>
          <a href="#method">METHOD</a>
          <a href="#scope">SCOPE</a>
          <a href="https://github.com/yuka-718/ito-pj-2026" target="_blank" rel="noreferrer">GITHUB ↗</a>
        </nav>
        <span className="buildBadge">MITOU JR. 2026 / BROWSER BUILD 01</span>
      </header>

      <section className="hero">
        <div className="heroIndex"><span>01</span><i />ORIGAMI DESIGN LAB</div>
        <div className="heroTitle">
          <h1>言葉から、<br /><em>折りの候補</em>へ。</h1>
          <p>
            つくりたい形を部位に分け、単頂点の構造候補を探索するブラウザ版スタジオ。
            特徴を編集し、局所条件を確かめ、SVGやFOLDとして持ち出せます。
          </p>
        </div>
        <div className="heroFacts" aria-label="アプリの機能">
          <div><strong>03</strong><span>CANDIDATES</span></div>
          <div><strong>LIVE</strong><span>LOCAL CHECK</span></div>
          <div><strong>SVG / FOLD</strong><span>EXPORT</span></div>
        </div>
      </section>

      <section className="studio" id="studio" aria-label="折り紙構造候補スタジオ">
        <aside className="controlPanel">
          <div className="panelTitle">
            <span>01 / DESIGN INPUT</span>
            <strong>つくりたい形を<br />構造へ分ける</strong>
          </div>

          <fieldset className="presetField">
            <legend>EXAMPLES</legend>
            <div className="presetButtons">
              {PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={presetKey === preset.key ? "isActive" : ""}
                  aria-pressed={presetKey === preset.key}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}<span>↗</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="ideaField">
            <label htmlFor="idea">IDEA / つくりたい形</label>
            <textarea
              id="idea"
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setPresetKey("custom");
              }}
              rows={4}
              maxLength={160}
            />
            <div className="fieldMeta"><span>{description.length} / 160</span><span>日本語キーワード対応</span></div>
            <button type="button" className="organizeButton" onClick={organizeFeatures}>
              語彙テンプレートで特徴を整理 <span>↓</span>
            </button>
          </div>

          <div className="partsEditor">
            <div className="subhead"><span>02 / FEATURES</span><strong>{parts.length} PARTS</strong></div>
            <p className="helperText">名前・重要度・紙の上で伸ばしたい方向を編集できます。</p>
            <div className="partList">
              {parts.map((part, index) => (
                <article className="partRow" key={part.id}>
                  <span className="partNumber">{String(index + 1).padStart(2, "0")}</span>
                  <div className="partMain">
                    <label>
                      <span className="srOnly">特徴 {index + 1} の名前</span>
                      <input
                        type="text"
                        value={part.label}
                        maxLength={18}
                        onChange={(event) => updatePart(part.id, { label: event.target.value })}
                      />
                    </label>
                    <div className="partControls">
                      <label>
                        <span>重要度 {part.importance}</span>
                        <input
                          type="range"
                          min="1"
                          max="5"
                          value={part.importance}
                          onChange={(event) => updatePart(part.id, { importance: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>方向</span>
                        <input
                          className="directionInput"
                          type="number"
                          min="0"
                          max="359"
                          value={part.direction}
                          onChange={(event) => updatePart(part.id, { direction: Number(event.target.value) })}
                          aria-label={`${part.label} の方向（度）`}
                        />
                        <span>°</span>
                      </label>
                    </div>
                  </div>
                  <button type="button" className="removePart" onClick={() => removePart(part.id)} aria-label={`${part.label}を削除`}>×</button>
                </article>
              ))}
            </div>
            <button type="button" className="addPart" onClick={() => setParts((current) => [...current, createPart(current.length + 1)])}>
              ＋ 特徴を追加
            </button>
          </div>

          <div className="generatorSettings">
            <div className="subhead"><span>03 / SEARCH SETTINGS</span><strong>{complexityLabels[complexity]}</strong></div>
            <label className="rangeSetting">
              <span>構造の密度 <output>{complexity} / 5</output></span>
              <input type="range" min="1" max="5" value={complexity} onChange={(event) => setComplexity(Number(event.target.value))} />
            </label>
            <div className="toggleSetting">
              <span><strong>左右のバランスを優先</strong><small>鏡映方向に近い線配置を高く評価</small></span>
              <input id="symmetry-toggle" aria-label="左右のバランスを優先" type="checkbox" checked={symmetry} onChange={(event) => setSymmetry(event.target.checked)} />
              <i aria-hidden="true" />
            </div>
            <label className="seedSetting">
              <span>SEED</span>
              <input type="number" min="0" max="999999" value={seed} onChange={(event) => setSeed(Number(event.target.value))} />
            </label>
          </div>

          <button type="button" className="generateButton" onClick={() => regenerate()}>
            <span>3つの構造候補を生成</span><i aria-hidden="true">↗</i>
          </button>
          <p className="statusLine" role="status" aria-live="polite">{status}</p>
        </aside>

        <div className="resultPanel">
          <div className="resultHeader">
            <div><span>02 / STRUCTURE CANDIDATES</span><strong>比較して、選んで、ずらしてみる</strong></div>
            <div className="lineLegend" aria-label="折線の凡例">
              <span><i className="mountainKey" />M / 仮の山折り</span>
              <span><i className="valleyKey" />V / 仮の谷折り</span>
            </div>
          </div>

          <div className="candidateTabs" role="group" aria-label="生成した3つの候補">
            {candidates.map((candidate, index) => (
              <button
                type="button"
                key={candidate.id}
                className={baseCandidate.id === candidate.id ? "isSelected" : ""}
                aria-pressed={baseCandidate.id === candidate.id}
                onClick={() => selectCandidate(candidate)}
              >
                <span>0{index + 1} / {candidate.title}</span>
                <strong>{candidate.score}<small>/100</small></strong>
                <em>{candidate.subtitle}</em>
              </button>
            ))}
          </div>

          <div className="resultWorkspace">
            <div className="canvasColumn">
              <div className="canvasToolbar">
                <span>SINGLE-VERTEX CP / {selectedCandidate.degree} RAYS</span>
                <span>600 × 600 UNIT PAPER</span>
              </div>
              <div className="canvasFrame">
                <CreasePattern candidate={selectedCandidate} />
                <span className="canvasAxis axisZero">0°</span>
                <span className="canvasAxis axisNinety">90°</span>
              </div>
              <div className="canvasCaption">
                <span>中心頂点 V-01</span>
                <p>特徴ラベルは最も近い放射線へ割り当て。線の赤／青は局所必要条件を数えるための仮割当です。</p>
              </div>
            </div>

            <aside className="inspector" aria-label="選択中候補の検証結果">
              <div className="inspectorTitle"><span>03 / INSPECT</span><strong>{selectedCandidate.title}</strong></div>

              <section className="targetCard" aria-labelledby="target-title">
                <div><span>INPUT TARGET</span><strong id="target-title">{presetKey === "custom" ? "自由入力" : PRESETS.find((preset) => preset.key === presetKey)?.label}</strong></div>
                <MotifSilhouette presetKey={presetKey} />
                <p>目標シルエット。折り上がりシミュレーションではありません。</p>
              </section>

              <section className={`checkCard ${localWithinTolerance ? "isWithin" : "hasResidual"}`}>
                <div className="checkStatus"><span>LOCAL KAWASAKI</span><strong>{localWithinTolerance ? "数値許容内" : "残差あり"}</strong></div>
                <div className="residualValue"><strong>{formatResidual(selectedCandidate.residualRad)}</strong><span>rad</span></div>
                <p>{formatResidual(selectedCandidate.residualDeg)}° / 許容値 1.0e−6 rad</p>
              </section>

              <section className="angleTest">
                <label htmlFor="angle-offset"><span>1本目の線を検証用にずらす</span><output>{angleOffset > 0 ? "+" : ""}{angleOffset.toFixed(1)}°</output></label>
                <input
                  id="angle-offset"
                  type="range"
                  min="-8"
                  max="8"
                  step="0.5"
                  value={angleOffset}
                  onChange={(event) => setAngleOffset(Number(event.target.value))}
                />
                <button type="button" onClick={() => setAngleOffset(0)}>0°に戻す</button>
              </section>

              <section className="scoreCard">
                <div className="scoreLead"><span>CANDIDATE SCORE</span><strong>{selectedCandidate.score}<small>/100</small></strong></div>
                {Object.entries({
                  "特徴方向": selectedCandidate.scores.feature,
                  "左右バランス": selectedCandidate.scores.balance,
                  "セクター余白": selectedCandidate.scores.clarity,
                  "局所条件": selectedCandidate.scores.local,
                }).map(([label, value]) => (
                  <div className="scoreRow" key={label}>
                    <span>{label}</span><i><b style={{ width: `${value}%` }} /></i><strong>{value}</strong>
                  </div>
                ))}
              </section>

              <dl className="technicalList">
                <div><dt>次数</dt><dd>{selectedCandidate.degree}</dd></div>
                <div><dt>最小セクター</dt><dd>{selectedCandidate.minSectorDeg.toFixed(1)}°</dd></div>
                <div><dt>Maekawa |M−V|</dt><dd>{selectedCandidate.maekawaDifference}</dd></div>
                <div><dt>グラフ検査</dt><dd>{exportReady ? "問題なし" : `${selectedCandidate.validationIssues.length}件`}</dd></div>
              </dl>
            </aside>
          </div>

          <div className="exportBar">
            <div>
              <span>04 / TAKE IT FURTHER</span>
              <strong>次の検証へ持ち出す</strong>
              <p>表示と同じ内部グラフを書き出します。FOLDはOriedita等での追加検証用です。</p>
            </div>
            <button type="button" onClick={exportSvg} disabled={!exportReady}><span>SVG</span>図として保存 <i>↓</i></button>
            <button type="button" onClick={exportFold} disabled={!exportReady}><span>.FOLD 1.2</span>構造データを保存 <i>↓</i></button>
          </div>

          <div className="researchNotice">
            <strong>!</strong>
            <p>
              ここで確認しているのは中心1頂点の局所必要条件です。
              <b>作品全体の平坦折り、層順、自己衝突、紙の厚み、人が折れる手順は未検査</b>であり、実際に一枚の紙から折れることを保証しません。
            </p>
          </div>
        </div>
      </section>

      <section className="method" id="method">
        <div className="sectionHeading">
          <span>03 / WHAT THIS BUILD DOES</span>
          <h2>入力から書き出しまで、<br />ブラウザ内で本当に計算する。</h2>
          <p>Cosenseに記録された「特徴分解 → 構造候補 → 局所検証 → 外部ツール」という流れを、秘密鍵やサーバーなしで試せる範囲に絞りました。</p>
        </div>
        <ol className="methodGrid">
          <li><span>01 / PARSE</span><strong>語彙テンプレート</strong><p>金魚・昆虫・鶴・花の語彙から部位候補を整理。結果は人が名前、重要度、方向を修正します。</p></li>
          <li><span>02 / CONSTRUCT</span><strong>単頂点候補探索</strong><p>偶数・奇数番セクターの合計がそれぞれ180°になる角度列を多数つくり、入力特徴との近さで比較します。</p></li>
          <li><span>03 / VERIFY</span><strong>残差を再計算</strong><p>中心線の角度を動かすたび、川崎定理の局所残差と仮の山谷本数差を同じグラフから再計算します。</p></li>
          <li><span>04 / EXPORT</span><strong>次の道具へ渡す</strong><p>SVGとFOLD 1.2を生成。未検査項目もファイル内へ明記し、Orieditaなどで続きの検証ができます。</p></li>
        </ol>
      </section>

      <section className="scope" id="scope">
        <div className="scopeLabel"><span>RESEARCH</span><strong>SCOPE</strong></div>
        <div className="scopeIntro">
          <span>04 / HONEST PROTOTYPING</span>
          <h2>できることと、<br />まだ研究中のこと。</h2>
          <p>「局所条件を満たす」と「作品全体が折れる」は別です。この境界を画面と書き出しデータの両方に残しています。</p>
        </div>
        <div className="scopeColumns">
          <article>
            <h3><i>●</i> THIS BROWSER BUILD</h3>
            <ul>
              <li>入力文から編集可能な特徴候補を整理</li>
              <li>seed付きで単頂点構造を96案探索</li>
              <li>上位3候補を比較し角度を再編集</li>
              <li>川崎残差とMaekawa本数差を計算</li>
              <li>表示グラフをSVG／FOLDで保存</li>
            </ul>
          </article>
          <article>
            <h3><i>○</i> NEXT RESEARCH</h3>
            <ul>
              <li>Orieditaによる全体の折り計算と層順</li>
              <li>自己衝突、紙厚、指の届きやすさ</li>
              <li>複数頂点を持つ本格的な展開図</li>
              <li>折り上がりの2D／3Dシミュレーション</li>
              <li>人が理解できる折り手順の自動生成</li>
            </ul>
          </article>
        </div>
      </section>

      <footer>
        <div className="footerBrand"><span>ORI</span><i>/</i><span>AI</span></div>
        <div className="footerCopy">
          <p>未踏ジュニア2026 伊藤PJ「LLMを用いた折り紙展開図作成ソフト」</p>
          <div>
            <a href="https://scrapbox.io/mitoujr/伊藤PJ" target="_blank" rel="noreferrer">COSENSE SOURCE ↗</a>
            <a href="https://github.com/oriedita/oriedita" target="_blank" rel="noreferrer">ORIEDITA ↗</a>
            <a href="https://github.com/yuka-718/ito-pj-2026" target="_blank" rel="noreferrer">SOURCE CODE ↗</a>
            <a href="#top">BACK TO TOP ↑</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
