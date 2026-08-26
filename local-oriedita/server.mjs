#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { access, appendFile, copyFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadKnowledgePack,
  materializeKnowledgePattern,
  publicKnowledgeMatch,
  publicKnowledgeReference,
  retrieveKnowledge,
} from "./knowledge-search.mjs";
import {
  buildDesignGoal,
  mergeFinalEvaluation,
  validateCandidatePool,
} from "./fast-evaluation.mjs";
import { createMountainValleyVariants } from "./fold-repair.mjs";
import { foldGeometrySignature, regenerateCandidatePool } from "./regeneration.mjs";
import { DEFAULT_GROQ_MODEL, requestGroqEvaluation } from "./groq-evaluator.mjs";
import {
  fallbackStepJudgements,
  requestGroqStepEvaluation,
} from "./groq-step-evaluator.mjs";
import { evaluatePartialFold } from "./partial-evaluation.mjs";
import { runStepSearch } from "./step-search.mjs";
import {
  ApiInputError,
  createOpenApiDocument,
  ORIEDITA_API_VERSION,
  validateFoldDocument,
  validateFoldRequest,
} from "./api-contract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const workRoot = resolve(projectRoot, "work", "local-jobs");
const knowledgePack = await loadKnowledgePack();
const port = Number.parseInt(process.env.ORI_AI_LOCAL_PORT ?? "8788", 10);
const host = process.env.ORI_AI_LOCAL_HOST ?? "127.0.0.1";
const maxIterations = Math.min(10, Math.max(1, Number.parseInt(process.env.ORI_AI_MAX_ITERATIONS ?? "10", 10)));
const maxCycles = Math.min(10, Math.max(1, Number.parseInt(process.env.ORI_AI_MAX_CYCLES ?? String(maxIterations), 10)));
const targetScore = Math.min(100, Math.max(1, Number.parseInt(process.env.ORI_AI_TARGET_SCORE ?? "85", 10)));
const designMode = process.env.ORI_AI_DESIGN_MODE === "regeneration"
  ? "regeneration"
  : "crease_step_search";
const stepBranchFactor = Math.min(3, Math.max(1, Number.parseInt(process.env.ORI_AI_STEP_BRANCH_FACTOR ?? "2", 10)));
const stepBeamWidth = Math.min(2, Math.max(1, Number.parseInt(process.env.ORI_AI_STEP_BEAM_WIDTH ?? "1", 10)));
const knowledgeSearchEnabled = false;
const jobTimeoutMs = Math.max(60_000, Number.parseInt(process.env.ORI_AI_JOB_TIMEOUT_MS ?? "1200000", 10));
const rateWindowMs = Math.max(60_000, Number.parseInt(process.env.ORI_AI_RATE_WINDOW_MS ?? "21600000", 10));
const maxJobsPerWindow = Math.max(0, Number.parseInt(process.env.ORI_AI_MAX_JOBS_PER_WINDOW ?? "0", 10));
const trustProxy = process.env.ORI_AI_TRUST_PROXY === "1";
const groqModel = process.env.ORI_AI_GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
const groqEndpoint = process.env.ORI_AI_GROQ_ENDPOINT
  ?? "https://api.groq.com/openai/v1/chat/completions";
const orieditaJar = resolve(process.env.ORIEDITA_JAR
  ?? "/Users/yukaito/Documents/oriedita/oriedita/target/oriedita-1.1.4-SNAPSHOT.jar");
const orieditaJava = process.env.ORIEDITA_JAVA ?? "java";
const userSuffix = typeof process.getuid === "function" ? process.getuid() : "user";
const orieditaRuntime = resolve(process.env.ORIEDITA_MCP_RUNTIME_DIR
  ?? join(tmpdir(), `oriedita-mcp-${userSuffix}`));
const connectionFile = resolve(orieditaRuntime, "connection.json");
const orieditaLogFile = resolve(orieditaRuntime, "oriedita-api.log");
const apiToken = process.env.ORI_AI_API_TOKEN?.trim() ?? "";

function loadGroqApiKey() {
  const configured = process.env.GROQ_API_KEY?.trim();
  if (configured) return configured;
  if (process.platform !== "darwin") return "";
  try {
    return execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "jp.ito-pj.ori-ai.groq", "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

const groqApiKey = loadGroqApiKey();

const allowedOrigins = new Set([
  "https://yuka-718.github.io",
  "https://ori-ai-ito-pj-2026.pipipiimside.chatgpt.site",
  ...(process.env.ORI_AI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const jobs = new Map();
const queue = [];
const submissionWindows = new Map();
let activeJobId = null;
let activeOrieditaConnection = null;
let orieditaLaunchPromise = null;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
  if (origin && isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function send(response, status, payload, origin) {
  response.writeHead(status, corsHeaders(origin));
  response.end(JSON.stringify(payload));
}

function clientAddress(request) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",", 1)[0].trim();
  }
  return request.socket.remoteAddress ?? "unknown";
}

function consumeSubmissionQuota(request) {
  if (maxJobsPerWindow === 0) return;
  const address = clientAddress(request);
  if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return;
  const now = Date.now();
  const active = (submissionWindows.get(address) ?? []).filter((createdAt) => now - createdAt < rateWindowMs);
  if (active.length >= maxJobsPerWindow) {
    throw new HttpError(429, "利用回数の上限です。時間をおいて再実行してください");
  }
  active.push(now);
  submissionWindows.set(address, active);
}

async function readJson(request, limit = 14 * 1024 * 1024) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "application/json で送信してください");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "送信データが大きすぎます");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSONを読み取れませんでした");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hasApiAccess(request) {
  if (!apiToken) return true;
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(apiToken);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function requireApiAccess(request) {
  if (!hasApiAccess(request)) throw new HttpError(401, "有効なAPIトークンが必要です");
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
    progress: job.type === "design" ? {
      cycle: job.cycle ?? 0,
      maxCycles: job.maxCycles ?? maxCycles,
      bestScore: job.bestScore ?? null,
      step: job.step ?? job.cycle ?? 0,
      maxSteps: job.maxSteps ?? job.maxCycles ?? maxCycles,
      evaluatedNodes: job.evaluatedNodes ?? 0,
      mode: job.designMode ?? designMode,
    } : null,
  };
}

