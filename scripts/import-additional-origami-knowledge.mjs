#!/usr/bin/env node

import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { validateFoldDocument } from "../local-oriedita/api-contract.mjs";

const sourceRoot = resolve(process.argv[2]
  ?? "work/origami-additional-3000-20260827/origami_search_additional_3000_2026-08-27");
const packPath = resolve(process.argv[3] ?? "knowledge/origami-cp-world/patterns.pack.json.gz");
const outputPath = resolve(process.argv[4] ?? packPath);
const metadataPath = resolve(sourceRoot, "metadata/items.jsonl");
const additionalSourceName = "Origami Search Additional 3000 2026-08-27";

const FAMILY_MAP = new Map([
  ["single_vertex_kawasaki_extended", "single_vertex_kawasaki"],
  ["parallel_accordion_extended", "accordion_pleats"],
  ["miura_patch_extended", "miura_like"],
  ["alternating_diagonal_grid", "triangular_lattice"],
  ["waterbomb_cell_patch", "waterbomb_tessellation"],
  ["yoshimura_strip_extended", "yoshimura_like"],
]);

function insideSource(relativePath) {
  const path = resolve(sourceRoot, String(relativePath));
  if (path !== sourceRoot && !path.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error(`Unsafe dataset path: ${relativePath}`);
  }
  return path;
}

function makeOrieditaCompatible(fold) {
  return Object.fromEntries(
    Object.entries(fold).filter(([key]) => !key.startsWith("metadata_")),
  );
}

function normalizeParams(metadata) {
  const params = { ...(metadata.parameters ?? {}) };
  if (params.columns != null && params.cols == null) params.cols = params.columns;
  if (params.crease_count != null && params.count == null) params.count = params.crease_count;
  if (params.cells_x != null && params.cols == null) params.cols = params.cells_x;
  if (params.cells_y != null && params.rows == null) params.rows = params.cells_y;
  if (params.vertical_lines != null && params.cols == null) params.cols = params.vertical_lines;
  if (params.horizontal_lines != null && params.rows == null) params.rows = params.horizontal_lines;
  if (params.segments_per_row != null && params.cols == null) params.cols = params.segments_per_row;
  if (params.ray_count != null && params.rays == null) params.rays = params.ray_count;
  return params;
}

function convertMetadata(metadata, fold, steps) {
  return {
    id: metadata.id,
    title: metadata.title,
    title_ja: metadata.title_ja,
    family: FAMILY_MAP.get(metadata.family) ?? metadata.family,
    original_family: metadata.family,
    category: metadata.category,
    params: normalizeParams(metadata),
    assignment_counts: metadata.counts?.assignment_counts ?? {},
    vertex_count: metadata.counts?.vertex_count ?? fold.vertices_coords?.length ?? 0,
    edge_count: metadata.counts?.edge_count ?? fold.edges_vertices?.length ?? 0,
    max_degree: metadata.counts?.max_degree ?? null,
    max_edge_length: metadata.counts?.max_edge_length ?? null,
    mean_internal_degree: metadata.counts?.mean_internal_degree ?? null,
    min_edge_length: metadata.counts?.min_edge_length ?? null,
    canonical_sha256: metadata.semantic_sha256,
    semantic_sha256: metadata.semantic_sha256,
    license: metadata.license,
    foldability: metadata.foldability_status,
    human_verified: false,
    is_finished_model: false,
    produces_named_finished_model: false,
    source_kind: "generated_cc0",
    source: additionalSourceName,
    notes: metadata.notes,
    tags: metadata.tags ?? [],
    activation_sequence: {
      kind: steps.sequence_kind,
      human_verified: steps.human_verified === true,
      produces_named_finished_model: steps.produces_named_finished_model === true,
      steps: (steps.steps ?? []).map((step) => ({
        step: step.step,
        action: step.action,
        edge_indices: step.edge_indices,
        unfold_after_step: step.unfold_after_step === true,
      })),
    },
    fold,
  };
}

const current = JSON.parse(gunzipSync(await readFile(packPath)).toString("utf8"));
if (current.format !== "ori-ai-knowledge-pack-v1" || !Array.isArray(current.patterns)) {
  throw new Error("Existing knowledge pack is invalid");
}

const metadataLines = (await readFile(metadataPath, "utf8")).split("\n").filter(Boolean);
if (metadataLines.length !== 3_000) throw new Error(`Expected 3000 metadata records, got ${metadataLines.length}`);
const basePatterns = current.patterns.filter(({ source }) => source !== additionalSourceName);
const existingIds = new Set(basePatterns.map(({ id }) => id));
const existingHashes = new Set(basePatterns.map(({ canonical_sha256 }) => canonical_sha256).filter(Boolean));
const additionalIds = new Set();
const additionalHashes = new Set();
const additional = [];

for (const line of metadataLines) {
  const metadata = JSON.parse(line);
  if (existingIds.has(metadata.id) || additionalIds.has(metadata.id)) throw new Error(`Duplicate pattern id: ${metadata.id}`);
  if (!metadata.semantic_sha256 || existingHashes.has(metadata.semantic_sha256) || additionalHashes.has(metadata.semantic_sha256)) {
    throw new Error(`Duplicate semantic hash: ${metadata.id}`);
  }
  if (metadata.license !== "CC0-1.0" || metadata.rights_mode !== "bundled_open_public_domain_dedication") {
    throw new Error(`Pattern is not bundled CC0: ${metadata.id}`);
  }
  const [foldRaw, stepsRaw] = await Promise.all([
    readFile(insideSource(metadata.fold_file), "utf8"),
    readFile(insideSource(metadata.steps_file), "utf8"),
  ]);
  const fold = makeOrieditaCompatible(JSON.parse(foldRaw));
  validateFoldDocument(fold);
  const steps = JSON.parse(stepsRaw);
  if (steps.pattern_id !== metadata.id || steps.human_verified !== false || steps.produces_named_finished_model !== false) {
    throw new Error(`Invalid activation sequence metadata: ${metadata.id}`);
  }
  const expectedCreases = fold.edges_assignment
    .map((assignment, index) => assignment === "B" ? null : index)
    .filter((index) => index != null);
  const activatedCreases = (steps.steps ?? []).flatMap(({ edge_indices: indices }) => indices ?? []);
  if (activatedCreases.some((index) => !Number.isInteger(index))
    || new Set(activatedCreases).size !== activatedCreases.length
    || expectedCreases.length !== activatedCreases.length
    || expectedCreases.some((index) => !activatedCreases.includes(index))) {
    throw new Error(`Activation sequence does not cover every crease exactly once: ${metadata.id}`);
  }
  additionalIds.add(metadata.id);
  additionalHashes.add(metadata.semantic_sha256);
  additional.push(convertMetadata(metadata, fold, steps));
}

const patterns = [...basePatterns, ...additional];
const payload = {
  ...current,
  source: "Origami CP World Collection 2026-08-24 + Origami Search Additional 3000 2026-08-27",
  sources: [
    ...(current.sources ?? [{ name: current.source, patternCount: current.patternCount }])
      .filter(({ name }) => name !== additionalSourceName),
    {
      name: additionalSourceName,
      patternCount: additional.length,
      license: "CC0-1.0",
      humanVerified: false,
      finishedModelCount: 0,
    },
  ],
  patternCount: patterns.length,
  patterns,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, gzipSync(JSON.stringify(payload), { level: 9, mtime: 0 }));
process.stdout.write(`${basePatterns.length} + ${additional.length} = ${patterns.length} patterns -> ${outputPath}\n`);
