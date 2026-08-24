#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const workRoot = resolve(projectRoot, "work", "local-jobs");
const resultSchema = resolve(here, "result.schema.json");
const port = Number.parseInt(process.env.ORI_AI_LOCAL_PORT ?? "8788", 10);
const host = "127.0.0.1";
const maxIterations = Math.min(5, Math.max(1, Number.parseInt(process.env.ORI_AI_MAX_ITERATIONS ?? "3", 10)));
const codexModel = process.env.ORI_AI_CODEX_MODEL ?? "gpt-5.6-terra";
const codexBin = process.env.ORI_AI_CODEX_BIN
  ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const orieditaMcpServer = process.env.ORIEDITA_MCP_SERVER
  ?? "/Users/yukaito/Documents/oriedita/oriedita-mcp/server.mjs";
const userSuffix = typeof process.getuid === "function" ? process.getuid() : "user";
const connectionFile = resolve(
  process.env.ORIEDITA_MCP_RUNTIME_DIR
    ?? join(tmpdir(), `oriedita-mcp-${userSuffix}`),
  "connection.json",
);

const allowedOrigins = new Set([
  "https://yuka-718.github.io",
  ...(process.env.ORI_AI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
]);
const jobs = new Map();
const queue = [];
let activeJobId = null;

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;
  return /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    message: job.message,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    result: job.result,
    error: job.error,
  };
}

