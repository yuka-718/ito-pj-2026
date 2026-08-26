const EPSILON = 1e-8;
const KEY_PRECISION = 1_000_000;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finitePoint(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(Number(value[0]))
    && Number.isFinite(Number(value[1]));
}

function cleanPoint(value) {
  return [clamp(Number(value[0])), clamp(Number(value[1]))];
}

function quantize(value) {
  return Math.round(value * KEY_PRECISION) / KEY_PRECISION;
}

function pointKey([x, y]) {
  return `${quantize(x)},${quantize(y)}`;
}

function normalizedEndpoints(action) {
  const a = cleanPoint(action.a);
  const b = cleanPoint(action.b);
  return pointKey(a) <= pointKey(b) ? [a, b] : [b, a];
}

function onBoundary([x, y], tolerance = EPSILON) {
  return Math.min(Math.abs(x), Math.abs(1 - x), Math.abs(y), Math.abs(1 - y)) <= tolerance;
}

function strictlyInside([x, y], tolerance = EPSILON) {
  return x > tolerance && x < 1 - tolerance && y > tolerance && y < 1 - tolerance;
}

function distanceToLine(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length <= EPSILON) return Number.POSITIVE_INFINITY;
  return Math.abs(dx * (start[1] - point[1]) - (start[0] - point[0]) * dy) / length;
}

function projection(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
}

function foldBounds(fold) {
  const coords = Array.isArray(fold?.vertices_coords) ? fold.vertices_coords : [];
  const finite = coords.filter(finitePoint).map(([x, y]) => [Number(x), Number(y)]);
  if (!finite.length) return { minX: 0, minY: 0, scale: 1 };
  const xs = finite.map(([x]) => x);
  const ys = finite.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, minY, scale: Math.max(maxX - minX, maxY - minY, EPSILON) };
}

function normalizedFoldPoint(point, bounds) {
  return [
    (Number(point[0]) - bounds.minX) / bounds.scale,
    (Number(point[1]) - bounds.minY) / bounds.scale,
  ];
}

function creaseSegments(fold) {
  const coords = Array.isArray(fold?.vertices_coords) ? fold.vertices_coords : [];
  const edges = Array.isArray(fold?.edges_vertices) ? fold.edges_vertices : [];
  const assignments = Array.isArray(fold?.edges_assignment) ? fold.edges_assignment : [];
  const bounds = foldBounds(fold);
  return edges.flatMap((edge, index) => {
    if (assignments[index] === "B" || !Array.isArray(edge) || edge.length !== 2) return [];
    const a = coords[edge[0]];
    const b = coords[edge[1]];
    if (!finitePoint(a) || !finitePoint(b)) return [];
    return [[normalizedFoldPoint(a, bounds), normalizedFoldPoint(b, bounds)]];
  });
}

function geometryAlreadyPresent(fold, action, tolerance = 1e-6) {
  if (!fold) return false;
  const [start, end] = normalizedEndpoints(action);
  const intervals = creaseSegments(fold).flatMap(([a, b]) => {
    if (distanceToLine(a, start, end) > tolerance || distanceToLine(b, start, end) > tolerance) return [];
    const from = Math.max(0, Math.min(projection(a, start, end), projection(b, start, end)));
    const to = Math.min(1, Math.max(projection(a, start, end), projection(b, start, end)));
    return to - from > tolerance ? [[from, to]] : [];
  }).sort((a, b) => a[0] - b[0]);
  if (!intervals.length) return false;
  let covered = 0;
  for (const [from, to] of intervals) {
    if (from > covered + tolerance) return false;
    covered = Math.max(covered, to);
    if (covered >= 1 - tolerance) return true;
  }
  return false;
}

export function canonicalCreaseGeometryKey(action) {
  if (!finitePoint(action?.a) || !finitePoint(action?.b)) return "invalid";
  const [a, b] = normalizedEndpoints(action);
  return `${pointKey(a)}:${pointKey(b)}`;
}

export function canonicalCreaseActionKey(action) {
  return `${canonicalCreaseGeometryKey(action)}:${action?.assignment === "V" ? "V" : "M"}`;
}

export function validateFullWidthCreaseAction(action, fold = null) {
  const issues = [];
  if (action?.type !== "add_crease") issues.push("action type must be add_crease");
  if (!finitePoint(action?.a) || !finitePoint(action?.b)) {
    issues.push("crease endpoints must be finite points");
    return { valid: false, issues };
  }
  const a = [Number(action.a[0]), Number(action.a[1])];
  const b = [Number(action.b[0]), Number(action.b[1])];
  if (![...a, ...b].every((value) => value >= -EPSILON && value <= 1 + EPSILON)) {
    issues.push("crease endpoints must stay inside the normalized square");
  }
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON) issues.push("crease must not have zero length");
  if (!onBoundary(a) || !onBoundary(b)) issues.push("a full-width crease must end on the paper boundary");
  if (!strictlyInside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) {
    issues.push("crease must cross the paper interior rather than follow its boundary");
  }
  if (action.assignment !== "M" && action.assignment !== "V") {
    issues.push("crease assignment must be M or V");
  }
  if (!issues.length && geometryAlreadyPresent(fold, action)) issues.push("crease geometry already exists");
  return { valid: issues.length === 0, issues };
}

