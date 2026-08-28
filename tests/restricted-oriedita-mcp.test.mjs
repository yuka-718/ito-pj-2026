import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  appendActionIntentWal,
  inspectSymlinkFreePath,
  inspectRestrictedToolRequest,
  logicalizeMappedPaths,
  parseAllowedPaths,
  parsePathMappings,
  restrictedUpstreamEnvironment,
  restrictedActionKey,
} from "../local-oriedita/restricted-oriedita-mcp.mjs";

const initialFold = "/tmp/job/initial.fold";

function request(name, path, id = 1) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: { path } },
  };
}

test("restricted MCP permits only the current job's exact open and export paths", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-exact-policy-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const jobDirectory = join(temporaryRoot, "job");
  const realInitialFold = join(jobDirectory, "initial.fold");
  const realFinalFold = join(jobDirectory, "final.fold");
  const realFinalCrease = join(jobDirectory, "final-crease.png");
  await mkdir(jobDirectory);
  await writeFile(realInitialFold, "initial");
  await writeFile(realFinalFold, "final");
  const realPolicy = {
    allowedOpenPaths: new Set([realInitialFold, realFinalFold]),
    allowedExportPaths: new Set([realFinalFold, realFinalCrease]),
  };
  assert.equal(inspectRestrictedToolRequest(request("open_file", realInitialFold), realPolicy).allowed, true);
  assert.equal(inspectRestrictedToolRequest(request("open_file", realFinalFold), realPolicy).allowed, true);
  assert.equal(inspectRestrictedToolRequest(request("export_file", realFinalFold), realPolicy).allowed, true);
  assert.equal(inspectRestrictedToolRequest(request("export_file", realFinalCrease), realPolicy).allowed, true);

  for (const blocked of [
    request("open_file", "/tmp/private.fold"),
    request("export_file", "/tmp/private.fold"),
    request("export_file", realInitialFold),
    request("export_file", "relative.fold"),
  ]) {
    const result = inspectRestrictedToolRequest(blocked, realPolicy);
    assert.equal(result.allowed, false);
    assert.match(result.response.error.message, /outside this ORIAI job/);
  }
  assert.equal(inspectRestrictedToolRequest(request("add_line", "/tmp/private.fold"), realPolicy).allowed, true);
});

test("allowed path environment input is fail-closed", () => {
  assert.deepEqual([...parseAllowedPaths(JSON.stringify([initialFold, "relative.fold", 42]))], [initialFold]);
  assert.equal(parseAllowedPaths("not json").size, 0);
  assert.equal(parseAllowedPaths(undefined).size, 0);
});

test("add-line intent is fsynced to the WAL before upstream mutation", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-action-intent-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const walPath = join(temporaryRoot, "action-attempts.jsonl");
  const forward = { ax: -200, ay: 12.5, bx: 200, by: 12.5, color: "VALLEY" };
  const reversed = { ax: 200, ay: 12.5, bx: -200, by: 12.5, color: "VALLEY" };
  const actionKey = restrictedActionKey(forward);
  assert.equal(actionKey, restrictedActionKey(reversed));
  appendActionIntentWal(walPath, {
    schema: "oriai-codex-action-wal-v1",
    phase: "intent",
    batch: 3,
    batch_step: 2,
    action_key: actionKey,
  });
  const record = JSON.parse((await readFile(walPath, "utf8")).trim());
  assert.equal(record.phase, "intent");
  assert.equal(record.action_key, actionKey);
});

