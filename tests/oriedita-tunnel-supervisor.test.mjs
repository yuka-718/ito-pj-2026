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
  assert.equal(latestTunnelUrl("no tunnel yet"), null);
});
