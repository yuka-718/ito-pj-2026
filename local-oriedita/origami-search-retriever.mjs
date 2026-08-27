import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultRunDirectory = resolve(here, "..", "knowledge", "origami-search-training", "runs", "current");
const defaultIndexPath = resolve(defaultRunDirectory, "index.json");
const defaultPermissionPath = resolve(here, "..", "knowledge", "origami-search-training", "permission.json");

const MOTIFS = [
  {
    key: "crane",
    query: /鶴|つる|おりづる|折り鶴|crane/i,
    primary: ["crane"],
    related: ["bird", "heron", "swan", "hummingbird", "duck", "eagle", "owl"],
  },
  {
    key: "rabbit",
    query: /うさぎ|ウサギ|兎|rabbit|bunny|hare/i,
    primary: ["rabbit", "bunny", "hare"],
    related: ["animal", "mouse", "cat", "fox"],
  },
  {
    key: "goldfish",
    query: /金魚|きんぎょ|goldfish/i,
    primary: ["goldfish"],
    related: ["fish", "clownfish", "sunfish", "angelfish", "koi"],
  },
  {
    key: "fish",
    query: /魚|さかな|fish|koi/i,
    primary: ["fish", "goldfish", "clownfish", "sunfish", "angelfish", "koi"],
    related: ["manta ray", "shark", "whale", "dolphin"],
  },
  {
    key: "beetle",
    query: /カブトムシ|甲虫|クワガタ|beetle|stag beetle|kabuto/i,
    primary: ["beetle", "stag beetle"],
    related: ["cicada", "dragonfly", "butterfly", "hawkmoth", "moth", "spider"],
  },
  {
    key: "insect",
    query: /昆虫|虫|insect|bug|butterfly|dragonfly|cicada|moth|spider/i,
    primary: ["insect", "beetle", "butterfly", "dragonfly", "cicada", "hawkmoth", "moth", "spider"],
    related: [],
  },
];