function validateJobInput(value) {
  const prompt = typeof value?.prompt === "string" ? value.prompt.trim().slice(0, 200) : "";
  const fold = value?.fold;
  if (!prompt && !value?.referenceImage) {
    throw new HttpError(400, "プロンプトか参考画像が必要です");
  }
  if (!fold || typeof fold !== "object" || !Array.isArray(fold.vertices_coords) || !Array.isArray(fold.edges_vertices)) {
    throw new HttpError(400, "展開図データが不正です");
  }
  const encodedFold = JSON.stringify(fold);
  if (encodedFold.length > 1_000_000) throw new HttpError(413, "展開図データが大きすぎます");

  let referenceImage = null;
  if (value?.referenceImage != null) {
    if (typeof value.referenceImage !== "string") throw new HttpError(400, "参考画像が不正です");
    const match = value.referenceImage.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new HttpError(400, "PNG、JPEG、WEBPの参考画像を使用してください");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 10 * 1024 * 1024) throw new HttpError(413, "参考画像は10MB以下にしてください");
    referenceImage = { mimeType: match[1], bytes };
  }
  return { prompt, fold, referenceImage };
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
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(join(directory, "input.fold"), `${JSON.stringify(input.fold, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, "brief.txt"), `${input.prompt || "参考画像をもとに設計"}\n`, { mode: 0o600 });

  let referencePath = null;
  if (input.referenceImage) {
    referencePath = join(directory, `reference${extensionForMimeType(input.referenceImage.mimeType)}`);
    await writeFile(referencePath, input.referenceImage.bytes, { mode: 0o600 });
  }

  const job = {
    id,
    directory,
    referencePath,
    prompt: input.prompt,
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

function workerPrompt(job) {
  return `あなたは伊藤PJの折り紙設計改善ワーカーです。CodexからOriedita MCPを操作し、入力展開図を評価・改善してください。

作業ディレクトリ内の入力:
- brief.txt: 作りたい折り紙
- input.fold: ブラウザが作成した初期展開図
${job.referencePath ? `- ${job.referencePath.split("/").at(-1)}: 参考画像` : "- 参考画像なし"}

必ず行うこと:
1. Orieditaのget_statusを呼び、open_fileで input.fold を開く。
2. foldActionを実行し、get_folded_figureで折り上がりを確認する。
3. モチーフの特徴、輪郭、平坦折り可能性、線の明瞭さを評価する。
4. 必要ならFOLDデータまたはOrieditaの線を修正し、再度開いて折る。最大${maxIterations}回で終了する。
5. 最後にOriedita上へ最良案を開いた状態にし、foldActionを完了させる。

制約:
- 一枚の正方形、切断なし、接着なしを守る。
- 作業ディレクトリ以外のファイルは変更しない。
- サブエージェントは使わず、この1セッションだけで完了する。
- マウス座標操作より、open_file、add_line、perform_actionなど意味のある操作を優先する。
- 実際に折れない案を折れると断定しない。
- 最終回答は指定されたJSONスキーマだけを返す。`;
}

function runCodex(job) {
  return new Promise((resolveRun, rejectRun) => {
    const outputPath = join(job.directory, "evaluation.json");
    const logPath = join(job.directory, "codex.log");
    const log = createWriteStream(logPath, { flags: "a", mode: 0o600 });
    const args = [
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--color", "never",
      "--approve-for-me",
      "--model", codexModel,
      "--config", "model_reasoning_effort=\"medium\"",
      "--config", "mcp_servers.oriedita.command=\"node\"",
      "--config", `mcp_servers.oriedita.args=[${JSON.stringify(orieditaMcpServer)}]`,
      "--cd", job.directory,
      "--output-schema", resultSchema,
      "--output-last-message", outputPath,
    ];
    if (job.referencePath) args.push("--image", job.referencePath);
    args.push("-");

    const child = spawn(codexBin, args, {
      cwd: job.directory,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdin.end(workerPrompt(job));
    child.once("error", (error) => {
      log.end();
      rejectRun(error);
    });
    child.once("exit", (code, signal) => {
      log.end();
      if (code === 0) resolveRun(outputPath);
      else rejectRun(new Error(`Codexが終了しました (${signal ?? code ?? "unknown"})`));
    });
  });
}

async function readConnection() {
  const connection = JSON.parse(await readFile(connectionFile, "utf8"));
  if (typeof connection.url !== "string" || typeof connection.token !== "string") {
    throw new Error("Oriedita接続情報が不正です");
  }
  return connection;
}

async function orieditaRequest(path, options = {}) {
  const connection = await readConnection();
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

async function waitForFold(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await orieditaRequest("/state");
    if (!state.foldingTask?.running) return state;
    await new Promise((resolveWait) => setTimeout(resolveWait, 180));
  }
  throw new Error("Orieditaの折り計算がタイムアウトしました");
}

async function collectResult(job, evaluationPath) {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  const state = await waitForFold();
  const activeFile = typeof state.file === "string" ? resolve(state.file) : "";
  if (!activeFile.startsWith(`${job.directory}/`)) {
    throw new Error("Codexがこのジョブの展開図をOrieditaで開けませんでした");
  }
  if (!state.foldedFigures?.completed) {
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

  return {
    evaluation,
    creaseImage: `data:image/png;base64,${creaseBytes.toString("base64")}`,
    foldedImage: `data:${foldedFigure.mimeType};base64,${foldedFigure.data}`,
    foldFile: `data:application/json;base64,${foldBytes.toString("base64")}`,
  };
}

async function executeJob(job) {
  job.status = "running";
  job.message = "CodexがOrieditaを操作中";
  job.startedAt = new Date().toISOString();
  try {
    const evaluationPath = await runCodex(job);
    job.message = "結果を書き出し中";
    job.result = await collectResult(job, evaluationPath);
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
  if (request.method === "GET" && url.pathname === "/health") {
    send(response, 200, {
      ok: true,
      result: {
        ready: true,
        busy: Boolean(activeJobId),
        queued: queue.length,
        maxIterations,
      },
    }, origin);
    return;
  }
  if (request.method === "POST" && url.pathname === "/jobs") {
    const input = validateJobInput(await readJson(request));
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

await Promise.all([mkdir(workRoot, { recursive: true, mode: 0o700 }), access(resultSchema)]);
const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "サーバーエラー";
    send(response, status, { ok: false, error: message }, request.headers.origin);
  });
});
server.listen(port, host, () => {
  process.stdout.write(`ORI AI local Oriedita server: http://${host}:${port}\n`);
});
