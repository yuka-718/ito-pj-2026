const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const asset = (path: string) => `${basePath}${path}`;

const systemStages = [
  { number: "01", label: "INPUT", title: "言葉・写真・スケッチ", detail: "つくりたい題材と、残したい特徴を伝える。", status: "NOW" },
  { number: "02", label: "DECOMPOSE", title: "LLMが意味を分解", detail: "頭・胴体・尾、長さ、対称性、優先度へ。", status: "NOW" },
  { number: "03", label: "DESIGN", title: "基本形と配置を選ぶ", detail: "グリッド、面積配分、設計方式を組み合わせる。", status: "LAB" },
  { number: "04", label: "GENERATE", title: "展開図候補をつくる", detail: "幾何計算で山折り・谷折りの候補を生成。", status: "NOW" },
  { number: "05", label: "SIMULATE", title: "Orieditaで折り計算", detail: "専用ブリッジから折線を追加し、形を確認する。", status: "NOW" },
  { number: "06", label: "EVALUATE", title: "数学と見た目で評価", detail: "局所条件とVLM評価で改善点を見つける。", status: "LAB" },
  { number: "07", label: "ITERATE", title: "候補を比較・修正", detail: "複数案を反復し、折り紙らしい形へ近づける。", status: "NEXT" },
];

const timeline = [
  { date: "05.15", phase: "KICKOFF", title: "構想を言葉にする", text: "自然言語から折り紙設計へつなぐ目標を確認。開発と発信の進め方、合宿発表までのロードマップを整理した。", tag: "VISION" },
  { date: "05.24", phase: "RESEARCH", title: "4段階のシステムを定義", text: "入力、折り可能性の検証、展開図・折り手順生成、Web表示に分解。課題を“折れる”だけでなく“折り紙らしい”設計に置いた。", tag: "SCOPE" },
  { date: "05.31", phase: "PROTOTYPE", title: "検索から、考えるエージェントへ", text: "既存作品の検索だけでは細かな希望を反映できない。AIに検証と可視化の道具を持たせ、設計を探索させる方針へ進んだ。", tag: "PIVOT" },
  { date: "06.07", phase: "BOOST CAMP", title: "形だけでなく、折る楽しさを", text: "合宿の対話から、余った紙を隠して形だけ合わせる方法では足りないと気づく。特徴の選び方と人の創作プロセスに注目した。", tag: "INSIGHT" },
  { date: "06.21", phase: "TOOLCHAIN", title: "複数の折り紙ソフトをつなぐ", text: "特徴抽出、TreeMakerによる面積配分、Orieditaによる検証を組み合わせ、完成形を逆向きに開いて手順を得る案を検討した。", tag: "PIPELINE" },
  { date: "06.27", phase: "MILESTONE", title: "完成形から開く試作が動く", text: "3Dモデルを安定させ、完成形を逆向きに解体する処理が動作。結果を人が理解でき、実際に折れる手順へ変えることが次の課題になった。", tag: "WORKING" },
  { date: "07.05", phase: "EXPERIMENT", title: "22.5度系の限界を知る", text: "search22.5を再現。折りやすさはある一方、検索中心で自由度が低く、ツール間のファイル形式にも壁があることが分かった。", tag: "LEARNING" },
  { date: "07.12", phase: "FIELD TEST", title: "実際に折って評価する", text: "候補を紙で折り、手修正の多さを確認。COrigamiを調査し、TreeMakerとOrieditaの機能を部分的につなげた。", tag: "HANDS-ON" },
  { date: "07.18", phase: "IMPLEMENT", title: "配置計算とソルバーへ", text: "部位の配置計算と平坦折りソルバーの再現を進め、既存OSSの設計も調査。生成パイプラインの具体化が始まった。", tag: "BUILD" },
  { date: "07.26", phase: "REDESIGN", title: "基本形とOrieditaへ軸足", text: "専門家の助言をもとに22.5度依存を見直す。.foldの完成座標から線を出し、川崎定理の局所条件を可視化する試作を作った。", tag: "CHECK" },
  { date: "08.16", phase: "LOOP", title: "金魚を生成し、見た目を比べる", text: "Orieditaの折り上がりを別枠表示。金魚らしい平面候補を生成し、複数の視覚モデルで評価する反復実験を行った。", tag: "GOLDFISH" },
  { date: "08.23", phase: "MIDTERM", title: "自動操作から、評価基準の設計へ", text: "Oriedita用API/MCPで折線追加・保存・折り計算までを自動化。速度と評価ループを見直し、Few-shotや対称性、複数候補比較を次の実験に設定した。", tag: "CURRENT" },
];

