import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiInputError,
  createOpenApiDocument,
  validateFoldRequest,
} from "../local-oriedita/api-contract.mjs";

const squareFold = {
  file_spec: 1.2,
  vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
  edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]],
  edges_assignment: ["B", "B", "B", "B", "V"],
};

test("accepts a bounded FOLD document for the Oriedita API", () => {
  const input = validateFoldRequest({ fold: squareFold, waitMs: 15_000 });
  assert.equal(input.fold, squareFold);
  assert.equal(input.waitMs, 15_000);
});

test("rejects an edge that references a missing vertex", () => {
  assert.throws(
    () => validateFoldRequest({
      fold: { ...squareFold, edges_vertices: [[0, 99]] },
    }),
    (error) => error instanceof ApiInputError && error.status === 400,
  );
});

test("publishes the asynchronous Oriedita API contract", () => {
  const document = createOpenApiDocument("https://api.example.test");
  assert.equal(document.openapi, "3.1.0");
  assert.ok(document.paths["/v1/oriedita/fold"].post);
  assert.ok(document.paths["/v1/oriedita/jobs/{jobId}"].get);
  assert.deepEqual(document.servers, [{ url: "https://api.example.test" }]);
});
