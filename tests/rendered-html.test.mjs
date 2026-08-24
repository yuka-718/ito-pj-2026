import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the interactive ORI AI Studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*lang="ja"/i);
  assert.match(html, /ORI AI STUDIO/);
  assert.match(html, /言葉から/);
  assert.match(html, /折りの候補/);
  assert.match(html, /3つの構造候補を生成/);
  assert.match(html, /LOCAL KAWASAKI/);
  assert.match(html, /FOLD 1\.2/);
  assert.match(html, /作品全体の平坦折り/);
  assert.match(html, /og-studio\.png/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("contains the social assets, static output, and no starter preview", async () => {
  await Promise.all([
    access(new URL("../public/og-studio.png", import.meta.url)),
    access(new URL("../public/favicon.svg", import.meta.url)),
    access(new URL("../dist/client/index.html", import.meta.url)),
  ]);

  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  const packageJson = await readFile(new URL("../package.json", import.meta.url), "utf8");
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