function validateJobInput(value) {
  const prompt = typeof value?.prompt === "string" ? value.prompt.trim().slice(0, 200) : "";
  const fold = value?.fold;
  if (!prompt && !value?.referenceImage) {
    throw new HttpError(400, "プロンプトか参考画像が必要です");
  }
  try {
    validateFoldDocument(fold);
  } catch (error) {
    if (error instanceof ApiInputError) throw new HttpError(error.status, error.message);
    throw error;
  }

  const candidates = Array.isArray(value?.candidates) && value.candidates.length
    ? value.candidates.slice(0, 3)
    : [fold];
  if (Array.isArray(value?.candidates) && value.candidates.length > 3) {
    throw new HttpError(400, "展開図候補は3件までです");
  }
  for (const candidate of candidates) {
    try {
      validateFoldDocument(candidate);
    } catch (error) {
      if (error instanceof ApiInputError) throw new HttpError(error.status, error.message);
      throw error;
    }
  }

  let referenceImage = null;
  if (value?.referenceImage != null) {
    if (typeof value.referenceImage !== "string") throw new HttpError(400, "参考画像が不正です");
    const match = value.referenceImage.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new HttpError(400, "PNG、JPEG、WEBPの参考画像を使用してください");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 10 * 1024 * 1024) throw new HttpError(413, "参考画像は10MB以下にしてください");
    referenceImage = { mimeType: match[1], bytes };
  }
  const goal = value?.goal && typeof value.goal === "object" ? value.goal : null;
  return { prompt, fold, candidates, goal, referenceImage };
}

function extensionForMimeType(mimeType) {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  return ".png";
}

async function createJob(input) {
  if (queue.length >= 3) throw new HttpError(429, "処理待ちが多いため、少し待ってから再実行してください");
  const id = randomUUID();
  const directory = join(workRoot, id);
  // Search-result substitution is paused until every catalog entry has a
  // verified crease pattern and matching final 3D state.
  const knowledgeResults = knowledgeSearchEnabled
    ? retrieveKnowledge(knowledgePack, input.prompt, { limit: 3 })
    : [];
  const exactResult = knowledgeResults.find((match) => match.matchKind === "exact") ?? null;
  let knowledgeMatch = null;
  if (exactResult) {
    try {
      knowledgeMatch = await materializeKnowledgePattern(exactResult.pattern);
    } catch (error) {
      console.warn(`FOLDライブラリの取得に失敗したため生成へ切り替えます: ${error instanceof Error ? error.message : error}`);
    }
  }
  const candidateFolds = knowledgeMatch ? [knowledgeMatch.fold] : input.candidates;
  const goal = buildDesignGoal(input.prompt, input.goal);
  const preflight = validateCandidatePool(candidateFolds, goal);
  const initialFold = candidateFolds[preflight.selectedIndex];
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "iterations"), { recursive: true, mode: 0o700 });
  await mkdir(join(directory, "cycles"), { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "input.fold"), `${JSON.stringify(initialFold, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "brief.txt"), `${input.prompt || "参考画像をもとに設計"}\n`, { mode: 0o600 });
  await writeFile(join(directory, "goal.json"), `${JSON.stringify(goal, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "candidate-evaluation.json"), `${JSON.stringify(preflight, null, 2)}\n`, { mode: 0o600 });
  await Promise.all(candidateFolds.map((candidate, index) =>
    writeFile(join(directory, `candidate-${String(index + 1).padStart(2, "0")}.fold`), `${JSON.stringify(candidate, null, 2)}\n`, { mode: 0o600 })
  ));
  await Promise.all(preflight.validations.map((validation) =>
    writeFile(
      join(directory, "iterations", `${String(validation.index).padStart(2, "0")}-${validation.name}.json`),
      `${JSON.stringify(validation, null, 2)}\n`,
      { mode: 0o600 },
    )
  ));
  await writeFile(join(directory, "iterations.json"), `${JSON.stringify(preflight.validations, null, 2)}\n`, { mode: 0o600 });

  const resolvedKnowledgeResults = knowledgeResults.map((match) =>
    match === exactResult && knowledgeMatch ? { ...match, pattern: knowledgeMatch } : match);
  const knowledgeReferences = resolvedKnowledgeResults.map(publicKnowledgeReference);
  await writeFile(join(directory, "knowledge-references.json"), `${JSON.stringify(knowledgeReferences, null, 2)}\n`, { mode: 0o600 });
  await Promise.all(resolvedKnowledgeResults.filter((match) => match.pattern.fold).map((match, index) =>
    writeFile(
      join(directory, `reference-${String(index + 1).padStart(2, "0")}.fold`),
      `${JSON.stringify(match.pattern.fold, null, 2)}\n`,
      { mode: 0o600 },
    )
  ));

  let referencePath = null;
  if (input.referenceImage) {
    referencePath = join(directory, `reference${extensionForMimeType(input.referenceImage.mimeType)}`);
    await writeFile(referencePath, input.referenceImage.bytes, { mode: 0o600 });
  }

  const job = {
    id,
    type: "design",
    directory,
    referencePath,
    prompt: input.prompt,
    goal,
    preflight,
    candidateFolds,
    knowledgeMatch,
    knowledgeReferences,
    cycle: 0,
    step: 0,
    maxCycles: knowledgeMatch ? 1 : maxCycles,
    maxSteps: knowledgeMatch ? 1 : maxCycles,
    evaluatedNodes: 0,
    designMode,
    bestScore: null,
    status: "queued",
    message: "処理待ち",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  queue.push(id);
  void drainQueue();
  return job;
}

async function createOrieditaFoldJob(input) {
  if (queue.length >= 3) throw new HttpError(429, "処理待ちが多いため、少し待ってから再実行してください");
  const id = randomUUID();
  const directory = join(workRoot, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "input.fold"), `${JSON.stringify(input.fold, null, 2)}\n`, { mode: 0o600 });

  const job = {
    id,
    type: "oriedita-fold",
    directory,
    waitMs: input.waitMs,
    status: "queued",
    message: "処理待ち",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    result: null,
    error: null,
  };
  jobs.set(id, job);
  queue.push(id);
  void drainQueue();
  return job;
}

