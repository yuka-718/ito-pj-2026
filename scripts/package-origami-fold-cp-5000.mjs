#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { selectStructuralCorpus } from "../local-oriedita/knowledge-search.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const packPath = resolve(repoRoot, "knowledge", "origami-cp-world", "patterns.pack.json.gz");
const licenseRoot = resolve(repoRoot, "knowledge", "origami-cp-world", "LICENSES");
const archiveDate = "2026-08-28";
const archiveName = `origami_fold_cp_candidates_5000_${archiveDate}`;
const defaultOutputPath = resolve(homedir(), "Downloads", `${archiveName}.zip`);
const fixedMtime = new Date("2026-08-28T00:00:00.000Z");
const requestedCount = 5_000;

const cpType = Object.freeze({ M: 1, V: 2, B: 3 });

export function selectPatterns(patterns, count = requestedCount) {
  if (!Array.isArray(patterns) || patterns.length < count) {
    throw new Error(`At least ${count} patterns are required`);
  }
  const ids = new Set();
  const hashes = new Set();
  for (const pattern of patterns) {
    if (!pattern?.id || !pattern?.canonical_sha256) throw new Error("Pattern identity is missing");
    if (ids.has(pattern.id)) throw new Error(`Duplicate pattern id: ${pattern.id}`);
    if (hashes.has(pattern.canonical_sha256)) throw new Error(`Duplicate canonical hash: ${pattern.canonical_sha256}`);
    ids.add(pattern.id);
    hashes.add(pattern.canonical_sha256);
  }
  return selectStructuralCorpus(patterns, count);
}

export function validateFold(fold) {
  if (!fold || typeof fold !== "object" || Array.isArray(fold)) throw new Error("FOLD must be an object");
  const vertices = fold.vertices_coords;
  const edges = fold.edges_vertices;
  const assignments = fold.edges_assignment;
  if (!Array.isArray(vertices) || !Array.isArray(edges) || !Array.isArray(assignments)) {
    throw new Error("FOLD requires vertices_coords, edges_vertices, and edges_assignment");
  }
  if (edges.length !== assignments.length) throw new Error("Edge and assignment counts differ");
  for (const [index, vertex] of vertices.entries()) {
    if (!Array.isArray(vertex) || vertex.length < 2 || !vertex.slice(0, 2).every(Number.isFinite)) {
      throw new Error(`Invalid vertex ${index}`);
    }
  }
  for (const [index, edge] of edges.entries()) {
    if (!Array.isArray(edge) || edge.length !== 2 || !edge.every(Number.isInteger)) {
      throw new Error(`Invalid edge ${index}`);
    }
    if (edge[0] === edge[1] || edge.some((vertex) => vertex < 0 || vertex >= vertices.length)) {
      throw new Error(`Invalid edge reference ${index}`);
    }
    if (!new Set(["M", "V", "B", "F", "U", "C", "J"]).has(assignments[index])) {
      throw new Error(`Unsupported assignment ${assignments[index]} at edge ${index}`);
    }
  }
  return true;
}

function fixed(value) {
  const normalized = Math.abs(value) < 5e-13 ? 0 : value;
  return normalized.toFixed(10);
}

export function foldToCp(pattern) {
  validateFold(pattern.fold);
  const lines = [
    `# ${pattern.title}`,
    `# id=${pattern.id} family=${pattern.family} license=${pattern.license}`,
    "# Oriedita/Orihime-style CP: type x1 y1 x2 y2; 1=M, 2=V, 3=B, 0=other",
  ];
  for (let index = 0; index < pattern.fold.edges_vertices.length; index += 1) {
    const [a, b] = pattern.fold.edges_vertices[index];
    const [x1, y1] = pattern.fold.vertices_coords[a];
    const [x2, y2] = pattern.fold.vertices_coords[b];
    const type = cpType[pattern.fold.edges_assignment[index]] ?? 0;
    lines.push(`${type} ${fixed(x1 * 400)} ${fixed(y1 * 400)} ${fixed(x2 * 400)} ${fixed(y2 * 400)}`);
  }
  return `${lines.join("\n")}\n`;
}

