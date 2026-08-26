import assert from "node:assert/strict";
import test from "node:test";

import {
  attachAddCreaseLineage,
  canonicalCreaseActionKey,
  createSquareRootFold,
  enumerateFullWidthCreaseActions,
  validateFullWidthCreaseAction,
} from "../local-oriedita/crease-actions.mjs";

test("creates a normalized square boundary-only root", () => {
  const root = createSquareRootFold({ file_title: "うさぎ" });
  assert.deepEqual(root.vertices_coords, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  assert.deepEqual(root.edges_vertices, [[0, 1], [1, 2], [2, 3], [3, 0]]);
  assert.deepEqual(root.edges_assignment, ["B", "B", "B", "B"]);
  assert.equal(root["mitou:stepLineage"].kind, "root");
  assert.equal(root["mitou:stepLineage"].sequentialPhysicalFolding, false);
  assert.equal(root["mitou:stepLineage"].physicalScope, "oriedita_flat_fold_2d");
});

test("enumerates deterministic normalized full-width mountain and valley actions", () => {
  const root = createSquareRootFold();
  const first = enumerateFullWidthCreaseActions({ fold: root, depth: 0 });
  const second = enumerateFullWidthCreaseActions({ fold: root, depth: 0 });
  assert.ok(first.length > 12);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(canonicalCreaseActionKey)).size, first.length);
  for (const action of first) {
    assert.equal(action.type, "add_crease");
    assert.ok(action.assignment === "M" || action.assignment === "V");
    assert.equal(validateFullWidthCreaseAction(action, root).valid, true);
    assert.ok([...action.a, ...action.b].every((value) => value >= 0 && value <= 1));
    const boundary = ([x, y]) => x === 0 || x === 1 || y === 0 || y === 1;
    assert.equal(boundary(action.a), true);
    assert.equal(boundary(action.b), true);
  }
});

test("rejects zero-length, paper-external, boundary-only, and duplicate creases", () => {
  const root = createSquareRootFold();
  const zero = { type: "add_crease", a: [0, 0], b: [0, 0], assignment: "M" };
  const outside = { type: "add_crease", a: [-0.1, 0.5], b: [1, 0.5], assignment: "V" };
  const boundary = { type: "add_crease", a: [0, 0], b: [1, 0], assignment: "M" };
  assert.equal(validateFullWidthCreaseAction(zero, root).valid, false);
  assert.equal(validateFullWidthCreaseAction(outside, root).valid, false);
  assert.equal(validateFullWidthCreaseAction(boundary, root).valid, false);

  const splitExisting = {
    ...root,
    vertices_coords: [...root.vertices_coords, [0.5, 0], [0.5, 0.5], [0.5, 1]],
    edges_vertices: [...root.edges_vertices, [4, 5], [5, 6]],
    edges_assignment: [...root.edges_assignment, "M", "M"],
  };
  const duplicate = { type: "add_crease", a: [0.5, 0], b: [0.5, 1], assignment: "V" };
  assert.match(validateFullWidthCreaseAction(duplicate, splitExisting).issues.join(" "), /already exists/);
  assert.equal(
    enumerateFullWidthCreaseActions({ fold: splitExisting }).some((action) =>
      action.a[0] === 0.5 && action.b[0] === 0.5),
    false,
  );
});

test("attaches immutable add_crease lineage to a simulated child document", () => {
  const root = createSquareRootFold();
  const action = enumerateFullWidthCreaseActions({ fold: root })[0];
  const child = {
    ...root,
    vertices_coords: [...root.vertices_coords, action.a, action.b],
    edges_vertices: [...root.edges_vertices, [4, 5]],
    edges_assignment: [...root.edges_assignment, action.assignment],
  };
  const withLineage = attachAddCreaseLineage(child, {
    parentNodeId: "step-00-root",
    depth: 1,
    action,
  });
  assert.equal(child["mitou:stepLineage"].kind, "root");
  assert.equal(withLineage["mitou:stepLineage"].kind, "add_crease");
  assert.equal(withLineage["mitou:stepLineage"].parentNodeId, "step-00-root");
  assert.equal(withLineage["mitou:stepLineage"].action.type, "add_crease");
  assert.equal(withLineage["mitou:stepLineage"].action.key, canonicalCreaseActionKey(action));
  assert.equal(withLineage["mitou:stepLineage"].sequentialPhysicalFolding, false);
});
