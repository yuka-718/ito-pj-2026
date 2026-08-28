#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_ENV_KEYS = new Set([
  "DISPLAY",
  "HOME",
  "JAVA_HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "ORIEDITA_JAR",
  "ORIEDITA_JAVA",
  "ORIEDITA_MCP_RUNTIME_DIR",
  "PATH",
  "SECURITYSESSIONID",
  "SHELL",
  "SYSTEMROOT",
  "TMPDIR",
  "USER",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "__CF_USER_TEXT_ENCODING",
]);

function normalizedAllowedPaths(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value
    .filter((path) => typeof path === "string" && isAbsolute(path))
    .map((path) => resolve(path)));
}

export function parseAllowedPaths(value) {
  try {
    return normalizedAllowedPaths(JSON.parse(value ?? "[]"));
  } catch {
    return new Set();
  }
}

function pathMappingKey(tool, path) {
  return `${tool}\u0000${resolve(path)}`;
}

export function parsePathMappings(value) {
  try {
    const source = JSON.parse(value ?? "[]");
    if (!Array.isArray(source)) return new Map();
    const mappings = new Map();
    for (const entry of source) {
      const tool = entry?.tool;
      const logicalPath = entry?.logical_path;
      const physicalPath = entry?.physical_path;
      if ((tool !== "open_file" && tool !== "export_file")
        || typeof logicalPath !== "string"
        || typeof physicalPath !== "string"
        || !isAbsolute(logicalPath)
        || !isAbsolute(physicalPath)) continue;
      const normalized = {
        tool,
        logical_path: resolve(logicalPath),
        physical_path: resolve(physicalPath),
      };
      mappings.set(pathMappingKey(tool, logicalPath), normalized);
    }
    return mappings;
  } catch {
    return new Map();
  }
}

export function restrictedUpstreamEnvironment(source = {}) {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    typeof value === "string"
    && (UPSTREAM_ENV_KEYS.has(key) || key.startsWith("LC_"))));
}

export function inspectSymlinkFreePath(path, { allowMissingLeaf = false } = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    return { safe: false, reason: "not_absolute", path: null };
  }
  const resolvedPath = resolve(path);
  const { root } = parse(resolvedPath);
  const segments = resolvedPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let currentPath = root;
  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment);
    const isLeaf = index === segments.length - 1;
    try {
      const stat = lstatSync(currentPath);
      if (stat.isSymbolicLink()) {
        return { safe: false, reason: "symlink", path: currentPath };
      }
      if (!isLeaf && !stat.isDirectory()) {
        return { safe: false, reason: "parent_not_directory", path: currentPath };
      }
    } catch (error) {
      if (allowMissingLeaf && isLeaf && error?.code === "ENOENT") continue;
      return { safe: false, reason: error?.code ?? "uninspectable", path: currentPath };
    }
  }
  return { safe: true, reason: null, path: resolvedPath };
}

export function inspectRestrictedToolRequest(request, {
  allowedOpenPaths = new Set(),
  allowedExportPaths = new Set(),
  pathMappings = new Map(),
} = {}) {
  if (request?.method !== "tools/call") return { allowed: true };
  const tool = request?.params?.name;
  if (tool !== "open_file" && tool !== "export_file") return { allowed: true };
  const path = request?.params?.arguments?.path;
  const allowed = tool === "open_file" ? allowedOpenPaths : allowedExportPaths;
  if (typeof path === "string" && isAbsolute(path)) {
    const mapping = pathMappings.get(pathMappingKey(tool, path));
    if (mapping) {
      const pathInspection = inspectSymlinkFreePath(mapping.physical_path, {
        allowMissingLeaf: tool === "export_file",
      });
      if (pathInspection.safe) {
        return {
          allowed: true,
          request: {
            ...request,
            params: {
              ...request.params,
              arguments: {
                ...request.params.arguments,
                path: mapping.physical_path,
              },
            },
          },
        };
      }
    }
  }
  if (typeof path === "string" && isAbsolute(path) && allowed.has(resolve(path))) {
    const pathInspection = inspectSymlinkFreePath(path, { allowMissingLeaf: tool === "export_file" });
    if (pathInspection.safe) return { allowed: true };
  }
  return {
    allowed: false,
    response: {
      jsonrpc: request?.jsonrpc ?? "2.0",
      id: request?.id ?? null,
      error: {
        code: -32602,
        message: `${tool} path is outside this ORIAI job`,
      },
    },
  };
}

const ACTION_COORDINATE_SCALE = 1e6;

function actionCoordinate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const rounded = Math.round(number * ACTION_COORDINATE_SCALE);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function restrictedActionKey(line) {
  const color = typeof line?.color === "string" ? line.color.toUpperCase() : "";
  if (color !== "MOUNTAIN" && color !== "VALLEY") return null;
  const coordinates = [line?.ax, line?.ay, line?.bx, line?.by].map(actionCoordinate);
  if (coordinates.some((value) => value == null)) return null;
  const [ax, ay, bx, by] = coordinates;
  const first = `${ax},${ay}`;
  const second = `${bx},${by}`;
  if (first === second) return null;
  const [start, end] = first < second ? [first, second] : [second, first];
  return `${color}:${start}:${end}`;
}

