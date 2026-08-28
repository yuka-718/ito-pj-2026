import { gunzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPackPath = resolve(here, "..", "knowledge", "origami-cp-world", "patterns.pack.json.gz");
const defaultLibraryPath = resolve(here, "..", "knowledge", "finished-models", "catalog.json");
const remoteFoldCache = new Map();

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
  { family: "boundary_fan_pleats", aliases: ["boundary fan", "fan pleat", "境界ファン", "ファンプリーツ", "扇ひだ"] },
  { family: "herringbone_corrugation", aliases: ["herringbone", "ヘリンボーン", "杉綾"] },
  { family: "nonuniform_orthogonal_grid", aliases: ["nonuniform orthogonal grid", "nonuniform grid", "不均一直交格子", "不均一格子"] },
  { family: "concentric_polygon_rings", aliases: ["concentric polygon", "polygon rings", "同心多角形", "多角形リング"] },
];

const MOTIF_PROFILES = [
  {
    key: "winged_insect",
    pattern: /蝶|ちょう|バタフライ|butterfly|羽(?:を|が)?(?:広げ|開い)|winged insect/i,
    targetCapacity: 8,
    complexity: 0.58,
    references: [
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { id: "reference_03_eight_spoke" },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "insect",
    pattern: /クワガタ|カブトムシ|昆虫|虫|beetle|insect/i,
    targetCapacity: 12,
    complexity: 0.78,
    references: [
      { family: "box_pleat", params: { grid: 10, variant: 0 } },
      { family: "single_vertex_kawasaki", params: { degree: 12 } },
      { id: "reference_10_radial_12" },
    ],
  },
  {
    key: "rabbit",
    pattern: /うさぎ|ウサギ|兎|rabbit|bunny/i,
    targetCapacity: 8,
    complexity: 0.55,
    references: [
      { id: "reference_12_blintz_precrease" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "fish",
    pattern: /金魚|魚|さかな|fish/i,
    targetCapacity: 6,
    complexity: 0.45,
    references: [
      { id: "reference_14_waterbomb_base_reference" },
      { family: "single_vertex_kawasaki", params: { degree: 6 } },
      { family: "box_pleat", params: { grid: 6, variant: 0 } },
    ],
  },
  {
    key: "bird",
    pattern: /鶴|つる|鳥|bird|crane/i,
    targetCapacity: 8,
    complexity: 0.52,
    references: [
      { id: "reference_03_eight_spoke" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 6, variant: 0 } },
    ],
  },
  {
    key: "quadruped",
    pattern: /猫|ねこ|犬|いぬ|四足|cat|dog/i,
    targetCapacity: 8,
    complexity: 0.6,
    references: [
      { id: "reference_12_blintz_precrease" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ],
  },
  {
    key: "flower",
    pattern: /花|バラ|桜|flower|rose/i,
    targetCapacity: 10,
    complexity: 0.5,
    references: [
      { family: "radial_flasher_like", params: { rays: 10, levels: 1 } },
      { family: "square_twist_array", params: { rows: 1, cols: 1 } },
      { id: "reference_10_radial_12" },
    ],
  },
  {
    key: "dragon",
    pattern: /龍|竜|ドラゴン|dragon/i,
    targetCapacity: 12,
    complexity: 0.85,
    references: [
      { family: "box_pleat", params: { grid: 16, variant: 0 } },
      { family: "single_vertex_kawasaki", params: { degree: 12 } },
      { family: "accordion_pleats", params: { count: 12 } },
    ],
  },
  {
    key: "snake",
    pattern: /蛇|へび|細長|snake/i,
    targetCapacity: 12,
    complexity: 0.48,
    references: [
      { family: "accordion_pleats", params: { count: 12 } },
      { family: "yoshimura_like", params: { rows: 2, cols: 6 } },
      { family: "miura_like", params: { rows: 2, cols: 6 } },
    ],
  },
  {
    key: "architecture",
    pattern: /建築|建物|屋根|タワー|塔|ファサード|シェル|architecture|building|roof|tower|facade/i,
    targetCapacity: 8,
    complexity: 0.62,
    references: [
      { family: "nonuniform_orthogonal_grid", params: { rows: 8, cols: 8 } },
      { family: "yoshimura_like", params: { rows: 4, cols: 6 } },
      { family: "miura_like", params: { rows: 4, cols: 6 } },
    ],
  },
  {
    key: "star",
    pattern: /星|スター|太陽|star|sun/i,
    targetCapacity: 10,
    complexity: 0.5,
    references: [
      { family: "radial_flasher_like", params: { rays: 10, levels: 1 } },
      { family: "concentric_polygon_rings", params: { sides: 10, levels: 3 } },
      { id: "reference_10_radial_12" },
    ],
  },
  {
    key: "vehicle",
    pattern: /車|船|飛行機|宇宙船|ロケット|vehicle|car|boat|airplane|spaceship|rocket/i,
    targetCapacity: 8,
    complexity: 0.58,
    references: [
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "accordion_pleats", params: { count: 10 } },
    ],
  },
];

const STRUCTURAL_FAMILY_FEATURES = Object.freeze({
  miura_like: { symmetric: true, elongated: true, grid: true },
  single_vertex_kawasaki: { symmetric: false, radial: true, branching: true },
  radial_flasher_like: { symmetric: true, radial: true },
  square_twist_array: { symmetric: true, grid: true },
  kresling_like: { symmetric: true, radial: true, elongated: true },
  accordion_pleats: { symmetric: true, elongated: true },
  yoshimura_like: { symmetric: true, elongated: true, grid: true },
  box_pleat: { symmetric: true, grid: true, branching: true },
  triangular_lattice: { symmetric: true, grid: true },
  waterbomb_tessellation: { symmetric: true, grid: true },
  reference_precrease: { symmetric: true, branching: true },
  boundary_fan_pleats: { symmetric: false, radial: true, branching: true },
  herringbone_corrugation: { symmetric: true, elongated: true, grid: true },
  nonuniform_orthogonal_grid: { symmetric: true, grid: true },
  concentric_polygon_rings: { symmetric: true, radial: true },
});

const FOLDABILITY_CONFIDENCE = Object.freeze({
  local_theorem_constraints_constructed: 90,
  local_kawasaki_and_maekawa_constructed_not_physical_verified: 82,
  construction_known_parallel_pleats_not_human_verified: 74,
  miura_family_topology_constructed_not_rigid_verified: 68,
  corrugation_primitive_not_global_fold_verified: 58,
  construction_heuristic_boundary_fan_not_physical_verified: 54,
  not_verified: 30,
});

const LIBRARY_QUERY_RULES = [
  { family: "dragonfly", pattern: /とんぼ|トンボ|蜻蛉|dragonfly/i },
  { family: "crane", pattern: /鶴|おりづる|つる|crane/i },
  { family: "rabbit", pattern: /うさぎ|ウサギ|兎|rabbit|bunny/i },
  { family: "dragon", pattern: /龍|竜|ドラゴン|dragon(?!fly)/i },
  { family: "butterfly", pattern: /蝶|ちょう|バタフライ|butterfly|swallowtail/i },
  { family: "penguin", pattern: /ペンギン|penguin|pinguin/i },
  { family: "frog", pattern: /蛙|かえる|カエル|frog/i },
  { family: "turtle", pattern: /亀|かめ|カメ|turtle|tortoise/i },
  { family: "fish", pattern: /金魚|魚|さかな|fish|taiyaki/i },
  { family: "dog", pattern: /犬|いぬ|イヌ|dog/i },
  { family: "cat", pattern: /猫|ねこ|ネコ|cat/i },
  { family: "bird", pattern: /鳥|とり|バード|bird/i },
  { family: "boat", pattern: /船|ふね|ボート|boat|sailboat/i },
  { family: "heart", pattern: /ハート|心|heart/i },
  { family: "flower", pattern: /花|バラ|チューリップ|flower|rose|tulip/i },
  { family: "crab", pattern: /蟹|かに|カニ|crab/i },
  { family: "insect", pattern: /昆虫|虫|カブトムシ|クワガタ|beetle|insect|kabuto|scorpion|mantis/i },
  { family: "bat", pattern: /蝙蝠|コウモリ|(?:^|\s)bat(?:$|\s)/i },
  { family: "elephant", pattern: /象|ゾウ|elephant/i },
  { family: "horse", pattern: /馬|うま|ウマ|horse/i },
  { family: "deer", pattern: /鹿|しか|シカ|deer|stag/i },
  { family: "snake", pattern: /蛇|へび|ヘビ|snake|serpent/i },
  { family: "box", pattern: /箱|はこ|ボックス|box/i },
  { family: "envelope", pattern: /封筒|ふうとう|envelope/i },
  { family: "star", pattern: /星|ほし|スター|star/i },
];

const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["一", 1], ["二", 2], ["三", 3], ["四", 4], ["五", 5],
  ["六", 6], ["七", 7], ["八", 8], ["九", 9], ["十", 10],
]);

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

