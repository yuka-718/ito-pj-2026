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
