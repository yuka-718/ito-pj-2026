#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(here, "..", "knowledge", "finished-models", "catalog.json");

const SOURCES = [
  {
    id: "flat_folder",
    repo: "origamimagiro/flat-folder",
    commit: "d50004815fb738d009e5b87b2307fbaefa717ef0",
    license: "MIT",
    attribution: "Jason S. Ku and credited example designers",
    include: (path) => /^examples\/instagram\/[^/]+\.fold$/i.test(path),
    parseName(stem) {
      const clean = stem.replace(/^\d+_/, "");
      const split = clean.indexOf("_");
      if (split < 0) return { author: "Flat-Folder contributors", title: clean };
      const author = clean.slice(0, split);
      return {
        author: author === "traditional" ? "Traditional design" : author,
        title: clean.slice(split + 1),
      };
    },
  },
  {
    id: "rabbit_ear",
    repo: "rabbit-ear/rabbit-ear",
    commit: "b717948c712324dba2132450a12c0260a48e8aeb",
    license: "GPL-3.0",
    attribution: "Rabbit Ear contributors",
    include: (path) => /^tests\/files\/fold\/[^/]+\.fold$/i.test(path),
  },
  {
    id: "rigid_origami",
    repo: "osbo/rigid-origami",
    commit: "31f7cc9ff3da8c96c1138b305e9cf6d0041c1075",
    license: "MIT",
    attribution: "osbo",
    include: (path) => /^[^/]+\.fold$/i.test(path),
  },
  {
    id: "fold_examples",
    repo: "edemaine/fold",
    commit: "824f9fa6f944248787b0b2077ef622761489201e",
    license: "MIT",
    attribution: "Erik Demaine, Jason Ku, Robert Lang and FOLD contributors",
    include: (path) => /^examples\/[^/]+\.fold$/i.test(path),
  },
  {
    id: "origami_web",
    repo: "maciekmm/origami",
    commit: "3346e88b3f51631e2383a3ae7f746721be9bec19",
    license: "GPL-3.0",
    attribution: "Maciej Mroczkowski and project contributors",
    include: (path) => /^assets\/(?:models|origuide-models)\/[^/]+\.fold$/i.test(path),
  },
  {
    id: "origami_db",
    repo: "dozingpip/origami-db",
    commit: "9949785068f80ddb80588003b7cabd5413569e3a",
    license: "GPL-3.0",
    attribution: "origami-db contributors",
    include: (path) => /^tmp\/db-origami\/.+\.fold$/i.test(path),
  },
];

const FAMILY_RULES = [
  ["dragonfly", /dragonfly|とんぼ|蜻蛉/i],
  ["crane", /(?:^|[ _-])crane(?:$|[ _-])|折り鶴|おりづる/i],
  ["rabbit", /rabbit|bunny|うさぎ|兎/i],
  ["dragon", /(?:^|[ _-])dragon(?:$|[ _-])|ドラゴン|竜|龍/i],
  ["butterfly", /butterfly|swallowtail|蝶/i],
  ["penguin", /penguin|pinguin|ペンギン/i],
  ["frog", /frog|蛙|カエル/i],
  ["turtle", /turtle|tortoise|亀|カメ/i],
  ["fish", /fish|taiyaki|魚|金魚/i],
  ["dog", /(?:^|[ _-])dog(?:e)?(?:$|[ _-])|犬/i],
  ["cat", /(?:^|[ _-])cat(?:$|[ _-])|猫/i],
  ["bird", /bird|鳥/i],
  ["boat", /boat|sailboat|ship|船/i],
  ["heart", /heart|ハート/i],
  ["flower", /flower|rose|tulip|花|バラ/i],
  ["crab", /crab|蟹|カニ/i],
  ["insect", /beetle|kabuto|insect|scorpion|mantis|虫|カブト/i],
  ["bat", /(?:^|[ _-])bat(?:$|[ _-])|蝙蝠|コウモリ/i],
  ["elephant", /elephant|象/i],
  ["horse", /horse|馬/i],
  ["deer", /deer|stag(?!ger)|鹿/i],
  ["snake", /snake|serpent|蛇/i],
  ["box", /(?:^|[ _-])box(?:$|[ _-])|箱/i],
  ["envelope", /envelope|封筒/i],
  ["star", /star|星/i],
];

const NUMBER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
]);

function displayText(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function familyFor(title) {
  return FAMILY_RULES.find(([, pattern]) => pattern.test(title))?.[0] ?? "library_pattern";
}

function headCountFor(title) {
  const normalized = displayText(title).toLowerCase();
  const digits = normalized.match(/(?:^|\s)(\d+)\s*(?:headed|heads?)(?:\s|$)/);
  if (digits) return Number.parseInt(digits[1], 10);
  for (const [word, value] of NUMBER_WORDS) {
    if (new RegExp(`(?:^|\\s)${word}\\s+(?:headed|heads?)(?:\\s|$)`).test(normalized)) return value;
  }
  return null;
}

function isFinishedModel(title, family) {
  if (family === "library_pattern") return false;
  return !/(?:^|[ _-])(?:base|cp|test|invalid|bad|step)(?:$|[ _-])/i.test(title);
}

async function githubJson(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "ito-pj-finished-model-catalog",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${path}`);
  return response.json();
}

const models = [];
for (const source of SOURCES) {
  const tree = await githubJson(`/repos/${source.repo}/git/trees/${source.commit}?recursive=1`);
  for (const item of tree.tree ?? []) {
    if (item.type !== "blob" || !source.include(item.path)) continue;
    const filename = item.path.split("/").at(-1);
    const stem = filename.replace(/\.fold$/i, "");
    const parsed = source.parseName?.(stem) ?? { author: source.attribution, title: stem };
    const title = displayText(parsed.title);
    const family = familyFor(title);
    const encodedPath = item.path.split("/").map(encodeURIComponent).join("/");
    models.push({
      id: `${source.id}:${item.path}`,
      title,
      author: displayText(parsed.author),
      family,
      category: isFinishedModel(title, family) ? "finished_model" : "fold_pattern",
      head_count: headCountFor(title),
      license: source.license,
      foldability: "upstream_unverified",
      source_kind: "remote_open_fold",
      source: source.repo,
      source_url: `https://github.com/${source.repo}/blob/${source.commit}/${encodedPath}`,
      fold_url: `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${encodedPath}`,
      remote_bytes: item.size,
      git_commit: source.commit,
      is_finished_model: isFinishedModel(title, family),
    });
  }
}

models.sort((a, b) => a.family.localeCompare(b.family) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
const catalog = {
  format: "ori-ai-fold-library-v1",
  generated_at: "2026-08-26",
  model_count: models.length,
  sources: SOURCES.map(({ id, repo, commit, license, attribution }) => ({
    id,
    repo,
    commit,
    license,
    attribution,
    url: `https://github.com/${repo}/tree/${commit}`,
  })),
  models,
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${models.length} FOLD records to ${outputPath}`);
