# ORIAI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版プロトタイプです。
公開先は [GitHub Pages](https://yuka-718.github.io/oriai/) です。

## What works

- プロンプト入力
- 参考画像アップロード
- `gpt-5.6-terra`によるOriedita MCP操作と、別プロセスの`gpt-5.6-sol`による独立評価
- COrigami-inspired clean-room生成器による、検証後FOLDの最終状態プレビュー
- Origami Search 625作品と5,157件の構造知識を生成時だけ検索するRAG
- Orieditaで検証した展開図と2D平坦折り
- 同一CPに折角を与えた、ドラッグ回転対応の3Dプレビュー
- simple foldによる首・翼・脚などの姿勢調整
- 山谷1組のnarrowingによる先端部位の細部造形
- 第1〜4段階それぞれのFOLD保存、cpHash、操作trace、検証範囲表示
- 失効する公開トンネルURLをruntimeブランチから自動検出

## Local development

```bash
npm install
npm run dev
```

`http://localhost:3000/` で確認できます。
localhostでは `http://localhost:8788` のローカル生成サービスへ直接接続します。

## COrigami-inspired final-state pipeline

公開画面は、RAGで選んだ初期FOLDをTerraとOrieditaで反復改善し、Orieditaの2D折り上がり画像が
独立したSolの最終ルーブリック審査に合格した時だけ結果を表示します。表示する最終FOLDから、
折順を生成せず最終状態を次の4段階で作ります。

1. 展開図 + Orieditaの折り上がり2D
2. 同じCPへ部分折り角を与えた3Dプレビュー
3. 意味部位を対象にしたsimple fold姿勢調整
4. 山谷のcrease pairを使うnarrowing細部造形

base FOLDには `SemanticTree`、radial flapへのpacking trace、`faces_vertices`、
`edges_foldAngle`、安定edge ID、意味部位を保存します。
第2〜4段階は頂点・辺・面を変えず、角度と山谷を段階的に更新します。独立評価の対象は
第1段階のOriedita 2D折り上がり画像です。第1段階だけが
Orieditaの2D平坦折り検証済みで、後続段階はOrigami Simulatorによるゼロ厚み・全折線同時の
角度プレビューです。自己衝突、紙厚、手の到達可能性、折順は検証済みとは表示しません。

論文の非公開コード・重み・データを複製したものではないため、実装名は
`COrigami-inspired clean-room` としています。現状の対象は単頂点base familyと
`radial_single_vertex` adapterに限定され、論文型のbox-pleat packingは未実装として記録します。

## Codex × Oriedita worker

公開画面の `codex_mcp_loop` モードは、検証用MacのAPIを通じて役割ごとに独立したCodex CLIを起動します。
操作担当の`gpt-5.6-terra`（high）はOriedita MCPへ接続し、「折り線を1本追加 → 平坦折りを計算 →
完成画像を確認 → 暫定候補を保存」を実行します。同じ実行が付ける暫定点はバッチ内の候補選択だけに使い、
公開可否には使いません。候補ができると、別プロセスの`gpt-5.6-terra`（medium）が0〜5の基準と
現在ベストとの二者比較で足切りし、通過候補だけを`gpt-5.6-sol`（high）が3つの独立プロセスで
最終評価します。中央値と多数決が合格した場合だけ結果を公開します。
Codex CLIはMacでログイン済みの認証を使用するため、OpenAI APIキーをフロントエンドへ保存しません。

最終評価者には操作履歴、暫定点、過去の評価結果を渡しません。完成画像、制作目標、評価基準、
ユーザーが指定した場合だけ参照画像を渡します。折り完了・禁止操作なし・局所平坦折り違反なしは
LLMに推測させず、Orieditaと制限付きMCPの実測結果を合否条件にします。画像ルーブリックは次の4項目です。

- モチーフとして認識できる: 0〜5
- 必要な部位が存在する: 0〜5
- 比率・バランス: 0〜5
- 参照画像との類似度: 0〜5（参照画像がある場合）

```bash
npm run local:oriedita
```

Macへのログイン時に自動起動させる場合:

```bash
npm run local:install
```

ローカルサーバーは `127.0.0.1:8788` のみに接続し、Orieditaを同時操作しないよう1バッチずつ処理します。
10回の操作バッチが終わるたびに待ち行列の末尾へ戻すため、未合格の1件が他のジョブを永久に
塞ぎません。各ジョブは `job-state.json` とバッチ境界のチェックポイントへ保存され、API再起動後も
最後に完了したバッチから再開します。不要になった設計ジョブは `POST /jobs/{jobId}/cancel` で停止できます。
ブラウザ側も実行中ジョブIDを端末内へ保存するため、同じ端末でページを再読み込みしても監視を再開します。
失敗した候補ではGUIのundoに依存せず、変更前の最良FOLDを開き直します。バッチごとの開始FOLDと
最良FOLDを別々に保存するため、処理失敗時も直前の最良版を上書きしません。CodexのMCP操作ログ、
各回の操作証跡、独立評価、最終FOLD、展開図PNG、折り上がりPNGはジョブ内へ保存します。最終不合格では公開結果を
組み立てず、画面には経過秒だけを表示します。

これは累積展開図を一手ずつ設計する探索です。折られた紙の3Dレイヤー状態を次の一手へ保持する
逐次物理シミュレーションではなく、その実現可能性は未検証として結果へ記録します。
Origami Searchの作品は基本形・特徴・部位・比率・対称性・面積配分の参考にだけ使い、
作品そのものを複製しません。構造パックは完成作品や人間検証済み手順として扱わず、
Orieditaの2D平坦折り検証を通った構造だけを `initial.fold` に使用します。適切な候補が
ない場合は正方形から開始します。どちらの場合も完成結果を即返さず、独立ルーブリックに合格するまで
TerraとOrieditaの反復を継続します。これは完成2D画像に対する視覚評価であり、後段の3Dプレビューが
物理的一致を証明するものではありません。

## Oriedita HTTP API

ローカルワーカーには、Orieditaを直接呼び出す非同期APIも含まれます。

- `GET /v1/oriedita/health` — APIとOrieditaの状態
- `POST /v1/oriedita/fold` — FOLD形式の展開図を送信
- `GET /v1/oriedita/jobs/{jobId}` — 状態・展開図画像・折り上がり画像を取得
- `GET /openapi.json` — OpenAPI 3.1仕様

```bash
curl -X POST http://127.0.0.1:8788/v1/oriedita/fold \
  -H 'Content-Type: application/json' \
  --data-binary @request.json
```

`request.json` は `{"fold": { ...FOLD形式のJSON... }}` です。受付時に返る
`job.id` を `/v1/oriedita/jobs/{jobId}` で取得します。公開環境では
`ORI_AI_API_TOKEN` を設定し、`Authorization: Bearer ...` を付けます。

検証用Macの公開トンネルは `npm run local:tunnel:install` で常駐します。
トンネルURLが失効した場合は自動的に再作成してruntimeブランチへ通知するため、
サイト側の接続先を手作業で更新する必要はありません。

## Validation

```bash
npm run build
npm test
```

## Oracle Cloud API

公開利用時は、Oracle Cloud Always FreeのAmpere A1 VMでOrieditaとGroq連携APIを
常時起動します。VMはHTTPSのAPIだけを公開し、Groq APIキーをサーバーの
環境変数として保持します。構築手順は `deploy/oracle/README.md` にあります。

## Publishing

`main` ブランチへのpushでGitHub Actionsが静的サイトをビルドし、
GitHub Pagesへ公開します。

```bash
npm run build:pages
```

- Site: https://yuka-718.github.io/oriai/
- Repository: https://github.com/yuka-718/oriai

個人連絡先、会議URL、移動・健康など公開に不要な私的情報はサイトへ含めていません。
