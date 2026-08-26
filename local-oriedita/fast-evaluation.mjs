const TAU = Math.PI * 2;
const STAGES = [
  ["fold_document", "physical"],
  ["single_square_sheet", "physical"],
  ["no_cuts_or_disconnected_boundary", "physical"],
  ["assignments_resolved", "physical"],
  ["kawasaki_local", "physical"],
  ["maekawa_local", "physical"],
  ["minimum_feature_clearance", "foldability"],
  ["complexity_risk", "foldability"],
  ["semantic_shape_rotation_normalized", "appearance"],
];

const PROFILES = [
  {
    key: "rabbit",
    pattern: /うさぎ|ウサギ|兎|rabbit|bunny/i,
    symmetry: true,
    parts: [
      { label: "頭", importance: 5, direction: 0 },
      { label: "長い耳", importance: 5, direction: 330 },
      { label: "胴体", importance: 5, direction: 180 },
      { label: "前脚", importance: 3, direction: 55 },
      { label: "後脚", importance: 4, direction: 135 },
      { label: "尾", importance: 3, direction: 190 },
    ],
  },
  {
    key: "goldfish",
    pattern: /金魚|魚|さかな|fish/i,
    symmetry: true,
    parts: [
      { label: "頭", importance: 4, direction: 0 },
      { label: "胴体", importance: 5, direction: 180 },
      { label: "尾びれ", importance: 5, direction: 180 },
      { label: "背びれ", importance: 3, direction: 285 },
      { label: "腹びれ", importance: 2, direction: 75 },
    ],
  },
  {
    key: "beetle",
    pattern: /クワガタ|カブトムシ|昆虫|虫|beetle|insect/i,
    symmetry: true,
    parts: [
      { label: "大あご", importance: 5, direction: 0 },
      { label: "頭", importance: 4, direction: 15 },
      { label: "胴体", importance: 5, direction: 180 },
      { label: "脚", importance: 5, direction: 90 },
      { label: "羽", importance: 4, direction: 145 },
    ],
  },
  {
    key: "crane",
    pattern: /鶴|つる|鳥|bird|crane/i,
    symmetry: true,
    parts: [
      { label: "頭", importance: 3, direction: 350 },
      { label: "首", importance: 5, direction: 10 },
      { label: "翼", importance: 5, direction: 90 },
      { label: "尾", importance: 3, direction: 180 },
    ],
  },
  {
    key: "flower",
    pattern: /花|バラ|桜|flower|rose/i,
    symmetry: true,
    parts: [
      { label: "中心", importance: 5, direction: 0 },
      { label: "花びら", importance: 5, direction: 72 },
    ],
  },
];

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeAngle(value) {
  return ((value % TAU) + TAU) % TAU;
}

function angularDistance(a, b) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, TAU - difference);
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function cleanParts(parts) {
  if (!Array.isArray(parts)) return [];
  return parts.slice(0, 16).flatMap((part) => {
    if (!part || typeof part.label !== "string" || !part.label.trim()) return [];
    return [{
      label: part.label.trim().slice(0, 30),
      importance: clamp(Number(part.importance) || 3, 1, 5),
      direction: ((Number(part.direction) || 0) % 360 + 360) % 360,
    }];
  });
}

export function buildDesignGoal(prompt, supplied = null) {
  const text = typeof prompt === "string" ? prompt.trim().slice(0, 200) : "";
  const profile = PROFILES.find(({ pattern }) => pattern.test(text));
  const suppliedParts = cleanParts(supplied?.parts);
  const useProfile = profile && (!suppliedParts.length || supplied?.presetKey === "custom");
  return {
    motif: profile?.key ?? (typeof supplied?.presetKey === "string" ? supplied.presetKey : "custom"),
    description: text || "参考画像をもとに設計",
    symmetry: typeof supplied?.symmetry === "boolean" ? supplied.symmetry : (profile?.symmetry ?? false),
    parts: useProfile ? profile.parts : (suppliedParts.length ? suppliedParts : (profile?.parts ?? [])),
    constraints: ["single_square_sheet", "no_cuts", "mountain_valley_explicit", "oriedita_fold_completed"],
    visualComparison: "rotation_normalized_2d",
  };
}

