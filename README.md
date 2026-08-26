# ORIAI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版プロトタイプです。
プロンプトまたは参考画像を入力して、展開図とFOLDデータから計算した3Dシミュレーションを表示します。

## What works

- プロンプト入力
- 参考画像アップロード
- 3候補の物理・見た目・複雑さを分離したPareto選択
- 3候補の生成、9件の高速検査、Codex + Oriedita評価、評価指摘を使った再生成の最大10サイクル
- CC0展開図2,157件の知識検索と、モチーフ別の構造参照
- Orieditaで折れる山折り・谷折り配置の探索
- Orieditaで検証した展開図表示
- OrieditaのFOLD出力をOrigami Simulatorへ渡すドラッグ可能な3D表示

## Local development

```bash
npm install
npm run dev
```

`http://localhost:3000/` で確認できます。

## Local Oriedita worker

CodexへChatGPTアカウントでログインし、カスタム版OrieditaをビルドしたMacで実行します。

```bash
npm run local:oriedita
```

Macへのログイン時に自動起動させる場合:

```bash
npm run local:install
```

ローカルサーバーは `127.0.0.1:8788` のみに接続し、サイトから受け取ったジョブを1件ずつ処理します。
ワーカーは3候補を高速に比較し、Orieditaで折れる山折り・谷折り配置を探したあと、
Codexが折り上がりを評価します。合格点未満の場合は、指摘された部位・向き・対称性を
次の候補生成へ戻し、合格点に達するか最大10サイクルまで生成→評価→再生成を続けます。
ミウラ折り、水爆折り、フラッシャー、箱ひだなど登録済みの構造名が入力された場合は、
添付コレクション由来のCC0展開図を検索し、変更せずOrieditaへ渡します。
うさぎ、魚、昆虫などが入力された場合は、完成作品として置き換えず、
Blintz、単頂点、ボックスプリーツなどを設計用の構造参照として利用します。

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

公開APIの固定URLは `https://ori-ai-ito-pj-2026.pipipiimside.chatgpt.site/api`
です。公開プロキシは上記の必要なAPIパスだけをOriedita実行環境へ転送し、
任意の画面操作やローカルファイル操作は公開しません。

## Validation

```bash
npm run build
npm test
```

## Oracle Cloud API

公開利用時は、Oracle Cloud Always FreeのAmpere A1 VMでOrieditaとCodexを
常時起動します。VMはHTTPSのAPIだけを公開し、OpenAI APIキーをサーバーの
環境変数として保持します。構築手順は `deploy/oracle/README.md` にあります。

## Publishing

`main` ブランチへのpushでGitHub Actionsが静的サイトをビルドし、
GitHub Pagesへ公開します。

```bash
npm run build:pages
```

- Site: https://yuka-718.github.io/ito-pj-2026/
- Repository: https://github.com/yuka-718/ito-pj-2026

個人連絡先、会議URL、移動・健康など公開に不要な私的情報はサイトへ含めていません。
