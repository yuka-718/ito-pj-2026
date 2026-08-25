import assert from "node:assert/strict";
import test from "node:test";

import { isOrieditaApiRequest, proxyOrieditaRequest } from "../worker/oriedita-proxy.ts";

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
