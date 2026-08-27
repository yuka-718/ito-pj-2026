import { createHash } from "node:crypto";

const EPSILON = 1e-8;

const round = (value) => Math.round(value * 1e8) / 1e8;
const finitePoint = (value) => Array.isArray(value)
  && value.length >= 2
  && Number.isFinite(Number(value[0]))
  && Number.isFinite(Number(value[1]));

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeTrainingItem(item, baseUrl) {
  if (!item || typeof item.id !== "string" || !item.id.trim()) throw new Error("作品IDがありません");
  const resolveUrl = (value) => new URL(String(value), baseUrl).href;
  return {
    id: item.id.trim(),
    title: String(item.title ?? "").trim(),
    creator: String(item.creator ?? "").trim(),
    site: String(item.site ?? "").trim(),
    site_label: String(item.site_label ?? "").trim(),
    source_url: resolveUrl(item.source_url),
    public_policy: String(item.public_policy ?? "").trim(),
    formats: Array.isArray(item.formats) ? item.formats.map(String) : [],
    diagram_image_urls: Array.isArray(item.diagram_image_urls)
      ? item.diagram_image_urls.map(resolveUrl)
      : [],
  };
}

function pointKey(point) {
  return `${round(point[0])},${round(point[1])}`;
}

function canonicalSegmentKey(a, b) {
  const first = pointKey(a);
  const second = pointKey(b);
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function interpolate(a, b, t) {
  return [round(a[0] + (b[0] - a[0]) * t), round(a[1] + (b[1] - a[1]) * t)];
}

function segmentIntersection(first, second) {
  const r = subtract(first.b, first.a);
  const s = subtract(second.b, second.a);
  const denominator = cross(r, s);
  const delta = subtract(second.a, first.a);
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = cross(delta, s) / denominator;
  const u = cross(delta, r) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
}

function splitSegments(segments) {
  const breakpoints = segments.map(() => [0, 1]);
  for (let first = 0; first < segments.length; first += 1) {
    for (let second = first + 1; second < segments.length; second += 1) {
      const hit = segmentIntersection(segments[first], segments[second]);
      if (!hit) continue;
      breakpoints[first].push(hit.t);
      breakpoints[second].push(hit.u);
    }
  }
  return segments.flatMap((segment, index) => {
    const values = [...new Set(breakpoints[index].map((value) => round(value)))].sort((a, b) => a - b);
    return values.slice(0, -1).flatMap((start, partIndex) => {
      const end = values[partIndex + 1];
      if (end - start <= EPSILON) return [];
      return [{
        a: interpolate(segment.a, segment.b, start),
        b: interpolate(segment.a, segment.b, end),
        assignment: segment.assignment,
        sourceSteps: segment.sourceSteps,
      }];
    });
  });
}

function snapCreaseTopology(segments, tolerance = 0.005) {
  const snapped = segments.map((segment) => ({
    ...segment,
    a: segment.a.map((value) => Math.abs(value) <= tolerance ? 0 : Math.abs(1 - value) <= tolerance ? 1 : value),
    b: segment.b.map((value) => Math.abs(value) <= tolerance ? 0 : Math.abs(1 - value) <= tolerance ? 1 : value),
  }));
  const endpointCandidates = snapped.map(() => [[], []]);
  const addNearestEndpoint = (parameter, length, candidates, point) => {
    const fromStart = Math.abs(parameter) * length;
    const fromEnd = Math.abs(1 - parameter) * length;
    if (Math.min(fromStart, fromEnd) > tolerance) return;
    candidates[fromStart <= fromEnd ? 0 : 1].push(point);
  };
  for (let first = 0; first < snapped.length; first += 1) {
    for (let second = first + 1; second < snapped.length; second += 1) {
      const firstDirection = subtract(snapped[first].b, snapped[first].a);
      const secondDirection = subtract(snapped[second].b, snapped[second].a);
      const denominator = cross(firstDirection, secondDirection);
      if (Math.abs(denominator) <= EPSILON) continue;
      const delta = subtract(snapped[second].a, snapped[first].a);
      const firstT = cross(delta, secondDirection) / denominator;
      const secondT = cross(delta, firstDirection) / denominator;
      const firstLength = Math.hypot(...firstDirection);
      const secondLength = Math.hypot(...secondDirection);
      const firstMargin = tolerance / Math.max(firstLength, EPSILON);
      const secondMargin = tolerance / Math.max(secondLength, EPSILON);
      if (firstT < -firstMargin || firstT > 1 + firstMargin || secondT < -secondMargin || secondT > 1 + secondMargin) continue;
      const point = interpolate(snapped[first].a, snapped[first].b, firstT);
      addNearestEndpoint(firstT, firstLength, endpointCandidates[first], point);
      addNearestEndpoint(secondT, secondLength, endpointCandidates[second], point);
    }
  }
  const nearest = (origin, points) => points.reduce((best, point) => {
    const distance = Math.hypot(point[0] - origin[0], point[1] - origin[1]);
    return !best || distance < best.distance ? { point, distance } : best;
  }, null)?.point ?? origin;
  for (let index = 0; index < snapped.length; index += 1) {
    snapped[index].a = nearest(snapped[index].a, endpointCandidates[index][0]);
    snapped[index].b = nearest(snapped[index].b, endpointCandidates[index][1]);
  }
  return snapped;
}

function cleanCreases(extraction, minimumConfidence, minimumCoverage, minimumCreases) {
  const reasons = [];
  if (extraction?.source_coordinate_system !== "original_square") {
    reasons.push("元の正方形上の座標へ復元されていません");
  }
  const steps = Array.isArray(extraction?.steps) ? extraction.steps : [];
  const cpCreases = extraction?.crease_pattern?.present === true && Array.isArray(extraction.crease_pattern.creases)
    ? extraction.crease_pattern.creases
    : [];
  const useCreasePattern = cpCreases.length > 0;
  const creaseBearing = useCreasePattern
    ? cpCreases
    : steps.filter((step) => (
      ["mountain", "valley", "reverse", "sink"].includes(step?.fold_type)
      && Number(step?.confidence) >= 0.5
    ));
  const mappedSteps = new Set();
  const byGeometry = new Map();
  const sources = useCreasePattern
    ? cpCreases.map((crease, index) => ({
      step_number: `cp-${index + 1}`,
      fold_type: crease.assignment === "M" ? "mountain" : crease.assignment === "V" ? "valley" : "unknown",
      confidence: crease.confidence,
      crease: { a: crease.a, b: crease.b, coordinate_system: "original_square" },
    }))
    : steps;
  for (const step of sources) {
    if (step?.fold_type !== "mountain" && step?.fold_type !== "valley") continue;
    if (!step.crease || step.crease.coordinate_system !== "original_square") continue;
    if (Number(step.confidence) < minimumConfidence) continue;
    if (!finitePoint(step.crease.a) || !finitePoint(step.crease.b)) continue;
    const a = step.crease.a.map(Number);
    const b = step.crease.b.map(Number);
    if ([...a, ...b].some((value) => value < -EPSILON || value > 1 + EPSILON)) continue;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON) continue;
    const key = canonicalSegmentKey(a, b);
    const assignment = step.fold_type === "mountain" ? "M" : "V";
    const existing = byGeometry.get(key);
    if (existing && existing.assignment !== assignment) {
      reasons.push(`同じ折り線に山折りと谷折りの競合があります: step ${step.step_number}`);
      continue;
    }
    if (existing) {
      existing.sourceSteps.push(step.step_number);
    } else {
      byGeometry.set(key, { a, b, assignment, sourceSteps: [step.step_number] });
    }
    mappedSteps.add(step.step_number);
  }
  const coverage = creaseBearing.length ? mappedSteps.size / creaseBearing.length : 0;
  if (byGeometry.size < minimumCreases) reasons.push(`高信頼の山谷線が不足しています (${byGeometry.size}/${minimumCreases})`);
  if (coverage < minimumCoverage) {
    reasons.push(`元の正方形へ戻せた折り操作が不足しています (${mappedSteps.size}/${creaseBearing.length}, ${Math.round(coverage * 100)}%)`);
  }
  return {
    creases: [...byGeometry.values()],
    reasons,
    coverage: {
      creaseBearingSteps: creaseBearing.length,
      mappedSteps: mappedSteps.size,
      ratio: round(coverage),
      source: useCreasePattern ? "crease_pattern" : "steps",
    },
  };
}

