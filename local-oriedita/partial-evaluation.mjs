import { validateCandidatePool } from "./fast-evaluation.mjs";

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function creaseSegments(fold) {
  const coords = Array.isArray(fold?.vertices_coords) ? fold.vertices_coords : [];
  const edges = Array.isArray(fold?.edges_vertices) ? fold.edges_vertices : [];
  const assignments = Array.isArray(fold?.edges_assignment) ? fold.edges_assignment : [];
  return edges.flatMap((edge, index) => {
    if (!Array.isArray(edge) || !["M", "V"].includes(assignments[index])) return [];
    const a = coords[edge[0]];
    const b = coords[edge[1]];
    if (!Array.isArray(a) || !Array.isArray(b)) return [];
    const dx = Number(b[0]) - Number(a[0]);
    const dy = Number(b[1]) - Number(a[1]);
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 1e-10) return [];
    let angle = Math.atan2(dy, dx) % Math.PI;
    if (angle < 0) angle += Math.PI;
    return [{
      a: [Number(a[0]), Number(a[1])],
      b: [Number(b[0]), Number(b[1])],
      angle,
      length,
    }];
  });
}

function structureProgressProxy(fold, targetCreaseCount) {
  const segments = creaseSegments(fold);
  const target = Math.max(1, Number(targetCreaseCount) || segments.length || 1);
  const coverage = clamp(segments.length / target, 0, 1);
  const orientations = new Set(segments.map(({ angle }) => Math.round(angle / (Math.PI / 36))));
  const diversityTarget = Math.min(6, Math.max(1, target));
  const diversity = clamp(orientations.size / diversityTarget, 0, 1);
  return {
    score: round((coverage * 0.72 + diversity * 0.28) * 100),
    creaseSegmentCount: segments.length,
    targetCreaseCount: target,
    coverage: round(coverage * 100),
    orientationDiversity: round(diversity * 100),
    source: "geometry_only",
  };
}

/**
 * Evaluate an intermediate cumulative crease pattern.
 *
 * Kawasaki and Maekawa are deliberately deferred while the pattern is still
 * being constructed. Oriedita recomputes the whole 2D flat-folded projection;
 * this does not claim to advance a persistent physical 3D paper state.
 */
export function evaluatePartialFold({
  fold,
  goal,
  action = null,
  orieditaCompleted = false,
  targetCreaseCount = null,
  finalStep = false,
}) {
  const preflight = validateCandidatePool([fold], goal);
  const validations = preflight.validations;
  const hardChecks = validations.slice(0, 4);
  const orieditaCheck = {
    name: "oriedita_flat_fold_projection",
    status: orieditaCompleted ? "pass" : "fail",
    passed: Boolean(orieditaCompleted),
    issues: orieditaCompleted ? [] : ["Orieditaの2D平坦折り計算が完了していません"],
  };
  const theoremChecks = validations.slice(4, 6).map((validation) => ({
    name: validation.name,
    status: finalStep
      ? (validation.passed === false ? "fail" : validation.passed === true ? "pass" : "deferred")
      : "deferred",
    passed: finalStep ? validation.passed : null,
    issues: finalStep ? validation.issues : ["途中状態のため最終判定を保留します"],
  }));
  const actionValid = !action || (
    action.type === "add_crease"
    && ["M", "V"].includes(action.assignment)
    && Array.isArray(action.a)
    && Array.isArray(action.b)
    && Math.hypot(action.a[0] - action.b[0], action.a[1] - action.b[1]) > 1e-9
  );
  const actionCheck = {
    name: "single_add_crease_action",
    status: actionValid ? "pass" : "fail",
    passed: actionValid,
    issues: actionValid ? [] : ["一手の折り線操作が不正です"],
  };
  const hardFailures = hardChecks.filter(({ passed }) => passed === false).length
    + (orieditaCheck.passed ? 0 : 1)
    + (actionCheck.passed ? 0 : 1)
    + (finalStep ? theoremChecks.filter(({ passed }) => passed === false).length : 0);
  const structure = structureProgressProxy(fold, targetCreaseCount);
  const foldability = preflight.selectedScores.foldability;
  const physicalBase = hardChecks.reduce((sum, check) => sum + check.score, 0) / Math.max(1, hardChecks.length);
  const physical = round(physicalBase * 0.75 + (orieditaCompleted ? 25 : 0));

  return {
    hardFailures,
    passed: hardFailures === 0,
    checks: [
      ...hardChecks.map((validation) => ({
        name: validation.name,
        status: validation.passed === false ? "fail" : validation.passed === true ? "pass" : "deferred",
        passed: validation.passed,
        issues: validation.issues,
      })),
      actionCheck,
      ...theoremChecks,
      orieditaCheck,
    ],
    scores: {
      physical,
      target: structure.score,
      foldability,
    },
    structure,
    physicalScope: "oriedita_flat_fold_2d",
    stateType: "crease_pattern_prefix",
    actionKind: "add_crease",
    sequentialPhysicalFolding: false,
    sequenceFeasibility: "unverified",
  };
}

