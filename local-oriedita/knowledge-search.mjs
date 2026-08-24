import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPackPath = resolve(here, "..", "knowledge", "origami-cp-world", "patterns.pack.json.gz");

const FAMILY_ALIASES = [
  { family: "miura_like", aliases: ["miura", "miura ori", "ミウラ", "三浦折り", "三浦"] },
  { family: "single_vertex_kawasaki", aliases: ["single vertex", "kawasaki", "単頂点", "川崎定理", "川崎"] },
  { family: "radial_flasher_like", aliases: ["radial flasher", "flasher", "フラッシャー", "放射折り", "放射状"] },
  { family: "square_twist_array", aliases: ["square twist", "スクエアツイスト", "四角ねじり", "正方形ねじり"] },
  { family: "kresling_like", aliases: ["kresling", "クレスリング"] },
  { family: "accordion_pleats", aliases: ["accordion", "accordion pleat", "アコーディオン", "蛇腹", "じゃばら"] },
  { family: "yoshimura_like", aliases: ["yoshimura", "吉村パターン", "吉村折り", "吉村"] },
  { family: "box_pleat", aliases: ["box pleat", "boxpleat", "ボックスプリーツ", "箱ひだ"] },
  { family: "triangular_lattice", aliases: ["triangular lattice", "triangle lattice", "三角格子"] },
  { family: "waterbomb_tessellation", aliases: ["waterbomb", "water bomb", "ウォーターボム", "水爆折り", "水爆"] },
  { family: "reference_precrease", aliases: ["reference precrease", "precrease", "プリクリーズ", "基準折り"] },
];

function normalize(value) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_\-・]+/g, " ").trim();
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function loadKnowledgePack(packPath = defaultPackPath) {
  const compressed = await readFile(packPath);
  const pack = JSON.parse(gunzipSync(compressed).toString("utf8"));
  if (pack.format !== "ori-ai-knowledge-pack-v1" || !Array.isArray(pack.patterns)) {
    throw new Error("折り紙知識パックの形式が不正です");
  }
  return pack;
}

export function searchKnowledge(pack, query) {
  const normalizedQuery = normalize(query ?? "");
  if (!normalizedQuery) return null;
  const aliasGroup = FAMILY_ALIASES.find(({ aliases }) =>
    aliases.some((alias) => normalizedQuery.includes(normalize(alias))),
  );
  if (!aliasGroup) return null;

  const candidates = pack.patterns.filter((pattern) => pattern.family === aliasGroup.family);
  if (candidates.length === 0) return null;
  const requestedNumbers = normalizedQuery.match(/\d+/g) ?? [];
  const ranked = candidates.map((pattern) => {
    const parameterText = JSON.stringify(pattern.params ?? {});
    const parameterMatches = requestedNumbers.filter((number) => parameterText.includes(number)).length;
    const verifiedBonus = pattern.foldability === "local_theorem_constraints_constructed" ? 10 : 0;
    return {
      pattern,
      score: parameterMatches * 50 + verifiedBonus - Math.log2(Math.max(2, pattern.edge_count ?? 2)),
      tie: hashString(`${normalizedQuery}:${pattern.id}`),
    };
  }).sort((a, b) => b.score - a.score || a.tie - b.tie);

  return ranked[0].pattern;
}

export function publicKnowledgeMatch(pattern) {
  if (!pattern) return null;
  return {
    id: pattern.id,
    title: pattern.title,
    family: pattern.family,
    category: pattern.category,
    params: pattern.params ?? {},
    license: pattern.license,
    foldability: pattern.foldability,
    source: "Origami CP World Collection 2026-08-24",
  };
}
