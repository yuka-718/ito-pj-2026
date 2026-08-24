# ORI / AI — 伊藤PJ 2026

未踏ジュニア2026「LLMを用いた折り紙展開図作成ソフト」のブラウザ版研究プロトタイプです。
Cosenseに記録された「特徴分解 → 構造候補 → 局所検証 → 外部ツール」の流れをもとに、
単頂点の展開図候補を実際に生成・編集・検証・書き出しできます。

## What works

- 金魚・クワガタ・鶴・花の語彙テンプレートと自由入力
- 部位名、重要度、伸ばしたい方向の編集
- seed付き96案探索から上位3候補を比較
- Kawasaki局所残差とMaekawa山谷本数差の再計算
- SVGとFOLD 1.2のブラウザ内書き出し

作品全体の平坦折り、層順、自己衝突、紙厚、折り順は検査しません。
この境界はUIと書き出しファイルの両方に明記しています。

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