export function buildFoldCandidate(extraction, {
  minimumConfidence = 0.9,
  minimumCoverage = 0.9,
  minimumCreases = 2,
  provenance = {},
} = {}) {
  const { creases, reasons, coverage } = cleanCreases(
    extraction,
    minimumConfidence,
    minimumCoverage,
    minimumCreases,
  );
  if (reasons.length) return { ok: false, reasons, fold: null, coverage };
  const boundary = [
    { a: [0, 0], b: [1, 0], assignment: "B", sourceSteps: [] },
    { a: [1, 0], b: [1, 1], assignment: "B", sourceSteps: [] },
    { a: [1, 1], b: [0, 1], assignment: "B", sourceSteps: [] },
    { a: [0, 1], b: [0, 0], assignment: "B", sourceSteps: [] },
  ];
  const pieces = splitSegments([...boundary, ...snapCreaseTopology(creases)]);
  const vertices = [];
  const vertexIndex = new Map();
  const getVertex = (point) => {
    const key = pointKey(point);
    if (!vertexIndex.has(key)) {
      vertexIndex.set(key, vertices.length);
      vertices.push(point.map(round));
    }
    return vertexIndex.get(key);
  };
  const edges = [];
  const assignments = [];
  const angles = [];
  const sourceSteps = [];
  const seenEdges = new Set();
  for (const piece of pieces) {
    const edge = [getVertex(piece.a), getVertex(piece.b)];
    // Intersections are rounded to make vertex identity deterministic. Very
    // short split pieces can therefore collapse onto one rounded vertex and
    // must not be emitted as zero-length FOLD edges.
    if (edge[0] === edge[1]) continue;
    const key = edge[0] < edge[1] ? `${edge[0]}:${edge[1]}` : `${edge[1]}:${edge[0]}`;
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    edges.push(edge);
    assignments.push(piece.assignment);
    angles.push(piece.assignment === "M" ? -180 : piece.assignment === "V" ? 180 : 0);
    sourceSteps.push(piece.sourceSteps);
  }
  const fold = {
    file_spec: 1.2,
    file_creator: "ORIAI Origami Search training pipeline",
    file_title: String(extraction.title ?? extraction.item_id ?? "Extracted origami"),
    file_classes: ["singleModel"],
    frame_classes: ["creasePattern"],
    frame_attributes: ["2D"],
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: assignments,
    edges_foldAngle: angles,
    "edges_oriai:sourceSteps": sourceSteps,
    "file_oriai:trainingProvenance": provenance,
    "file_oriai:sequenceFeasibility": "unverified",
  };
  return {
    ok: true,
    reasons: [],
    fold,
    stats: { vertices: vertices.length, edges: edges.length, creases: creases.length, coverage },
  };
}

export function isApprovedTrainingRecord({ extraction, build, verification, review }) {
  const reasons = [];
  if (extraction?.completeness !== "complete") reasons.push("手順抽出がcompleteではありません");
  if (build?.ok !== true) reasons.push("FOLD候補を作成できていません");
  if (verification?.status !== "done" || verification?.orieditaCompleted !== true) {
    reasons.push("Oriedita検証が完了していません");
  }
  if (review?.approved !== true) reasons.push("出典との人手照合が承認されていません");
  return { approved: reasons.length === 0, reasons };
}
