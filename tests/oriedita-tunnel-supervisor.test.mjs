import assert from "node:assert/strict";
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