const normalize = (value) => String(value ?? "")
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[“”‘’'"`$()[\]{}.,:;!?/\\|+*=<>~・、。！？【】「」『』]/g, " ")
  .replace(/[-_]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const phraseIncluded = (text, phrase) => {
  const normalizedPhrase = normalize(phrase);
  if (!normalizedPhrase) return false;
  return ` ${text} `.includes(` ${normalizedPhrase} `)
    || text.startsWith(`${normalizedPhrase} `)
    || text.endsWith(` ${normalizedPhrase}`)
    || text === normalizedPhrase;
};

const queryTokens = (query) => [...new Set(normalize(query).split(" "))]
  .filter((token) => token.length >= 2 && !/^[ぁ-んァ-ヶ一-龯]+$/.test(token));

function motifForQuery(query) {
  return MOTIFS.find(({ query: pattern }) => pattern.test(String(query ?? ""))) ?? null;
}

function workScore(item, query, motif) {
  const title = normalize(item.title);
  const creator = normalize(item.creator);
  const searchable = `${title} ${creator}`.trim();
  const reasons = [];
  let score = 0;
  const exactQuery = normalize(query);
  if (exactQuery && phraseIncluded(title, exactQuery)) {
    score += 700;
    reasons.push("作品名が入力と一致");
  }
  if (motif) {
    const primary = motif.primary.find((term) => phraseIncluded(title, term));
    const related = motif.related.find((term) => phraseIncluded(title, term));
    if (primary) {
      score += 500;
      reasons.push(`${motif.key}の直接候補`);
    } else if (related) {
      score += 180;
      reasons.push(`${motif.key}と部位構成が近い${related}の参考`);
    }
  }
  const tokenHits = queryTokens(query).filter((token) => searchable.includes(token));
  if (tokenHits.length) {
    score += tokenHits.length * 45;
    reasons.push(`語句一致: ${tokenHits.join("、")}`);
  }
  if (!reasons.length) return { score: 0, reasons: [] };
  const imageCount = Array.isArray(item.local_images) ? item.local_images.length : 0;
  if (imageCount > 0) score += Math.min(20, imageCount);
  if (String(item.creator ?? "").trim()) score += 3;
  if (String(item.source_url ?? "").startsWith("https://")) score += 2;
  return { score, reasons };
}

export async function loadOrigamiSearchCatalog({
  indexPath = defaultIndexPath,
  permissionPath = defaultPermissionPath,
} = {}) {
  const [indexRaw, permissionRaw] = await Promise.all([
    readFile(indexPath, "utf8"),
    readFile(permissionPath, "utf8"),
  ]);
  const index = JSON.parse(indexRaw);
  const permission = JSON.parse(permissionRaw);
  if (index?.schema !== "oriai-origami-search-source-v1" || !Array.isArray(index.items)) {
    throw new Error("Origami Search索引の形式が不正です");
  }
  if (index.items.length !== 625 || Number(index.item_count) !== index.items.length) {
    throw new Error(`Origami Search索引は625作品ではありません (${index.items.length})`);
  }
  if (permission?.status !== "user_confirmed") {
    throw new Error("Origami Searchの許可情報を確認できません");
  }
  return {
    index,
    permission,
    indexPath: resolve(indexPath),
    indexDirectory: dirname(resolve(indexPath)),
  };
}

export function searchOrigamiWorks(catalog, query, { minimum = 3, maximum = 5 } = {}) {
  if (!catalog?.index?.items || !String(query ?? "").trim()) return [];
  const lower = Math.max(1, Math.min(5, Math.floor(Number(minimum) || 3)));
  const upper = Math.max(lower, Math.min(5, Math.floor(Number(maximum) || 5)));
  const motif = motifForQuery(query);
  const seenTitles = new Set();
  const seenSources = new Set();
  const ranked = catalog.index.items
    .map((item) => ({ item, ...workScore(item, query, motif) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.item.id.localeCompare(right.item.id, "en"));
  const results = [];
  for (const { item, score, reasons } of ranked) {
    const titleKey = normalize(item.title);
    const sourceKey = normalize(item.source_url);
    if (!titleKey || seenTitles.has(titleKey) || (sourceKey && seenSources.has(sourceKey))) continue;
    seenTitles.add(titleKey);
    if (sourceKey) seenSources.add(sourceKey);
    results.push({
      id: item.id,
      title: item.title,
      creator: item.creator || null,
      source: item.site_label || item.site,
      source_url: item.source_url,
      public_policy: item.public_policy,
      score,
      reason: reasons.join("。") || "入力語と作品名の一致",
      motif: motif?.key ?? null,
      local_images: Array.isArray(item.local_images) ? item.local_images : [],
    });
    if (results.length >= upper) break;
  }
  return results.length >= lower ? results : [];
}

const defaultExists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export async function selectOrigamiReferenceImages(catalog, works, {
  maximum = 8,
  exists = defaultExists,
} = {}) {
  const limit = Math.max(0, Math.min(8, Math.floor(Number(maximum) || 0)));
  if (!limit || !catalog?.indexDirectory) return [];
  const queues = works.map((work) => {
    const source = work.local_images ?? [];
    if (!source.length) return [];
    const indices = [0];
    if (source.length > 1) indices.push(Math.floor(source.length / 2));
    if (source.length > 2) indices.push(source.length - 1);
    return [...new Set(indices)].map((index, position) => ({
      work,
      image: source[index],
      role: position === 0 ? "representative" : "folding_structure",
      sequence: index + 1,
    }));
  });
  const selected = [];
  for (let round = 0; selected.length < limit; round += 1) {
    let found = false;
    for (const queue of queues) {
      const candidate = queue[round];
      if (!candidate || selected.length >= limit) continue;
      found = true;
      const localPath = resolve(catalog.indexDirectory, candidate.image.path);
      if (!await exists(localPath)) continue;
      selected.push({
        work_id: candidate.work.id,
        title: candidate.work.title,
        role: candidate.role,
        sequence: candidate.sequence,
        local_path: localPath,
        source_url: candidate.image.url,
        sha256: candidate.image.sha256,
        bytes: candidate.image.bytes,
      });
    }
    if (!found) break;
  }
  return selected;
}

export function publicOrigamiWorkReference(work) {
  return {
    id: work.id,
    title: work.title,
    creator: work.creator,
    source: work.source,
    source_url: work.source_url,
    public_policy: work.public_policy,
    reason: work.reason,
    score: work.score,
    motif: work.motif,
  };
}

export const ORIGAMI_SEARCH_LIMITS = Object.freeze({ worksMinimum: 3, worksMaximum: 5, imagesMaximum: 8 });
