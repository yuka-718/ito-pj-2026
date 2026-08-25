function orderedCreaseRays(fold) {
  const coords = fold?.vertices_coords;
  const edges = fold?.edges_vertices;
  const assignments = fold?.edges_assignment;
  if (!Array.isArray(coords) || !Array.isArray(edges) || !Array.isArray(assignments)) return [];
  const incidence = new Map();
  edges.forEach((edge, edgeIndex) => {
    if (!Array.isArray(edge) || !["M", "V"].includes(assignments[edgeIndex])) return;
    for (const [vertex, other] of [[edge[0], edge[1]], [edge[1], edge[0]]]) {
      const rays = incidence.get(vertex) ?? [];
      rays.push({ edgeIndex, other, assignment: assignments[edgeIndex] });
      incidence.set(vertex, rays);
    }
  });
  const center = [...incidence.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!center || center[1].length < 4) return [];
  const [centerIndex, rays] = center;
  const [cx, cy] = coords[centerIndex] ?? [];
  return rays.map((ray) => {
    const [x, y] = coords[ray.other] ?? [];
    return { ...ray, angle: Math.atan2(y - cy, x - cx) };
  }).sort((a, b) => a.angle - b.angle);
}

function rotate(values, offset) {
  return values.map((_, index) => values[(index + offset) % values.length]);
}

function sequenceVariants(sequence) {
  const variants = [];
  for (const values of [sequence, [...sequence].reverse()]) {
    for (let offset = 0; offset < values.length; offset += 1) variants.push(rotate(values, offset));
  }
  return variants;
}

export function createMountainValleyVariants(pack, fold, { limit = 64 } = {}) {
  const targetRays = orderedCreaseRays(fold);
  const degree = targetRays.length;
  if (!degree) return [];
  const sourcePatterns = pack.patterns.filter((pattern) =>
    pattern.family === "single_vertex_kawasaki" && pattern.params?.degree === degree,
  );
  const signatures = [];
  const seen = new Set();
  const current = targetRays.map(({ assignment }) => assignment);
  for (const signature of [current, ...sourcePatterns.flatMap((pattern) => {
    const source = orderedCreaseRays(pattern.fold).map(({ assignment }) => assignment);
    return sequenceVariants(source);
  })]) {
    const key = signature.join("");
    if (signature.length !== degree || seen.has(key)) continue;
    seen.add(key);
    signatures.push(signature);
    if (signatures.length >= limit) break;
  }
  return signatures.map((signature, variantIndex) => {
    const candidate = structuredClone(fold);
    if (!Array.isArray(candidate.edges_foldAngle)) {
      candidate.edges_foldAngle = candidate.edges_assignment.map(() => 0);
    }
    signature.forEach((assignment, index) => {
      const edgeIndex = targetRays[index].edgeIndex;
      candidate.edges_assignment[edgeIndex] = assignment;
      candidate.edges_foldAngle[edgeIndex] = assignment === "M" ? -180 : 180;
    });
    candidate["mitou:assignmentRepair"] = {
      source: variantIndex === 0 ? "browser_candidate" : "cc0_single_vertex_template",
      signature: signature.join(""),
      degree,
    };
    return candidate;
  });
}
