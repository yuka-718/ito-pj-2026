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

const MOTIF_PROFILES = [
  {
    key: "winged_insect",
    pattern: /蝶|ちょう|バタフライ|butterfly|羽(?:を|が)?(?:広げ|開い)|winged insect/i,
    references: [
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { id: "reference_03_eight_spoke" },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "insect",
    pattern: /クワガタ|カブトムシ|昆虫|虫|beetle|insect/i,
    references: [
      { family: "box_pleat", params: { grid: 10, variant: 0 } },
      { family: "single_vertex_kawasaki", params: { degree: 12 } },
      { id: "reference_10_radial_12" },
    ],
  },
  {
    key: "rabbit",
    pattern: /うさぎ|ウサギ|兎|rabbit|bunny/i,
    references: [
      { id: "reference_12_blintz_precrease" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "fish",
    pattern: /金魚|魚|さかな|fish/i,
    references: [
      { id: "reference_14_waterbomb_base_reference" },
      { family: "single_vertex_kawasaki", params: { degree: 6 } },
      { family: "box_pleat", params: { grid: 6, variant: 0 } },
    ],
  },
  {
    key: "bird",
    pattern: /鶴|つる|鳥|bird|crane/i,
    references: [
      { id: "reference_03_eight_spoke" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 6, variant: 0 } },
    ],
  },
  {
    key: "quadruped",
    pattern: /猫|ねこ|犬|いぬ|四足|cat|dog/i,
    references: [
      { id: "reference_12_blintz_precrease" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "flower",
    pattern: /花|バラ|桜|flower|rose/i,
    references: [
      { family: "radial_flasher_like", params: { rays: 10, levels: 1 } },
      { family: "square_twist_array", params: { rows: 1, cols: 1 } },
      { id: "reference_10_radial_12" },
    ],
  },
  {
    key: "dragon",
    pattern: /龍|竜|ドラゴン|dragon/i,
    references: [
      { family: "box_pleat", params: { grid: 16, variant: 0 } },
      { family: "single_vertex_kawasaki", params: { degree: 12 } },
      { family: "accordion_pleats", params: { count: 12 } },
    ],
  },
  {
    key: "snake",
    pattern: /蛇|へび|細長|snake/i,
    references: [
      { family: "accordion_pleats", params: { count: 12 } },
      { family: "yoshimura_like", params: { rows: 2, cols: 6 } },
      { family: "miura_like", params: { rows: 2, cols: 6 } },
    ],
  },
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

function explicitFamily(query) {
  return FAMILY_ALIASES.find(({ aliases }) => aliases.some((alias) => query.includes(normalize(alias))))?.family ?? null;
}

function motifProfile(query) {
  return MOTIF_PROFILES.find(({ pattern }) => pattern.test(query)) ?? null;
}

function numericConstraints(query, family) {
  const read = (patterns) => {
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) return Number.parseInt(match[1], 10);
    }
    return null;
  };
  const result = {};
  const dimensions = query.match(/(\d+)\s*[×xX＊*]\s*(\d+)/);
  if (dimensions && ["miura_like", "yoshimura_like", "square_twist_array", "triangular_lattice", "waterbomb_tessellation"].includes(family)) {
    result.rows = Number.parseInt(dimensions[1], 10);
    result.cols = Number.parseInt(dimensions[2], 10);
  }
  const mappings = {
    single_vertex_kawasaki: [["degree", [/次数\s*(\d+)/, /(\d+)\s*次(?:の|単頂点)/, /degree\s*(\d+)/i]]],
    box_pleat: [["grid", [/格子\s*(\d+)/, /(\d+)\s*格子/, /grid\s*(\d+)/i]]],
    radial_flasher_like: [
      ["rays", [/(\d+)\s*本(?:放射)?/, /放射\s*(\d+)/, /rays?\s*(\d+)/i]],
      ["levels", [/(\d+)\s*層/, /層\s*(\d+)/, /levels?\s*(\d+)/i]],
    ],
    accordion_pleats: [["count", [/蛇腹\s*(\d+)/, /(\d+)\s*本/, /count\s*(\d+)/i]]],
    kresling_like: [
      ["sectors", [/角\s*(\d+)/, /(\d+)\s*角/, /sectors?\s*(\d+)/i]],
      ["levels", [/(\d+)\s*層/, /層\s*(\d+)/, /levels?\s*(\d+)/i]],
    ],
  };
  for (const [key, patterns] of mappings[family] ?? []) {
    const value = read(patterns);
    if (value != null) result[key] = value;
  }
  return result;
}

function paramDistance(params, requested) {
  const entries = Object.entries(requested);
  if (!entries.length) return 0;
  return entries.reduce((total, [key, value]) => {
    const actual = Number(params?.[key]);
    return total + (Number.isFinite(actual) ? Math.abs(actual - value) : 100);
  }, 0);
}

function rankFamily(pack, family, query, defaults = {}, limit = 1) {
  const explicit = numericConstraints(query, family);
  const requested = { ...defaults, ...explicit };
  return pack.patterns
    .filter((pattern) => pattern.family === family)
    .map((pattern) => {
      const exactParams = Object.entries(requested).filter(([key, value]) => pattern.params?.[key] === value).length;
      const verifiedBonus = pattern.foldability === "local_theorem_constraints_constructed" ? 15 : 0;
      return {
        pattern,
        score: exactParams * 80 + verifiedBonus - paramDistance(pattern.params, requested) * 20
          - Math.log2(Math.max(2, pattern.edge_count ?? 2)),
        tie: hashString(`${query}:${pattern.id}`),
      };
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, limit)
    .map(({ pattern }) => pattern);
}

function resolveReference(pack, spec, query) {
  if (spec.id) return pack.patterns.find((pattern) => pattern.id === spec.id) ?? null;
  return rankFamily(pack, spec.family, query, spec.params, 1)[0] ?? null;
}

export async function loadKnowledgePack(packPath = defaultPackPath) {
  const compressed = await readFile(packPath);
  const pack = JSON.parse(gunzipSync(compressed).toString("utf8"));
  if (pack.format !== "ori-ai-knowledge-pack-v1" || !Array.isArray(pack.patterns)) {
    throw new Error("折り紙知識パックの形式が不正です");
  }
  return pack;
}

export function retrieveKnowledge(pack, query, { limit = 3 } = {}) {
  const normalizedQuery = normalize(query ?? "");
  if (!normalizedQuery) return [];
  const family = explicitFamily(normalizedQuery);
  const profile = motifProfile(normalizedQuery);

  // The synthetic corpus contains structures, not finished animals or flowers.
  if (profile) {
    const preferredFamilySpec = family
      ? profile.references.find((reference) => reference.family === family)
      : null;
    const specs = family
      ? [{
        family,
        params: { ...(preferredFamilySpec?.params ?? {}), ...numericConstraints(normalizedQuery, family) },
      }, ...profile.references]
      : profile.references;
    const seenFamilies = new Set();
    const results = [];
    for (const spec of specs) {
      const pattern = resolveReference(pack, spec, normalizedQuery);
      if (!pattern || seenFamilies.has(pattern.family)) continue;
      seenFamilies.add(pattern.family);
      results.push({
        pattern,
        matchKind: "structural_reference",
        profile: profile.key,
        reason: `${profile.key}の部位配置を考えるための${pattern.family}構造`,
      });
      if (results.length >= limit) break;
    }
    return results;
  }

  if (!family) return [];
  return rankFamily(pack, family, normalizedQuery, {}, limit).map((pattern) => ({
    pattern,
    matchKind: "exact",
    profile: null,
    reason: `指定された${family}構造に一致`,
  }));
}

export function searchKnowledge(pack, query) {
  const match = retrieveKnowledge(pack, query, { limit: 1 })[0];
  return match?.matchKind === "exact" ? match.pattern : null;
}

export function publicKnowledgeMatch(pattern, details = {}) {
  if (!pattern) return null;
  return {
    id: pattern.id,
    title: pattern.title,
    family: pattern.family,
    category: pattern.category,
    params: pattern.params ?? {},
    license: pattern.license,
    foldability: pattern.foldability,
    sourceKind: pattern.source_kind ?? "generated_cc0",
    source: "Origami CP World Collection 2026-08-24",
    isFinishedModel: false,
    ...details,
  };
}

export function publicKnowledgeReference(match) {
  if (!match) return null;
  return publicKnowledgeMatch(match.pattern, {
    matchKind: match.matchKind,
    profile: match.profile,
    reason: match.reason,
  });
}