function documentView(fold, index) {
  const coords = Array.isArray(fold?.vertices_coords) ? fold.vertices_coords : [];
  const edges = Array.isArray(fold?.edges_vertices) ? fold.edges_vertices : [];
  const assignments = Array.isArray(fold?.edges_assignment) ? fold.edges_assignment : [];
  const semantic = Array.isArray(fold?.["edges_mitou:semanticPart"])
    ? fold["edges_mitou:semanticPart"]
    : [];
  const numericCoords = coords.map((point) => [Number(point?.[0]), Number(point?.[1])]);
  const finiteCoords = numericCoords.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const xs = finiteCoords.map(([x]) => x);
  const ys = finiteCoords.map(([, y]) => y);
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 1);
  const width = Math.max(1e-12, maxX - minX);
  const height = Math.max(1e-12, maxY - minY);
  const scale = Math.max(width, height);
  const normalizedCoords = numericCoords.map(([x, y]) => [(x - minX) / scale, (y - minY) / scale]);
  const title = typeof fold?.file_title === "string" && fold.file_title.trim()
    ? fold.file_title.trim()
    : `candidate-${index + 1}`;
  const id = `candidate-${index + 1}-${hashString(JSON.stringify([coords, edges, assignments]))}`;
  return {
    fold,
    id,
    title,
    coords: normalizedCoords,
    edges,
    assignments,
    semantic,
    width: width / scale,
    height: height / scale,
    center: [width / scale / 2, height / scale / 2],
  };
}

function foldDocumentCheck(view) {
  const issues = [];
  if (view.coords.length < 4) issues.push("頂点が4個未満です");
  if (!view.edges.length || view.edges.length !== view.assignments.length) issues.push("辺と割当の数が一致しません");
  view.coords.forEach(([x, y], index) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) issues.push(`頂点${index}の座標が不正です`);
  });
  view.edges.forEach((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2 || !view.coords[edge[0]] || !view.coords[edge[1]]) {
      issues.push(`辺${index}の頂点参照が不正です`);
    }
  });
  return { score: issues.length ? 0 : 100, passed: issues.length === 0, issues };
}

function boundaryInfo(view) {
  const boundaryEdges = view.edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ index }) => view.assignments[index] === "B");
  const degree = new Map();
  const graph = new Map();
  for (const { edge } of boundaryEdges) {
    for (const [from, to] of [[edge[0], edge[1]], [edge[1], edge[0]]]) {
      degree.set(from, (degree.get(from) ?? 0) + 1);
      const neighbors = graph.get(from) ?? [];
      neighbors.push(to);
      graph.set(from, neighbors);
    }
  }
  const vertices = [...degree.keys()];
  const visited = new Set();
  if (vertices.length) {
    const pending = [vertices[0]];
    while (pending.length) {
      const vertex = pending.pop();
      if (visited.has(vertex)) continue;
      visited.add(vertex);
      pending.push(...(graph.get(vertex) ?? []));
    }
  }
  const tolerance = 1e-5;
  const onPaperEdge = vertices.every((vertex) => {
    const [x, y] = view.coords[vertex] ?? [];
    return Math.min(Math.abs(x), Math.abs(x - view.width), Math.abs(y), Math.abs(y - view.height)) <= tolerance;
  });
  return {
    boundaryEdges,
    vertices,
    connected: vertices.length >= 4 && visited.size === vertices.length,
    closed: vertices.length >= 4 && vertices.every((vertex) => degree.get(vertex) === 2),
    square: Math.abs(view.width - view.height) <= 0.015,
    onPaperEdge,
  };
}

