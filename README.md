# ORIAI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版プロトタイプです。
公開先は [GitHub Pages](https://yuka-718.github.io/oriai/) です。

## What works

- プロンプト入力
- 参考画像アップロード
- ブラウザ内での展開図候補生成
- ドラッグで回転できる3Dプレビュー
- 生成中は結果を隠し、完了後に展開図と3Dを同時表示
- 外部APIやローカルMacへ依存しない公開動作

## Local development

```bash
npm install
npm run dev
```

`http://localhost:3000/` で確認できます。

## Legacy research worker

以下のOriedita連携コードは研究・検証用に残していますが、現在の公開サイトの生成ボタンからは使用しません。

`GROQ_API_KEY`を環境変数へ設定し、カスタム版OrieditaをビルドしたMacで実行します。

```bash
npm run local:oriedita
```

Macの常駐サービスでは、APIキーをログインキーチェーンの
`jp.ito-pj.ori-ai.groq`へ保存すると自動的に読み込みます。キーをサイトやGitHubへは保存しません。

Macへのログイン時に自動起動させる場合:

```bash
npm run local:install
```

ローカルサーバーは `127.0.0.1:8788` のみに接続し、サイトから受け取ったジョブを1件ずつ処理します。
ワーカーは正方形の親状態を開き、正規化された折り線を一本だけ追加してFOLDを保存し、
その時点の展開図全体をOrieditaで平坦折り再計算します。Groqは親と分岐候補の2D輪郭を比較し、
合格点に達するか最大10手まで「追加→平坦折り→評価→選択」を続けます。失敗した分岐では
GUIのundoに依存せず、変更前の親FOLDを開き直します。各状態・判断・巻き戻しはジョブ内へ保存します。

これは累積展開図を一手ずつ設計する探索です。折られた紙の3Dレイヤー状態を次の一手へ保持する
逐次物理シミュレーションではなく、その実現可能性は未検証として結果へ記録します。
知識検索による作品の置換は一時停止しています。鶴やうさぎを含むすべての自然言語入力を
3候補の生成・評価処理へ送り、登録データを検索結果として表示しません。

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

旧公開プロキシは現在のGitHub Pages版からは呼び出しません。

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