async function runGroqJudge(job) {
  const foldedFigure = await orieditaRequest("/folded-figure");
  let referenceImage = null;
  if (job.referencePath) {
    const extension = job.referencePath.split(".").at(-1)?.toLowerCase();
    const mimeType = extension === "jpg" || extension === "jpeg"
      ? "image/jpeg"
      : extension === "webp" ? "image/webp" : "image/png";
    referenceImage = { mimeType, data: (await readFile(job.referencePath)).toString("base64") };
  }
  const { judge, metadata } = await requestGroqEvaluation({
    apiKey: groqApiKey,
    model: groqModel,
    endpoint: groqEndpoint,
    prompt: job.prompt,
    goal: job.goal,
    preflight: job.preflight,
    cycle: job.cycle,
    knowledgeMatch: job.knowledgeMatch,
    foldedImage: foldedFigure,
    referenceImage,
    timeoutMs: Math.min(jobTimeoutMs, 120_000),
  });
  const outputPath = join(job.directory, "evaluation.json");
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(judge, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(job.directory, "groq-evaluation.json"), `${JSON.stringify({ judge, metadata }, null, 2)}\n`, { mode: 0o600 }),
  ]);
  return outputPath;
}

async function readConnection() {
  try {
    const connection = JSON.parse(await readFile(connectionFile, "utf8"));
    if (typeof connection.url !== "string" || typeof connection.token !== "string") return null;
    return connection;
  } catch {
    return null;
  }
}

async function bridgeRequest(connection, path, options = {}) {
  const response = await fetch(`${connection.url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${connection.token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message ?? `Oriedita ${response.status}`);
  }
  return payload.result;
}

async function healthyConnection(connection) {
  if (!connection) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_000);
    try {
      const health = await bridgeRequest(connection, "/health", { signal: controller.signal });
      return health?.ready ? connection : null;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

async function launchOriedita() {
  await Promise.all([
    access(orieditaJar),
    mkdir(orieditaRuntime, { recursive: true, mode: 0o700 }),
  ]);
  await rm(connectionFile, { force: true });
  const token = randomBytes(32).toString("hex");
  const log = await open(orieditaLogFile, "a", 0o600);
  try {
    const child = spawn(orieditaJava, ["-jar", orieditaJar], {
      cwd: projectRoot,
      detached: true,
      env: {
        ...process.env,
        ORIEDITA_MCP_CONNECTION_FILE: connectionFile,
        ORIEDITA_MCP_TOKEN: token,
      },
      stdio: ["ignore", log.fd, log.fd],
    });
    child.unref();
  } finally {
    await log.close();
  }

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const connection = await readConnection();
    if (connection?.token === token && await healthyConnection(connection)) return connection;
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
  }
  throw new Error(`Orieditaを起動できませんでした。${orieditaLogFile} を確認してください`);
}

async function ensureOriedita() {
  const active = await healthyConnection(activeOrieditaConnection);
  if (active) return active;

  const existing = await healthyConnection(await readConnection());
  if (existing) {
    activeOrieditaConnection = existing;
    return existing;
  }

  if (!orieditaLaunchPromise) {
    orieditaLaunchPromise = launchOriedita().finally(() => {
      orieditaLaunchPromise = null;
    });
  }
  activeOrieditaConnection = await orieditaLaunchPromise;
  return activeOrieditaConnection;
}

async function orieditaRequest(path, options = {}) {
  const connection = await ensureOriedita();
  try {
    return await bridgeRequest(connection, path, options);
  } catch (error) {
    activeOrieditaConnection = null;
    throw error;
  }
}

async function inspectOriedita() {
  const connection = await healthyConnection(activeOrieditaConnection)
    ?? await healthyConnection(await readConnection());
  if (!connection) return { ready: false };
  activeOrieditaConnection = connection;
  const health = await bridgeRequest(connection, "/health");
  return {
    ready: true,
    version: health.version,
  };
}

async function waitForFold(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await orieditaRequest("/state");
    if (!state.foldingTask?.running) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error("Orieditaの折り計算がタイムアウトしました");
}

async function selectOrieditaFoldableAssignment(job) {
  const selected = job.candidateFolds[job.preflight.selectedIndex];
  const variants = job.knowledgeMatch
    ? [selected]
    : createMountainValleyVariants(knowledgePack, selected, { limit: 64 });
  if (!variants.length) throw new Error("山折り・谷折り候補を作成できませんでした");
  const attempts = [];
  for (let index = 0; index < variants.length; index += 1) {
    const attemptPath = join(job.directory, `assignment-attempt-${String(index + 1).padStart(2, "0")}.fold`);
    await writeFile(attemptPath, `${JSON.stringify(variants[index], null, 2)}\n`, { mode: 0o600 });
    let state = null;
    let errorMessage = null;
    try {
      await orieditaRequest("/open", {
        method: "POST",
        body: JSON.stringify({ path: attemptPath }),
      });
      await orieditaRequest("/action", {
        method: "POST",
        body: JSON.stringify({ action: "foldAction" }),
      });
      state = await waitForFold(15_000);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }
    const completed = Boolean(state?.foldedFigures?.completed);
    attempts.push({
      attempt: index + 1,
      assignment: variants[index]["mitou:assignmentRepair"]?.signature ?? null,
      completed,
      estimationStep: state?.foldedFigures?.estimationStep ?? null,
      error: errorMessage,
    });
    if (!completed) continue;

    await writeFile(join(job.directory, "input.fold"), `${JSON.stringify(variants[index], null, 2)}\n`, { mode: 0o600 });
    job.assignmentRepair = {
      attempts: index + 1,
      assignment: variants[index]["mitou:assignmentRepair"]?.signature ?? null,
      completed: true,
    };
    await writeFile(join(job.directory, "assignment-search.json"), `${JSON.stringify(attempts, null, 2)}\n`, { mode: 0o600 });
    return;
  }
  job.assignmentRepair = { attempts: attempts.length, assignment: null, completed: false };
  await writeFile(join(job.directory, "assignment-search.json"), `${JSON.stringify(attempts, null, 2)}\n`, { mode: 0o600 });
  throw new Error("Orieditaで折り上がりが完了する山谷配置を見つけられませんでした");
}

async function persistFinalEvaluation(job, judge, completed, issues = []) {
  const evaluation = mergeFinalEvaluation(job.preflight, judge, { completed, issues });
  const finalRecord = evaluation.validations.at(-1);
  finalRecord.metrics.assignmentSearchAttempts = job.assignmentRepair?.attempts ?? 0;
  finalRecord.metrics.assignment = job.assignmentRepair?.assignment ?? null;
  await Promise.all([
    writeFile(
      join(job.directory, "iterations", "10-oriedita_final_fold_and_groq_visual_judge.json"),
      `${JSON.stringify(finalRecord, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(job.directory, "iterations.json"),
      `${JSON.stringify(evaluation.validations, null, 2)}\n`,
      { mode: 0o600 },
    ),
    writeFile(
      join(job.directory, "final-evaluation.json"),
      `${JSON.stringify(evaluation, null, 2)}\n`,
      { mode: 0o600 },
    ),
  ]);
  return evaluation;
}