function requestedHeadCount(query) {
  const digits = query.match(/(\d+)\s*(?:つの?)?\s*(?:頭|ヘッド|heads?|headed)/i)
    ?? query.match(/(\d+)\s*[- ]?headed/i);
  if (digits) return Number.parseInt(digits[1], 10);
  for (const [word, count] of NUMBER_WORDS) {
    if (new RegExp(`${word}\\s*(?:つの?)?\\s*(?:頭|ヘッド|heads?|headed)`, "i").test(query)
      || new RegExp(`${word}[- ]headed`, "i").test(query)) return count;
  }
  return null;
}

function rankLibraryModels(models, query, limit) {
  const rule = LIBRARY_QUERY_RULES.find(({ pattern }) => pattern.test(query));
  if (!rule) return [];
  const headCount = requestedHeadCount(query);
  return models
    .filter((model) => model.family === rule.family)
    .filter((model) => headCount == null || model.head_count === headCount)
    .map((model) => {
      const title = normalize(model.title);
      const exactTitle = query.includes(title) || title.includes(query);
      const traditional = /traditional/i.test(model.title);
      const simple = /(?:^|[ _-])simple(?:$|[ _-])/i.test(model.title);
      const base = /(?:^|[ _-])(?:base|cp)(?:$|[ _-])/i.test(model.title);
      const preferredSource = model.source === "origamimagiro/flat-folder";
      return {
        model,
        score: (exactTitle ? 200 : 0)
          + (model.is_finished_model ? 80 : 0)
          + (traditional ? 30 : 0)
          + (simple ? 10 : 0)
          + (preferredSource ? 20 : 0)
          - (base ? 25 : 0)
          - model.title.length * 0.2
          - Math.log2(Math.max(2, model.remote_bytes ?? 2)),
        tie: hashString(`${query}:${model.id}`),
      };
    })
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, limit)
    .map(({ model }) => model);
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
  if (dimensions && [
    "miura_like", "yoshimura_like", "square_twist_array", "triangular_lattice", "waterbomb_tessellation",
    "herringbone_corrugation", "nonuniform_orthogonal_grid",
  ].includes(family)) {
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
    boundary_fan_pleats: [["rays", [/(\d+)\s*本/, /放射\s*(\d+)/, /rays?\s*(\d+)/i]]],
    concentric_polygon_rings: [
      ["sides", [/(\d+)\s*角/, /辺数\s*(\d+)/, /sides?\s*(\d+)/i]],
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

export async function loadKnowledgePack(packPath = defaultPackPath, libraryPath = defaultLibraryPath) {
  const [compressed, libraryRaw] = await Promise.all([
    readFile(packPath),
    readFile(libraryPath, "utf8"),
  ]);
  const pack = JSON.parse(gunzipSync(compressed).toString("utf8"));
  if (pack.format !== "ori-ai-knowledge-pack-v1" || !Array.isArray(pack.patterns)) {
    throw new Error("折り紙知識パックの形式が不正です");
  }
  const library = JSON.parse(libraryRaw);
  if (library.format !== "ori-ai-fold-library-v1" || !Array.isArray(library.models)) {
    throw new Error("完成作品FOLDライブラリの形式が不正です");
  }
  pack.finishedModels = library.models;
  pack.finishedModelCount = library.model_count;
  pack.finishedModelSources = library.sources;
  return pack;
}

export function retrieveKnowledge(pack, query, { limit = 3 } = {}) {
  const normalizedQuery = normalize(query ?? "");
  if (!normalizedQuery) return [];
  const family = explicitFamily(normalizedQuery);
  const libraryModels = family ? [] : rankLibraryModels(pack.finishedModels ?? [], normalizedQuery, 1);
  if (libraryModels.length) {
    return libraryModels.map((pattern) => ({
      pattern,
      matchKind: "exact",
      profile: pattern.family,
      reason: `公開FOLDライブラリの「${pattern.title}」に一致`,
    }));
  }
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

export function selectStructuralCorpus(packOrPatterns, count = 5_000) {
  const patterns = Array.isArray(packOrPatterns) ? packOrPatterns : packOrPatterns?.patterns;
  if (!Array.isArray(patterns) || patterns.length < count) {
    throw new Error(`構造知識が不足しています (${patterns?.length ?? 0}/${count})`);
  }
  return [...patterns]
    .sort((a, b) => {
      const hashA = String(a.canonical_sha256 ?? "");
      const hashB = String(b.canonical_sha256 ?? "");
      if (hashA < hashB) return -1;
      if (hashA > hashB) return 1;
      return String(a.id).localeCompare(String(b.id), "en");
    })
    .slice(0, count);
}

function bounded(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function intentPreferences(profile, family, query) {
  let preferences = profile?.references?.map((reference) => ({
    ...reference,
    params: reference.family
      ? { ...(reference.params ?? {}), ...numericConstraints(query, reference.family) }
      : reference.params,
  })) ?? [];
  const petals = query.match(/(\d+)\s*枚(?:の)?\s*花びら/);
  if (profile?.key === "flower" && petals) {
    const rays = Number.parseInt(petals[1], 10);
    preferences = preferences.map((reference) => reference.family === "radial_flasher_like"
      ? { ...reference, params: { ...(reference.params ?? {}), rays } }
      : reference);
  }
  const floors = query.match(/(\d+)\s*階/);
  if (profile?.key === "architecture" && /タワー|塔|円筒|tower|cylinder/i.test(query)) {
    preferences = [{
      family: "kresling_like",
      params: { sectors: 6, levels: floors ? Number.parseInt(floors[1], 10) : 4 },
    }, ...preferences];
  }
  if (family) {
    const existing = preferences.find((reference) => reference.family === family);
    preferences = [{
      family,
      params: {
        ...(family === "accordion_pleats" && !existing ? { count: profile?.targetCapacity ?? 8 } : {}),
        ...(existing?.params ?? {}),
        ...numericConstraints(query, family),
      },
    }, ...preferences.filter((reference) => reference.family !== family)];
  }
  if (!preferences.length) {
    preferences = [
      { id: "reference_12_blintz_precrease" },
      { family: "single_vertex_kawasaki", params: { degree: 8 } },
      { family: "box_pleat", params: { grid: 8, variant: 0 } },
    ];
  }
  if (profile && !preferences.some((preference) => preference.family === "accordion_pleats")) {
    preferences.push({ family: "accordion_pleats", params: { count: profile.targetCapacity } });
  }
  const validationFallbacks = [
    { id: "origami-add-20260827-1032", validationFallback: true },
    { id: "origami-add-20260827-0890", validationFallback: true },
  ];
  preferences = [...preferences, ...validationFallbacks];
  const seen = new Set();
  return preferences.filter((preference) => {
    const key = preference.id ? `id:${preference.id}` : `family:${preference.family}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseStructuralIntent(query, goal = null) {
  const normalizedQuery = normalize(query ?? "");
  const profile = motifProfile(normalizedQuery);
  const family = explicitFamily(normalizedQuery);
  const preferences = intentPreferences(profile, family, normalizedQuery);
  const suppliedParts = Array.isArray(goal?.parts) ? goal.parts.filter((part) => part?.label) : [];
  const targetPartCount = Math.max(2, Math.min(16, suppliedParts.length || Math.round((profile?.targetCapacity ?? 8) * 0.7)));
  const adjectiveComplexity = /簡単|単純|少ない|simple|easy/i.test(normalizedQuery)
    ? 0.2
    : /複雑|精密|リアル|細かい|complex|detailed|realistic/i.test(normalizedQuery)
      ? 0.82
      : null;
  const cylindrical = /円筒|タワー|塔|cylinder|tower/i.test(normalizedQuery);
  const radial = profile?.key === "flower" || profile?.key === "star" || cylindrical
    || /放射|花びら|星|radial|petal/i.test(normalizedQuery);
  const elongated = profile?.key === "snake" || cylindrical || /細長|長い|蛇腹|elongated|long/i.test(normalizedQuery);
  const branching = ["winged_insect", "insect", "rabbit", "fish", "bird", "quadruped", "dragon", "vehicle"].includes(profile?.key)
    || suppliedParts.length >= 4;
  const grid = !cylindrical && ["insect", "quadruped", "dragon", "architecture", "vehicle"].includes(profile?.key)
    || /格子|グリッド|grid|box pleat/i.test(normalizedQuery);
  return {
    schema: "oriai-structural-intent-v1",
    profile: profile?.key ?? "generic",
    explicit_family: family,
    symmetry: typeof goal?.symmetry === "boolean" ? goal.symmetry : profile?.key !== "snake",
    target_part_count: targetPartCount,
    target_capacity: profile?.targetCapacity ?? Math.max(6, Math.min(16, targetPartCount + 2)),
    complexity: adjectiveComplexity ?? profile?.complexity ?? bounded(0.28 + targetPartCount * 0.055, 0.25, 0.78),
    style: { radial, elongated, branching, grid },
    preferred: preferences.map((preference, index) => ({ ...preference, priority: index + 1 })),
    recognized_terms: [
      ...(radial ? ["radial"] : []),
      ...(elongated ? ["elongated"] : []),
      ...(branching ? ["branching"] : []),
      ...(grid ? ["grid"] : []),
      ...(goal?.symmetry !== false ? ["symmetry"] : []),
    ],
  };
}

function structuralCapacity(pattern) {
  for (const key of ["degree", "rays", "grid", "count", "sectors", "sides"]) {
    const value = Number(pattern.params?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return Number(pattern.max_degree) || 4;
}

function parameterSimilarity(pattern, preference) {
  if (preference?.id === pattern.id) return { score: 100, distance: 0 };
  const requested = preference?.params ?? {};
  const entries = Object.entries(requested).filter(([, value]) => Number.isFinite(Number(value)));
  if (!entries.length) return { score: preference ? 70 : 35, distance: preference ? 0 : 100 };
  let distance = 0;
  let similarity = 0;
  let weightTotal = 0;
  for (const [key, expectedValue] of entries) {
    const expected = Number(expectedValue);
    const actual = Number(pattern.params?.[key]);
    const weight = ["degree", "rays", "grid", "count"].includes(key) ? 2 : 1;
    weightTotal += weight;
    if (!Number.isFinite(actual)) {
      distance += 100 * weight;
      continue;
    }
    const difference = Math.abs(actual - expected);
    distance += difference * weight;
    similarity += bounded(1 - difference / Math.max(2, Math.abs(expected))) * weight;
  }
  return {
    score: weightTotal ? (similarity / weightTotal) * 100 : 0,
    distance,
  };
}

function topologySimilarity(pattern, intent) {
  const feature = STRUCTURAL_FAMILY_FEATURES[pattern.family] ?? {};
  const values = [];
  const capacityDifference = Math.abs(structuralCapacity(pattern) - intent.target_capacity);
  values.push(bounded(100 - (capacityDifference / Math.max(4, intent.target_capacity)) * 75));
  if (intent.symmetry) values.push(feature.symmetric ? 100 : 45);
  for (const key of ["radial", "elongated", "branching", "grid"]) {
    if (intent.style[key]) values.push(feature[key] ? 100 : 20);
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function complexitySimilarity(pattern, intent) {
  const normalizedEdges = bounded(Math.log1p(Number(pattern.edge_count) || 0) / Math.log1p(200), 0, 1);
  return bounded(100 - Math.abs(normalizedEdges - intent.complexity) * 125);
}

function structureTermSimilarity(pattern, intent) {
  if (!intent.recognized_terms.length) return 50;
  const feature = STRUCTURAL_FAMILY_FEATURES[pattern.family] ?? {};
  const matches = intent.recognized_terms.filter((term) => term === "symmetry" ? feature.symmetric : feature[term]).length;
  return (matches / intent.recognized_terms.length) * 100;
}

function scoreStructuralPattern(pattern, intent) {
  const exactIndex = intent.preferred.findIndex((preference) => preference.id === pattern.id);
  const familyIndex = intent.preferred.findIndex((preference) => preference.family === pattern.family);
  const preference = exactIndex >= 0 ? intent.preferred[exactIndex] : familyIndex >= 0 ? intent.preferred[familyIndex] : null;
  const preferenceIndex = exactIndex >= 0 ? exactIndex : familyIndex;
  const affinity = preferenceIndex >= 0 ? Math.max(45, 100 - preferenceIndex * 18) : 18;
  const parameters = parameterSimilarity(pattern, preference);
  const components = {
    family_or_reference: rounded(affinity * 0.45),
    parameters: rounded(parameters.score * 0.25),
    complexity: rounded(complexitySimilarity(pattern, intent) * 0.1),
    topology: rounded(topologySimilarity(pattern, intent) * 0.1),
    foldability_description: rounded((FOLDABILITY_CONFIDENCE[pattern.foldability] ?? 20) * 0.05),
    structural_terms: rounded(structureTermSimilarity(pattern, intent) * 0.05),
    validation_fallback_penalty: preference?.validationFallback === true ? -15 : 0,
  };
  const score = rounded(Object.values(components).reduce((sum, value) => sum + value, 0));
  return { score, components, parameterDistance: parameters.distance, preference };
}

function isBasicOrieditaStructuralCandidate(pattern) {
  const fold = pattern?.fold;
  if (!(fold
    && pattern.is_finished_model !== true
    && !fold.frame_classes?.includes("foldedForm")
    && Array.isArray(fold.vertices_coords)
    && Array.isArray(fold.edges_vertices)
    && Array.isArray(fold.edges_assignment)
    && fold.edges_vertices.length === fold.edges_assignment.length)) return false;
  if (fold.vertices_coords.length < 3 || fold.edges_vertices.length < 1) return false;
  if (!fold.vertices_coords.every((point) => Array.isArray(point)
    && point.length >= 2
    && Number.isFinite(Number(point[0]))
    && Number.isFinite(Number(point[1])))) return false;
  if (!fold.edges_vertices.every((edge) => Array.isArray(edge)
    && edge.length === 2
    && edge.every((index) => Number.isInteger(index) && index >= 0 && index < fold.vertices_coords.length)
    && edge[0] !== edge[1])) return false;
  const assignments = new Set(fold.edges_assignment);
  return ![...assignments].some((assignment) => !["B", "M", "V", "F", "U"].includes(assignment));
}

function isStructuralCandidate(pattern) {
  if (!isBasicOrieditaStructuralCandidate(pattern)) return false;
  const fold = pattern.fold;
  const assignments = new Set(fold.edges_assignment);
  if ([...assignments].some((assignment) => !["B", "M", "V"].includes(assignment))) return false;
  const vertices = fold.vertices_coords;
  const xs = vertices.map((point) => Number(point?.[0]));
  const ys = vertices.map((point) => Number(point?.[1]));
  if ([...xs, ...ys].some((coordinate) => !Number.isFinite(coordinate))) return false;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const epsilon = Math.max(maxX - minX, maxY - minY, 1) * 1e-7;
  const boundaryIncidence = Array.from({ length: vertices.length }, () => 0);
  const creaseIncidence = Array.from({ length: vertices.length }, () => 0);
  fold.edges_vertices.forEach(([a, b], edgeIndex) => {
    const assignment = fold.edges_assignment[edgeIndex];
    if (assignment === "B") {
      boundaryIncidence[a] += 1;
      boundaryIncidence[b] += 1;
    } else {
      creaseIncidence[a] += 1;
      creaseIncidence[b] += 1;
    }
  });
  return vertices.every(([x, y], vertexIndex) => {
    if (!creaseIncidence[vertexIndex]) return true;
    const onBoundary = Math.abs(x - minX) <= epsilon
      || Math.abs(x - maxX) <= epsilon
      || Math.abs(y - minY) <= epsilon
      || Math.abs(y - maxY) <= epsilon;
    return !onBoundary || boundaryIncidence[vertexIndex] >= 2;
  });
}

export function retrieveStructuralKnowledge(pack, query, { limit = 3, goal = null, corpusSize = 5_000 } = {}) {
  const normalizedQuery = normalize(query ?? "");
  if (!normalizedQuery) return [];
  const maximum = Math.max(1, Math.min(12, Math.floor(Number(limit) || 3)));
  const boundedCorpusSize = Math.max(maximum, Math.min(pack.patterns.length, Math.floor(Number(corpusSize) || 5_000)));
  const intent = parseStructuralIntent(normalizedQuery, goal);
  const corpus = selectStructuralCorpus(pack, boundedCorpusSize);
  const seenIds = new Set();
  const seenHashes = new Set();
  const compareMatches = (a, b) =>
    b.score - a.score
    || a.parameterDistance - b.parameterDistance
    || (a.pattern.edge_count ?? 0) - (b.pattern.edge_count ?? 0)
    || String(a.pattern.id).localeCompare(String(b.pattern.id), "en");
  const ranked = corpus.flatMap((pattern) => {
    const isCandidate = intent.explicit_family
      ? pattern.family === intent.explicit_family && isBasicOrieditaStructuralCandidate(pattern)
      : isStructuralCandidate(pattern);
    if (!isCandidate || seenIds.has(pattern.id) || seenHashes.has(pattern.canonical_sha256)) return [];
    seenIds.add(pattern.id);
    seenHashes.add(pattern.canonical_sha256);
    const scored = scoreStructuralPattern(pattern, intent);
    return [{
      pattern,
      matchKind: "structural_reference",
      profile: intent.profile,
      reason: `${intent.profile}の部位数・対称性・複雑度に対する${pattern.family}構造の類似候補（Oriedita検証前）`,
      score: scored.score,
      scoreBreakdown: scored.components,
      parameterDistance: scored.parameterDistance,
      validationFallback: scored.preference?.validationFallback === true,
      requiresModifiabilitySmokeTest: true,
      structuralIntent: intent,
      requiresOrieditaValidation: true,
      corpus: {
        strategy: "canonical_sha256_first_n",
        searchedPatternCount: boundedCorpusSize,
        sourcePatternCount: pack.patterns.length,
      },
    }];
  }).sort(compareMatches);

  if (intent.explicit_family) return ranked.filter(({ pattern }) => pattern.family === intent.explicit_family).slice(0, maximum);
  const results = [];
  const selectedIds = new Set();
  const familyCounts = new Map();
  for (const preference of intent.preferred) {
    const candidate = ranked.find(({ pattern }) => !selectedIds.has(pattern.id)
      && (preference.id ? pattern.id === preference.id : pattern.family === preference.family));
    if (!candidate) continue;
    if ((familyCounts.get(candidate.pattern.family) ?? 0) >= 2) continue;
    results.push(candidate);
    selectedIds.add(candidate.pattern.id);
    familyCounts.set(candidate.pattern.family, (familyCounts.get(candidate.pattern.family) ?? 0) + 1);
    if (results.length >= maximum) break;
  }
  if (results.length < maximum) {
    for (const candidate of ranked) {
      if (selectedIds.has(candidate.pattern.id)) continue;
      if ((familyCounts.get(candidate.pattern.family) ?? 0) >= 2) continue;
      results.push(candidate);
      selectedIds.add(candidate.pattern.id);
      familyCounts.set(candidate.pattern.family, (familyCounts.get(candidate.pattern.family) ?? 0) + 1);
      if (results.length >= maximum) break;
    }
  }
  return results.sort(compareMatches);
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
    source: pattern.source ?? "Origami CP World Collection 2026-08-24",
    sourceUrl: pattern.source_url ?? null,
    author: pattern.author ?? null,
    isFinishedModel: pattern.is_finished_model ?? false,
    ...details,
  };
}

export function publicKnowledgeReference(match) {
  if (!match) return null;
  return publicKnowledgeMatch(match.pattern, {
    matchKind: match.matchKind,
    profile: match.profile,
    reason: match.reason,
    score: match.score ?? null,
    scoreBreakdown: match.scoreBreakdown ?? null,
    structuralIntent: match.structuralIntent ?? null,
    requiresOrieditaValidation: match.requiresOrieditaValidation === true,
    requiresModifiabilitySmokeTest: match.requiresModifiabilitySmokeTest === true,
    validationFallback: match.validationFallback === true,
    corpus: match.corpus ?? null,
  });
}

function flattenFoldFrame(document) {
  if (Array.isArray(document.vertices_coords) && Array.isArray(document.edges_vertices)) return document;
  const frame = document.file_frames?.find((candidate) =>
    Array.isArray(candidate?.vertices_coords) && Array.isArray(candidate?.edges_vertices));
  if (!frame) throw new Error("FOLDデータに頂点・辺がありません");
  return { ...document, ...frame };
}

export async function materializeKnowledgePattern(pattern, { fetchImpl = fetch } = {}) {
  if (pattern?.fold) return pattern;
  if (pattern?.source_kind !== "remote_open_fold" || typeof pattern.fold_url !== "string") {
    throw new Error("取得可能なFOLDデータではありません");
  }
  const url = new URL(pattern.fold_url);
  if (url.protocol !== "https:" || url.hostname !== "raw.githubusercontent.com" || !url.pathname.endsWith(".fold")) {
    throw new Error("許可されていないFOLD取得先です");
  }
  if ((pattern.remote_bytes ?? 0) > 5 * 1024 * 1024) throw new Error("FOLDデータが大きすぎます");
  if (remoteFoldCache.has(url.href)) return { ...pattern, fold: remoteFoldCache.get(url.href) };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`FOLDデータの取得に失敗しました (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error("FOLDデータが大きすぎます");
    const document = flattenFoldFrame(JSON.parse(new TextDecoder().decode(bytes)));
    remoteFoldCache.set(url.href, document);
    return { ...pattern, fold: document };
  } finally {
    clearTimeout(timeout);
  }
}
