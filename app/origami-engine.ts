export type Assignment = "B" | "M" | "V" | "U";
export type Point = [number, number];

export type Part = {
  id: string;
  label: string;
  importance: number;
  direction: number;
};

export type Preset = {
  key: string;
  label: string;
  description: string;
  parts: Omit<Part, "id">[];
};

export type Edge = {
  vertices: [number, number];
  assignment: Assignment;
  part: string | null;
};

export type Candidate = {
  id: string;
  title: string;
  subtitle: string;
  paper: { width: number; height: number };
  vertices: Point[];
  edges: Edge[];
  rayAngles: number[];
  assignments: Exclude<Assignment, "B">[];
  partLabels: string[];
  degree: number;
  seed: number;
  residualRad: number;
  residualDeg: number;
  maekawaDifference: number;
  minSectorDeg: number;
  score: number;
  scores: {
    feature: number;
    balance: number;
    clarity: number;
    local: number;
  };
  validationIssues: string[];
};

export type GenerateInput = {
  description: string;
  parts: Part[];
  complexity: number;
  symmetry: boolean;
  seed: number;
};

const TAU = Math.PI * 2;
const PAPER = { width: 600, height: 600 };
const CENTER: Point = [PAPER.width / 2, PAPER.height / 2];
const ASSIGNMENTS = new Set<Assignment>(["B", "M", "V", "U"]);

export const PRESETS: Preset[] = [
  {
    key: "goldfish",
    label: "金魚",
    description: "丸い胴体と大きく広がる尾びれを持つ金魚",
    parts: [
      { label: "頭", importance: 4, direction: 0 },
      { label: "胴体", importance: 5, direction: 180 },
      { label: "大きな尾びれ", importance: 5, direction: 165 },
      { label: "背びれ", importance: 3, direction: 285 },
      { label: "腹びれ", importance: 2, direction: 75 },
    ],
  },
  {
    key: "beetle",
    label: "クワガタ",
    description: "大あごと六本の脚、開いた羽があるクワガタ",
    parts: [
      { label: "大あご", importance: 5, direction: 0 },
      { label: "頭", importance: 4, direction: 20 },
      { label: "胴体", importance: 5, direction: 180 },
      { label: "脚", importance: 4, direction: 80 },
      { label: "開いた羽", importance: 4, direction: 140 },
    ],
  },
  {
    key: "crane",
    label: "鶴",
    description: "長い首と左右に広がる翼を持つ鶴",
    parts: [
      { label: "頭", importance: 3, direction: 350 },
      { label: "長い首", importance: 5, direction: 10 },
      { label: "左の翼", importance: 5, direction: 110 },
      { label: "右の翼", importance: 5, direction: 250 },
      { label: "尾", importance: 3, direction: 180 },
    ],
  },
  {
    key: "flower",
    label: "花",
    description: "中心から五枚の花びらが開く花",
    parts: [
      { label: "中心", importance: 5, direction: 0 },
      { label: "花びらA", importance: 4, direction: 18 },
      { label: "花びらB", importance: 4, direction: 90 },
      { label: "花びらC", importance: 4, direction: 162 },
      { label: "花びらD", importance: 4, direction: 234 },
      { label: "花びらE", importance: 4, direction: 306 },
    ],
  },
];

const GENERIC_PARTS: Omit<Part, "id">[] = [
  { label: "中心となる胴体", importance: 5, direction: 180 },
  { label: "先端の特徴", importance: 4, direction: 0 },
  { label: "左右の広がり", importance: 3, direction: 90 },
  { label: "支える部分", importance: 3, direction: 270 },
];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeAngle(angle: number) {
  return ((angle % TAU) + TAU) % TAU;
}

function angularDistance(a: number, b: number) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, TAU - difference);
}

function round(value: number, digits = 10) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function copyParts(parts: Omit<Part, "id">[]) {
  return parts.map((part, index) => ({ ...part, id: `part-${index + 1}` }));
}