test("path mappings rewrite exact logical paths to symlink-free physical staging paths", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-path-mapping-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const logicalDirectory = join(temporaryRoot, "logical");
  const physicalDirectory = join(temporaryRoot, "physical");
  const logicalPath = join(logicalDirectory, "final.fold");
  const physicalPath = join(physicalDirectory, "final.fold");
  await mkdir(logicalDirectory);
  await mkdir(physicalDirectory);
  await writeFile(logicalPath, "logical");
  await writeFile(physicalPath, "physical");
  const pathMappings = parsePathMappings(JSON.stringify([{
    tool: "export_file",
    logical_path: logicalPath,
    physical_path: physicalPath,
  }]));
  const decision = inspectRestrictedToolRequest(request("export_file", logicalPath), { pathMappings });
  assert.equal(decision.allowed, true);
  assert.equal(decision.request.params.arguments.path, physicalPath);
  assert.deepEqual(logicalizeMappedPaths({
    content: [{ type: "text", text: `Exported ${physicalPath}` }],
    structuredContent: { path: physicalPath },
  }, pathMappings), {
    content: [{ type: "text", text: `Exported ${logicalPath}` }],
    structuredContent: { path: logicalPath },
  });
  assert.equal(inspectRestrictedToolRequest(request("open_file", logicalPath), { pathMappings }).allowed, false);
  assert.equal(parsePathMappings("not-json").size, 0);
});

test("restricted MCP rejects symlinks in an allowed path and its parents", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-path-policy-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const realDirectory = join(temporaryRoot, "real");
  const linkedDirectory = join(temporaryRoot, "linked");
  const externalFile = join(temporaryRoot, "external.fold");
  const linkedFile = join(temporaryRoot, "linked.fold");
  await mkdir(realDirectory);
  await writeFile(externalFile, "unchanged");
  await symlink(realDirectory, linkedDirectory);
  await symlink(externalFile, linkedFile);

  assert.equal(inspectSymlinkFreePath(externalFile).safe, true);
  assert.equal(inspectSymlinkFreePath(linkedFile).reason, "symlink");
  assert.equal(inspectSymlinkFreePath(join(linkedDirectory, "final.fold"), { allowMissingLeaf: true }).reason, "symlink");

  const linkedPolicy = {
    allowedOpenPaths: new Set([linkedFile]),
    allowedExportPaths: new Set([linkedFile, join(linkedDirectory, "final.fold")]),
  };
  assert.equal(inspectRestrictedToolRequest(request("open_file", linkedFile), linkedPolicy).allowed, false);
  assert.equal(inspectRestrictedToolRequest(request("export_file", linkedFile), linkedPolicy).allowed, false);
  assert.equal(inspectRestrictedToolRequest(request("export_file", join(linkedDirectory, "final.fold")), linkedPolicy).allowed, false);
});