function safeSegment(value) {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Unsafe path segment: ${value}`);
  return value;
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

async function writeTracked(root, relativePath, data, checksums) {
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}/`)) throw new Error(`Unsafe output path: ${relativePath}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  checksums.push({ path: relativePath, sha256: sha256(data) });
  return path;
}

async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(relative(root, path));
    }
  }
  await visit(root);
  return files.sort();
}

async function normalizeMtimes(root) {
  const paths = [];
  async function visit(path) {
    paths.push(path);
    if ((await stat(path)).isDirectory()) {
      for (const entry of await readdir(path)) await visit(join(path, entry));
    }
  }
  await visit(root);
  for (const path of paths.reverse()) await utimes(path, fixedMtime, fixedMtime);
}

async function createZip(parent, rootName, outputPath) {
  const files = (await listFiles(join(parent, rootName))).map((path) => `${rootName}/${path}`);
  await mkdir(dirname(outputPath), { recursive: true });
  await rm(outputPath, { force: true });
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("zip", ["-X", "-q", outputPath, "-@"], {
      cwd: parent,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`zip exited with ${code}: ${stderr}`));
    });
    child.stdin.end(`${files.join("\n")}\n`);
  });
}

function researchSources() {
  return [
    {
      name: "Origami Crease Pattern Dataset",
      url: "https://www.research-collection.ethz.ch/items/6a2b8229-e62f-4bac-8655-37b283c549ec",
      data_type: "8 million rigidly-foldable 1-DOF crease-pattern geometries",
      license: "CC-BY-4.0",
      included: false,
      reason: "Large external dataset; not needed because this archive uses the already-local CC0 corpus.",
    },
    {
      name: "FOLD file format and examples",
      url: "https://github.com/edemaine/fold",
      data_type: "FOLD specification, converters, and examples",
      license: "MIT",
      included: false,
      reason: "Used as the interchange-format reference; third-party example payloads are not mixed into the CC0 corpus.",
    },
    {
      name: "Jun Mitani crease-pattern downloads",
      url: "https://mitani.cs.tsukuba.ac.jp/en/cp_download.html",
      data_type: "PDF crease patterns and finished-form images",
      license: "Site grants general download/use but requests contact for special uses",
      included: false,
      reason: "Not redistributed because product/research conversion scope requires direct confirmation.",
    },
    {
      name: "Origami Database",
      url: "https://origami-database.com/",
      data_type: "Named models, finished photos, diagrams/video/CP links",
      license: "No archive-wide redistribution license confirmed",
      included: false,
      reason: "Metadata and media were not copied without a redistribution license.",
    },
    {
      name: "ORIAI Origami Search local index",
      url: "https://origami-search.i1013235329.workers.dev/",
      data_type: "625 named works and 3,676 indexed diagram images",
      license: "User-confirmed permission; exact AI/conversion/redistribution scope still needs written evidence",
      included: false,
      reason: "No images or diagrams are redistributed in this archive.",
    },
  ];
}

function readme(summary) {
  return `# 折り紙 FOLD / CP 候補 5,000件（${archiveDate}）

このZIPには、CC0で再配布可能な生成構造コーパス5,157件から、形状ハッシュ順で決定論的に選んだ5,000件を収録しています。

## 内容

- \`fold/\`: FOLD 1.2 JSON、5,000件
- \`cp/\`: Oriedita/Orihime形式のCP、5,000件
- \`steps/\`: 機械生成の折り線活性化順（存在するもののみ、${summary.machine_step_files}件）
- \`metadata/manifest.jsonl\`: 全5,000件の出典・ライセンス・検証状態
- \`metadata/manifest.csv\`: 表計算ソフト用の簡易目録
- \`SOURCES/research_sources.json\`: 調査した外部データ源と不採用理由
- \`LICENSES/\`: CC0権利情報
- \`SHA256SUMS\`: 全ファイルの改ざん確認用ハッシュ

## 重要な制限

これは完成作品集ではありません。全件が展開図・構造候補で、完成形3Dや人間向け折り図を持ちません。
\`steps/\` は機械生成の折り線活性化順であり、人が実際に折れる手順として検証されていません。
FOLD/CPとしての構文・頂点参照・線種は検査済みですが、大域的な平坦折り、剛体折り、衝突、レイヤー順、作品一致は保証しません。

Origami Searchの画像、第三者サイトのPDF・完成写真・折り図は同梱していません。権利範囲が確認できない資料を無断再配布しないためです。

## 件数

- 合計: ${summary.pattern_count}
- 元コーパス: ${Object.entries(summary.source_counts).map(([key, value]) => `${key} ${value}件`).join(" / ")}
- FOLD: ${summary.fold_files}件
- CP: ${summary.cp_files}件
- ID重複: 0件
- 形状ハッシュ重複: 0件

各ファイルの正確な状態は \`metadata/manifest.jsonl\` の \`foldability\`, \`human_verified\`, \`is_finished_model\` を確認してください。
`;
}