function squareCheck(view) {
  const boundary = boundaryInfo(view);
  const issues = [];
  if (!boundary.connected) issues.push("外周が一つにつながっていません");
  if (!boundary.closed) issues.push("外周が閉じた一周になっていません");
  if (!boundary.square) issues.push("紙の外接形状が正方形ではありません");
  if (!boundary.onPaperEdge) issues.push("外周線が紙の外接辺から外れています");
  const passed = issues.length === 0;
  return { score: passed ? 100 : clamp(100 - issues.length * 28), passed, issues, boundary };
}

function noCutsCheck(view, boundary) {
  const cutCount = view.assignments.filter((assignment) => assignment === "C").length;
  const issues = [];
  if (cutCount) issues.push(`切断線が${cutCount}本あります`);
  if (!boundary.connected || !boundary.closed) issues.push("外周が分断されています");
  return { score: issues.length ? 0 : 100, passed: issues.length === 0, issues };
}

function assignmentCheck(view) {
  const inner = view.assignments.filter((assignment) => assignment !== "B");
  const unresolved = inner.filter((assignment) => assignment === "U" || assignment == null).length;
  const invalid = inner.filter((assignment) => !["M", "V", "F", "U"].includes(assignment)).length;
  const mv = inner.filter((assignment) => assignment === "M" || assignment === "V").length;
  const issues = [];
  if (unresolved) issues.push(`未確定の折線が${unresolved}本あります`);
  if (invalid) issues.push(`未対応の割当が${invalid}本あります`);
  if (!mv) issues.push("山折り・谷折りがありません");
  return {
    score: inner.length ? clamp(((inner.length - unresolved - invalid) / inner.length) * 100) : 0,
    passed: issues.length === 0,
    issues,
  };
}

function creaseVertices(view) {
  const incidence = new Map();
  view.edges.forEach((edge, edgeIndex) => {
    const assignment = view.assignments[edgeIndex];
    if (assignment !== "M" && assignment !== "V") return;
    for (const [vertex, other] of [[edge[0], edge[1]], [edge[1], edge[0]]]) {
      const list = incidence.get(vertex) ?? [];
      list.push({ other, assignment });
      incidence.set(vertex, list);
    }
  });
  const tolerance = 1e-5;
  return [...incidence.entries()].flatMap(([vertex, rays]) => {
    const [x, y] = view.coords[vertex] ?? [];
    const boundary = Math.min(Math.abs(x), Math.abs(x - view.width), Math.abs(y), Math.abs(y - view.height)) <= tolerance;
    return !boundary && rays.length >= 4 ? [{ vertex, rays }] : [];
  });
}

function localTheoremChecks(view) {
  const vertices = creaseVertices(view);
  if (!vertices.length) {
    const unknown = { score: 50, passed: null, issues: ["適用できる内点がないため未判定です"] };
    return { kawasaki: unknown, maekawa: unknown, minSectorDeg: null };
  }
  const kawasakiIssues = [];
  const maekawaIssues = [];
  let worstResidual = 0;
  let minSector = Number.POSITIVE_INFINITY;
  for (const { vertex, rays } of vertices) {
    if (rays.length % 2 !== 0) {
      kawasakiIssues.push(`内点${vertex}の折線次数が奇数です`);
    } else {
      const [cx, cy] = view.coords[vertex];
      const angles = rays.map(({ other }) => {
        const [x, y] = view.coords[other];
        return normalizeAngle(Math.atan2(y - cy, x - cx));
      }).sort((a, b) => a - b);
      const sectors = angles.map((angle, index) => {
        const next = angles[(index + 1) % angles.length] + (index === angles.length - 1 ? TAU : 0);
        return next - angle;
      });
      const even = sectors.reduce((sum, value, index) => sum + (index % 2 === 0 ? value : 0), 0);
      const residual = Math.abs(even - Math.PI);
      worstResidual = Math.max(worstResidual, residual);
      minSector = Math.min(minSector, ...sectors);
      if (residual > 1e-5) kawasakiIssues.push(`内点${vertex}の交互角和がπから${round(residual * 180 / Math.PI, 3)}°ずれています`);
    }
    const mountains = rays.filter(({ assignment }) => assignment === "M").length;
    const valleys = rays.filter(({ assignment }) => assignment === "V").length;
    if (Math.abs(mountains - valleys) !== 2) maekawaIssues.push(`内点${vertex}の山谷本数差が2ではありません`);
  }
  return {
    kawasaki: {
      score: clamp(100 - worstResidual * 180 / Math.PI * 12),
      passed: kawasakiIssues.length === 0,
      issues: kawasakiIssues,
    },
    maekawa: {
      score: clamp(100 - maekawaIssues.length * 35),
      passed: maekawaIssues.length === 0,
      issues: maekawaIssues,
    },
    minSectorDeg: Number.isFinite(minSector) ? minSector * 180 / Math.PI : null,
  };
}

