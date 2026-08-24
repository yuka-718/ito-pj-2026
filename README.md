# ORI / AI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版プロトタイプです。
プロンプトまたは参考画像を入力して、展開図と完成形3Dモデルを表示します。

## What works

- プロンプト入力
- 参考画像アップロード
- CodexによるOriedita操作・折り上がり評価ループ
- CC0展開図2,157件の知識検索と登録パターン優先表示
- Orieditaで検証した展開図表示
- ドラッグ操作できる完成形3D表示

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
CodexはOrieditaで入力 `.fold` を開き、折り上がりを評価し、最良案をサイトへ返します。
ミウラ折り、水爆折り、フラッシャー、箱ひだなど登録済みの構造名が入力された場合は、
添付コレクション由来のCC0展開図を検索し、変更せずOrieditaへ渡します。

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
