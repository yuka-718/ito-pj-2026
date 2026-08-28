import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const simulatorRoot = new URL("../public/origami-simulator/", import.meta.url);

test("vendored simulator is pinned and retains license notices", async () => {
  const [vendorNotes, upstreamLicense, thirdPartyNotices] = await Promise.all([
    readFile(new URL("ORIAI-VENDORING.md", simulatorRoot), "utf8"),
    readFile(new URL("LICENSE", simulatorRoot), "utf8"),
    readFile(new URL("THIRD_PARTY_NOTICES.md", simulatorRoot), "utf8"),
  ]);
  assert.match(vendorNotes, /7855983a613c879c171b2b1557f8cd102d2640cf/);
  assert.match(upstreamLicense, /MIT License/);
  assert.match(thirdPartyNotices, /dat\.guiVR \| Apache-2\.0/);
  assert.match(thirdPartyNotices, /Earcut \| ISC/);
});

test("iframe bridge only accepts its same-origin direct parent", async () => {
  const importer = await readFile(new URL("js/importer.js", simulatorRoot), "utf8");
  assert.match(importer, /e\.source !== window\.parent/);
  assert.match(importer, /e\.origin !== bridgeOrigin/);
  assert.match(importer, /window\.parent\.postMessage\(message, bridgeOrigin\)/);
  assert.match(importer, /globals\.setCreasePercent\(1\)/);
  assert.match(importer, /globals\.creasePercent = 1/);
  assert.match(importer, /globals\.shouldChangeCreasePercent = true/);
  assert.match(importer, /data\.op === ['"]hello['"]/);
  assert.doesNotMatch(importer, /postMessage\([^\n]+,\s*['"]\*['"]\)/);
  for (const status of ["ready", "loaded", "error"]) {
    assert.match(importer, new RegExp(`['"]${status}['"]`));
  }
});

test("application uses a deployment-relative simulator URL and strict replies", async () => {
  const component = await readFile(new URL("../app/OrigamiSimulator3D.tsx", import.meta.url), "utf8");
  assert.match(component, /SIMULATOR_URL = "\.\/origami-simulator\/index\.html"/);
  assert.match(component, /event\.origin !== window\.location\.origin/);
  assert.match(component, /event\.source !== iframeRef\.current\?\.contentWindow/);
  assert.match(component, /armTimeout\(BOOT_TIMEOUT_MS,\s*requestId\)/);
  assert.match(component, /armTimeout\(IMPORT_TIMEOUT_MS,\s*requestId\)/);
  assert.match(component, /onLoad=\{requestReady\}/);
  assert.doesNotMatch(component, /https:\/\/origamisimulator\.org/);
});

test("application waits for the Codex and Oriedita job before showing either result panel", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /API_DISCOVERY_URL/);
  assert.match(page, /api\.github\.com\/repos\/yuka-718\/oriai\/contents\/oriedita-upstream\.json/);
  assert.match(page, /application\/vnd\.github\.raw\+json/);
  assert.match(page, /candidateToFold/);
  assert.match(page, /generateCandidates/);
  assert.match(page, /apiFetch\("\/jobs"/);
  assert.match(page, /waitForApiOrigin\(\)/);
  assert.match(page, /API_RECONNECT_ATTEMPTS = 30/);
  assert.match(page, /生成サーバーへ接続できませんでした/);
  assert.match(page, /waitForJob\(payload\.job\.id/);
  assert.match(page, /\{result && \(\s*<section className="outputs"/);
  assert.match(page, /src=\{result\.creaseImage\}/);
  assert.match(page, /src=\{result\.foldedImage\}/);
  assert.match(page, /<OrigamiSimulator3D foldFile=\{result\.foldFile\}/);
  assert.match(page, /CodexがOrieditaを操作・評価中/);
});

test("terminal job failures bypass transient polling retries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const waitForJob = page.slice(
    page.indexOf("async function waitForJob"),
    page.indexOf("export default function Home"),
  );
  const terminalFailure = waitForJob.indexOf('payload.job.status === "failed"');

  assert.notEqual(terminalFailure, -1);
  assert.ok(terminalFailure > waitForJob.lastIndexOf("catch (error)"));
  assert.match(waitForJob, /catch \(error\) \{\s*transientFailures \+= 1;\s*if \(transientFailures > 12\) throw error;\s*continue;\s*\}/);
});

test("embed removes analytics and exposes only the WebGL canvas", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("index.html", simulatorRoot), "utf8"),
    readFile(new URL("css/embed.css", simulatorRoot), "utf8"),
  ]);
  assert.match(html, /css\/embed\.css/);
  assert.doesNotMatch(html, /googletagmanager/);
  assert.match(css, /body > :not\(#threeContainer\)/);
  assert.match(css, /#threeContainer canvas/);
});
