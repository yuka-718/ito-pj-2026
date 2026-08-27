import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { latestTunnelUrl } from "../scripts/oriedita-tunnel-supervisor.mjs";

test("extracts the latest quick tunnel URL from cloudflared output", () => {
  const output = `
  https://old-tunnel.trycloudflare.com
  retrying
  https://current-tunnel.trycloudflare.com
  `;
  assert.equal(latestTunnelUrl(output), "https://current-tunnel.trycloudflare.com");
  assert.equal(
    latestTunnelUrl("abc123.lhr.life tunneled with tls termination, https://abc123.lhr.life"),
    "https://abc123.lhr.life",
  );
  assert.equal(
    latestTunnelUrl("your url is: https://oriai-ito-pj-2026.loca.lt"),
    "https://oriai-ito-pj-2026.loca.lt",
  );
  assert.equal(latestTunnelUrl("no tunnel yet"), null);
});

test("detects a dropped public tunnel quickly", async () => {
  const source = await readFile(new URL("../scripts/oriedita-tunnel-supervisor.mjs", import.meta.url), "utf8");
  assert.match(source, /await delay\(5_000\)/);
  assert.match(source, /failures >= 2/);
  assert.match(source, /"ServerAliveInterval=10"/);
});
