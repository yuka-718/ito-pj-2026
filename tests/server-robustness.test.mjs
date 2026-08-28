import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after } from "node:test";

process.env.ORI_AI_LOCAL_HOST = "127.0.0.1";
process.env.ORI_AI_LOCAL_PORT = "0";

const {
  assertSuccessfulFinalFoldCalculation,
  runOrieditaModifiabilitySmokeTest,
  searchedStructuralPatternCount,
  server,
} = await import("../local-oriedita/server.mjs?server-robustness-test");

if (!server.listening) await once(server, "listening");

after(async () => {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test("image-only and reference-less jobs do not report a 5000-pattern text search", () => {
  assert.equal(searchedStructuralPatternCount(""), 0);
  assert.equal(searchedStructuralPatternCount("   "), 0);
  assert.equal(searchedStructuralPatternCount(null), 0);
  assert.equal(searchedStructuralPatternCount("鶴"), 5_000);
});

test("final fold calculation requires both a started calculation and zero violations", () => {
  assert.equal(assertSuccessfulFinalFoldCalculation({ started: true, violationCount: 0 }), 0);
  assert.throws(
    () => assertSuccessfulFinalFoldCalculation({ started: false, violationCount: 0 }),
    /平坦折り計算を開始できませんでした/,
  );
  assert.throws(
    () => assertSuccessfulFinalFoldCalculation({ started: true, violationCount: 2 }),
    /局所平坦折り違反が2件あります/,
  );
  for (const violationCount of [undefined, null, Number.NaN, "0", -1, 0.5]) {
    assert.throws(
      () => assertSuccessfulFinalFoldCalculation({ started: true, violationCount }),
      /違反数を確認できませんでした/,
    );
  }
});

test("modifiability smoke-test edits only a temporary copy and reloads the parent FOLD", async () => {
  const parentPath = "/tmp/job/structural-candidate-01.fold";
  const smokePath = "/tmp/job/.structural-smoke-01.fold";
  const calls = [];
  const copied = [];
  const removed = [];
  let lineAdded = false;
  const requestImpl = async (path, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body });
    if (path === "/document") {
      return {
        lines: [
          { color: "EDGE", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
          { color: "EDGE", a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
          { color: "EDGE", a: { x: 1, y: 1 }, b: { x: 0, y: 1 } },
          { color: "EDGE", a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
          ...(lineAdded ? [{ color: "MOUNTAIN", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }] : []),
        ],
      };
    }
    if (path === "/line") lineAdded = true;
    if (path === "/fold-calculate") return { started: true, violationCount: 0 };
    return { ok: true };
  };
  const result = await runOrieditaModifiabilitySmokeTest({
    parentPath,
    smokePath,
    fold: {
      vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
      edges_assignment: ["B", "B", "B", "B"],
    },
    requestImpl,
    waitImpl: async () => ({ foldedFigures: { completed: true } }),
    copyImpl: async (source, destination) => copied.push({ source, destination }),
    removeImpl: async (path, options) => removed.push({ path, options }),
  });

  assert.equal(result.status, "passed");
  assert.equal(result.add_line_completed, true);
  assert.equal(result.calculation_started, true);
  assert.equal(result.violation_count, 0);
  assert.equal(result.oriedita_completed, true);
  assert.equal(result.parent_reloaded, true);
  assert.equal(result.temporary_copy_removed, true);
  assert.deepEqual(copied, [{ source: parentPath, destination: smokePath }]);
  assert.deepEqual(removed, [{ path: smokePath, options: { force: true } }]);
  assert.deepEqual(
    calls.filter(({ path }) => path === "/open").map(({ body }) => body.path),
    [smokePath, parentPath],
  );
  assert.equal(calls.filter(({ path }) => path === "/line").length, 1);
  assert.equal(calls.filter(({ path }) => path === "/document").length, 2);
  assert.equal(calls.filter(({ path }) => path === "/fold-calculate").length, 1);
  assert.equal(calls.some(({ path }) => path === "/export"), false);
});

test("modifiability smoke-test rejects an Oriedita add-line no-op", async () => {
  const parentPath = "/tmp/job/structural-candidate-01.fold";
  const smokePath = "/tmp/job/.structural-smoke-01.fold";
  const calls = [];
  const document = {
    lines: [
      { color: "EDGE", a: { x: 0, y: 0 }, b: { x: 1, y: 0 } },
      { color: "EDGE", a: { x: 1, y: 0 }, b: { x: 1, y: 1 } },
      { color: "EDGE", a: { x: 1, y: 1 }, b: { x: 0, y: 1 } },
      { color: "EDGE", a: { x: 0, y: 1 }, b: { x: 0, y: 0 } },
    ],
  };
  const result = await runOrieditaModifiabilitySmokeTest({
    parentPath,
    smokePath,
    fold: {
      vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
      edges_assignment: ["B", "B", "B", "B"],
    },
    requestImpl: async (path) => {
      calls.push(path);
      if (path === "/document") return document;
      return { ok: true };
    },
    waitImpl: async () => ({ foldedFigures: { completed: true } }),
    copyImpl: async () => {},
    removeImpl: async () => {},
  });

  assert.equal(result.status, "failed");
  assert.equal(result.add_line_completed, false);
  assert.equal(result.line_count_before, 4);
  assert.equal(result.line_count_after, 4);
  assert.match(result.reason, /追加折り線の実在を確認できませんでした/);
  assert.equal(calls.filter((path) => path === "/fold-calculate").length, 0);
  assert.equal(result.parent_reloaded, true);
  assert.equal(result.temporary_copy_removed, true);
});
