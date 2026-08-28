import type { Part, Point } from "./origami-engine";

export type FoldAssignment = "B" | "M" | "V" | "F" | "U";

export type FoldDocument = {
  file_spec?: number;
  file_creator?: string;
  file_title?: string;
  file_description?: string;
  file_classes?: string[];
  frame_title?: string;
  frame_classes?: string[];
  frame_attributes?: string[];
  frame_unit?: string;
  vertices_coords: number[][];
  edges_vertices: [number, number][];
  edges_assignment: FoldAssignment[];
  edges_foldAngle?: Array<number | null>;
  faces_vertices: number[][];
  [key: string]: unknown;
};

export type ShapingOperation = {
  id: string;
  kind: "base_angle" | "simple_fold" | "narrowing";
  partId: string | null;
  partLabel: string;
  edgeIds: string[];
  targetAnglesDeg: number[];
  instructionJa: string;
};

export type FinalStateStageId = "angle-preview" | "simple-fold" | "narrowing";

export type FinalStateStage = {
  id: FinalStateStageId;
  phase: 2 | 3 | 4;
  title: string;
  shortTitle: string;
  description: string;
  fold: FoldDocument;
  foldFile: string;
  operations: ShapingOperation[];
  angleSummary: {
    activeCreases: number;
    minimumDeg: number;
    maximumDeg: number;
  };
  validation: {
    graph: "same_cp";
    rendering: "zero_thickness_preview";
    collision: "unchecked";
    paperThickness: "unchecked";
  };
};

export type COrigamiFinalState = {
  schema: "oriai-corigami-final-state-v1";
  generator: "corigami-inspired-clean-room";
  sourceTitle: string;
  cpHash: string;
  angleConvention: "degree:absolute:M-negative:V-positive";
  stages: FinalStateStage[];
  limitations: string[];
};