function featureCheck(view, minSectorDeg) {
  const lengths = view.edges.flatMap((edge, index) => {
    if (view.assignments[index] === "B") return [];
    const [a, b] = edge;
    const start = view.coords[a];
    const end = view.coords[b];
    if (!start || !end) return [];
    return [Math.hypot(start[0] - end[0], start[1] - end[1])];
  });
  if (!lengths.length) return { score: 0, passed: false, issues: ["折線の寸法を測れません"] };
  const minimumLength = Math.min(...lengths);
  const lengthScore = clamp((minimumLength - 0.01) / 0.12 * 100);
  const sectorScore = minSectorDeg == null ? 50 : clamp((minSectorDeg - 4) / 26 * 100);
  const score = round(lengthScore * 0.6 + sectorScore * 0.4);
  const issues = [];
  if (minimumLength < 0.025) issues.push("非常に短い折線があります");
  if (minSectorDeg != null && minSectorDeg < 7) issues.push("狭いセクターがあります");
  return {
    score,
    passed: issues.length === 0,
    issues,
    metrics: { minimumNormalizedEdge: round(minimumLength, 4), minimumSectorDeg: round(minSectorDeg, 2) },
  };
}

function complexityCheck(view) {
  const creaseCount = view.assignments.filter((assignment) => assignment === "M" || assignment === "V").length;
  const degrees = new Array(view.coords.length).fill(0);
  view.edges.forEach(([from, to]) => {
    if (degrees[from] != null) degrees[from] += 1;
    if (degrees[to] != null) degrees[to] += 1;
  });
  const maximumDegree = Math.max(...degrees, 0);
  const score = clamp(105 - Math.max(0, creaseCount - 18) * 1.6 - Math.max(0, maximumDegree - 8) * 7);
  const issues = [];
  if (creaseCount > 80) issues.push("折線数が多く、手順が複雑になる可能性があります");
  if (maximumDegree > 12) issues.push("一点に集まる折線が多い箇所があります");
  return {
    score: round(score),
    passed: issues.length === 0,
    issues,
    metrics: { creaseCount, maximumDegree, estimatedStepProxy: Math.max(1, Math.ceil(creaseCount * 0.7)), layerCount: "unknown" },
  };
}

function normalizedLabel(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s_\-・左右大小なるをがの]/g, "");
}

function labelsMatch(a, b) {
  const left = normalizedLabel(a);
  const right = normalizedLabel(b);
  return Boolean(left && right && (left.includes(right) || right.includes(left)));
}