export function analyzeDescription(description: string) {
  const value = description.trim();
  const rules: [RegExp, string][] = [
    [/金魚|魚|さかな/, "goldfish"],
    [/クワガタ|カブト|昆虫|虫/, "beetle"],
    [/鶴|つる|鳥|翼/, "crane"],
    [/花|バラ|桜|花びら/, "flower"],
  ];
  const matchedKey = rules.find(([pattern]) => pattern.test(value))?.[1];
  const preset = PRESETS.find((item) => item.key === matchedKey);
  const parts = copyParts(preset?.parts ?? GENERIC_PARTS).map((part) => ({
    ...part,
    importance: clamp(
      part.importance + (value.includes(part.label.replace(/^大きな/, "")) ? 1 : 0),
      1,
      5,
    ),
  }));

  return {
    presetKey: preset?.key ?? "custom",
    presetLabel: preset?.label ?? "自由入力",
    parts,
  };
}

export function createPart(index: number): Part {
  return {
    id: `part-${Date.now()}-${index}`,
    label: `特徴 ${index}`,
    importance: 3,
    direction: ((index - 1) * 57) % 360,
  };
}

function makeSectorGroup(logits: number[], minimumAngle: number) {
  const remaining = Math.PI - logits.length * minimumAngle;
  if (remaining <= 0) throw new Error("minimum sector angle is too large");
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const sum = exponentials.reduce((total, value) => total + value, 0);
  return exponentials.map((value) => minimumAngle + (remaining * value) / sum);
}

function generateAngles(degree: number, random: () => number, parts: Part[], symmetry: boolean) {
  const groupSize = degree / 2;
  const minimumAngle = (8 * Math.PI) / 180;
  const weightAt = (index: number) => parts[index % Math.max(parts.length, 1)]?.importance ?? 3;
  const evenLogits = Array.from({ length: groupSize }, (_, index) =>
    (random() - 0.5) * 2.4 + weightAt(index * 2) * 0.16,
  );
  const oddLogits = Array.from({ length: groupSize }, (_, index) => {
    const mirrorBias = symmetry ? evenLogits[(groupSize - index - 1 + groupSize) % groupSize] * 0.78 : 0;
    return (random() - 0.5) * 2.4 + weightAt(index * 2 + 1) * 0.16 + mirrorBias;
  });
  const even = makeSectorGroup(evenLogits, minimumAngle);
  const odd = makeSectorGroup(oddLogits, minimumAngle);
  const sectors = Array.from({ length: degree }, (_, index) =>
    index % 2 === 0 ? even[index / 2] : odd[(index - 1) / 2],
  );
  const rotation = random() * TAU;
  const angles = [rotation];
  for (let index = 0; index < degree - 1; index += 1) {
    angles.push(angles[index] + sectors[index]);
  }
  return angles.map((angle) => round(normalizeAngle(angle), 12)).sort((a, b) => a - b);
}

function rayRectangleIntersection(center: Point, angle: number, width: number, height: number): Point {
  const [cx, cy] = center;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const epsilon = Math.max(width, height) * 1e-12;
  const values: number[] = [];
  if (dx > epsilon) values.push((width - cx) / dx);
  if (dx < -epsilon) values.push((0 - cx) / dx);
  if (dy > epsilon) values.push((height - cy) / dy);
  if (dy < -epsilon) values.push((0 - cy) / dy);
  const distance = Math.min(...values.filter((value) => value > epsilon));
  if (!Number.isFinite(distance)) throw new Error("ray does not hit paper boundary");
  return [
    round(clamp(cx + distance * dx, 0, width), 9),
    round(clamp(cy + distance * dy, 0, height), 9),
  ];
}

function perimeterPosition([x, y]: Point, width: number, height: number) {
  const epsilon = 1e-7;
  if (Math.abs(y) < epsilon) return x;
  if (Math.abs(x - width) < epsilon) return width + y;
  if (Math.abs(y - height) < epsilon) return width + height + (width - x);
  return width * 2 + height + (height - y);
}