function baseGeometries(depth) {
  const dyadic = [0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875];
  const offset = Math.max(0, Math.min(dyadic.length - 1, Math.floor(depth / 2)));
  const positions = [...dyadic.slice(offset), ...dyadic.slice(0, offset)];
  const geometries = [];
  for (const value of positions) {
    geometries.push([[value, 0], [value, 1]]);
    geometries.push([[0, value], [1, value]]);
  }
  geometries.push([[0, 0], [1, 1]], [[0, 1], [1, 0]]);
  for (const value of positions.slice(0, 4)) {
    geometries.push([[0, value], [1, 1 - value]]);
    geometries.push([[value, 0], [1 - value, 1]]);
  }
  return geometries;
}

function lineAngle(action) {
  return Math.atan2(action.b[1] - action.a[1], action.b[0] - action.a[0]);
}

function angularDistance(a, b) {
  const halfTurn = Math.PI;
  const difference = Math.abs(((a - b) % halfTurn + halfTurn) % halfTurn);
  return Math.min(difference, halfTurn - difference);
}

export function enumerateFullWidthCreaseActions({
  fold,
  depth = 0,
  focus = null,
  goal = null,
  triedActionKeys = [],
} = {}) {
  const goalParts = Array.isArray(goal?.parts)
    ? [...goal.parts].filter((part) => part && typeof part === "object").sort((a, b) =>
      Number(b.importance ?? 0) - Number(a.importance ?? 0)
      || String(a.label ?? "").localeCompare(String(b.label ?? "")))
    : [];
  const selectedPart = focus ?? (goalParts.length ? goalParts[depth % goalParts.length] : null);
  const tried = new Set(triedActionKeys);
  const geometries = new Map();
  for (const [a, b] of baseGeometries(depth)) {
    const probe = { type: "add_crease", a, b, assignment: "M" };
    geometries.set(canonicalCreaseGeometryKey(probe), [a, b]);
  }
  const targetAngle = Number.isFinite(Number(selectedPart?.direction))
    ? Number(selectedPart.direction) * Math.PI / 180
    : null;
  const actions = [];
  for (const [a, b] of geometries.values()) {
    for (const assignment of depth % 2 === 0 ? ["V", "M"] : ["M", "V"]) {
      const action = {
        id: "",
        type: "add_crease",
        a: [quantize(a[0]), quantize(a[1])],
        b: [quantize(b[0]), quantize(b[1])],
        assignment,
        targetPart: typeof selectedPart?.part === "string"
          ? selectedPart.part.slice(0, 40)
          : typeof selectedPart?.label === "string" ? selectedPart.label.slice(0, 40) : null,
        construction: "normalized_full_width_line",
        rationale: typeof selectedPart?.rationale === "string"
          ? selectedPart.rationale.slice(0, 240)
          : typeof selectedPart?.label === "string" ? `${selectedPart.label}の輪郭を整える` : "",
      };
      action.id = `crease-${canonicalCreaseActionKey(action).replace(/[^0-9A-Za-z:.,-]/g, "")}`;
      const key = canonicalCreaseActionKey(action);
      if (tried.has(key) || !validateFullWidthCreaseAction(action, fold).valid) continue;
      actions.push(action);
    }
  }
  return actions.sort((a, b) => {
    if (targetAngle != null) {
      const distance = angularDistance(lineAngle(a), targetAngle) - angularDistance(lineAngle(b), targetAngle);
      if (Math.abs(distance) > 1e-12) return distance;
    }
    return canonicalCreaseActionKey(a).localeCompare(canonicalCreaseActionKey(b));
  });
}

export function createSquareRootFold(source = null) {
  const sourceTitle = typeof source?.file_title === "string" && source.file_title.trim()
    ? source.file_title.trim()
    : "Origami step search";
  return {
    file_spec: 1.2,
    file_creator: "ORIAI step search",
    file_title: `${sourceTitle} — square root`,
    file_description: "Square root state for incremental crease search.",
    file_classes: ["singleModel"],
    frame_title: "Step 0",
    frame_classes: ["creasePattern"],
    frame_attributes: ["2D"],
    frame_unit: "unit",
    vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
    edges_assignment: ["B", "B", "B", "B"],
    edges_foldAngle: [0, 0, 0, 0],
    "edges_mitou:semanticPart": [null, null, null, null],
    "mitou:stepLineage": {
      kind: "root",
      parentNodeId: null,
      depth: 0,
      action: null,
      sequentialPhysicalFolding: false,
      physicalScope: "oriedita_flat_fold_2d",
    },
  };
}

export function attachAddCreaseLineage(fold, { parentNodeId, depth, action }) {
  const validation = validateFullWidthCreaseAction(action);
  if (!validation.valid) throw new Error(`Invalid add_crease lineage: ${validation.issues.join("; ")}`);
  const document = structuredClone(fold);
  document["mitou:stepLineage"] = {
    kind: "add_crease",
    parentNodeId,
    depth,
    action: {
      id: action.id || null,
      type: "add_crease",
      a: cleanPoint(action.a).map(quantize),
      b: cleanPoint(action.b).map(quantize),
      assignment: action.assignment,
      targetPart: action.targetPart ?? null,
      construction: action.construction ?? "normalized_full_width_line",
      rationale: action.rationale ?? "",
      key: canonicalCreaseActionKey(action),
    },
    sequentialPhysicalFolding: false,
    physicalScope: "oriedita_flat_fold_2d",
  };
  return document;
}