function symmetryScore(view) {
  const segments = view.edges.map(([a, b]) => [view.coords[a], view.coords[b]]).filter(([a, b]) => a && b);
  if (!segments.length) return 0;
  const [cx, cy] = view.center;
  let best = 0;
  for (let axisDeg = 0; axisDeg < 180; axisDeg += 15) {
    const axis = axisDeg * Math.PI / 180;
    const cos = Math.cos(axis);
    const sin = Math.sin(axis);
    const reflect = ([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      return [cx + along * cos + across * sin, cy + along * sin - across * cos];
    };
    const distance = segments.reduce((total, [a, b]) => {
      const ra = reflect(a);
      const rb = reflect(b);
      const nearest = Math.min(...segments.map(([c, d]) => Math.min(
        Math.hypot(ra[0] - c[0], ra[1] - c[1]) + Math.hypot(rb[0] - d[0], rb[1] - d[1]),
        Math.hypot(ra[0] - d[0], ra[1] - d[1]) + Math.hypot(rb[0] - c[0], rb[1] - c[1]),
      )));
      return total + nearest / 2;
    }, 0) / segments.length;
    best = Math.max(best, clamp(100 - distance / 0.22 * 100));
  }
  return best;
}

function semanticCheck(view, goal) {
  const edges = view.edges.flatMap((edge, index) => {
    const label = view.semantic[index];
    if (typeof label !== "string" || !label.trim()) return [];
    const a = view.coords[edge[0]];
    const b = view.coords[edge[1]];
    if (!a || !b) return [];
    const [cx, cy] = view.center;
    const da = Math.hypot(a[0] - cx, a[1] - cy);
    const db = Math.hypot(b[0] - cx, b[1] - cy);
    const target = da > db ? a : b;
    return [{ label, angle: normalizeAngle(Math.atan2(target[1] - cy, target[0] - cx)) }];
  });
  if (!goal.parts.length || !edges.length) {
    return {
      score: 35,
      passed: null,
      issues: ["部位ラベルがないため形状の方向評価は未判定です"],
      metrics: { bestRotationDeg: 0, semanticScore: 35, symmetryScore: round(symmetryScore(view)) },
    };
  }
  let bestSemantic = 0;
  let bestRotation = 0;
  for (let rotationDeg = 0; rotationDeg < 360; rotationDeg += 15) {
    const rotation = rotationDeg * Math.PI / 180;
    let weighted = 0;
    let weight = 0;
    for (const part of goal.parts) {
      const matches = edges.filter((edge) => labelsMatch(edge.label, part.label));
      const partScore = matches.length
        ? Math.max(...matches.map((edge) => 100 - angularDistance(edge.angle + rotation, part.direction * Math.PI / 180) / Math.PI * 100))
        : 0;
      weighted += partScore * part.importance;
      weight += part.importance;
    }
    const score = weight ? weighted / weight : 0;
    if (score > bestSemantic) {
      bestSemantic = score;
      bestRotation = rotationDeg;
    }
  }
  const symmetry = symmetryScore(view);
  const score = goal.symmetry ? bestSemantic * 0.75 + symmetry * 0.25 : bestSemantic * 0.9 + symmetry * 0.1;
  const missing = goal.parts.filter((part) => !edges.some((edge) => labelsMatch(edge.label, part.label))).map((part) => part.label);
  return {
    score: round(score),
    passed: score >= 45,
    issues: missing.length ? [`部位ラベル不足: ${missing.join("、")}`] : [],
    metrics: { bestRotationDeg: bestRotation, semanticScore: round(bestSemantic), symmetryScore: round(symmetry) },
  };
}

function evaluateCandidate(fold, goal, index) {
  const view = documentView(fold, index);
  const document = foldDocumentCheck(view);
  const square = squareCheck(view);
  const noCuts = noCutsCheck(view, square.boundary);
  const assignments = assignmentCheck(view);
  const theorems = localTheoremChecks(view);
  const clearance = featureCheck(view, theorems.minSectorDeg);
  const complexity = complexityCheck(view);
  const semantic = semanticCheck(view, goal);
  const checks = [document, square, noCuts, assignments, theorems.kawasaki, theorems.maekawa, clearance, complexity, semantic];
  const physicalChecks = checks.slice(0, 6).filter((check) => check.passed !== null);
  const physical = physicalChecks.reduce((sum, check) => sum + check.score, 0) / Math.max(1, physicalChecks.length);
  const foldability = clearance.score * 0.58 + complexity.score * 0.42;
  const hardFailures = checks.slice(0, 6).filter((check) => check.passed === false).length;
  return {
    id: view.id,
    title: view.title,
    index,
    checks,
    scores: { physical: round(physical), appearance: semantic.score, foldability: round(foldability) },
    hardFailures,
  };
}

function dominates(a, b) {
  const keys = ["physical", "appearance", "foldability"];
  return keys.every((key) => a.scores[key] >= b.scores[key])
    && keys.some((key) => a.scores[key] > b.scores[key]);
}

export function validateCandidatePool(folds, goalInput) {
  const goal = buildDesignGoal(goalInput?.description ?? "", goalInput);
  const candidates = folds.slice(0, 3).map((fold, index) => evaluateCandidate(fold, goal, index));
  if (!candidates.length) throw new Error("評価する候補がありません");
  const minimumFailures = Math.min(...candidates.map((candidate) => candidate.hardFailures));
  const eligible = candidates.filter((candidate) => candidate.hardFailures === minimumFailures);
  const pareto = eligible.filter((candidate) => !eligible.some((other) => other !== candidate && dominates(other, candidate)));
  const selected = [...pareto].sort((a, b) =>
    b.scores.physical - a.scores.physical
    || b.scores.appearance - a.scores.appearance
    || b.scores.foldability - a.scores.foldability
    || a.id.localeCompare(b.id),
  )[0];
  const now = new Date().toISOString();
  const validations = STAGES.map(([name, category], stageIndex) => ({
    index: stageIndex + 1,
    kind: "deterministic",
    name,
    category,
    startedAt: now,
    completedAt: now,
    selectedCandidateId: selected.id,
    passed: selected.checks[stageIndex].passed,
    score: selected.checks[stageIndex].score,
    issues: selected.checks[stageIndex].issues,
    metrics: selected.checks[stageIndex].metrics ?? {},
    candidateScores: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.checks[stageIndex].score])),
  }));
  return {
    goal,
    selectedIndex: selected.index,
    selectedCandidateId: selected.id,
    paretoCandidateIds: pareto.map((candidate) => candidate.id),
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      index: candidate.index,
      scores: candidate.scores,
      hardFailures: candidate.hardFailures,
    })),
    selectedScores: selected.scores,
    validations,
  };
}