async function main() {
  const outputPath = resolve(process.argv[2] ?? defaultOutputPath);
  const pack = JSON.parse(gunzipSync(await readFile(packPath)));
  const selected = selectPatterns(pack.patterns, requestedCount);
  const temporaryParent = await mkdtemp(join(tmpdir(), "oriai-fold-cp-5000-"));
  const root = join(temporaryParent, archiveName);
  const checksums = [];
  const manifest = [];
  const sourceCounts = new Map();
  const foldabilityCounts = new Map();
  const familyCounts = new Map();
  let stepFileCount = 0;

  try {
    await mkdir(root, { recursive: true });
    for (let index = 0; index < selected.length; index += 1) {
      const pattern = selected[index];
      validateFold(pattern.fold);
      const family = safeSegment(pattern.family);
      const id = safeSegment(pattern.id);
      const foldRelative = `fold/${family}/${id}.fold`;
      const cpRelative = `cp/${family}/${id}.cp`;
      const foldData = `${JSON.stringify(pattern.fold, null, 2)}\n`;
      const cpData = foldToCp(pattern);
      await writeTracked(root, foldRelative, foldData, checksums);
      await writeTracked(root, cpRelative, cpData, checksums);
      let stepsRelative = null;
      if (pattern.activation_sequence) {
        stepsRelative = `steps/${family}/${id}.steps.json`;
        await writeTracked(root, stepsRelative, `${JSON.stringify(pattern.activation_sequence, null, 2)}\n`, checksums);
        stepFileCount += 1;
      }
      increment(sourceCounts, pattern.source ?? "Origami CP World Collection 2026-08-24");
      increment(foldabilityCounts, pattern.foldability);
      increment(familyCounts, pattern.family);
      manifest.push({
        index: index + 1,
        id: pattern.id,
        title: pattern.title,
        title_ja: pattern.title_ja ?? null,
        family: pattern.family,
        category: pattern.category,
        source: pattern.source ?? "Origami CP World Collection 2026-08-24",
        source_kind: pattern.source_kind,
        license: pattern.license,
        foldability: pattern.foldability,
        human_verified: false,
        physical_foldability_verified: false,
        is_finished_model: false,
        produces_named_finished_model: false,
        fold_path: foldRelative,
        cp_path: cpRelative,
        steps_path: stepsRelative,
        canonical_sha256: pattern.canonical_sha256,
        fold_file_sha256: sha256(foldData),
        cp_file_sha256: sha256(cpData),
        vertex_count: pattern.fold.vertices_coords.length,
        edge_count: pattern.fold.edges_vertices.length,
        assignment_counts: pattern.assignment_counts,
        params: pattern.params ?? null,
        notes: pattern.notes,
      });
    }

    const summary = {
      schema: "oriai-fold-cp-candidate-archive-v1",
      generated_at: `${archiveDate}T00:00:00.000Z`,
      selection: "canonical_sha256 ascending, first 5000 of 5157 unique CC0 structures",
      pattern_count: manifest.length,
      fold_files: manifest.length,
      cp_files: manifest.length,
      machine_step_files: stepFileCount,
      source_counts: Object.fromEntries([...sourceCounts].sort()),
      foldability_counts: Object.fromEntries([...foldabilityCounts].sort()),
      family_counts: Object.fromEntries([...familyCounts].sort()),
      duplicate_ids: 0,
      duplicate_canonical_hashes: 0,
      images_included: 0,
      diagrams_included: 0,
      finished_models_claimed: 0,
      human_verified_steps_claimed: 0,
    };

    const manifestJsonl = `${manifest.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const csvFields = [
      "index", "id", "title", "title_ja", "family", "category", "source", "license", "foldability",
      "human_verified", "physical_foldability_verified", "is_finished_model", "fold_path", "cp_path", "steps_path",
      "canonical_sha256", "vertex_count", "edge_count",
    ];
    const manifestCsv = [
      csvFields.join(","),
      ...manifest.map((record) => csvFields.map((field) => csvCell(record[field])).join(",")),
    ].join("\n") + "\n";

    await writeTracked(root, "README_JA.md", readme(summary), checksums);
    await writeTracked(root, "SUMMARY.json", `${JSON.stringify(summary, null, 2)}\n`, checksums);
    await writeTracked(root, "metadata/manifest.jsonl", manifestJsonl, checksums);
    await writeTracked(root, "metadata/manifest.csv", manifestCsv, checksums);
    await writeTracked(root, "SOURCES/research_sources.json", `${JSON.stringify(researchSources(), null, 2)}\n`, checksums);
    await writeTracked(root, "LICENSES/CC0_GENERATED_CORPUS.txt", await readFile(resolve(licenseRoot, "CC0_GENERATED_CORPUS.txt")), checksums);
    await writeTracked(root, "LICENSES/CC0_ADDITIONAL_3000.txt", await readFile(resolve(licenseRoot, "CC0_ADDITIONAL_3000.txt")), checksums);
    const checksumText = `${checksums.sort((a, b) => a.path.localeCompare(b.path)).map((entry) => `${entry.sha256}  ${entry.path}`).join("\n")}\n`;
    await writeFile(resolve(root, "SHA256SUMS"), checksumText);

    await normalizeMtimes(root);
    await createZip(temporaryParent, archiveName, outputPath);
    const archiveStats = await stat(outputPath);
    process.stdout.write(`${JSON.stringify({ output: outputPath, bytes: archiveStats.size, ...summary }, null, 2)}\n`);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