function buildGraph(
  rayAngles: number[],
  assignments: Exclude<Assignment, "B">[],
  partLabels: string[],
) {
  const endpoints = rayAngles.map((angle) => rayRectangleIntersection(CENTER, angle, PAPER.width, PAPER.height));
  const boundaryPoints: { point: Point; rayIndices: number[] }[] = [
    { point: [0, 0], rayIndices: [] },
    { point: [PAPER.width, 0], rayIndices: [] },
    { point: [PAPER.width, PAPER.height], rayIndices: [] },
    { point: [0, PAPER.height], rayIndices: [] },
  ];

  endpoints.forEach((point, rayIndex) => {
    const existing = boundaryPoints.find(
      (item) => Math.hypot(item.point[0] - point[0], item.point[1] - point[1]) < 1e-7,
    );
    if (existing) existing.rayIndices.push(rayIndex);
    else boundaryPoints.push({ point, rayIndices: [rayIndex] });
  });

  boundaryPoints.sort(
    (a, b) => perimeterPosition(a.point, PAPER.width, PAPER.height) - perimeterPosition(b.point, PAPER.width, PAPER.height),
  );
  const vertices: Point[] = [CENTER, ...boundaryPoints.map((item) => item.point)];
  const edges: Edge[] = boundaryPoints.map((_, index) => ({
    vertices: [index + 1, ((index + 1) % boundaryPoints.length) + 1],
    assignment: "B",
    part: null,
  }));

  const endpointIndices = new Array<number>(rayAngles.length);
  boundaryPoints.forEach((item, boundaryIndex) => {
    item.rayIndices.forEach((rayIndex) => {
      endpointIndices[rayIndex] = boundaryIndex + 1;
    });
  });
  rayAngles.forEach((_, index) => {
    edges.push({
      vertices: [0, endpointIndices[index]],
      assignment: assignments[index],
      part: partLabels[index] ?? null,
    });
  });
  return { vertices, edges };
}

export function kawasakiResidualFromAngles(sourceAngles: number[]) {
  const angles = [...sourceAngles].map(normalizeAngle).sort((a, b) => a - b);
  if (angles.length < 4) return { status: "not-applicable" as const, residualRad: Number.NaN, sectors: [] };
  if (angles.length % 2 !== 0) return { status: "invalid" as const, residualRad: Number.NaN, sectors: [] };
  for (let index = 1; index < angles.length; index += 1) {
    if (Math.abs(angles[index] - angles[index - 1]) < 1e-10) {
      return { status: "invalid" as const, residualRad: Number.NaN, sectors: [] };
    }
  }
  const sectors = angles.map((angle, index) => {
    const next = angles[(index + 1) % angles.length] + (index === angles.length - 1 ? TAU : 0);
    return next - angle;
  });
  const evenSum = sectors.reduce((sum, value, index) => sum + (index % 2 === 0 ? value : 0), 0);
  return { status: "ok" as const, residualRad: Math.abs(evenSum - Math.PI), sectors };
}

function assignMountainValley(degree: number, random: () => number) {
  const mountainCount = degree / 2 + 1;
  const values: Exclude<Assignment, "B">[] = Array.from(
    { length: degree },
    (_, index) => (index < mountainCount ? "M" : "V"),
  );
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function mapPartLabels(rayAngles: number[], parts: Part[]) {
  if (!parts.length) return rayAngles.map(() => "構造線");
  return rayAngles.map((angle) => {
    const closest = parts.reduce((best, part) => {
      const distance = angularDistance(angle, (part.direction * Math.PI) / 180);
      return distance < best.distance ? { part, distance } : best;
    }, { part: parts[0], distance: Number.POSITIVE_INFINITY });
    return closest.part.label;
  });
}

function scoreAngles(rayAngles: number[], parts: Part[], symmetry: boolean, residualRad: number) {
  const weightedError = parts.reduce((total, part) => {
    const target = (part.direction * Math.PI) / 180;
    const nearest = Math.min(...rayAngles.map((angle) => angularDistance(angle, target)));
    return total + nearest * part.importance;
  }, 0);
  const weightTotal = parts.reduce((total, part) => total + part.importance, 0) || 1;
  const feature = clamp(100 - ((weightedError / weightTotal) / (Math.PI / 2)) * 100, 0, 100);
  const symmetryError = rayAngles.reduce((total, angle) => {
    const reflection = normalizeAngle(-angle);
    return total + Math.min(...rayAngles.map((other) => angularDistance(other, reflection)));
  }, 0) / rayAngles.length;
  const balance = symmetry
    ? clamp(100 - (symmetryError / (Math.PI / 2)) * 100, 0, 100)
    : clamp(92 - (symmetryError / Math.PI) * 25, 0, 100);
  const check = kawasakiResidualFromAngles(rayAngles);
  const minSector = check.sectors.length ? Math.min(...check.sectors) : 0;
  const minSectorDeg = (minSector * 180) / Math.PI;
  const clarity = clamp(((minSectorDeg - 8) / 22) * 100, 35, 100);
  const residualDeg = (residualRad * 180) / Math.PI;
  const local = clamp(100 - residualDeg * 15, 0, 100);
  const total = feature * 0.45 + balance * 0.2 + clarity * 0.2 + local * 0.15;
  return { feature, balance, clarity, local, total, minSectorDeg };
}

function validateGraph(vertices: Point[], edges: Edge[]) {
  const issues: string[] = [];
  vertices.forEach(([x, y], index) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) issues.push(`頂点 ${index} の座標が不正です`);
    if (x < -1e-8 || x > PAPER.width + 1e-8 || y < -1e-8 || y > PAPER.height + 1e-8) {
      issues.push(`頂点 ${index} が紙の外にあります`);
    }
  });
  const seen = new Set<string>();
  edges.forEach((edge, index) => {
    const [from, to] = edge.vertices;
    if (!Number.isInteger(from) || !Number.isInteger(to) || !vertices[from] || !vertices[to]) {
      issues.push(`辺 ${index} の頂点参照が不正です`);
      return;
    }
    if (!ASSIGNMENTS.has(edge.assignment)) issues.push(`辺 ${index} の割当が不正です`);
    if (Math.hypot(vertices[from][0] - vertices[to][0], vertices[from][1] - vertices[to][1]) < 1e-8) {
      issues.push(`辺 ${index} の長さが0です`);
    }
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (seen.has(key)) issues.push(`辺 ${index} が重複しています`);
    seen.add(key);
  });
  return issues;
}