export function mergeFinalEvaluation(preflight, judge, { completed = true, issues = [] } = {}) {
  const now = new Date().toISOString();
  const finalRecord = {
    index: 10,
    kind: "oriedita_groq",
    name: "oriedita_final_fold_and_groq_visual_judge",
    category: "physical_and_appearance",
    startedAt: now,
    completedAt: now,
    selectedCandidateId: preflight.selectedCandidateId,
    passed: Boolean(completed),
    score: completed ? clamp(Number(judge?.score) || 0) : 0,
    issues: [...issues, ...(Array.isArray(judge?.issues) ? judge.issues : [])].slice(0, 12),
    metrics: { orientationPolicy: "0_90_180_270_equivalent", engineCompleted: Boolean(completed) },
  };
  const appearance = round(preflight.selectedScores.appearance * 0.35 + finalRecord.score * 0.65);
  const physical = completed ? preflight.selectedScores.physical : 0;
  const foldability = preflight.selectedScores.foldability;
  const score = round(physical * 0.5 + appearance * 0.35 + foldability * 0.15);
  return {
    score: Math.round(score),
    iterations: 10,
    stop_reason: "completed_10_validations",
    summary: typeof judge?.summary === "string" ? judge.summary : "10段階の検証を完了しました",
    issues: finalRecord.issues.slice(0, 8),
    mode: "9_fast_checks_plus_1_oriedita_groq",
    physical: { score: Math.round(physical), orieditaCompleted: Boolean(completed) },
    appearance: { score: Math.round(appearance), rotationNormalized: true, dimensions: "2d_folded_figure" },
    foldability: { score: Math.round(foldability), layerCount: "unknown", clearanceIsProxy: true },
    selectedCandidate: preflight.selectedCandidateId,
    paretoCandidateIds: preflight.paretoCandidateIds,
    validations: [...preflight.validations, finalRecord],
  };
}
