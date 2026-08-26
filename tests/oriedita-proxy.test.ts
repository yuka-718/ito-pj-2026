import assert from "node:assert/strict";
import test from "node:test";

import {
  isOrieditaApiRequest,
  proxyOrieditaRequest,
  resolveOrieditaUpstream,
} from "../worker/oriedita-proxy.ts";

test("recognizes only the stable public API prefix", () => {
  assert.equal(isOrieditaApiRequest(new URL("https://site.example/api/jobs")), true);
  assert.equal(isOrieditaApiRequest(new URL("https://site.example/_next/static/app.js")), false);
});

test("proxies an allowed Oriedita route and forwards the client address", async () => {
  let forwarded: Request | null = null;
  const response = await proxyOrieditaRequest(
    new Request("https://site.example/api/v1/oriedita/health", {
      headers: { "CF-Connecting-IP": "203.0.113.8" },
    }),
    "https://engine.example",
    async (request) => {
      forwarded = request;
      return Response.json({ ok: true });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(forwarded?.url, "https://engine.example/v1/oriedita/health");
  assert.equal(forwarded?.headers.get("X-Forwarded-For"), "203.0.113.8");
});

test("does not expose arbitrary upstream paths", async () => {
  const response = await proxyOrieditaRequest(
    new Request("https://site.example/api/action", { method: "POST" }),
    "https://engine.example",
  );
  assert.equal(response.status, 404);
});

test("discovers the current tunnel and falls back when discovery is unavailable", async () => {
  const discovered = await resolveOrieditaUpstream(
    "https://registry.example/oriedita.json",
    "https://old-engine.example",
    async () => Response.json({ url: "https://current-engine.example/ignored-path" }),
    100_000,
  );
  assert.equal(discovered, "https://current-engine.example");

  const fallback = await resolveOrieditaUpstream(
    "https://another-registry.example/oriedita.json",
    "https://fallback-engine.example",
    async () => new Response("unavailable", { status: 503 }),
    200_000,
  );
  assert.equal(fallback, "https://fallback-engine.example");
});