export function appendActionIntentWal(path, record) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("action WAL path must be absolute");
  }
  const parent = inspectSymlinkFreePath(dirname(resolve(path)));
  const leaf = inspectSymlinkFreePath(resolve(path), { allowMissingLeaf: true });
  if (!parent.safe || !leaf.safe) throw new Error("action WAL path is not symlink-safe");
  let descriptor;
  try {
    descriptor = openSync(
      resolve(path),
      constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    writeSync(descriptor, `${JSON.stringify(record)}\n`);
    fsyncSync(descriptor);
  } finally {
    if (descriptor != null) closeSync(descriptor);
  }
}

function mappedPathReplacements(pathMappings) {
  return [...pathMappings.values()].map(({ logical_path: logicalPath, physical_path: physicalPath }) => ({
    logicalPath,
    physicalPath,
  }));
}

function replaceMappedPathText(value, pathMappings) {
  return mappedPathReplacements(pathMappings).reduce(
    (text, { logicalPath, physicalPath }) => text.split(physicalPath).join(logicalPath),
    value,
  );
}

export function logicalizeMappedPaths(value, pathMappings = new Map()) {
  if (typeof value === "string") return replaceMappedPathText(value, pathMappings);
  if (Array.isArray(value)) return value.map((entry) => logicalizeMappedPaths(entry, pathMappings));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    logicalizeMappedPaths(entry, pathMappings),
  ]));
}

function startProxy() {
  const upstream = process.env.ORIAI_ORIEDITA_MCP_UPSTREAM;
  if (!upstream || !isAbsolute(upstream)) {
    throw new Error("ORIAI_ORIEDITA_MCP_UPSTREAM must be an absolute path");
  }
  const policy = {
    allowedOpenPaths: parseAllowedPaths(process.env.ORIAI_ORIEDITA_ALLOWED_OPEN_PATHS),
    allowedExportPaths: parseAllowedPaths(process.env.ORIAI_ORIEDITA_ALLOWED_EXPORT_PATHS),
    pathMappings: parsePathMappings(process.env.ORIAI_ORIEDITA_PATH_MAPPINGS),
  };
  const actionWalPath = process.env.ORIAI_ORIEDITA_ACTION_WAL_PATH;
  const actionBatch = Math.max(1, Number.parseInt(process.env.ORIAI_ORIEDITA_ACTION_BATCH ?? "1", 10) || 1);
  const actionIterationOffset = Math.max(0, Number.parseInt(process.env.ORIAI_ORIEDITA_ACTION_ITERATION_OFFSET ?? "0", 10) || 0);
  let actionSequence = 0;
  const child = spawn(process.execPath, [resolve(upstream)], {
    cwd: dirname(resolve(upstream)),
    env: restrictedUpstreamEnvironment(process.env),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let outputBuffer = "";
  const routeOutputLine = (line) => {
    if (!line.trim()) return;
    try {
      const response = logicalizeMappedPaths(JSON.parse(line), policy.pathMappings);
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch {
      process.stdout.write(`${replaceMappedPathText(line, policy.pathMappings)}\n`);
    }
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    outputBuffer += chunk;
    const lines = outputBuffer.split(/\r?\n/);
    outputBuffer = lines.pop() ?? "";
    for (const line of lines) routeOutputLine(line);
  });
  child.stdout.on("end", () => {
    if (outputBuffer.trim()) routeOutputLine(outputBuffer);
    outputBuffer = "";
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    process.stderr.write(replaceMappedPathText(chunk, policy.pathMappings));
  });

  let inputBuffer = "";
  const routeLine = (line) => {
    if (!line.trim()) return;
    let forwardedLine = line;
    try {
      const request = JSON.parse(line);
      const decision = inspectRestrictedToolRequest(request, policy);
      if (!decision.allowed) {
        process.stdout.write(`${JSON.stringify(decision.response)}\n`);
        return;
      }
      if (request?.method === "tools/call" && request?.params?.name === "add_line") {
        const actionKey = restrictedActionKey(request.params.arguments);
        if (!actionKey) throw new Error("add_line does not have a valid action key");
        actionSequence += 1;
        appendActionIntentWal(actionWalPath, {
          schema: "oriai-codex-action-wal-v1",
          phase: "intent",
          batch: actionBatch,
          batch_step: actionSequence,
          step: actionIterationOffset + actionSequence,
          action_key: actionKey,
          arguments: request.params.arguments,
          proxy_pid: process.pid,
          recorded_at: new Date().toISOString(),
        });
      }
      forwardedLine = JSON.stringify(decision.request ?? request);
    } catch (error) {
      try {
        const request = JSON.parse(line);
        if (request?.method === "tools/call" && request?.params?.name === "add_line") {
          process.stdout.write(`${JSON.stringify({
            jsonrpc: request?.jsonrpc ?? "2.0",
            id: request?.id ?? null,
            error: { code: -32603, message: `add_line action WAL failed: ${error instanceof Error ? error.message : error}` },
          })}\n`);
          return;
        }
      } catch {
        // Let the upstream MCP server report malformed protocol messages.
      }
    }
    child.stdin.write(`${forwardedLine}\n`);
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    inputBuffer += chunk;
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() ?? "";
    for (const line of lines) routeLine(line);
  });
  process.stdin.on("end", () => {
    if (inputBuffer.trim()) routeLine(inputBuffer);
    child.stdin.end();
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
  child.on("close", (code, signal) => {
    if (code !== 0) {
      process.stderr.write(`Oriedita MCP upstream exited (${code ?? signal})\n`);
      process.exitCode = code ?? 1;
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startProxy();
}