function hydrateCandidate(
  rayAngles: number[],
  assignments: Exclude<Assignment, "B">[],
  partLabels: string[],
  parts: Part[],
  symmetry: boolean,
  seed: number,
  title = "STRUCTURE",
  subtitle = "単頂点構造候補",
): Candidate {
  const graph = buildGraph(rayAngles, assignments, partLabels);
  const kawasaki = kawasakiResidualFromAngles(rayAngles);
  const residualRad = kawasaki.status === "ok" ? kawasaki.residualRad : Number.POSITIVE_INFINITY;
  const scores = scoreAngles(rayAngles, parts, symmetry, residualRad);
  const mountainCount = assignments.filter((value) => value === "M").length;
  const valleyCount = assignments.filter((value) => value === "V").length;
  return {
    id: `candidate-${hashString(`${seed}-${rayAngles.map((value) => value.toFixed(8)).join("-")}`)}`,
    title,
    subtitle,
    paper: PAPER,
    vertices: graph.vertices,
    edges: graph.edges,
    rayAngles,
    assignments,
    partLabels,
    degree: rayAngles.length,
    seed,
    residualRad,
    residualDeg: (residualRad * 180) / Math.PI,
    maekawaDifference: Math.abs(mountainCount - valleyCount),
    minSectorDeg: scores.minSectorDeg,
    score: Math.round(scores.total),
    scores: {
      feature: Math.round(scores.feature),
      balance: Math.round(scores.balance),
      clarity: Math.round(scores.clarity),
      local: Math.round(scores.local),
    },
    validationIssues: validateGraph(graph.vertices, graph.edges),
  };
}

function patternDistance(a: Candidate, b: Candidate) {
  if (a.degree !== b.degree) return Math.PI;
  return a.rayAngles.reduce((total, angle, index) => total + angularDistance(angle, b.rayAngles[index]), 0) / a.degree;
}

export function generateCandidates(input: GenerateInput) {
  const complexity = clamp(Math.round(input.complexity), 1, 5);
  const complexityDegree = [4, 6, 6, 8, 10][complexity - 1];
  const partsDegree = clamp(Math.ceil((Math.max(input.parts.length, 2) + 1) / 2) * 2, 4, 10);
  const degree = Math.max(complexityDegree, partsDegree);
  const seed = (Math.round(input.seed) ^ hashString(input.description)) >>> 0;
  const random = mulberry32(seed);
  const pool: Candidate[] = [];

  for (let index = 0; index < 96; index += 1) {
    const rayAngles = generateAngles(degree, random, input.parts, input.symmetry);
    const assignments = assignMountainValley(degree, random);
    const partLabels = mapPartLabels(rayAngles, input.parts);
    pool.push(hydrateCandidate(rayAngles, assignments, partLabels, input.parts, input.symmetry, seed + index));
  }

  pool.sort((a, b) => b.score - a.score || b.minSectorDeg - a.minSectorDeg);
  const selected: Candidate[] = [];
  for (const candidate of pool) {
    if (selected.every((item) => patternDistance(candidate, item) > 0.035)) selected.push(candidate);
    if (selected.length === 3) break;
  }
  while (selected.length < 3) selected.push(pool[selected.length]);

  const titles = [
    ["BALANCED", "特徴と余白のバランス"],
    ["FEATURE FIRST", "重要な部位の方向を優先"],
    ["OPEN SECTORS", "広いセクターを残す案"],
  ];
  return selected.map((candidate, index) => ({
    ...candidate,
    title: titles[index][0],
    subtitle: titles[index][1],
  }));
}

