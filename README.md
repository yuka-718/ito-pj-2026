# ORI / AI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のプロジェクトサイトです。
2026年5月から8月までのCosense開発記録、ブースト合宿、中間発表をもとに、
構想、技術構成、試作、研究課題を公開向けに整理しています。

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
