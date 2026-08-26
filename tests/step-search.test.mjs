import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalCreaseActionKey,
  createSquareRootFold,
  enumerateFullWidthCreaseActions,
} from "../local-oriedita/crease-actions.mjs";
import {
  buildBestPath,
  runStepSearch,
  selectDiverseCreaseActions,
  selectParetoFrontier,
} from "../local-oriedita/step-search.mjs";

function simulatedFold(parent, action) {
  const source = parent.fold ?? createSquareRootFold();
  const fold = structuredClone(source);
  const start = fold.vertices_coords.length;
  fold.vertices_coords.push(action.a, action.b);
  fold.edges_vertices.push([start, start + 1]);
  fold.edges_assignment.push(action.assignment);
  return fold;
}

function limitedActions({ fold, depth, triedActionKeys }) {
  return enumerateFullWidthCreaseActions({ fold, depth, triedActionKeys }).slice(0, 8);
}

test("branches across different crease geometries before retrying mountain/valley assignments", () => {
  const actions = enumerateFullWidthCreaseActions({ fold: createSquareRootFold() });
  const selected = selectDiverseCreaseActions(actions, 3);
  const geometry = (action) => [action.a, action.b]
    .map((point) => point.join(","))
    .sort()
    .join(":");
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map(geometry)).size, 3);
});

test("runs injected simulation sequentially with the required bounded defaults", async () => {
  let activeSimulations = 0;
  let maximumConcurrentSimulations = 0;
  const persisted = [];
  const result = await runStepSearch({
    rootFold: { file_title: "カブトムシ" },
    goal: { motif: "beetle" },
    targetScore: 101,
    maxDepth: 2,
    enumerateActions: limitedActions,
    simulate: async ({ parent, action }) => {
      activeSimulations += 1;
      maximumConcurrentSimulations = Math.max(maximumConcurrentSimulations, activeSimulations);
      await new Promise((resolve) => setImmediate(resolve));
      activeSimulations -= 1;
      return {
        fold: simulatedFold(parent, action),
        physical: { completed: true, score: 90, foldabilityScore: 75, hardFailures: [] },
      };
    },
    judge: async ({ candidates }) => candidates.map((candidate, index) => ({
      id: candidate.id,
      targetScore: 45 + candidate.depth * 20 - index,
      issues: [],
    })),
    persist: async ({ event }) => { persisted.push(event.type); },
  });

  assert.equal(maximumConcurrentSimulations, 1);
  assert.deepEqual(result.manifest.settings, {
    maxDepth: 2,
    branchFactor: 3,
    beamWidth: 2,
    targetScore: 100,
  });
  assert.equal(result.manifest.sequentialPhysicalFolding, false);
  assert.equal(result.manifest.physicalScope, "oriedita_flat_fold_2d");
  assert.ok(result.manifest.evaluatedNodes > 3);
  assert.ok(Object.values(result.manifest.nodes).every((node) => node.depth <= 2));
  assert.ok(persisted.includes("simulated"));
  assert.ok(persisted.includes("evaluated"));
  assert.ok(persisted.includes("complete"));
  assert.equal(result.bestPath.length, 2);
  assert.deepEqual(result.bestPath, buildBestPath(result.manifest));
  for (const step of result.bestPath) {
    assert.equal(step.action.type, "add_crease");
    assert.equal(step.depth, result.manifest.nodes[step.parentId].depth + 1);
    const lineage = result.manifest.nodes[step.nodeId].fold["mitou:stepLineage"];
    assert.equal(lineage.action.key, canonicalCreaseActionKey(step.action));
  }
});

test("excludes hard failures, rolls back, and continues with an untried root action", async () => {
  const rootActions = enumerateFullWidthCreaseActions({ fold: createSquareRootFold() }).slice(0, 4);
  const childAction = enumerateFullWidthCreaseActions({ fold: createSquareRootFold(), depth: 1 })[0];
  const expandedRootActions = [];
  const result = await runStepSearch({
    maxDepth: 3,
    targetScore: 95,
    enumerateActions: ({ node }) => {
      if (node.depth === 0) return rootActions;
      return node.triedActionKeys.length ? [] : [childAction];
    },
    simulate: async ({ parent, action }) => {
      if (parent.depth === 0) expandedRootActions.push(canonicalCreaseActionKey(action));
      const firstWaveChild = parent.depth === 1;
      return {
        fold: simulatedFold(parent, action),
        physical: firstWaveChild
          ? { completed: false, score: 0, hardFailures: ["flat fold failed"] }
          : { completed: true, score: 100, foldabilityScore: 80, hardFailures: [] },
      };
    },
    judge: async ({ candidates }) => candidates.map((candidate, index) => ({
      id: candidate.id,
      targetScore: candidate.depth === 1 ? 70 - index : 60,
    })),
    persist: async () => {},
  });

  assert.equal(new Set(expandedRootActions).size, 4);
  assert.ok(result.manifest.rollbackCount >= 1);
  const rollback = result.manifest.events.find(({ type }) => type === "rollback");
  assert.ok(rollback);
  assert.equal(rollback.toNodeId, result.manifest.rootNodeId);
  assert.ok(Object.values(result.manifest.nodes).some((node) =>
    node.status === "pruned" && node.physical.hardFailures.includes("flat fold failed")));
});

test("keeps physically distinct Pareto candidates before applying the beam limit", () => {
  const node = (id, target, physical, foldability) => ({
    id,
    depth: 1,
    target: { score: target },
    physical: { score: physical, foldabilityScore: foldability, hardFailures: [] },
  });
  const targetFirst = node("target-first", 95, 65, 70);
  const physicalFirst = node("physical-first", 80, 100, 90);
  const dominated = node("dominated", 70, 80, 70);
  assert.deepEqual(
    selectParetoFrontier([targetFirst, physicalFirst, dominated], 2).map(({ id }) => id),
    ["target-first", "physical-first"],
  );
});

test("stops on target score and returns an ancestry-ordered best path", async () => {
  const result = await runStepSearch({
    maxDepth: 10,
    targetScore: 75,
    enumerateActions: limitedActions,
    simulate: async ({ parent, action }) => ({
      fold: simulatedFold(parent, action),
      physical: { completed: true, score: 100, foldabilityScore: 90, hardFailures: [] },
    }),
    judge: async ({ candidates }) => candidates.map((candidate) => ({
      id: candidate.id,
      targetScore: candidate.depth * 40,
      nextFocus: { part: "長い耳", direction: 330 },
    })),
  });
  assert.equal(result.stopReason, "target_score_reached");
  assert.equal(result.bestPath.length, 2);
  assert.deepEqual(result.bestPath.map(({ depth }) => depth), [1, 2]);
  assert.ok(result.bestNode.target.score >= 75);
  assert.equal(result.bestNode.status, "goal");
});

test("returns a generated crease when visual scores are unavailable", async () => {
  const result = await runStepSearch({
    maxDepth: 1,
    branchFactor: 2,
    beamWidth: 1,
    enumerateActions: limitedActions,
    simulate: async ({ parent, action }) => ({
      fold: simulatedFold(parent, action),
      physical: { completed: true, score: 80, foldabilityScore: 70, hardFailures: [] },
    }),
    judge: async ({ candidates }) => candidates.map((candidate) => ({
      id: candidate.id,
      targetScore: 0,
      silhouetteScore: 0,
      issues: ["画像評価は未実施です"],
    })),
  });

  assert.equal(result.bestNode.depth, 1);
  assert.equal(result.bestPath.length, 1);
  assert.notEqual(result.manifest.bestNodeId, result.manifest.rootNodeId);
});
