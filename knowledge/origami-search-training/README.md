# Origami Search → verified FOLD training pipeline

許可済みの Origami Search データを、出典を保持したまま学習候補へ変換するためのパイプラインです。
生成物は `cache/` と `runs/` に保存します。実行時検索に必要な
`runs/current/index.json` だけをGitへ追加し、3,678枚の参考画像や中間生成物は
検証用Macだけに置いて公開サイトへ再配布しません。

```bash
# 625作品の索引を取得
npm run training:origami -- ingest

# 折り図画像も取得（途中再開可能）
npm run training:origami -- ingest --download --concurrency 4

# 1作品をCodex Visionで手順抽出
npm run training:origami -- extract --limit 1

# 色分けCP用のローカルPython環境を準備し、赤山・青谷のCPを抽出
npm run training:origami -- setup
npm run training:origami -- extract-cp

# original_square座標まで高信頼で復元できた作品をFOLD候補化
npm run training:origami -- build

# ローカルOriedita APIで候補を検証
npm run training:origami -- verify

# Oriedita合格かつ review.json で人が承認したものだけ学習索引へ登録
npm run training:origami -- register
```

## 状態の意味

- `extracted`: 画像から折り操作を読み取った段階。正解とは扱わない。
- `candidate`: 元の正方形上へ対応付けられた山谷線から作ったFOLD候補。
- `oriedita_verified`: Orieditaの2D平坦折り計算が完了。実際の折り順や作品一致の証明ではない。
- `approved`: 出典の折り図と照合して人が承認。学習索引へ入るのはこの状態だけ。

`review.json` の例:

```json
{
  "approved": true,
  "reviewer": "name",
  "reviewed_at": "2026-08-27T00:00:00.000Z",
  "notes": "全手順と最終形を照合済み"
}
```
