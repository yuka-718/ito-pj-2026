import {
  attachAddCreaseLineage,
  canonicalCreaseActionKey,
  canonicalCreaseGeometryKey,
  createSquareRootFold,
  enumerateFullWidthCreaseActions,
} from "./crease-actions.mjs";

function clampScore(value) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function nodeId(parentId, depth, action) {
  return `step-${String(depth).padStart(2, "0")}-${hashString(`${parentId}:${canonicalCreaseActionKey(action)}`)}`;
}

function normalizePhysical(value, simulationError = null) {
  const physical = value && typeof value === "object" ? structuredClone(value) : {};
  const failures = Array.isArray(physical.hardFailures)
    ? physical.hardFailures.filter(Boolean).map(String)
    : Number.isFinite(Number(physical.hardFailures))
      ? Array.from({ length: Math.max(0, Number(physical.hardFailures)) }, (_, index) => `hard_failure_${index + 1}`)
      : [];
  if (physical.completed === false) failures.push("oriedita_fold_not_completed");
  if (simulationError) failures.push(simulationError);
  return {
    ...physical,
    completed: simulationError ? false : physical.completed !== false,
    hardFailures: [...new Set(failures)],
    score: clampScore(physical.score ?? (failures.length ? 0 : 100)),
    foldabilityScore: clampScore(physical.foldabilityScore ?? physical.foldability ?? 50),
    physicalScope: "oriedita_flat_fold_2d",
    sequentialPhysicalFolding: false,
  };
}

function normalizeJudgeResults(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.candidates)) return value.candidates;
  if (value instanceof Map) return [...value.entries()].map(([id, evaluation]) => ({ id, ...evaluation }));
  if (value && typeof value === "object") {
    return Object.entries(value).map(([id, evaluation]) => ({ id, ...(evaluation ?? {}) }));
  }
  return [];
}

function applyJudgements(nodes, value) {
  const byId = new Map(normalizeJudgeResults(value).map((entry) => [entry.id, entry]));
  for (const node of nodes) {
    const judgement = byId.get(node.id) ?? {};
    const targetScore = clampScore(judgement.targetScore ?? judgement.score);
    node.target = {
      ...structuredClone(judgement),
      score: targetScore,
      targetScore,
      deltaFromParent: 0,
      issues: Array.isArray(judgement.issues) ? judgement.issues.filter(Boolean).map(String).slice(0, 12) : [],
    };
  }
}

function dominates(a, b) {
  const aScores = [a.target.score, a.physical.score, a.physical.foldabilityScore];
  const bScores = [b.target.score, b.physical.score, b.physical.foldabilityScore];
  return aScores.every((score, index) => score >= bScores[index])
    && aScores.some((score, index) => score > bScores[index]);
}

function compareNodes(a, b) {
  return b.target.score - a.target.score
    || b.physical.score - a.physical.score
    || b.physical.foldabilityScore - a.physical.foldabilityScore
    || b.depth - a.depth
    || a.id.localeCompare(b.id);
}

export function selectParetoFrontier(nodes, limit = 2) {
  const viable = nodes.filter((node) => node.physical.hardFailures.length === 0);
  const pareto = viable.filter((node) => !viable.some((other) => other !== node && dominates(other, node)));
  const selected = [...pareto].sort(compareNodes).slice(0, limit);
  if (selected.length < Math.min(limit, viable.length)) {
    const selectedIds = new Set(selected.map(({ id }) => id));
    selected.push(...viable.filter((node) => !selectedIds.has(node.id)).sort(compareNodes).slice(0, limit - selected.length));
  }
  return selected;
}

export function selectDiverseCreaseActions(actions, limit = 3) {
  const source = Array.isArray(actions) ? actions : [];
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const selected = [];
  const selectedKeys = new Set();
  const geometries = new Set();
  for (const action of source) {
    const geometry = canonicalCreaseGeometryKey(action);
    if (geometries.has(geometry)) continue;
    selected.push(action);
    selectedKeys.add(canonicalCreaseActionKey(action));
    geometries.add(geometry);
    if (selected.length >= boundedLimit) return selected;
  }
  for (const action of source) {
    const key = canonicalCreaseActionKey(action);
    if (selectedKeys.has(key)) continue;
    selected.push(action);
    if (selected.length >= boundedLimit) break;
  }
  return selected;
}

export function buildBestPath(manifest, nodeIdValue = manifest.bestNodeId) {
  const nodes = [];
  const seen = new Set();
  let current = manifest.nodes[nodeIdValue];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.action) nodes.push(current);
    current = current.parentId ? manifest.nodes[current.parentId] : null;
  }
  return nodes.reverse().map((node) => ({
    nodeId: node.id,
    parentId: node.parentId,
    depth: node.depth,
    action: structuredClone(node.action),
    targetScore: node.target.score,
    physicalScore: node.physical.score,
  }));
}

