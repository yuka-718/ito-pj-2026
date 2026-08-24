# ORI / AI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版プロトタイプです。
プロンプトまたは参考画像を入力して、展開図と完成形3Dモデルを表示します。

## What works

- プロンプト入力
- 参考画像アップロード
- 展開図表示
- ドラッグ操作できる完成形3D表示

## Local development

```bash
npm install
npm run dev
```

`http://localhost:3000/` で確認できます。

## Validation

```bash
npm run build
npm test
```

## Publishing

`main` ブランチへのpushでGitHub Actionsが静的サイトをビルドし、
GitHub Pagesへ公開します。

```bash
npm run build:pages
```

- Site: https://yuka-718.github.io/ito-pj-2026/
- Repository: https://github.com/yuka-718/ito-pj-2026

個人連絡先、会議URL、移動・健康など公開に不要な私的情報はサイトへ含めていません。
