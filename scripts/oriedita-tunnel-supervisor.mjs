#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";

const cloudflared = process.env.ORI_AI_CLOUDFLARED ?? "/opt/homebrew/bin/cloudflared";
const ssh = process.env.ORI_AI_SSH ?? "/usr/bin/ssh";
const provider = process.env.ORI_AI_TUNNEL_PROVIDER ?? "localhost-run";
const gh = process.env.ORI_AI_GH ?? "/opt/homebrew/bin/gh";
const registryRepo = process.env.ORI_AI_TUNNEL_REGISTRY_REPO ?? "yuka-718/oriai";
const registryBranch = process.env.ORI_AI_TUNNEL_REGISTRY_BRANCH ?? "runtime";
const registryPath = process.env.ORI_AI_TUNNEL_REGISTRY_PATH ?? "oriedita-upstream.json";
const localHealth = process.env.ORI_AI_LOCAL_HEALTH ?? "http://127.0.0.1:8788/health";
const tunnelUrlPattern = /https:\/\/(?:[a-z0-9-]+\.trycloudflare\.com|[a-z0-9-]+\.lhr\.life)/gi;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function latestTunnelUrl(value) {
  return String(value ?? "").match(tunnelUrlPattern)?.at(-1)?.toLowerCase() ?? null;
}

async function ghJson(argumentsList, input = null) {
  const options = { encoding: "utf8", maxBuffer: 2_000_000 };
  if (input != null) options.input = JSON.stringify(input);
  const stdout = execFileSync(gh, argumentsList, options);
  return stdout.trim() ? JSON.parse(stdout) : null;
}

export async function publishTunnelUrl(url) {
  const endpoint = `repos/${registryRepo}/contents/${registryPath}`;
  let existing = null;
  try {
    existing = await ghJson(["api", `${endpoint}?ref=${registryBranch}`]);
  } catch {
    // The first write creates the registry file on the existing runtime branch.
  }
  const document = `${JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 2)}\n`;
  const payload = {
    message: "Update ORIAI runtime tunnel",
    branch: registryBranch,
    content: Buffer.from(document).toString("base64"),
    ...(typeof existing?.sha === "string" ? { sha: existing.sha } : {}),
  };
  await ghJson(["api", "--method", "PUT", endpoint, "--input", "-"], payload);
}

async function healthy(url, timeoutMs = 10_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return payload?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function startTunnel() {
  const command = provider === "cloudflare" ? cloudflared : ssh;
  const argumentsList = provider === "cloudflare" ? [
    "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", localHealth.replace(/\/health$/, ""),
  ] : [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "ExitOnForwardFailure=yes",
    "-R", "80:127.0.0.1:8788",
    "nokey@localhost.run",
  ];
  const child = spawn(command, argumentsList, { stdio: ["ignore", "pipe", "pipe"] });
  let buffer = "";
  let settled = false;
  const url = new Promise((resolve, reject) => {
    const inspectChunk = (chunk) => {
      buffer = `${buffer}${chunk}`.slice(-16_000);
      const found = latestTunnelUrl(buffer);
      if (found && !settled) {
        settled = true;
        resolve(found);
      }
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      inspectChunk(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      inspectChunk(chunk);
    });
    child.once("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("exit", (code, signal) => {
      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared exited before publishing a URL (${code ?? signal})`));
      }
    });
  });
  return { child, url };
}

async function supervise() {
  for (;;) {
    const { child, url: urlPromise } = startTunnel();
    try {
      const url = await Promise.race([
        urlPromise,
        delay(45_000).then(() => { throw new Error("cloudflared URL timeout"); }),
      ]);
      let ready = false;
      for (let attempt = 0; attempt < 30 && child.exitCode == null; attempt += 1) {
        if (await healthy(`${url}/health`)) {
          ready = true;
          break;
        }
        await delay(1_000);
      }
      if (!ready) throw new Error("quick tunnel did not become healthy");
      await publishTunnelUrl(url);
      process.stdout.write(`ORIAI public tunnel: ${url}\n`);

      let failures = 0;
      while (child.exitCode == null) {
        await delay(30_000);
        if (await healthy(`${url}/health`)) {
          failures = 0;
        } else {
          failures += 1;
          if (failures >= 3) throw new Error("quick tunnel health check failed");
        }
      }
    } catch (error) {
      process.stderr.write(`ORIAI tunnel restarting: ${error instanceof Error ? error.message : error}\n`);
    } finally {
      if (child.exitCode == null) child.kill("SIGTERM");
      await delay(2_000);
    }
  }
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  await supervise();
}