export function withAngleOffset(candidate: Candidate, degrees: number, parts: Part[], symmetry: boolean) {
  const angles = [...candidate.rayAngles];
  angles[0] = round(normalizeAngle(angles[0] + (degrees * Math.PI) / 180), 12);
  angles.sort((a, b) => a - b);
  return hydrateCandidate(
    angles,
    candidate.assignments,
    mapPartLabels(angles, parts),
    parts,
    symmetry,
    candidate.seed,
    candidate.title,
    candidate.subtitle,
  );
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

export function candidateToSvg(candidate: Candidate, title: string) {
  const lines = candidate.edges.map((edge) => {
    const [from, to] = edge.vertices;
    const [x1, y1] = candidate.vertices[from];
    const [x2, y2] = candidate.vertices[to];
    const styles: Record<Assignment, string> = {
      B: "stroke:#13223c;stroke-width:3",
      M: "stroke:#f04f3b;stroke-width:2.6",
      V: "stroke:#275bd7;stroke-width:2.6;stroke-dasharray:10 7",
      U: "stroke:#697386;stroke-width:2;stroke-dasharray:3 6",
    };
    return `  <line x1="${round(x1, 5)}" y1="${round(y1, 5)}" x2="${round(x2, 5)}" y2="${round(y2, 5)}" data-assignment="${edge.assignment}" style="${styles[edge.assignment]}" vector-effect="non-scaling-stroke"/>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${candidate.paper.width} ${candidate.paper.height}" role="img">`,
    `  <title>${escapeXml(title)} — ${escapeXml(candidate.title)}</title>`,
    `  <desc>Single-vertex crease-pattern candidate. Local Kawasaki residual only. Global flat-foldability, collision, layer order, paper thickness, and fold sequence are unverified.</desc>`,
    `  <rect width="${candidate.paper.width}" height="${candidate.paper.height}" fill="#fffdf7"/>`,
    ...lines,
    `  <circle cx="${CENTER[0]}" cy="${CENTER[1]}" r="5" fill="#13223c"/>`,
    `</svg>`,
  ].join("\n");
}

export function candidateToFold(candidate: Candidate, title: string) {
  const fold = {
    file_spec: 1.2,
    file_creator: "Ito PJ 2026 browser prototype",
    file_title: `${title} — ${candidate.title}`,
    file_description:
      "Single-vertex structure candidate. Local Kawasaki residual evaluated. Global flat-foldability, layer order, collision, paper thickness, and fold sequence are unverified.",
    file_classes: ["singleModel"],
    frame_title: "Crease-pattern candidate",
    frame_classes: ["creasePattern"],
    frame_attributes: ["2D"],
    frame_unit: "unit",
    vertices_coords: candidate.vertices.map(([x, y]) => [
      round(x / candidate.paper.width, 12),
      round(1 - y / candidate.paper.height, 12),
    ]),
    edges_vertices: candidate.edges.map((edge) => edge.vertices),
    edges_assignment: candidate.edges.map((edge) => edge.assignment),
    "edges_mitou:semanticPart": candidate.edges.map((edge) => edge.part),
    "mitou:localValidation": {
      scope: "singleVertexKawasakiAndMaekawaCounts",
      kawasakiResidualRad: round(candidate.residualRad, 14),
      kawasakiToleranceRad: 0.000001,
      maekawaMountainValleyDifference: candidate.maekawaDifference,
      globalFlatFoldability: "unchecked",
      layerOrder: "unchecked",
      collision: "unchecked",
      paperThickness: "unchecked",
      foldSequence: "unchecked",
    },
  };
  return JSON.stringify(fold, null, 2);
}