function focusFor(node) {
  const focus = node.target?.nextFocus;
  if (!focus || typeof focus !== "object") return null;
  return {
    part: typeof focus.part === "string" ? focus.part : null,
    direction: Number.isFinite(Number(focus.direction)) ? Number(focus.direction) : null,
    rationale: typeof focus.rationale === "string" ? focus.rationale : "",
  };
}

function createManifest({ rootFold, goal, maxDepth, branchFactor, beamWidth, targetScore, now }) {
  const rootId = `step-00-${hashString(JSON.stringify(rootFold.vertices_coords))}`;
  const root = {
    id: rootId,
    parentId: null,
    depth: 0,
    action: null,
    status: "frontier",
    fold: rootFold,
    artifacts: {},
    physical: normalizePhysical({ completed: true, score: 100, foldabilityScore: 100 }),
    target: { score: 0, targetScore: 0, deltaFromParent: 0, issues: [] },
    children: [],
    triedActionKeys: [],
    availableActions: null,
    createdAt: now(),
  };
  return {
    schema: "oriai-step-search-v1",
    goal: structuredClone(goal ?? {}),
    settings: { maxDepth, branchFactor, beamWidth, targetScore },
    rootNodeId: rootId,
    frontierIds: [rootId],
    bestNodeId: rootId,
    bestPath: [],
    nodes: { [rootId]: root },
    events: [],
    expandedCount: 0,
    evaluatedNodes: 0,
    rollbackCount: 0,
    stopReason: null,
    sequentialPhysicalFolding: false,
    physicalScope: "oriedita_flat_fold_2d",
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function runStepSearch({
  rootFold: sourceFold = null,
  goal = {},
  maxDepth = 10,
  branchFactor = 3,
  beamWidth = 2,
  targetScore = 85,
  enumerateActions = enumerateFullWidthCreaseActions,
  simulate,
  judge,
  persist = async () => {},
  now = () => new Date().toISOString(),
} = {}) {
  if (typeof simulate !== "function") throw new TypeError("simulate must be a function");
  if (typeof judge !== "function") throw new TypeError("judge must be a function");
  if (typeof persist !== "function") throw new TypeError("persist must be a function");
  const settings = {
    maxDepth: Math.max(1, Math.min(10, Math.floor(Number(maxDepth) || 10))),
    branchFactor: Math.max(1, Math.min(3, Math.floor(Number(branchFactor) || 3))),
    beamWidth: Math.max(1, Math.min(2, Math.floor(Number(beamWidth) || 2))),
    targetScore: clampScore(targetScore),
  };
  const rootFold = createSquareRootFold(sourceFold);
  const manifest = createManifest({ rootFold, goal, ...settings, now });
  let frontier = [manifest.nodes[manifest.rootNodeId]];
  let stopReason = "frontier_exhausted";
  const expansionBudget = settings.maxDepth * settings.beamWidth * 2;

  const emit = async (type, details = {}, node = null) => {
    const event = {
      sequence: manifest.events.length + 1,
      type,
      at: now(),
      ...structuredClone(details),
    };
    manifest.events.push(event);
    manifest.updatedAt = event.at;
    await persist({ type, event, node, manifest });
  };

  await emit("root_created", { nodeId: manifest.rootNodeId }, manifest.nodes[manifest.rootNodeId]);

  while (frontier.length && manifest.expandedCount < expansionBudget) {
    const children = [];
    const expandedParents = [];
    for (const parent of frontier) {
      if (parent.depth >= settings.maxDepth) continue;
      if (!parent.availableActions) {
        parent.availableActions = await enumerateActions({
          fold: parent.fold,
          node: parent,
          goal: manifest.goal,
          depth: parent.depth,
          focus: focusFor(parent),
          triedActionKeys: parent.triedActionKeys,
        });
      }
      const tried = new Set(parent.triedActionKeys);
      const actions = selectDiverseCreaseActions(
        (Array.isArray(parent.availableActions) ? parent.availableActions : [])
          .filter((action) => !tried.has(canonicalCreaseActionKey(action))),
        settings.branchFactor,
      );
      if (!actions.length) {
        parent.status = "dead_end";
        await emit("dead_end", { nodeId: parent.id }, parent);
        continue;
      }
      expandedParents.push(parent);
      parent.status = "expanded";
      parent.triedActionKeys.push(...actions.map(canonicalCreaseActionKey));
      manifest.expandedCount += 1;
      await emit("expand", { nodeId: parent.id, actionIds: actions.map((action) => action.id) }, parent);

      for (const action of actions) {
        const id = nodeId(parent.id, parent.depth + 1, action);
        let simulation;
        let errorMessage = null;
        try {
          simulation = await simulate({
            id,
            parent,
            action: structuredClone(action),
            depth: parent.depth + 1,
            goal: manifest.goal,
            manifest,
          });
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          simulation = {};
        }
        const physical = normalizePhysical(simulation?.physical, errorMessage);
        const fold = simulation?.fold
          ? attachAddCreaseLineage(simulation.fold, { parentNodeId: parent.id, depth: parent.depth + 1, action })
          : null;
        const child = {
          id,
          parentId: parent.id,
          depth: parent.depth + 1,
          action: structuredClone(action),
          status: physical.hardFailures.length ? "pruned" : "evaluated",
          fold,
          artifacts: structuredClone(simulation?.artifacts ?? {}),
          physical,
          target: { score: 0, targetScore: 0, deltaFromParent: 0, issues: [] },
          children: [],
          triedActionKeys: [],
          availableActions: null,
          createdAt: now(),
        };
        manifest.nodes[id] = child;
        parent.children.push(id);
        manifest.evaluatedNodes += 1;
        await emit("simulated", { nodeId: id, parentId: parent.id, hardFailures: physical.hardFailures }, child);
        if (physical.hardFailures.length) {
          await emit("prune", { nodeId: id, reason: "hard_physical_failure", issues: physical.hardFailures }, child);
        } else {
          children.push(child);
        }
      }
    }

    if (children.length) {
      const judgements = await judge({
        parents: expandedParents,
        candidates: children,
        goal: manifest.goal,
        manifest,
      });
      applyJudgements(children, judgements);
      for (const child of children) {
        const parent = manifest.nodes[child.parentId];
        child.target.deltaFromParent = child.target.score - (parent?.target.score ?? 0);
        await emit("evaluated", {
          nodeId: child.id,
          targetScore: child.target.score,
          deltaFromParent: child.target.deltaFromParent,
        }, child);
      }
      const survivors = selectParetoFrontier(children, settings.beamWidth);
      const survivorIds = new Set(survivors.map(({ id }) => id));
      for (const child of children) {
        child.status = survivorIds.has(child.id) ? "frontier" : "pruned";
        if (!survivorIds.has(child.id)) {
          await emit("prune", { nodeId: child.id, reason: "beam_or_pareto" }, child);
        }
      }
      frontier = survivors;
      manifest.frontierIds = survivors.map(({ id }) => id);
      const bestCandidate = [...survivors, manifest.nodes[manifest.bestNodeId]].sort(compareNodes)[0];
      manifest.bestNodeId = bestCandidate.id;
      manifest.bestPath = buildBestPath(manifest);
      await emit("select", {
        frontierIds: manifest.frontierIds,
        bestNodeId: manifest.bestNodeId,
      }, bestCandidate);
      const goalNode = survivors.find((node) => node.target.score >= settings.targetScore);
      if (goalNode) {
        goalNode.status = "goal";
        manifest.bestNodeId = goalNode.id;
        manifest.bestPath = buildBestPath(manifest);
        stopReason = "target_score_reached";
        await emit("goal", { nodeId: goalNode.id, targetScore: goalNode.target.score }, goalNode);
        break;
      }
      if (survivors.every((node) => node.depth >= settings.maxDepth)) {
        stopReason = "max_depth_reached";
        break;
      }
      continue;
    }

    const rollbackCandidates = Object.values(manifest.nodes).filter((node) => {
      if (!node.fold || node.depth >= settings.maxDepth || !Array.isArray(node.availableActions)) return false;
      const tried = new Set(node.triedActionKeys);
      return node.availableActions.some((action) => !tried.has(canonicalCreaseActionKey(action)));
    }).sort(compareNodes);
    const rollback = rollbackCandidates[0];
    if (!rollback) break;
    manifest.rollbackCount += 1;
    rollback.status = "frontier";
    frontier = [rollback];
    manifest.frontierIds = [rollback.id];
    await emit("rollback", {
      fromNodeIds: expandedParents.map(({ id }) => id),
      toNodeId: rollback.id,
      rollbackCount: manifest.rollbackCount,
    }, rollback);
  }

  if (manifest.expandedCount >= expansionBudget && stopReason === "frontier_exhausted") {
    stopReason = "expansion_budget_reached";
  }
  if (stopReason === "frontier_exhausted" && Object.values(manifest.nodes).some((node) => node.depth >= settings.maxDepth)) {
    stopReason = "max_depth_reached";
  }
  manifest.stopReason = stopReason;
  manifest.frontierIds = frontier.map(({ id }) => id);
  manifest.bestPath = buildBestPath(manifest);
  manifest.updatedAt = now();
  await emit("complete", {
    stopReason,
    bestNodeId: manifest.bestNodeId,
    bestPathNodeIds: manifest.bestPath.map(({ nodeId: id }) => id),
  }, manifest.nodes[manifest.bestNodeId]);
  return {
    manifest,
    bestNode: manifest.nodes[manifest.bestNodeId],
    bestPath: manifest.bestPath,
    stopReason,
  };
}
