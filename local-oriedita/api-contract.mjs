export const ORIEDITA_API_VERSION = "1.0.0";

const MAX_VERTICES = 20_000;
const MAX_EDGES = 40_000;
const MAX_FOLD_BYTES = 1_000_000;
const ASSIGNMENTS = new Set(["B", "M", "V", "F", "U"]);

export class ApiInputError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isFinitePoint(value) {
  return Array.isArray(value)
    && value.length >= 2
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function isVertexPair(value, vertexCount) {
  return Array.isArray(value)
    && value.length === 2
    && value.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)
    && value[0] !== value[1];
}

export function validateFoldDocument(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiInputError(400, "fold はFOLD形式のJSONオブジェクトにしてください");
  }

  const vertices = value.vertices_coords;
  const edges = value.edges_vertices;
  const assignments = value.edges_assignment;
  if (!Array.isArray(vertices) || vertices.length < 3 || vertices.length > MAX_VERTICES) {
    throw new ApiInputError(400, `vertices_coords は3〜${MAX_VERTICES}頂点にしてください`);
  }
  if (!vertices.every(isFinitePoint)) {
    throw new ApiInputError(400, "vertices_coords に不正な座標があります");
  }
  if (!Array.isArray(edges) || edges.length < 1 || edges.length > MAX_EDGES) {
    throw new ApiInputError(400, `edges_vertices は1〜${MAX_EDGES}辺にしてください`);
  }
  if (!edges.every((edge) => isVertexPair(edge, vertices.length))) {
    throw new ApiInputError(400, "edges_vertices に不正な頂点番号があります");
  }
  if (assignments != null) {
    if (!Array.isArray(assignments) || assignments.length !== edges.length) {
      throw new ApiInputError(400, "edges_assignment はedges_verticesと同じ長さにしてください");
    }
    if (!assignments.every((assignment) => typeof assignment === "string" && ASSIGNMENTS.has(assignment))) {
      throw new ApiInputError(400, "edges_assignment はB、M、V、F、Uのいずれかにしてください");
    }
  }

  const encoded = JSON.stringify(value);
  if (encoded.length > MAX_FOLD_BYTES) {
    throw new ApiInputError(413, "fold データが大きすぎます");
  }
  return value;
}

export function validateFoldRequest(value) {
  const fold = validateFoldDocument(value?.fold);
  const requestedWait = value?.waitMs ?? 30_000;
  if (!Number.isInteger(requestedWait) || requestedWait < 1_000 || requestedWait > 60_000) {
    throw new ApiInputError(400, "waitMs は1000〜60000の整数にしてください");
  }
  return { fold, waitMs: requestedWait };
}

export function createOpenApiDocument(serverUrl) {
  return {
    openapi: "3.1.0",
    info: {
      title: "ORIAI Oriedita API",
      version: ORIEDITA_API_VERSION,
      description: "FOLD形式の展開図をOrieditaで開き、折り上がりを計算して画像とFOLDデータを返す非同期API。",
    },
    servers: [{ url: serverUrl }],
    paths: {
      "/v1/oriedita/health": {
        get: {
          summary: "APIとOrieditaの状態を確認する",
          responses: { 200: { description: "状態" } },
        },
      },
      "/v1/oriedita/fold": {
        post: {
          summary: "展開図の折り計算ジョブを作成する",
          security: [{ bearerAuth: [] }, {}],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["fold"],
                  properties: {
                    fold: { type: "object", description: "FOLD format JSON" },
                    waitMs: { type: "integer", minimum: 1_000, maximum: 60_000, default: 30_000 },
                  },
                },
              },
            },
          },
          responses: {
            202: { description: "ジョブを受付" },
            400: { description: "入力エラー" },
            401: { description: "認証エラー" },
            429: { description: "利用上限" },
          },
        },
      },
      "/v1/oriedita/jobs/{jobId}": {
        get: {
          summary: "折り計算ジョブの状態と結果を取得する",
          security: [{ bearerAuth: [] }, {}],
          parameters: [{
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          }],
          responses: {
            200: { description: "ジョブ状態。完了時は展開図画像、折り上がり画像、FOLDデータを含む" },
            404: { description: "ジョブが見つからない" },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
  };
}