async function collectResult(job, evaluationPath) {
  const judge = JSON.parse(await readFile(evaluationPath, "utf8"));
  const state = await waitForFold();
  const activeFile = typeof state.file === "string" ? resolve(state.file) : "";
  if (!activeFile.startsWith(`${job.directory}/`)) {
    await persistFinalEvaluation(job, judge, false, ["最終候補がOrieditaで開かれていません"]);
    throw new Error("このジョブの展開図をOrieditaで開けませんでした");
  }
  if (!state.foldedFigures?.completed) {
    await persistFinalEvaluation(job, judge, false, ["Orieditaの折り上がり計算が未完了です"]);
    throw new Error("Orieditaの折り上がり計算が完了していません");
  }

  const finalFoldPath = join(job.directory, "final.fold");
  const finalCreasePath = join(job.directory, "final-crease.png");
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalFoldPath }),
  });
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalCreasePath }),
  });
  await Promise.all([access(finalFoldPath), access(finalCreasePath)]);
  const foldedFigure = await orieditaRequest("/folded-figure");
  const creaseBytes = await readFile(finalCreasePath);
  const foldBytes = await readFile(finalFoldPath);
  const foldedBytes = Buffer.from(foldedFigure.data, "base64");
  await writeFile(join(job.directory, "final-folded.png"), foldedBytes, { mode: 0o600 });
  const evaluation = await persistFinalEvaluation(job, judge, true);

  return {
    evaluation,
    knowledgeMatch: publicKnowledgeMatch(job.knowledgeMatch),
    knowledgeReferences: job.knowledgeReferences,
    creaseImage: `data:image/png;base64,${creaseBytes.toString("base64")}`,
    foldedImage: `data:${foldedFigure.mimeType};base64,${foldedBytes.toString("base64")}`,
    foldFile: `data:application/json;base64,${foldBytes.toString("base64")}`,
  };
}