test("blocked symlink exports never reach the upstream process or modify external files", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-proxy-process-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const realDirectory = join(temporaryRoot, "real");
  const linkedDirectory = join(temporaryRoot, "linked");
  const externalFile = join(temporaryRoot, "external.fold");
  const linkedFile = join(temporaryRoot, "linked.fold");
  const nestedExternalFile = join(realDirectory, "nested.fold");
  const upstreamLog = join(temporaryRoot, "upstream.log");
  const upstreamPath = join(temporaryRoot, "fake-upstream.mjs");
  await mkdir(realDirectory);
  await writeFile(externalFile, "unchanged-file");
  await writeFile(nestedExternalFile, "unchanged-parent");
  await writeFile(upstreamLog, "");
  await symlink(externalFile, linkedFile);
  await symlink(realDirectory, linkedDirectory);
  await writeFile(upstreamPath, `
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const logPath = ${JSON.stringify(upstreamLog)};
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  appendFileSync(logPath, line + "\\n");
  const request = JSON.parse(line);
  writeFileSync(request.params.arguments.path, "modified-by-upstream");
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { path: request.params.arguments.path } }) + "\\n");
});
`);

  const proxyPath = new URL("../local-oriedita/restricted-oriedita-mcp.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [proxyPath], {
    env: {
      ...process.env,
      ORIAI_ORIEDITA_MCP_UPSTREAM: upstreamPath,
      ORIAI_ORIEDITA_ALLOWED_OPEN_PATHS: "[]",
      ORIAI_ORIEDITA_ALLOWED_EXPORT_PATHS: JSON.stringify([
        linkedFile,
        join(linkedDirectory, "nested.fold"),
      ]),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(request("export_file", linkedFile, 41))}\n${JSON.stringify(request("export_file", join(linkedDirectory, "nested.fold"), 42))}\n`);
  const [code] = await once(child, "close");

  assert.equal(code, 0, stderr);
  assert.equal((stdout.match(/outside this ORIAI job/g) ?? []).length, 2);
  assert.equal(await readFile(upstreamLog, "utf8"), "");
  assert.equal(await readFile(externalFile, "utf8"), "unchanged-file");
  assert.equal(await readFile(nestedExternalFile, "utf8"), "unchanged-parent");
});

test("logical leaf replacement after inspection cannot redirect an upstream export", async (t) => {
  const temporaryRoot = await realpath(await mkdtemp(join(tmpdir(), "oriai-proxy-race-")));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  const logicalDirectory = join(temporaryRoot, "logical");
  const physicalDirectory = join(temporaryRoot, "physical");
  const logicalPath = join(logicalDirectory, "final.fold");
  const physicalPath = join(physicalDirectory, "final.fold");
  const externalPath = join(temporaryRoot, "external.fold");
  const markerPath = join(temporaryRoot, "upstream-received");
  const releasePath = join(temporaryRoot, "release-upstream");
  const upstreamLog = join(temporaryRoot, "upstream.log");
  const upstreamPath = join(temporaryRoot, "delayed-upstream.mjs");
  await mkdir(logicalDirectory);
  await mkdir(physicalDirectory);
  await writeFile(logicalPath, "logical-before-race");
  await writeFile(physicalPath, "physical-before-race");
  await writeFile(externalPath, "external-unchanged");
  await writeFile(upstreamLog, "");
  await writeFile(upstreamPath, `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  appendFileSync(${JSON.stringify(upstreamLog)}, line + "\\n");
  writeFileSync(${JSON.stringify(markerPath)}, "received");
  while (!existsSync(${JSON.stringify(releasePath)})) await sleep(5);
  const request = JSON.parse(line);
  writeFileSync(request.params.arguments.path, "physical-after-race");
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { path: request.params.arguments.path } }) + "\\n");
});
`);
  const mappings = [{
    tool: "export_file",
    logical_path: logicalPath,
    physical_path: physicalPath,
  }];
  const proxyPath = new URL("../local-oriedita/restricted-oriedita-mcp.mjs", import.meta.url).pathname;
  const child = spawn(process.execPath, [proxyPath], {
    env: {
      ...process.env,
      ORIAI_ORIEDITA_MCP_UPSTREAM: upstreamPath,
      ORIAI_ORIEDITA_PATH_MAPPINGS: JSON.stringify(mappings),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${JSON.stringify(request("export_file", logicalPath, 73))}\n`);

  const markerDeadline = Date.now() + 5_000;
  while (Date.now() < markerDeadline) {
    try {
      await access(markerPath);
      break;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 5));
    }
  }
  await access(markerPath);
  await rm(logicalPath);
  await symlink(externalPath, logicalPath);
  await writeFile(releasePath, "continue");
  const [code] = await once(child, "close");

  assert.equal(code, 0, stderr);
  assert.equal(await readFile(physicalPath, "utf8"), "physical-after-race");
  assert.equal(await readFile(externalPath, "utf8"), "external-unchanged");
  const forwarded = await readFile(upstreamLog, "utf8");
  assert.equal(JSON.parse(forwarded).params.arguments.path, physicalPath);
  assert.equal(JSON.parse(stdout).result.path, logicalPath);
  assert.doesNotMatch(stdout, new RegExp(physicalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("upstream environment removes proxy policy and unrelated secrets", () => {
  assert.deepEqual(restrictedUpstreamEnvironment({
    PATH: "/bin",
    LANG: "ja_JP.UTF-8",
    LC_MESSAGES: "ja_JP.UTF-8",
    ORIEDITA_JAVA: "/usr/bin/java",
    ORIAI_ORIEDITA_ALLOWED_OPEN_PATHS: "secret-policy",
    ORIAI_ORIEDITA_PATH_MAPPINGS: "secret-mapping",
    OPENAI_API_KEY: "secret-key",
    GH_TOKEN: "secret-token",
  }), {
    PATH: "/bin",
    LANG: "ja_JP.UTF-8",
    LC_MESSAGES: "ja_JP.UTF-8",
    ORIEDITA_JAVA: "/usr/bin/java",
  });
});
