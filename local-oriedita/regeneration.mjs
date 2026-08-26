const TAU = Math.PI * 2;
const MINIMUM_SECTOR = (8 * Math.PI) / 180;

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 12) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeAngle(angle) {
  return ((angle % TAU) + TAU) % TAU;
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
  return hash >>> 0;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSectorGroup(logits) {
  const remaining = Math.PI - logits.length * MINIMUM_SECTOR;
  const maximum = Math.max(...logits);
  const exponentials = logits.map((value) => Math.exp(value - maximum));
  const sum = exponentials.reduce((total, value) => total + value, 0);
  return exponentials.map((value) => MINIMUM_SECTOR + (remaining * value) / sum);
}

function boostedParts(goal, feedback) {
  const normalizedFeedback = feedback.join(" ").toLocaleLowerCase("ja");
  return (goal.parts ?? []).map((part) => ({
    ...part,
    importance: clamp(
      Number(part.importance ?? 3) + (normalizedFeedback.includes(String(part.label).toLocaleLowerCase("ja")) ? 2 : 0),
      1,
      7,
    ),
  }));
}

function generateSectors(degree, random, parts, symmetry) {
  const groupSize = degree / 2;
  const weightAt = (index) => parts[index % Math.max(parts.length, 1)]?.importance ?? 3;
  const evenLogits = Array.from({ length: groupSize }, (_, index) =>
    (random() - 0.5) * 2.8 + weightAt(index * 2) * 0.18
  );
  const oddLogits = Array.from({ length: groupSize }, (_, index) => {
    const mirrored = symmetry
      ? evenLogits[(groupSize - index - 1 + groupSize) % groupSize] * 0.72
      : 0;
    return (random() - 0.5) * 2.8 + weightAt(index * 2 + 1) * 0.18 + mirrored;
  });
  const even = makeSectorGroup(evenLogits);
  const odd = makeSectorGroup(oddLogits);
  return Array.from({ length: degree }, (_, index) =>
    index % 2 === 0 ? even[index / 2] : odd[(index - 1) / 2]
  );
}

function anglesFromSectors(sectors) {
  const angles = [0];
  for (let index = 0; index < sectors.length - 1; index += 1) {
    angles.push(angles[index] + sectors[index]);
  }
  return angles;
}

function alignmentCost(angles, parts, rotation) {
  if (!parts.length) return 0;
  return parts.reduce((total, part) => {
    const target = (Number(part.direction ?? 0) * Math.PI) / 180;
    const nearest = Math.min(...angles.map((angle) => angularDistance(angle + rotation, target)));
    return total + nearest * Number(part.importance ?? 3);
  }, 0);
}

function alignAngles(angles, parts, random) {
  const candidates = [random() * TAU];
  for (const part of parts) {
    const target = (Number(part.direction ?? 0) * Math.PI) / 180;
    for (const angle of angles) candidates.push(target - angle);
  }
  const rotation = candidates.sort((a, b) => alignmentCost(angles, parts, a) - alignmentCost(angles, parts, b))[0];
  return angles.map((angle) => round(normalizeAngle(angle + rotation))).sort((a, b) => a - b);
}

function nearestPartLabel(angle, parts) {
  if (!parts.length) return "構造線";
  return parts.reduce((best, part) => {
    const distance = angularDistance(angle, (Number(part.direction ?? 0) * Math.PI) / 180);
    return distance < best.distance ? { distance, label: String(part.label) } : best;
  }, { distance: Number.POSITIVE_INFINITY, label: "構造線" }).label;
}

function rayRectangleIntersection(center, angle, bounds) {
  const [cx, cy] = center;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const epsilon = Math.max(bounds.width, bounds.height) * 1e-12;
  const distances = [];
  if (dx > epsilon) distances.push((bounds.maxX - cx) / dx);
  if (dx < -epsilon) distances.push((bounds.minX - cx) / dx);
  if (dy > epsilon) distances.push((bounds.maxY - cy) / dy);
  if (dy < -epsilon) distances.push((bounds.minY - cy) / dy);
  const distance = Math.min(...distances.filter((value) => value > epsilon));
  return [
    round(clamp(cx + distance * dx, bounds.minX, bounds.maxX)),
    round(clamp(cy + distance * dy, bounds.minY, bounds.maxY)),
  ];
}

function perimeterPosition([x, y], bounds) {
  const epsilon = 1e-8;
  if (Math.abs(y - bounds.minY) < epsilon) return x - bounds.minX;
  if (Math.abs(x - bounds.maxX) < epsilon) return bounds.width + (y - bounds.minY);
  if (Math.abs(y - bounds.maxY) < epsilon) return bounds.width + bounds.height + (bounds.maxX - x);
  return bounds.width * 2 + bounds.height + (bounds.maxY - y);
}

function paperBounds(fold) {
  const boundaryVertices = new Set();
  fold.edges_vertices.forEach((edge, index) => {
    if (fold.edges_assignment?.[index] === "B") edge.forEach((vertex) => boundaryVertices.add(vertex));
  });
  const source = boundaryVertices.size
    ? [...boundaryVertices].map((index) => fold.vertices_coords[index])
    : fold.vertices_coords;
  const xs = source.map(([x]) => x);
  const ys = source.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function creaseDegree(fold) {
  const degreeByVertex = new Map();
  fold.edges_vertices.forEach((edge, index) => {
    if (fold.edges_assignment?.[index] === "B") return;
    edge.forEach((vertex) => degreeByVertex.set(vertex, (degreeByVertex.get(vertex) ?? 0) + 1));
  });
  const degree = Math.max(4, ...degreeByVertex.values());
  return clamp(degree % 2 === 0 ? degree : degree + 1, 4, 12);
}

function assignmentSequence(degree, random) {
  const mountainCount = degree / 2 + 1;
  const assignments = Array.from({ length: degree }, (_, index) => index < mountainCount ? "M" : "V");
  for (let index = assignments.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [assignments[index], assignments[other]] = [assignments[other], assignments[index]];
  }
  return assignments;
}

function buildFold(source, angles, assignments, parts, cycle, feedback) {
  const bounds = paperBounds(source);
  const center = [bounds.minX + bounds.width / 2, bounds.minY + bounds.height / 2];
  const endpoints = angles.map((angle) => rayRectangleIntersection(center, angle, bounds));
  const boundaryPoints = [
    [bounds.minX, bounds.minY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY],
    [bounds.minX, bounds.maxY],
    ...endpoints,
  ].filter((point, index, values) => values.findIndex((other) =>
    Math.hypot(point[0] - other[0], point[1] - other[1]) < 1e-9
  ) === index).sort((a, b) => perimeterPosition(a, bounds) - perimeterPosition(b, bounds));
  const vertices = [center, ...boundaryPoints];
  const edges = boundaryPoints.map((_, index) => [index + 1, ((index + 1) % boundaryPoints.length) + 1]);
  const edgeAssignments = boundaryPoints.map(() => "B");
  const semanticParts = boundaryPoints.map(() => null);
  endpoints.forEach((endpoint, index) => {
    const boundaryIndex = boundaryPoints.findIndex((point) =>
      Math.hypot(point[0] - endpoint[0], point[1] - endpoint[1]) < 1e-9
    );
    edges.push([0, boundaryIndex + 1]);
    edgeAssignments.push(assignments[index]);
    semanticParts.push(nearestPartLabel(angles[index], parts));
  });
  return {
    ...source,
    file_title: `${source.file_title ?? "Origami candidate"} — regeneration ${cycle}`,
    file_description: "Regenerated from the previous evaluation. Local single-vertex conditions are constructed; global foldability remains unverified.",
    frame_classes: ["creasePattern"],
    vertices_coords: vertices,
    edges_vertices: edges,
    edges_assignment: edgeAssignments,
    "edges_mitou:semanticPart": semanticParts,
    "mitou:regeneration": {
      cycle,
      feedback: feedback.slice(0, 8),
      method: "evaluation_weighted_single_vertex_regeneration",
      globalFlatFoldability: "unchecked",
    },
  };
}

export function foldGeometrySignature(fold) {
  return hashString(JSON.stringify({
    vertices: fold.vertices_coords,
    edges: fold.edges_vertices,
    assignments: fold.edges_assignment,
  })).toString(16);
}

export function regenerateCandidatePool({ currentFold, goal, feedback = [], cycle, count = 24 }) {
  const parts = boostedParts(goal, feedback);
  const baseDegree = creaseDegree(currentFold);
  const partDegree = clamp(Math.ceil(Math.max(parts.length, 2) / 2) * 2, 4, 12);
  const targetDegree = Math.max(baseDegree, partDegree);
  const degreeOptions = [...new Set([
    targetDegree,
    clamp(targetDegree + 2, 4, 12),
    clamp(targetDegree - 2, 4, 12),
  ].filter((degree) => degree % 2 === 0))];
  const seed = hashString(JSON.stringify({
    motif: goal.motif,
    parts,
    feedback,
    cycle,
    source: foldGeometrySignature(currentFold),
  }));
  const random = mulberry32(seed);
  const candidates = [];
  const seen = new Set();
  for (let index = 0; index < count * 3 && candidates.length < count; index += 1) {
    const degree = degreeOptions[index % degreeOptions.length];
    const sectors = generateSectors(degree, random, parts, Boolean(goal.symmetry));
    const angles = alignAngles(anglesFromSectors(sectors), parts, random);
    const assignments = assignmentSequence(degree, random);
    const fold = buildFold(currentFold, angles, assignments, parts, cycle, feedback);
    const signature = foldGeometrySignature(fold);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(fold);
  }
  return candidates;
}