const researchLinks = [
  { title: "Learn2Fold", type: "PAPER", href: "https://arxiv.org/abs/2603.29585" },
  { title: "COrigami", type: "PAPER / PROJECT", href: "https://www.tomzahavy.com/projects/corigami" },
  { title: "Oriedita", type: "OPEN SOURCE", href: "https://github.com/oriedita/oriedita" },
  { title: "Origami Simulator", type: "SIMULATION", href: "https://origamisimulator.org/" },
  { title: "step-folder", type: "FOLDING STEPS", href: "https://kei-morisue.github.io/step-folder/" },
  { title: "折り紙研究（筑波大学）", type: "RESEARCH", href: "https://mitani.cs.tsukuba.ac.jp/origami/" },
];

export default function Home() {
  return (
    <main>
      <section className="hero" id="top">
        <nav className="nav" aria-label="メインナビゲーション">
          <a className="brand" href="#top" aria-label="ORI AI トップへ">
            <span className="brandMark" aria-hidden="true" />
            <span>ORI / AI</span>
          </a>
          <div className="navLinks">
            <a href="#concept">概要</a>
            <a href="#system">仕組み</a>
            <a href="#progress">開発ログ</a>
            <a href="#experiments">実験</a>
          </div>
          <div className="navMeta">
            <span>MITOU JR. 2026</span>
            <span className="navRule" aria-hidden="true" />
            <span>YUKA ITO</span>
          </div>
        </nav>

        <div className="heroGrid">
          <div className="heroCopy">
            <p className="eyebrow"><span>01</span> PROJECT STATEMENT</p>
            <h1>
              折り紙の<span className="accent">「構造」</span>を、
              <br />AIと探る。
            </h1>
            <p className="lead">
              完成形から、折れる展開図へ。人が創作折り紙で行う思考を手がかりに、
              LLMと既存の折り紙ソフトをつなぐ制作支援ツールを研究・開発しています。
            </p>
            <div className="heroActions">
              <a className="primaryAction" href="#system">仕組みを見る <span>↘</span></a>
              <p>2026年 未踏ジュニア採択<br />クリエーター：伊藤 夕夏</p>
            </div>
          </div>

          <div className="heroVisual" aria-label="折り紙の形と計算グリッドを組み合わせたイメージ">
            <div className="visualLabel"><span>FOLD / UNFOLD</span><span>2026.08</span></div>
            <div className="gridPlane" aria-hidden="true">
              <span className="fold foldOne" />
              <span className="fold foldTwo" />
              <span className="fold foldThree" />
              <span className="node nodeOne" />
              <span className="node nodeTwo" />
              <span className="node nodeThree" />
              <span className="axis axisX">X</span>
              <span className="axis axisY">Y</span>
            </div>
            <div className="visualFooter"><span>LOCAL FLAT-FOLDABILITY</span><strong>PASS</strong></div>
          </div>
        </div>
        <a className="scrollCue" href="#concept"><span>SCROLL TO UNFOLD</span><i aria-hidden="true">↓</i></a>
      </section>

      <section className="concept" id="concept">
        <p className="sectionIndex">02 / CONCEPT</p>
        <div className="conceptIntro">
          <h2>つくる人の直感と、<br />計算できるルールのあいだ。</h2>
          <p>
            折り紙には、川崎定理など検証できる局所条件がある一方、
            「何をどう折ればその形になるか」という創作者の経験知があります。
            このプロジェクトは、その両方を一つの制作フローへ編み直します。
          </p>
        </div>
        <div className="conceptSteps" aria-label="プロジェクトの基本フロー">
          <article><span>INPUT</span><strong>つくりたい形</strong><i>01</i></article>
          <article><span>AGENT</span><strong>LLMが操作・探索</strong><i>02</i></article>
          <article><span>VERIFY</span><strong>折れるかを検証</strong><i>03</i></article>
          <article><span>OUTPUT</span><strong>展開図の候補</strong><i>04</i></article>
        </div>
        <div className="projectStats" aria-label="プロジェクト概要">
          <div><strong>12</strong><span>DEVELOPMENT LOGS</span></div>
          <div><strong>MAY—AUG</strong><span>2026 TIMELINE</span></div>
          <div><strong>2D</strong><span>CURRENT FOCUS</span></div>
          <div><strong>R&amp;D</strong><span>RESEARCH PROTOTYPE</span></div>
        </div>
      </section>

      <section className="origin" aria-labelledby="origin-title">
        <div className="originImage">
          <img src={asset("/origami-insect.png")} alt="緑色の紙で精巧に折られた昆虫の折り紙" />
          <div className="imageStamp"><span>WHY ORIGAMI?</span><strong>THE STARTING POINT</strong></div>
        </div>
        <div className="originCopy">
          <p className="sectionIndex">03 / ORIGIN</p>
          <h2 id="origin-title">正解が一つではないから、<br />創作はおもしろい。</h2>
          <p className="originLead">
            本にない形を、自分で折ってみたい。その原体験から始まった研究です。
            目的はボタン一つの“正解生成”ではなく、つくる人が候補を比べ、
            試し、選べる相棒をつくることです。
          </p>
          <div className="originNotes">
            <article><span>01</span><div><strong>特徴を選ぶ</strong><p>全部を再現するのではなく、その題材らしさを決める部位を見つける。</p></div></article>
            <article><span>02</span><div><strong>基本形から考える</strong><p>既存の知識、グリッド、面積配分を手がかりに、折り紙らしい構造を探る。</p></div></article>
            <article><span>03</span><div><strong>手を動かして確かめる</strong><p>シミュレーションだけで終わらせず、人が紙で折れるか、楽しいかを問い続ける。</p></div></article>
          </div>
        </div>
      </section>

      <section className="system" id="system">
        <div className="systemHeader">
          <p className="sectionIndex light">04 / SYSTEM</p>
          <div>
            <h2>言葉から、折り上がりまで。<br /><span>生成と評価を、ひとつのループに。</span></h2>
            <p>LLMがすべてを計算するのではなく、意味の理解はLLM、正確な幾何処理は専用ツールへ。得意分野をつなぐ設計です。</p>
          </div>
        </div>
        <ol className="systemFlow">
          {systemStages.map((stage) => (
            <li key={stage.number}>
              <div className="flowTop"><span>{stage.number} / {stage.label}</span><em className={`status status${stage.status}`}>{stage.status}</em></div>
              <strong>{stage.title}</strong>
              <p>{stage.detail}</p>
            </li>
          ))}
        </ol>
        <div className="legend" aria-label="開発状況の凡例">
          <span><i className="legendNow" /> NOW：試作済み</span>
          <span><i className="legendLab" /> LAB：実験中</span>
          <span><i className="legendNext" /> NEXT：今後</span>
        </div>
      </section>

      <section className="progress" id="progress">
        <div className="progressTitle">
          <p className="sectionIndex">05 / PROGRESS</p>
          <h2>折って、ほどいて、<br />また考える。</h2>
          <p>2026年5月のキックオフから中間発表まで。実装だけでなく、問いそのものを更新してきた記録です。</p>
        </div>
        <ol className="timeline">
          {timeline.map((item, index) => (
            <li key={item.date} className={index === timeline.length - 1 ? "isCurrent" : ""}>
              <div className="timelineDate"><strong>{item.date}</strong><span>2026</span></div>
              <div className="timelineBody"><span className="timelinePhase">{item.phase}</span><h3>{item.title}</h3><p>{item.text}</p></div>
              <span className="timelineTag">{item.tag}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="experiments" id="experiments">
        <div className="experimentsHeader">
          <p className="sectionIndex">06 / EXPERIMENTS</p>
          <h2>現在地は、<br />“折れるかもしれない”を<br />丁寧に確かめるところ。</h2>
        </div>
        <div className="experimentGrid">
          <figure className="experimentMain">
            <div className="figureImage technical"><img src={asset("/foldability-check.png")} alt="部位ごとの折線候補と川崎定理の局所条件を表示する試作画面" /></div>
            <figcaption><span>01 / LOCAL CHECK</span><strong>局所条件を、見える形に。</strong><p>.foldの完成座標から山谷線候補をつくり、川崎定理の残差を表示。これは単一頂点の局所条件であり、作品全体が物理的に折れることの保証ではありません。</p></figcaption>
          </figure>
          <figure>
            <div className="figureImage goldfish"><img src={asset("/goldfish-prototype.png")} alt="Orieditaで生成した赤い平面の金魚候補" /></div>
            <figcaption><span>02 / GOLDFISH LOOP</span><strong>見た目も、評価の対象へ。</strong><p>金魚を題材に、候補生成と視覚モデルによる評価を反復。回転や見る向きに左右されにくい基準を探っています。</p></figcaption>
          </figure>
          <figure>
            <div className="figureImage roses"><img src={asset("/origami-roses.png")} alt="黄色とオレンジ色の紙で折られた二輪のバラ" /></div>
            <figcaption><span>03 / HUMAN SENSE</span><strong>規則性と、つくる感覚。</strong><p>花のような規則性のある題材は、基本形を考えるヒントになります。人の観察と試作も、設計ループの大切な一部です。</p></figcaption>
          </figure>
        </div>
      </section>

      <section className="currentState" aria-labelledby="current-title">
        <div className="currentLabel"><span>STATUS</span><strong>RESEARCH<br />PROTOTYPE</strong></div>
        <div className="currentCopy">
          <p className="sectionIndex">07 / NOW &amp; NEXT</p>
          <h2 id="current-title">できたことと、<br />まだできていないこと。</h2>
          <p>「自動生成できた」と一言でまとめず、試作済み・実験中・今後を分けて公開します。</p>
        </div>
        <div className="stateColumns">
          <div className="stateDone">
            <h3><span>●</span> NOW — 試作済み</h3>
            <ul>
              <li>Oriedita専用API/MCPから折線追加・保存・折り計算を操作</li>
              <li>折り上がり形状を別枠で表示</li>
              <li>.foldの完成座標から山谷線候補を生成</li>
              <li>川崎残差など一部の局所条件を可視化</li>
              <li>金魚を題材に生成と視覚評価を反復</li>
            </ul>
          </div>
          <div className="stateNext">
            <h3><span>○</span> NEXT — 研究課題</h3>
            <ul>
              <li>作品全体の層順・衝突・紙厚を含む折り可能性</li>
              <li>人が実際に折りやすい手順と手数の評価</li>
              <li>GUIに依存しない高速な実行環境</li>
              <li>複数候補の並列生成と比較</li>
              <li>3D完成形と幅広い題材への一般化</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="watch" aria-labelledby="watch-title">
        <div className="watchCopy">
          <p className="sectionIndex light">08 / WATCH</p>
          <h2 id="watch-title">発表でたどる、<br />構想から中間成果まで。</h2>
        </div>
        <div className="videoLinks">
          <a href="https://youtu.be/9oekrk3Ma-g" target="_blank" rel="noreferrer"><span>01 / JUNE</span><strong>ブースト合宿発表</strong><i>↗</i></a>
          <a href="https://youtu.be/O1axFAyN-7A" target="_blank" rel="noreferrer"><span>02 / AUGUST</span><strong>中間発表</strong><i>↗</i></a>
        </div>
        <p className="videoNote">※ ブースト合宿動画 0:36 付近の鶴の展開図には誤りがあることを記録ページで注記しています。</p>
      </section>

      <section className="references" aria-labelledby="references-title">
        <div className="referencesIntro">
          <p className="sectionIndex">09 / REFERENCES</p>
          <h2 id="references-title">先行研究と<br />オープンソース。</h2>
          <p>このプロジェクトは、計算折り紙の研究と公開ツールから多くを学び、その間をつなぐ方法を探っています。</p>
        </div>
        <div className="referenceList">
          {researchLinks.map((link, index) => (
            <a key={link.title} href={link.href} target="_blank" rel="noreferrer">
              <span>{String(index + 1).padStart(2, "0")}</span><strong>{link.title}</strong><em>{link.type}</em><i>↗</i>
            </a>
          ))}
        </div>
      </section>

      <footer>
        <div className="footerMark" aria-hidden="true"><span>ORI</span><i>/</i><span>AI</span></div>
        <div className="footerCopy">
          <p>LLMを用いた折り紙展開図作成ソフト</p>
          <strong>MITOU JUNIOR 2026<br />YUKA ITO PROJECT</strong>
        </div>
        <div className="footerLinks">
          <a href="https://github.com/yuka-718/ito-pj-2026" target="_blank" rel="noreferrer">GITHUB ↗</a>
          <a href="#top">BACK TO TOP ↑</a>
        </div>
        <p className="footerNote">2026年5月〜8月のCosense開発記録をもとに構成。個人連絡先・非公開の会議情報は掲載していません。</p>
      </footer>
    </main>
  );
}