async function copyIfPresent(source, destination) {
  try {
    await copyFile(source, destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function prepareDesignCycle(job, candidateFolds, cycle) {
  const directory = join(job.directory, "cycles", String(cycle).padStart(2, "0"));
  const preflight = validateCandidatePool(candidateFolds, job.goal);
  const initialFold = candidateFolds[preflight.selectedIndex];
  await mkdir(join(directory, "iterations"), { recursive: true, mode: 0o700 });
  await Promise.all([
    writeFile(join(directory, "brief.txt"), `${job.prompt || "参考画像をもとに設計"}\n`, { mode: 0o600 }),
    writeFile(join(directory, "goal.json"), `${JSON.stringify(job.goal, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, "input.fold"), `${JSON.stringify(initialFold, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, "candidate-evaluation.json"), `${JSON.stringify(preflight, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, "knowledge-references.json"), `${JSON.stringify(job.knowledgeReferences, null, 2)}\n`, { mode: 0o600 }),
    ...candidateFolds.map((candidate, index) => writeFile(
      join(directory, `candidate-${String(index + 1).padStart(2, "0")}.fold`),
      `${JSON.stringify(candidate, null, 2)}\n`,
      { mode: 0o600 },
    )),
    ...preflight.validations.map((validation) => writeFile(
      join(directory, "iterations", `${String(validation.index).padStart(2, "0")}-${validation.name}.json`),
      `${JSON.stringify(validation, null, 2)}\n`,
      { mode: 0o600 },
    )),
  ]);
  await writeFile(join(directory, "iterations.json"), `${JSON.stringify(preflight.validations, null, 2)}\n`, { mode: 0o600 });
  await Promise.all([1, 2, 3].map((index) => copyIfPresent(
    join(job.directory, `reference-${String(index).padStart(2, "0")}.fold`),
    join(directory, `reference-${String(index).padStart(2, "0")}.fold`),
  )));
  return {
    ...job,
    directory,
    cycle,
    preflight,
    candidateFolds,
    assignmentRepair: null,
  };
}

function rankRegeneratedCandidates(candidates, goal, limit = 3) {
  return candidates.map((fold) => {
    const evaluation = validateCandidatePool([fold], goal);
    const candidate = evaluation.candidates[0];
    return { fold, evaluation, hardFailures: candidate.hardFailures, scores: evaluation.selectedScores };
  }).sort((a, b) =>
    a.hardFailures - b.hardFailures
    || b.scores.physical - a.scores.physical
    || b.scores.appearance - a.scores.appearance
    || b.scores.foldability - a.scores.foldability
    || foldGeometrySignature(a.fold).localeCompare(foldGeometrySignature(b.fold))
  ).slice(0, limit).map(({ fold }) => fold);
}

function publicCycleRecord(record) {
  return {
    cycle: record.cycle,
    status: record.status,
    score: record.evaluation?.score ?? 0,
    physical: record.evaluation?.physical?.score ?? 0,
    appearance: record.evaluation?.appearance?.score ?? 0,
    foldability: record.evaluation?.foldability?.score ?? 0,
    selectedCandidate: record.evaluation?.selectedCandidate ?? record.preflight?.selectedCandidateId ?? null,
    issues: record.evaluation?.issues ?? record.issues ?? [],
    feedbackUsed: record.feedbackUsed,
  };
}

function bestCycleRecord(records) {
  return [...records].filter((record) => record.result).sort((a, b) =>
    b.evaluation.score - a.evaluation.score
    || b.evaluation.appearance.score - a.evaluation.appearance.score
    || b.evaluation.physical.score - a.evaluation.physical.score
    || a.cycle - b.cycle
  )[0] ?? null;
}

async function runRegenerationLoop(job) {
  let candidateFolds = job.candidateFolds;
  let feedback = [];
  let stopReason = "max_cycles_reached";
  const records = [];

  for (let cycle = 1; cycle <= job.maxCycles; cycle += 1) {
    job.cycle = cycle;
    job.message = `生成・評価サイクル ${cycle}/${job.maxCycles}`;
    const cycleJob = await prepareDesignCycle(job, candidateFolds, cycle);
    let record;
    try {
      await selectOrieditaFoldableAssignment(cycleJob);
      const evaluationPath = await runGroqJudge(cycleJob);
      const result = await collectResult(cycleJob, evaluationPath);
      record = {
        cycle,
        status: "completed",
        feedbackUsed: feedback,
        preflight: cycleJob.preflight,
        evaluation: result.evaluation,
        result,
      };
      records.push(record);
      const best = bestCycleRecord(records);
      job.bestScore = best?.evaluation.score ?? null;
      await writeFile(
        join(cycleJob.directory, "cycle-summary.json"),
        `${JSON.stringify(publicCycleRecord(record), null, 2)}\n`,
        { mode: 0o600 },
      );
      if (job.knowledgeMatch) {
        stopReason = "exact_knowledge_match";
        break;
      }
      if (result.evaluation.score >= targetScore) {
        stopReason = "target_score_reached";
        break;
      }
      feedback = result.evaluation.issues;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record = {
        cycle,
        status: "failed",
        feedbackUsed: feedback,
        preflight: cycleJob.preflight,
        evaluation: null,
        result: null,
        issues: [message],
      };
      records.push(record);
      feedback = [message];
      await writeFile(
        join(cycleJob.directory, "cycle-summary.json"),
        `${JSON.stringify(publicCycleRecord(record), null, 2)}\n`,
        { mode: 0o600 },
      );
      if (cycle === job.maxCycles && !bestCycleRecord(records)) throw error;
    }

    if (cycle === job.maxCycles) break;
    const currentFold = JSON.parse(await readFile(join(cycleJob.directory, "input.fold"), "utf8"));
    const regenerated = regenerateCandidatePool({
      currentFold,
      goal: job.goal,
      feedback,
      cycle: cycle + 1,
      count: 24,
    });
    candidateFolds = rankRegeneratedCandidates(regenerated, job.goal, 3);
    if (!candidateFolds.length) {
      stopReason = "regeneration_exhausted";
      break;
    }
  }

  const best = bestCycleRecord(records);
  if (!best) throw new Error("生成・評価ループで有効な候補を作成できませんでした");
  const cycles = records.map(publicCycleRecord);
  const evaluation = {
    ...best.evaluation,
    iterations: records.length,
    stop_reason: stopReason,
    mode: "generation_evaluation_regeneration_loop",
    maxCycles: job.maxCycles,
    targetScore,
    bestCycle: best.cycle,
    cycles,
  };
  const result = { ...best.result, evaluation };
  await writeFile(
    join(job.directory, "generation-loop.json"),
    `${JSON.stringify({ stopReason, targetScore, bestCycle: best.cycle, cycles }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return result;
}

function stepNodeDirectory(job, nodeId) {
  return join(job.directory, "steps", "nodes", nodeId);
}

function documentPaperBounds(document) {
  const lines = Array.isArray(document?.lines) ? document.lines : [];
  const boundary = lines.filter(({ color }) => color === "EDGE");
  const source = boundary.length ? boundary : lines;
  const points = source.flatMap((line) => [line?.a, line?.b]).filter((point) =>
    Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)));
  if (points.length < 4) throw new Error("Orieditaの紙面座標を取得できませんでした");
  const xs = points.map(({ x }) => Number(x));
  const ys = points.map(({ y }) => Number(y));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxX - minX <= 1e-9 || maxY - minY <= 1e-9) throw new Error("Orieditaの紙面寸法が不正です");
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

function mapPaperPoint(point, bounds) {
  return [
    bounds.minX + Number(point[0]) * bounds.width,
    bounds.minY + Number(point[1]) * bounds.height,
  ];
}

async function ensureNodeFoldSnapshot(job, node) {
  const directory = stepNodeDirectory(job, node.id);
  const path = join(directory, "state.fold");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(node.fold, null, 2)}\n`, { mode: 0o600 });
  node.artifacts ??= {};
  node.artifacts.foldPath = path;
  return path;
}

async function ensureParentPreview(job, parent) {
  if (typeof parent.artifacts?.foldedPng === "string") return;
  const screenshot = await orieditaRequest("/screenshot?target=canvas");
  if (!screenshot?.data || !screenshot?.mimeType) throw new Error("親状態のプレビューを取得できませんでした");
  const directory = stepNodeDirectory(job, parent.id);
  const path = join(directory, "folded.png");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path, Buffer.from(screenshot.data, "base64"), { mode: 0o600 });
  parent.artifacts ??= {};
  parent.artifacts.foldedPng = path;
  parent.artifacts.foldedMimeType = screenshot.mimeType;
}

async function simulateCreaseStep(job, { id, parent, action, depth, goal }) {
  const directory = stepNodeDirectory(job, id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const parentPath = await ensureNodeFoldSnapshot(job, parent);
  await orieditaRequest("/open", {
    method: "POST",
    body: JSON.stringify({ path: parentPath }),
  });
  await ensureParentPreview(job, parent);
  const before = await orieditaRequest("/document");
  const bounds = documentPaperBounds(before);
  const [a, b] = [mapPaperPoint(action.a, bounds), mapPaperPoint(action.b, bounds)];
  await orieditaRequest("/line", {
    method: "POST",
    body: JSON.stringify({
      ax: a[0],
      ay: a[1],
      bx: b[0],
      by: b[1],
      color: action.assignment === "V" ? "VALLEY" : "MOUNTAIN",
    }),
  });

  const foldPath = join(directory, "state.fold");
  const creasePath = join(directory, "crease.png");
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: foldPath }),
  });
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: creasePath }),
  });
  const fold = JSON.parse(await readFile(foldPath, "utf8"));
  const calculation = await orieditaRequest("/fold-calculate", { method: "POST" });
  let completed = false;
  let state = null;
  let foldedPath = null;
  let foldedMimeType = "image/png";
  if (calculation?.started) {
    state = await waitForFold(30_000);
    completed = Boolean(state?.foldedFigures?.completed);
    if (completed) {
      const folded = await orieditaRequest("/folded-figure");
      foldedPath = join(directory, "folded.png");
      foldedMimeType = folded.mimeType;
      await writeFile(foldedPath, Buffer.from(folded.data, "base64"), { mode: 0o600 });
    }
  }

  const partial = evaluatePartialFold({
    fold,
    goal,
    action,
    orieditaCompleted: completed,
    targetCreaseCount: job.maxSteps,
    finalStep: depth >= job.maxSteps,
  });
  const hardFailures = partial.checks
    .filter(({ status }) => status === "fail")
    .flatMap(({ issues, name }) => issues?.length ? issues : [name]);
  if (Number(calculation?.violationCount) > 0) {
    hardFailures.push(`局所平坦折り違反 ${calculation.violationCount}件`);
  }
  const physical = {
    completed,
    hardFailures: [...new Set(hardFailures)],
    score: partial.scores.physical,
    foldabilityScore: partial.scores.foldability,
    checks: partial.checks,
    structure: partial.structure,
    violationCount: Number(calculation?.violationCount) || 0,
    stateType: partial.stateType,
    actionKind: partial.actionKind,
    physicalScope: partial.physicalScope,
    sequentialPhysicalFolding: partial.sequentialPhysicalFolding,
    sequenceFeasibility: partial.sequenceFeasibility,
  };
  const artifacts = {
    foldPath,
    creasePng: creasePath,
    foldedPng: foldedPath,
    foldedMimeType,
  };
  await Promise.all([
    writeFile(join(directory, "action.json"), `${JSON.stringify(action, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, "physical.json"), `${JSON.stringify(physical, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, "document.json"), `${JSON.stringify(await orieditaRequest("/document"), null, 2)}\n`, { mode: 0o600 }),
  ]);
  return { fold, physical, artifacts };
}

function evaluationImagePath(imagePath) {
  if (process.platform !== "darwin") return imagePath;
  const resizedPath = imagePath.replace(/(\.[^.]+)$/i, "-evaluation$1");
  if (resizedPath === imagePath) return imagePath;
  try {
    execFileSync("/usr/bin/sips", ["-Z", "384", imagePath, "--out", resizedPath], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return resizedPath;
  } catch {
    return imagePath;
  }
}

async function stepCandidatePayload(node) {
  const imagePath = node.artifacts?.foldedPng ?? node.artifacts?.creasePng;
  if (typeof imagePath !== "string") throw new Error(`候補${node.id}の比較画像がありません`);
  const resizedPath = evaluationImagePath(imagePath);
  return {
    id: node.id,
    foldedImage: {
      mimeType: node.artifacts?.foldedMimeType ?? "image/png",
      data: (await readFile(resizedPath)).toString("base64"),
    },
    actionSummary: node.action ? {
      type: node.action.type,
      assignment: node.action.assignment,
      segment: { a: node.action.a, b: node.action.b },
      construction: node.action.construction,
    } : { type: "root_square" },
    physicalSummary: {
      score: node.physical?.score ?? 0,
      foldabilityScore: node.physical?.foldabilityScore ?? 0,
      priorTargetScore: node.target?.score ?? 0,
      hardFailures: node.physical?.hardFailures ?? [],
      physicalScope: node.physical?.physicalScope ?? "oriedita_flat_fold_2d",
    },
  };
}

async function stepReferenceImage(job) {
  if (!job.referencePath) return null;
  const extension = job.referencePath.split(".").at(-1)?.toLowerCase();
  const mimeType = extension === "jpg" || extension === "jpeg"
    ? "image/jpeg"
    : extension === "webp" ? "image/webp" : "image/png";
  return {
    mimeType,
    data: (await readFile(evaluationImagePath(job.referencePath))).toString("base64"),
  };
}

async function judgeCreaseStepCandidates(job, { candidates, goal, manifest }) {
  const byParent = new Map();
  for (const candidate of candidates) {
    const siblings = byParent.get(candidate.parentId) ?? [];
    siblings.push(candidate);
    byParent.set(candidate.parentId, siblings);
  }
  const referenceImage = await stepReferenceImage(job);
  const judgements = [];
  for (const [parentId, siblings] of byParent) {
    const parent = manifest.nodes[parentId];
    const parentPayload = await stepCandidatePayload(parent);
    const chunkSize = referenceImage ? 1 : 2;
    for (let offset = 0; offset < siblings.length; offset += chunkSize) {
      const siblingNodes = siblings.slice(offset, offset + chunkSize);
      const siblingPayloads = await Promise.all(siblingNodes.map(stepCandidatePayload));
      let evaluated;
      if (job.stepEvaluatorUnavailable) {
        evaluated = fallbackStepJudgements({ parent: parentPayload, siblings: siblingPayloads, goal });
      } else try {
        evaluated = (await requestGroqStepEvaluation({
          apiKey: groqApiKey,
          model: groqModel,
          endpoint: groqEndpoint,
          prompt: job.prompt,
          goal,
          step: siblingNodes[0]?.depth ?? 1,
          parent: parentPayload,
          siblings: siblingPayloads,
          referenceImage,
          includeParentImage: false,
          timeoutMs: Math.min(jobTimeoutMs, 120_000),
        })).judgements;
      } catch (error) {
        job.stepEvaluatorUnavailable = true;
        console.warn(`一手評価を決定論fallbackへ切り替えます: ${error instanceof Error ? error.message : error}`);
        evaluated = fallbackStepJudgements({ parent: parentPayload, siblings: siblingPayloads, goal });
      }
      const byId = new Map(evaluated.map((entry) => [entry.id, entry]));
      for (const sibling of siblingNodes) {
        const judgement = byId.get(sibling.id);
        if (judgement) judgements.push(judgement);
      }
    }
  }
  return judgements;
}

function publicStepRecord(node) {
  return {
    cycle: node.depth,
    step: node.depth,
    status: node.status,
    score: Math.round(node.target?.score ?? 0),
    physical: Math.round(node.physical?.score ?? 0),
    appearance: Math.round(node.target?.silhouetteScore ?? node.target?.score ?? 0),
    foldability: Math.round(node.physical?.foldabilityScore ?? 0),
    selectedCandidate: node.id,
    issues: node.target?.issues ?? [],
    action: node.action,
  };
}

async function finalizeStepSearchResult(job, search) {
  const best = search.bestNode;
  if (!best?.fold || best.depth < 1) throw new Error("一手ずつの探索で有効な折り線を追加できませんでした");
  const sourcePath = await ensureNodeFoldSnapshot(job, best);
  await orieditaRequest("/open", {
    method: "POST",
    body: JSON.stringify({ path: sourcePath }),
  });
  const calculation = await orieditaRequest("/fold-calculate", { method: "POST" });
  if (!calculation?.started) throw new Error("最終候補に局所平坦折り違反があります");
  const state = await waitForFold(30_000);
  if (!state?.foldedFigures?.completed) throw new Error("最終候補の2D平坦折り計算が完了しませんでした");

  const finalFoldPath = join(job.directory, "final.fold");
  const finalCreasePath = join(job.directory, "final-crease.png");
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalFoldPath }),
  });
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalCreasePath }),
  });
  const foldedFigure = await orieditaRequest("/folded-figure");
  const foldedBytes = Buffer.from(foldedFigure.data, "base64");
  await writeFile(join(job.directory, "final-folded.png"), foldedBytes, { mode: 0o600 });
  const pathNodes = search.bestPath.map(({ nodeId }) => search.manifest.nodes[nodeId]);
  const cycles = pathNodes.map(publicStepRecord);
  const evaluation = {
    score: Math.round(best.target?.score ?? 0),
    iterations: search.bestPath.length,
    stop_reason: search.stopReason,
    summary: best.target?.summary ?? `${search.bestPath.length}手の折り線追加と評価を完了しました`,
    issues: best.target?.issues ?? [],
    mode: "crease_by_crease_evaluation_search",
    physical: {
      score: Math.round(best.physical?.score ?? 0),
      orieditaCompleted: true,
      scope: "oriedita_flat_fold_2d",
    },
    appearance: {
      score: Math.round(best.target?.silhouetteScore ?? best.target?.score ?? 0),
      rotationNormalized: true,
      dimensions: "2d_folded_figure",
    },
    foldability: {
      score: Math.round(best.physical?.foldabilityScore ?? 0),
      layerCount: "unknown",
      clearanceIsProxy: true,
    },
    maxCycles: job.maxSteps,
    targetScore,
    bestCycle: best.depth,
    cycles,
    steps: cycles,
    search: {
      schema: search.manifest.schema,
      evaluatedNodes: search.manifest.evaluatedNodes,
      branches: Math.max(0, Object.keys(search.manifest.nodes).length - 1),
      rollbacks: search.manifest.rollbackCount,
      bestPath: search.bestPath,
      stateType: "crease_pattern_prefix",
      actionKind: "add_crease",
      physicalScope: "oriedita_flat_fold_2d",
      sequentialPhysicalFolding: false,
      sequenceFeasibility: "unverified",
    },
  };
  await Promise.all([
    writeFile(join(job.directory, "final-evaluation.json"), `${JSON.stringify(evaluation, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(job.directory, "generation-loop.json"), `${JSON.stringify({
      stopReason: search.stopReason,
      bestNodeId: best.id,
      bestPath: search.bestPath,
      cycles,
    }, null, 2)}\n`, { mode: 0o600 }),
  ]);
  const [creaseBytes, foldBytes] = await Promise.all([
    readFile(finalCreasePath),
    readFile(finalFoldPath),
  ]);
  return {
    evaluation,
    knowledgeMatch: publicKnowledgeMatch(job.knowledgeMatch),
    knowledgeReferences: job.knowledgeReferences,
    creaseImage: `data:image/png;base64,${creaseBytes.toString("base64")}`,
    foldedImage: `data:${foldedFigure.mimeType};base64,${foldedBytes.toString("base64")}`,
    foldFile: `data:application/json;base64,${foldBytes.toString("base64")}`,
  };
}

async function runStepDesignLoop(job) {
  const stepsDirectory = join(job.directory, "steps");
  await mkdir(join(stepsDirectory, "nodes"), { recursive: true, mode: 0o700 });
  const source = job.candidateFolds[job.preflight.selectedIndex];
  const persist = async ({ event, node, manifest }) => {
    if (node?.fold) await ensureNodeFoldSnapshot(job, node);
    if (node?.target && node.depth > 0) {
      const directory = stepNodeDirectory(job, node.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, "evaluation.json"), `${JSON.stringify({
        target: node.target,
        physical: node.physical,
        status: node.status,
      }, null, 2)}\n`, { mode: 0o600 });
    }
    await appendFile(join(stepsDirectory, "events.ndjson"), `${JSON.stringify(event)}\n`, { mode: 0o600 });
    await writeFile(join(stepsDirectory, "tree.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    job.step = Math.max(job.step ?? 0, Number(node?.depth) || 0);
    job.cycle = job.step;
    job.evaluatedNodes = manifest.evaluatedNodes;
    job.bestScore = manifest.nodes[manifest.bestNodeId]?.target?.score ?? null;
    job.message = `折り線を一手ずつ追加・評価 ${job.step}/${job.maxSteps}`;
  };
  const search = await runStepSearch({
    rootFold: source,
    goal: job.goal,
    maxDepth: job.maxSteps,
    branchFactor: stepBranchFactor,
    beamWidth: stepBeamWidth,
    targetScore,
    simulate: (input) => simulateCreaseStep(job, input),
    judge: (input) => judgeCreaseStepCandidates(job, input),
    persist,
  });
  return finalizeStepSearchResult(job, search);
}

async function runDesignLoop(job) {
  if (job.knowledgeMatch || job.designMode === "regeneration") return runRegenerationLoop(job);
  return runStepDesignLoop(job);
}

async function collectOrieditaFoldResult(job) {
  const inputPath = join(job.directory, "input.fold");
  await orieditaRequest("/open", {
    method: "POST",
    body: JSON.stringify({ path: inputPath }),
  });
  await orieditaRequest("/action", {
    method: "POST",
    body: JSON.stringify({ action: "foldAction" }),
  });
  const state = await waitForFold(job.waitMs);
  const activeFile = typeof state.file === "string" ? resolve(state.file) : "";
  if (!activeFile.startsWith(`${job.directory}/`)) {
    throw new Error("送信された展開図をOrieditaで開けませんでした");
  }
  if (!state.foldedFigures?.completed) {
    throw new Error("Orieditaで折り上がりを計算できませんでした");
  }

  const finalFoldPath = join(job.directory, "final.fold");
  const finalCreasePath = join(job.directory, "final-crease.png");
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalFoldPath }),
  });
  await orieditaRequest("/export", {
    method: "POST",
    body: JSON.stringify({ path: finalCreasePath }),
  });
  const [document, foldedFigure, creaseBytes, foldBytes] = await Promise.all([
    orieditaRequest("/document"),
    orieditaRequest("/folded-figure"),
    readFile(finalCreasePath),
    readFile(finalFoldPath),
  ]);

  return {
    engine: {
      name: "Oriedita",
      version: state.version,
    },
    foldability: {
      completed: true,
      lineCount: document.lineCount,
      figureCount: state.foldedFigures.count,
    },
    creaseImage: `data:image/png;base64,${creaseBytes.toString("base64")}`,
    foldedImage: `data:${foldedFigure.mimeType};base64,${foldedFigure.data}`,
    foldFile: `data:application/json;base64,${foldBytes.toString("base64")}`,
  };
}

async function executeJob(job) {
  job.status = "running";
  job.message = job.type === "oriedita-fold"
    ? "Orieditaで折り上がりを計算中"
    : job.designMode === "crease_step_search"
      ? "折り線を一手ずつ追加し、OrieditaとGroqで評価中"
      : "Orieditaで折り上げ、Groqが評価中";
  job.startedAt = new Date().toISOString();
  try {
    if (job.type === "oriedita-fold") {
      job.result = await collectOrieditaFoldResult(job);
    } else {
      job.result = await runDesignLoop(job);
    }
    job.status = "done";
    job.message = "完了";
  } catch (error) {
    job.status = "failed";
    job.message = "処理に失敗しました";
    job.error = error instanceof Error ? error.message : String(error);
  } finally {
    job.completedAt = new Date().toISOString();
  }
}

async function drainQueue() {
  if (activeJobId) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job) return void drainQueue();
  activeJobId = id;
  await executeJob(job);
  activeJobId = null;
  void drainQueue();
}

async function handle(request, response) {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    send(response, 403, { ok: false, error: "このサイトからは接続できません" }, origin);
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(origin));
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const forwardedProtocol = trustProxy ? request.headers["x-forwarded-proto"] : null;
  const protocol = typeof forwardedProtocol === "string" ? forwardedProtocol.split(",", 1)[0] : "http";
  const serverUrl = `${protocol}://${request.headers.host ?? `${host}:${port}`}`;
  if (request.method === "GET" && url.pathname === "/openapi.json") {
    send(response, 200, createOpenApiDocument(serverUrl), origin);
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, {
      ok: true,
      result: {
        ready: true,
        busy: Boolean(activeJobId),
        queued: queue.length,
        maxIterations,
        maxCycles,
        targetScore,
        designMode,
        stepSearch: { maxSteps: maxCycles, branchFactor: stepBranchFactor, beamWidth: stepBeamWidth },
        knowledgeSearch: knowledgeSearchEnabled,
        evaluator: { provider: "groq", model: groqModel, configured: Boolean(groqApiKey) },
      },
    }, origin);
    return;
  }
  if (request.method === "GET" && url.pathname === "/v1/oriedita/health") {
    send(response, 200, {
      ok: true,
      result: {
        service: "ori-ai-oriedita-api",
        apiVersion: ORIEDITA_API_VERSION,
        ready: true,
        busy: Boolean(activeJobId),
        queued: queue.length,
        authentication: apiToken ? "bearer" : "none",
        maxCycles,
        targetScore,
        designMode,
        stepSearch: { maxSteps: maxCycles, branchFactor: stepBranchFactor, beamWidth: stepBeamWidth },
        knowledgeSearch: knowledgeSearchEnabled,
        evaluator: { provider: "groq", model: groqModel, configured: Boolean(groqApiKey) },
        oriedita: await inspectOriedita(),
      },
    }, origin);
    return;
  }
  if (request.method === "POST" && url.pathname === "/v1/oriedita/fold") {
    requireApiAccess(request);
    let input;
    try {
      input = validateFoldRequest(await readJson(request));
    } catch (error) {
      if (error instanceof ApiInputError) throw new HttpError(error.status, error.message);
      throw error;
    }
    consumeSubmissionQuota(request);
    const job = await createOrieditaFoldJob(input);
    send(response, 202, { ok: true, job: publicJob(job) }, origin);
    return;
  }
  const orieditaJobMatch = url.pathname.match(/^\/v1\/oriedita\/jobs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && orieditaJobMatch) {
    requireApiAccess(request);
    const job = jobs.get(orieditaJobMatch[1]);
    if (!job || job.type !== "oriedita-fold") throw new HttpError(404, "ジョブが見つかりません");
    send(response, 200, { ok: true, job: publicJob(job) }, origin);
    return;
  }
  if (request.method === "POST" && url.pathname === "/jobs") {
    const input = validateJobInput(await readJson(request));
    consumeSubmissionQuota(request);
    const job = await createJob(input);
    send(response, 202, { ok: true, job: publicJob(job) }, origin);
    return;
  }
  const match = url.pathname.match(/^\/jobs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && match) {
    const job = jobs.get(match[1]);
    if (!job) throw new HttpError(404, "ジョブが見つかりません");
    send(response, 200, { ok: true, job: publicJob(job) }, origin);
    return;
  }
  throw new HttpError(404, "見つかりません");
}

await mkdir(workRoot, { recursive: true, mode: 0o700 });
const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof HttpError || error instanceof ApiInputError ? error.status : 500;
    const message = error instanceof Error ? error.message : "サーバーエラー";
    send(response, status, { ok: false, error: message }, request.headers.origin);
  });
});
server.listen(port, host, () => {
  process.stdout.write(`ORIAI local Oriedita server: http://${host}:${port}\n`);
});