const TAU = Math.PI * 2;

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cloneFold(fold: FoldDocument) {
  return JSON.parse(JSON.stringify(fold)) as FoldDocument;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeAngle(angle: number) {
  return ((angle % TAU) + TAU) % TAU;
}

function angularDistance(a: number, b: number) {
  const difference = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(difference, TAU - difference);
}

function edgeKey(fold: FoldDocument, edgeIndex: number) {
  const edge = fold.edges_vertices[edgeIndex];
  const points = edge
    .map((vertex) => fold.vertices_coords[vertex].slice(0, 2).map((value) => round(value, 9)).join(","))
    .sort();
  return points.join(":");
}

function stableEdgeIds(fold: FoldDocument) {
  const supplied = fold["edges_oriai:id"];
  if (Array.isArray(supplied) && supplied.length === fold.edges_vertices.length
    && supplied.every((value) => typeof value === "string")) {
    return supplied as string[];
  }
  return fold.edges_vertices.map((_, index) =>
    `edge-${hashString(edgeKey(fold, index)).toString(16).padStart(8, "0")}`
  );
}

function semanticParts(fold: FoldDocument) {
  const supplied = fold["edges_mitou:semanticPart"];
  if (!Array.isArray(supplied) || supplied.length !== fold.edges_vertices.length) {
    return fold.edges_vertices.map(() => null);
  }
  return supplied.map((value) => typeof value === "string" ? value : null);
}

function creaseIndices(fold: FoldDocument) {
  return fold.edges_assignment.flatMap((assignment, index) =>
    assignment === "M" || assignment === "V" ? [index] : []
  );
}

function creaseAngleFromCenter(fold: FoldDocument, edgeIndex: number, center: Point) {
  const [a, b] = fold.edges_vertices[edgeIndex];
  const pa = fold.vertices_coords[a];
  const pb = fold.vertices_coords[b];
  const distanceA = Math.hypot(pa[0] - center[0], pa[1] - center[1]);
  const distanceB = Math.hypot(pb[0] - center[0], pb[1] - center[1]);
  const tip = distanceA >= distanceB ? pa : pb;
  return normalizeAngle(Math.atan2(tip[1] - center[1], tip[0] - center[0]));
}

function graphCenter(fold: FoldDocument): Point {
  const incidence = Array.from({ length: fold.vertices_coords.length }, () => 0);
  fold.edges_vertices.forEach(([a, b], index) => {
    if (!["M", "V"].includes(fold.edges_assignment[index])) return;
    incidence[a] += 1;
    incidence[b] += 1;
  });
  const centerIndex = incidence.reduce(
    (best, value, index) => value > incidence[best] ? index : best,
    0,
  );
  return fold.vertices_coords[centerIndex].slice(0, 2) as Point;
}

function assignmentForAngle(angle: number): FoldAssignment {
  return angle < 0 ? "M" : "V";
}

function setAngle(fold: FoldDocument, edgeIndex: number, angle: number) {
  if (!fold.edges_foldAngle) fold.edges_foldAngle = fold.edges_assignment.map(() => 0);
  fold.edges_foldAngle[edgeIndex] = round(angle, 3);
  fold.edges_assignment[edgeIndex] = assignmentForAngle(angle);
}

function initialPreviewAngles(fold: FoldDocument) {
  const angles = fold.edges_assignment.map((assignment, index) => {
    if (assignment !== "M" && assignment !== "V") return assignment === "F" ? 0 : null;
    const source = fold.edges_foldAngle?.[index];
    const sign = assignment === "M" ? -1 : 1;
    const sourceMagnitude = typeof source === "number" && source !== 0 ? Math.abs(source) : 180;
    return round(sign * clamp(sourceMagnitude * 0.48, 56, 92), 3);
  });
  fold.edges_foldAngle = angles;
}

function labelMagnitude(label: string, importance: number) {
  if (/首|neck|頭|head|耳|ear|大あご|jaw/i.test(label)) return 74 + importance * 5;
  if (/翼|wing|羽|ひれ|fin|花びら|petal/i.test(label)) return 44 + importance * 5;
  if (/脚|leg|足|tail|尾/i.test(label)) return 62 + importance * 5;
  return 50 + importance * 4;
}

function simpleFoldTargets(
  fold: FoldDocument,
  parts: Part[],
  partByEdge: Array<string | null>,
  edgeIds: string[],
) {
  const operations: ShapingOperation[] = [];
  const creases = creaseIndices(fold);
  const used = new Set<number>();
  const rankedParts = [...parts]
    .filter((part) => !/胴体|中心|body|center/i.test(part.label))
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
    .slice(0, 4);

  rankedParts.forEach((part, operationIndex) => {
    const matching = creases.filter((edgeIndex) => partByEdge[edgeIndex] === part.label && !used.has(edgeIndex));
    const edgeIndex = matching[0] ?? creases.find((index) => !used.has(index));
    if (edgeIndex == null) return;
    used.add(edgeIndex);
    const sign = fold.edges_assignment[edgeIndex] === "M" ? -1 : 1;
    const target = sign * labelMagnitude(part.label, part.importance);
    setAngle(fold, edgeIndex, target);
    operations.push({
      id: `simple-${operationIndex + 1}-${part.id}`,
      kind: "simple_fold",
      partId: part.id,
      partLabel: part.label,
      edgeIds: [edgeIds[edgeIndex]],
      targetAnglesDeg: [round(target, 3)],
      instructionJa: `${part.label}の付け根を${Math.round(Math.abs(target))}°のsimple foldで姿勢調整`,
    });
  });
  return operations;
}

function narrowingTargets(
  fold: FoldDocument,
  parts: Part[],
  edgeIds: string[],
) {
  const operations: ShapingOperation[] = [];
  const creases = creaseIndices(fold);
  const center = graphCenter(fold);
  const angleByEdge = new Map(creases.map((edgeIndex) => [edgeIndex, creaseAngleFromCenter(fold, edgeIndex, center)]));
  const usedPairs = new Set<string>();
  const targets = [...parts]
    .filter((part) => part.importance >= 3 && !/胴体|中心|body|center/i.test(part.label))
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
    .slice(0, 3);

  targets.forEach((part, operationIndex) => {
    const targetDirection = normalizeAngle((part.direction * Math.PI) / 180);
    const nearest = [...creases]
      .sort((a, b) =>
        angularDistance(angleByEdge.get(a) ?? 0, targetDirection)
        - angularDistance(angleByEdge.get(b) ?? 0, targetDirection)
      )
      .slice(0, 2)
      .sort((a, b) => (angleByEdge.get(a) ?? 0) - (angleByEdge.get(b) ?? 0));
    if (nearest.length < 2) return;
    const pairKey = [...nearest].sort((a, b) => a - b).join(":");
    if (usedPairs.has(pairKey)) return;
    usedPairs.add(pairKey);
    const magnitude = clamp(84 + part.importance * 8, 96, 126);
    const angles = [-magnitude, magnitude];
    nearest.forEach((edgeIndex, index) => setAngle(fold, edgeIndex, angles[index]));
    operations.push({
      id: `narrow-${operationIndex + 1}-${part.id}`,
      kind: "narrowing",
      partId: part.id,
      partLabel: part.label,
      edgeIds: nearest.map((edgeIndex) => edgeIds[edgeIndex]),
      targetAnglesDeg: angles,
      instructionJa: `${part.label}を山谷1組のnarrowingで細く整える`,
    });
  });
  return operations;
}

function angleSummary(fold: FoldDocument) {
  const active = (fold.edges_foldAngle ?? []).filter((angle): angle is number =>
    typeof angle === "number" && Math.abs(angle) > 0.001
  ).map(Math.abs);
  return {
    activeCreases: active.length,
    minimumDeg: active.length ? Math.round(Math.min(...active)) : 0,
    maximumDeg: active.length ? Math.round(Math.max(...active)) : 0,
  };
}

function stageDocument(
  source: FoldDocument,
  id: FinalStateStageId,
  phase: 2 | 3 | 4,
  title: string,
  operations: ShapingOperation[],
  edgeIds: string[],
) {
  const fold = cloneFold(source);
  fold.file_title = `${source.file_title ?? "ORIAI model"} — ${title}`;
  fold.frame_title = title;
  fold.frame_classes = ["foldedForm"];
  fold.frame_attributes = ["3D"];
  fold["edges_oriai:id"] = edgeIds;
  fold["edges_oriai:stage"] = fold.edges_assignment.map((assignment) => assignment === "B" ? "base" : id);
  fold["oriai:stage"] = {
    schema: "oriai-final-state-stage-v1",
    id,
    phase,
    angleConvention: "degree:absolute:M-negative:V-positive",
    operations,
    validation: {
      graph: "same_cp",
      rendering: "zero_thickness_preview",
      collision: "unchecked",
      paperThickness: "unchecked",
    },
  };
  return fold;
}

function makeStage(
  fold: FoldDocument,
  id: FinalStateStageId,
  phase: 2 | 3 | 4,
  title: string,
  shortTitle: string,
  description: string,
  operations: ShapingOperation[],
): FinalStateStage {
  return {
    id,
    phase,
    title,
    shortTitle,
    description,
    fold,
    foldFile: foldToDataUrl(fold),
    operations,
    angleSummary: angleSummary(fold),
    validation: {
      graph: "same_cp",
      rendering: "zero_thickness_preview",
      collision: "unchecked",
      paperThickness: "unchecked",
    },
  };
}

export function foldToDataUrl(fold: FoldDocument) {
  const bytes = new TextEncoder().encode(JSON.stringify(fold));
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:application/json;base64,${btoa(binary)}`;
}

export function foldFromDataUrl(dataUrl: string | null | undefined) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:application\/json;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  try {
    const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    const fold = JSON.parse(new TextDecoder().decode(bytes)) as FoldDocument;
    if (!Array.isArray(fold.vertices_coords)
      || !Array.isArray(fold.edges_vertices)
      || !Array.isArray(fold.edges_assignment)
      || !Array.isArray(fold.faces_vertices)) return null;
    return fold;
  } catch {
    return null;
  }
}

export function createCOrigamiFinalState(
  sourceFold: FoldDocument,
  parts: Part[],
  sourceTitle: string,
): COrigamiFinalState {
  const source = cloneFold(sourceFold);
  if (source.edges_vertices.length !== source.edges_assignment.length || !source.faces_vertices.length) {
    throw new Error("段階プレビューに必要なFOLDの辺または面情報が不足しています");
  }
  const edgeIds = stableEdgeIds(source);
  const partByEdge = semanticParts(source);
  const cpHash = hashString(JSON.stringify([
    source.vertices_coords.map((point) => point.slice(0, 2).map((value) => round(value, 9))),
    source.edges_vertices,
  ])).toString(16).padStart(8, "0");

  const angleBase = cloneFold(source);
  initialPreviewAngles(angleBase);
  const baseOperations: ShapingOperation[] = [{
    id: "base-angle-preview",
    kind: "base_angle",
    partId: null,
    partLabel: "base CP",
    edgeIds: creaseIndices(angleBase).map((index) => edgeIds[index]),
    targetAnglesDeg: (angleBase.edges_foldAngle ?? []).filter((angle): angle is number =>
      typeof angle === "number" && Math.abs(angle) > 0.001
    ),
    instructionJa: "平坦折り状態を開き、全hingeへ目標折角を与える",
  }];
  const angleFold = stageDocument(angleBase, "angle-preview", 2, "折角付き3Dプレビュー", baseOperations, edgeIds);

  const simpleSource = cloneFold(angleBase);
  const simpleOperations = simpleFoldTargets(simpleSource, parts, partByEdge, edgeIds);
  const simpleFold = stageDocument(
    simpleSource,
    "simple-fold",
    3,
    "Simple fold 姿勢調整",
    [...baseOperations, ...simpleOperations],
    edgeIds,
  );

  const narrowSource = cloneFold(simpleSource);
  const narrowingOperations = narrowingTargets(narrowSource, parts, edgeIds);
  const narrowedFold = stageDocument(
    narrowSource,
    "narrowing",
    4,
    "Narrowing 細部造形",
    [...baseOperations, ...simpleOperations, ...narrowingOperations],
    edgeIds,
  );

  return {
    schema: "oriai-corigami-final-state-v1",
    generator: "corigami-inspired-clean-room",
    sourceTitle,
    cpHash,
    angleConvention: "degree:absolute:M-negative:V-positive",
    stages: [
      makeStage(
        angleFold,
        "angle-preview",
        2,
        "折角付き3Dプレビュー",
        "折角 3D",
        "base CPの全hingeへ部分折り角を与えた、ゼロ厚み3D状態です。",
        baseOperations,
      ),
      makeStage(
        simpleFold,
        "simple-fold",
        3,
        "Simple foldによる姿勢調整",
        "Simple fold",
        "首・翼・脚など、意味部位の付け根を単純折りで方向づけます。",
        simpleOperations,
      ),
      makeStage(
        narrowedFold,
        "narrowing",
        4,
        "Narrowingによる細部造形",
        "Narrowing",
        "重要な先端部位を山谷の対で絞り、輪郭を細く整えます。",
        narrowingOperations,
      ),
    ],
    limitations: [
      "COrigamiの非公開実装を複製したものではなくclean-roomの限定実装です",
      "3Dはゼロ厚み・全折線同時の角度プレビューです",
      "衝突、紙厚、手の到達可能性、折順は検証していません",
    ],
  };
}
